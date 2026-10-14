# Taskop Reports — Part 1: Contracts & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `reports.view` holders see live, scope-filtered counts, comparisons and lists of the runs, problems and tasks of any period, and let `reports.export` holders download them as CSV, Excel or PDF, by adding the report contracts, i18n strings and `@taskop/api-client` methods, the two permissions with their backfill, the `occurrences (tenant_id, local_date)` index, the `reports` NestJS module with its six endpoints and the exporter of the sub-project 7 spec §3–§5 and §9.

**Architecture:**
- **One rule set, two implementations.** `packages/contracts/src/report-logic.ts` defines the buckets (`classifyRun`), completion % and average score; `apps/api/src/reports/report-queries.ts` implements the same rules as SQL `count(*) filter (…)` columns over a `runs` CTE. Percentages are always computed in TypeScript from the SQL counts and score sums (`completionPercent`, `roundOne`), and a cross-check test compares the SQL counts with `tallyRuns` over the same rows.
- **Live SQL, no tables.** Every request runs inside the request's tenant transaction (`TenantContextInterceptor`), first `SET LOCAL statement_timeout`, then the queries. Runs and problems are scoped with `SchedulingScope.occurrences(principal)`, tasks with `TaskScope.readable(principal)`; filters are ANDed on top. SQLSTATE `57014` becomes `503 REPORT_TIMEOUT`.
- **Exports** build a neutral `ReportDocument` (titled sections of typed columns) from the same query results, then write it with `toCsv` (hand-written, BOM, RFC 4180, formula neutralising), `toXlsx` (`write-excel-file/node`, one sheet per section, typed cells) or `toPdf` (`pdfmake` with embedded Noto Sans). A count query runs before any rows are read (10,000-row cap), and each export writes an `reports.exported` audit entry in the same transaction.
- **Run detail** reuses `GET /occurrences/:id`, `GET /executions/:id` and `GET /media/:id/url`; their permission gate is widened to `assignments.view` **or** `reports.view` (same data scope), see Spec decision 1.

**Tech Stack:** Node 24, TypeScript 7, NestJS 12, nestjs-zod 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18, Vitest 5, Testcontainers (Postgres), supertest. **New packages (versions checked with `npm view` on 2026-10-14):** `pdfmake@^0.3.11` and `write-excel-file@^4.1.1` (API dependencies; both ship CommonJS for the API's swc CJS build: `pdfmake`'s `main` is `js/index.js`, `write-excel-file/node` has a `require` export), `@types/pdfmake@^0.3.3`, and the test-only `read-excel-file@^9.3.12`, `unpdf@^1.8.1` (PDF text extraction over pdf.js) and `csv-parse@^7.0.3`. The API also gains the workspace dependency `@taskop/i18n` (ESM, loaded through Node 24's `require(esm)` exactly as `@taskop/contracts` already is). Noto Sans Regular and Bold TTFs are committed files, not a package (Task 14).

**Spec:** `docs/superpowers/specs/2026-10-14-reports-design.md`

**This plan is Part 1 of 3:**
- Part 1 (this file): contracts, i18n strings, the API client, the permission migration and index, the `reports` module (six endpoints and the exports), the run-detail permission widening, API tests, the performance seed and timing scripts.
- Part 2 (`apps/mobile`): `docs/superpowers/plans/2026-10-14-reports-2-mobile.md`. Part 3 (`apps/web`): `docs/superpowers/plans/2026-10-14-reports-3-web.md`. Both are written against the section **Interfaces for Parts 2 and 3** below and do not depend on each other.
- **Tasks 1–5 unblock Parts 2 and 3:** they need nothing from the API and give both apps every type, zod schema, pure function (`report-logic.ts`, including the period presets), i18n key, permission key, error code and `@taskop/api-client` method (including the export download). Tasks 6 (permission migration) and 7 (run-detail access) must be merged before Parts 2 and 3 run their integration or end-to-end tests against a real API, and Tasks 8–15 before any screen shows real numbers.
- Unlike SP6, no existing contract field becomes required, so no app fixture breaks; the apps' typechecks stay green after every task of this part.

**Deployment plan note (not a task).** Production may set `REPORTS_STATEMENT_TIMEOUT_MS` (optional, default `15000`). The API image needs nothing else: `pnpm build` copies the PDF fonts into `dist/reports/pdf/fonts` (Task 14). Whoever merges `docs/superpowers/specs/2026-10-09-deployment-design.md` adds the variable to the API's environment list.

## Global Constraints

- The product name is **Taskop**. Packages are `@taskop/*`. Azerbaijani (`az`) is the only locale; every exported heading, status label and PDF header comes from `@taskop/i18n`.
- **Range:** `from` and `to` are tenant-local `YYYY-MM-DD` dates, both inclusive. `to − from ≤ 365` days (a range covers at most **366** days), otherwise **`400 REPORT_RANGE_TOO_LONG`**. `from > to` is `400 VALIDATION_FAILED` with `fields.to = 'reports.issues.toBeforeFrom'`.
- **Pages:** `/reports/runs`, `/reports/problems` and `/reports/tasks` return pages of **50**. Keyset cursors use the same format as `/problems`: `cursor` is the last row's id, compared as a `(sort key, id) < (select … where id = cursor)` tuple.
- **Exports:** at most **10,000** rows per list section, checked by a count query before any file is built; above that **`422 REPORT_TOO_LARGE`** with `{ rows, limit }` in the error body.
- **Timeout:** every report request runs `SET LOCAL statement_timeout` = **15 s** (`REPORTS_STATEMENT_TIMEOUT_MS`, default `15000`); SQLSTATE `57014` → **`503 REPORT_TIMEOUT`**.
- **Error codes** (new, in `@taskop/contracts` and `az.errors`): `REPORT_RANGE_TOO_LONG` (400), `REPORT_TOO_LARGE` (422), `REPORT_TIMEOUT` (503). Everything else uses the existing `VALIDATION_FAILED` (400), `FORBIDDEN` (403), `NOT_FOUND` (404).
- **Permissions:** `reports.view` (dashboard, Reports page, Team tab, the six GET endpoints) and `reports.export` (file downloads; also requires `reports.view`), in a new `reports` permission group, last. `SYSTEM_ROLE_DEFAULTS`: Manager and Auditor get both; Owner and Admin get both through `ALL_PERMISSIONS`; Worker gets neither. Migration `0014_reports_permissions.sql` backfills both keys for every existing `admin`, `manager` and `auditor` role and bumps their `version`.
- **Scope:** runs and problems through `SchedulingScope.occurrences(principal)`, tasks through `TaskScope.readable(principal)`; both fail closed on an unknown scope. Filters are ANDed with the scope: `siteId` matches the site **and its subtree** (`sites.path <@ :path`), `userId` follows spec §3.3, `checklistId` is exact. A filter outside the viewer's scope returns empty results, never 403.
- **Metrics (spec §3.1):** Planned `status <> 'cancelled'`; Due = Planned and (`due_at <= now` or Completed); Completed `completed | audit_pending | audited`; In progress `started | in_progress`; Pending, Overdue, Partial, Missed by status; With problems / critical from `execution_problems`. Completion % = Completed ÷ Due × 100, one decimal, `null` when Due = 0. Average score = mean of `executions.score->>'percent'` over the period's non-rejected executions where it is not null. Runs belong to a period by `occurrences.local_date`; problems by their occurrence's `local_date`; tasks by `coalesce(due_at, created_at)` converted to the tenant-local day.
- **Endpoints (all `GET`):** `/reports/summary`, `/reports/sites`, `/reports/employees`, `/reports/runs`, `/reports/problems`, `/reports/tasks`, and `/reports/:kind/export?format=csv|xlsx|pdf` with `kind` ∈ `summary | sites | employees | runs | problems | tasks | full` (`full` takes `xlsx | pdf` only).
- **File names:** `Content-Disposition: attachment; filename="taskop-<kind>-<from>_<to>.<ext>"`; `Content-Type` `text/csv; charset=utf-8`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `application/pdf`.
- **CSV:** UTF-8 with a BOM, comma-separated, RFC 4180 quoting, CRLF line ends; text cells starting with `=`, `+`, `-` or `@` (and tab or CR, Spec decision 19) are prefixed with `'`.
- **Excel:** numbers and dates are typed cells (`type: Number` / `type: Date` with a format), one sheet per section for the full report. **PDF:** Noto Sans Regular and Bold embedded, header with tenant name, period, filters and generation time.
- **Time:** timestamps in exports are on the tenant's wall clock; run exports include the device completion time and the server receipt time (FR-10.14). "Now" for Due is the injected `Clock` (one reading per request), so tests move time with `FakeClock`.
- **Audit:** each successful export writes `reports.exported` (entity type `report`, entity id `null`, `after: { kind, format, filters, rows }`).
- **Migrations:** `0013_reports.sql` (generated: `occurrences_local_date_idx` on `occurrences (tenant_id, local_date)`) and `0014_reports_permissions.sql` (custom: the backfill). No new tables, no new executions index (Spec decision 24).
- **Performance target:** every report endpoint answers in **under 500 ms** at a **366-day** range on the volume seed (50 sites, 200 users, one year, about 70k occurrences), for an `all`-scope and a `site_subtree` principal. Indexes beyond `occurrences_local_date_idx` are added only for an endpoint that misses it.
- **Dependencies, exactly:** API `pdfmake ^0.3.11`, `write-excel-file ^4.1.1`, `@taskop/i18n workspace:*`; API dev `@types/pdfmake ^0.3.3`, `read-excel-file ^9.3.12`, `unpdf ^1.8.1`, `csv-parse ^7.0.3`. Nothing else.

### Spec decisions this plan makes (ambiguities and gaps, resolved)

1. **§5.6 verified: the run-detail scope already matches; the permission gate did not.** `ExecutionAccess.assertCanRead` (behind `GET /executions/:id` and `GET /media/:id/url`) and `GET /occurrences/:id` both filter with `SchedulingScope.occurrences(principal)`, the same SQL the reports use, so a `site_subtree` manager reads runs at their sites and below and a `subordinates` manager reads the runs of their chain (executors are always assignees: `EligibilityService.canStart` refuses `NOT_ASSIGNED`). But both gates require `assignments.view`, so a role with `reports.view` alone sees a run in the report and gets 404/403 on its drawer. Task 7 accepts `assignments.view` **or** `reports.view` on all three reads (new `RequireAnyPermission` decorator, `permAny` route helper), and pins both manager cases with tests.
2. **"Now" is the request's `Clock` reading**, passed to SQL as a parameter (not SQL `now()`), so a request's numbers are internally consistent and tests can freeze time.
3. **Percentages are computed in TypeScript** from SQL counts (`completionPercent`) and from SQL `sum`/`count` of scores (`roundOne(sum / count)`), so the API and `report-logic.ts` round identically.
4. **`this_week` and `this_month` end today** (Monday → today, the 1st → today), like `last_7` / `last_30`; future days would only add pending runs that are not materialised yet beyond the 14-day horizon.
5. **`GET /reports/problems` takes `severity?: normal | critical`** (needed by the web dashboard's "critical problems" panel). It narrows both `counts` and `items`; the problems export honours it too.
6. **Two more run buckets, `completed` and `in_progress`,** so the Completed and In progress tiles (web) and chips (mobile) can link to a list. `RUN_BUCKETS = ['overdue', 'partial', 'missed', 'problems', 'completed', 'in_progress', 'all']`.
7. **Runs are ordered `due_at desc, id desc`** (a keyset tuple needs one direction); the cursor is the last occurrence id.
8. **Run rows add `late` and `clockSuspect`** (spec §8: "the flag is visible in the run list and in exports"). Fields the spec marks optional (`executionId?`, `executor?`, times, `score?`) are always present and `null` when absent.
9. **The Unassigned row** has `userId: null`, `name: "Təyin edilməyib"` (server-side from `@taskop/i18n`) and `active: true`, and comes last; the other employee rows are ordered by name. Sites come in tree order (`sites.path`) with `path` = ancestor names, root first.
10. **Filters on problems and tasks:** problems' `userId` = the executor (only executed runs have problems); tasks' `userId` = `assignee_user_id` (an unaccepted team task matches no user); tasks' `checklistId` = the checklist of the task's problem (ad-hoc tasks never match); tasks' `siteId` = the task's site in the subtree (tasks without a site never match).
11. **Task rows** are ordered `coalesce(due_at, created_at) desc, id desc` (the period key) with the same cursor format; `overdue` = `overdue_at is not null` (kept after completion, as `TaskSummary.overdueAt`); "Completed on time / late" count only `completed` tasks.
12. **Problem and task `counts` come with every page**, computed over the whole filtered set (the cursor does not affect them).
13. **No `limit` parameter:** pages are fixed at 50 (`REPORT_LIMITS.pageSize`); the dashboard shows the first 10 of the first page.
14. **The statement timeout is configurable** (`REPORTS_STATEMENT_TIMEOUT_MS`, default 15000) so the 503 test does not wait 15 s; it is set once per report request with `SET LOCAL`, covering every statement of that request's transaction.
15. **The range-length check lives in the API** (`ReportFilterResolver`), not in zod, so it answers its own code `REPORT_RANGE_TOO_LONG`; clients can check first with `reportRangeTooLong(from, to)`.
16. **One export route, `GET /reports/:kind/export`,** with `kind` ∈ `REPORT_EXPORT_KINDS` (including `full`); an unknown kind is `404`; `full` with `format=csv` is `400 VALIDATION_FAILED`, `fields.format = 'reports.issues.fullNotCsv'`. `bucket` applies to the `runs` kind (default `all`) and `severity` to `problems`; `full` ignores both (it is the complete report).
17. **The summary export has two sections** (measures, daily trend). CSV writes sections one after the other, each with its own header row, separated by one empty line; XLSX writes one sheet per section; PDF one heading per section.
18. **Row cap details:** list kinds count first (`countRuns`, `problemCounts.total`, the task status counts); `full` checks every list section before reading any rows and reports the largest count above 10,000. Sites and employees are bounded by the tenant's sites and users, so they are checked after their aggregation.
19. **Formula neutralising** covers the spec's `=`, `+`, `-`, `@` plus a leading tab or CR (OWASP CSV injection list). It applies to text cells only, so numeric columns (e.g. a negative value) are never altered.
20. **Audit entry:** `{ action: 'reports.exported', entityType: 'report', entityId: null, after: { kind, format, filters: { from, to, siteId, userId, checklistId, bucket, severity }, rows } }` (absent filters are `null`; `rows` = data rows written). A refused export (403, 422, 503) writes nothing: the transaction rolls back.
21. **Export time formats:** CSV and PDF print `DD.MM.YYYY HH:mm` on the tenant's wall clock and `DD.MM.YYYY` for dates; XLSX `Date` cells hold the tenant's wall-clock reading (Excel dates have no zone) with formats `dd.mm.yyyy hh:mm` / `dd.mm.yyyy`. Run exports carry the device start, device completion and server receipt times.
22. **Fonts** come from the npm tarball `@expo-google-fonts/noto-sans@0.4.2` (Google Fonts' static Noto Sans 400 and 700, SIL OFL 1.1; checked to contain ə, Ə, ğ, ı, İ, ş, ç, ö, ü), renamed to `NotoSans-Regular.ttf` / `NotoSans-Bold.ttf`, with its `LICENSE_FONT` as `OFL.txt`, verified by SHA-256. The API's `build` script copies them into `dist`.
23. **The API depends on `@taskop/i18n`** for export labels and the Unassigned row name.
24. **Indexes (§5.7):** only `occurrences (tenant_id, local_date)` is new. Executions are already covered twice: `executions_occurrence_idx (tenant_id, occurrence_id)` and the partial unique `executions_claim_uq (occurrence_id) where state <> 'rejected'`, which is exactly the reports' join condition.
25. **Existing Admin roles are backfilled too:** they were seeded with the permission list of their time, so without the backfill they would lack both keys.
26. **Problem flags are one aggregated join** per request (problems of the period's occurrences grouped by occurrence), not an `exists` per row.
27. **"Non-rejected executions" includes active ones** for the average score (the spec's literal rule); a rejected execution never counts anywhere.

## Review Focus

These are the five failure modes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **A run with a lost claim beside the counted one.** Two people claimed the same run; the loser's rejected execution (with its own score) must not change the run's bucket, the average score, or who it is attributed to. Pinned in Task 8 (`counts the period's runs by bucket…`: average 78.6 ignores the rejected 10) and Task 9 (`attributes executed runs to the executor only…`: R16 counts for Kamran, not Aynur).
2. **Days around a DST change in a tenant outside Baku.** The trend must have exactly one entry per calendar day, and tasks must land on their tenant-local due day near midnight, also on the 25-hour day. Pinned in Task 1 (`lists every calendar day, also across a DST change`), Task 8 (`keeps one trend entry per calendar day across a DST change`), Task 11 (`places a task by its due time's local day in the tenant timezone`) and Task 13 (`reads both sides of a DST change correctly`).
3. **A site moved in the tree after its runs happened.** The `siteId` subtree filter and the ancestor names must follow where the site is now; the old parent must no longer include it. Pinned in Task 9 (`follows a site moved in the tree…`).
4. **Spreadsheet-hostile text in exports.** Notes with commas, quotes, line breaks, Azerbaijani letters or a leading `=` must round-trip through a CSV parser unchanged except for the `'` guard. Pinned in Task 13 (`round-trips Azerbaijani text, quotes and line breaks…`) and Task 15 (`keeps problem notes intact and neutralises formulas in CSV`).
5. **An empty period.** Counts are 0, percentages `null`, the trend has one zero entry per day, and every export still produces a valid file with headers only. Pinned in Task 8 (`answers zeros, no percentages and one entry per day…`) and Task 15 (`produces header-only files for an empty period`).

---
## File Structure

```
packages/contracts/src/
  report-logic.ts (+ test)                  buckets, classifyRun, tallyRuns, completionPercent, averageScore, roundOne,
                                            attributeRun, period presets, periodDays, REPORT_LIMITS, reportRangeTooLong
  reports.ts (+ reports.test.ts)            kinds, formats, buckets, issue codes, query schemas, response schemas,
                                            REPORT_CONTENT_TYPES, reportFileName
  permissions.ts                            + reports group; Manager and Auditor defaults
  errors.ts                                 + REPORT_RANGE_TOO_LONG, REPORT_TOO_LARGE, REPORT_TIMEOUT; error body rows/limit
  audit.ts                                  + REPORT_AUDIT_ACTIONS
  index.ts                                  + report-logic, reports
  notifications.test.ts                     permission assertions no longer assume "notifications is last"
packages/i18n/src/az/
  reports.ts                                new namespace
  errors.ts, roles.ts, audit.ts, nav.ts, index.ts, ../i18n.test.ts
packages/api-client/src/
  client.ts                                 + ApiClient.download, DownloadedFile, parseContentDispositionFilename
  errors.ts                                 ApiError + rows, limit
  endpoints.ts                              + createReportsApi, ReportFile
  client.test.ts
apps/api/
  package.json                              + deps; build copies fonts; db:seed-report-volume, perf:reports scripts
  .env.example                              + REPORTS_STATEMENT_TIMEOUT_MS
  drizzle/0013_reports.sql                  (generated) occurrences_local_date_idx
  drizzle/0014_reports_permissions.sql      (custom) permission backfill
  src/db/schema.ts                          + occurrences_local_date_idx
  src/config/config.ts (+ test)             + REPORTS_STATEMENT_TIMEOUT_MS
  src/common/app-error.ts                   details + rows, limit
  src/common/decorators.ts                  + RequireAnyPermission, PermissionRequirement
  src/common/error.filter.ts (+ test)       + reports.* field keys
  src/auth/permission.guard.ts (+ test)     any-of requirements
  src/checklists/route-mode.ts              + permAny
  src/scheduling/occurrences.controller.ts  GET /occurrences/:id: assignments.view or reports.view
  src/executions/execution-access.ts        assignments.view or reports.view
  src/app.module.ts                         + ReportsModule
  src/reports/
    reports.module.ts
    report-filters.ts                       ResolvedFilters, ReportFilterResolver (range, site path, timezone, now)
    report-queries.ts                       ReportQueries: summary, sites, employees, runs, countRuns, problems,
                                            problemCounts, tasks, taskCounts
    reports.service.ts                      ReportsService: guarded (timeout, 57014), one method per endpoint
    reports.controller.ts                   the six GETs and the export
    dto.ts
    report-exporter.ts                      ReportExporter: sections per kind, row cap, audit, file
    export/report-table.ts (+ test)         ReportDocument, ReportTable, cellText, formatDate, formatInstant, wallClock
    export/report-tables.ts (+ test)        summaryTables, sitesTable, employeesTable, runsTable, runsTitle,
                                            problemsTable, tasksTable
    export/csv.ts (+ test)                  toCsv, csvField, neutralise
    export/xlsx.ts (+ test)                 toXlsx, sheetName
    pdf/pdf-document.ts (+ test)            toPdf, pdfDefinition, FONTS_DIR
    pdf/fonts/NotoSans-Regular.ttf, NotoSans-Bold.ttf, OFL.txt
  src/scripts/seed-report-volume.ts         the performance seed
  test/report-fixtures.ts                   reportBase, addSite, addChecklist, addRun, addProblem, addTask, reportWorld
  test/perf/time-reports.ts                 the timing script (500 ms target)
  test/reports-db.test.ts, reports-run-access.test.ts, reports-summary.test.ts, reports-tables.test.ts,
  reports-runs.test.ts, reports-problems-tasks.test.ts, reports-scope.test.ts, reports-export.test.ts
  test/roles.test.ts, openapi.test.ts       (extended)
```

---
## Interfaces for Parts 2 and 3

Everything below is exported from `@taskop/contracts`, `@taskop/i18n` or `@taskop/api-client` once **Tasks 1–5** of Part 1 are merged. Parts 2 and 3 import these names exactly. All instants are ISO-8601 UTC strings; dates are `YYYY-MM-DD` in the tenant's timezone.

### `@taskop/contracts`

**Metric rules** (`report-logic.ts`, Part 1 Task 1):
- `RUN_COUNT_KEYS = ['planned', 'due', 'completed', 'inProgress', 'pending', 'overdue', 'partial', 'missed', 'withProblems', 'withCritical'] as const`, `type RunCountKey`, `type RunCounts = Record<RunCountKey, number>`, `type RunFlags = Record<RunCountKey, boolean>`
- `COMPLETED_STATUSES = ['completed', 'audit_pending', 'audited'] as const`, `IN_PROGRESS_STATUSES = ['started', 'in_progress'] as const`
- `interface RunFacts { status: OccurrenceStatus; dueAt: Date | string; hasProblems: boolean; hasCritical: boolean }`
- `classifyRun(run: RunFacts, now: Date): RunFlags` — spec §3.1. A cancelled run has every flag `false`; `due` is `planned && (completed || dueAt <= now)`; `withProblems` / `withCritical` only on planned runs.
- `tallyRuns(runs: readonly RunFacts[], now: Date): RunCounts`, `emptyRunCounts(): RunCounts`
- `roundOne(x: number): number` — `Math.round(x * 10) / 10`
- `completionPercent(completed: number, due: number): number | null` — `null` when `due === 0`, else `roundOne(completed / due * 100)`
- `averageScore(values: readonly (number | null | undefined)[]): number | null` — mean of the numbers, `roundOne`, `null` when none
- `interface AttributionFacts { status: OccurrenceStatus; executorUserId: string | null; assigneeIds: readonly string[] }`; `attributeRun(run: AttributionFacts): (string | null)[]` — spec §3.3: `[]` for cancelled, `[executorUserId]` when executed, else the assignees, else `[null]` (the Unassigned row)
- `PERIOD_PRESETS = ['today', 'yesterday', 'this_week', 'this_month', 'last_7', 'last_30'] as const`, `type PeriodPreset`, `interface Period { from: LocalDate; to: LocalDate }`
- `resolvePeriod(preset: PeriodPreset, today: LocalDate): Period` — from the **tenant's** today (`localDateOf(now, me.tenant.timezone)`); weeks start on Monday; `this_week` = Monday → today, `this_month` = the 1st → today, `last_7` = today − 6 → today, `last_30` = today − 29 → today (Spec decision 4). "Custom" is the UI's own state, not a preset.
- `periodDays(from: LocalDate, to: LocalDate): LocalDate[]` — every calendar day, inclusive
- `REPORT_LIMITS = { maxRangeDays: 366, pageSize: 50, exportRowCap: 10_000, statementTimeoutMs: 15_000 } as const`
- `reportRangeTooLong(from: LocalDate, to: LocalDate): boolean` — `to − from > 365`

**Catalogue, queries and responses** (`reports.ts`, Part 1 Task 2):
- `REPORT_KINDS = ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks'] as const`, `reportKindSchema`, `type ReportKind`
- `REPORT_EXPORT_KINDS = [...REPORT_KINDS, 'full'] as const`, `reportExportKindSchema`, `type ReportExportKind`
- `REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const`, `reportFormatSchema`, `type ReportFormat`
- `RUN_BUCKETS = ['overdue', 'partial', 'missed', 'problems', 'completed', 'in_progress', 'all'] as const`, `runBucketSchema`, `type RunBucket` (Spec decision 6). `problems` = with problems (not cancelled); `all` includes cancelled runs.
- `REPORT_ISSUE_CODES = ['reports.issues.toBeforeFrom', 'reports.issues.fullNotCsv'] as const`, `type ReportIssueCode`
- `reportFiltersSchema` — `{ from: LocalDate; to: LocalDate; siteId?: uuid; userId?: uuid; checklistId?: uuid }`, refine `to ≥ from` (`path: ['to']`, `reports.issues.toBeforeFrom`). `type ReportFiltersQuery = z.input`, `type ReportFilters = z.output`.
- `reportRunsQuerySchema` — filters + `bucket?: RunBucket` (default `'all'`) + `cursor?: uuid`. `type ReportRunsQuery` (input), `type ReportRunsParams` (output).
- `reportProblemsQuerySchema` — filters + `severity?: 'normal' | 'critical'` + `cursor?: uuid`. `type ReportProblemsQuery`, `type ReportProblemsParams`.
- `reportTasksQuerySchema` — filters + `cursor?: uuid`. `type ReportTasksQuery`, `type ReportTasksParams`.
- `reportExportQuerySchema` — filters + `format: ReportFormat` + `bucket?: RunBucket` + `severity?: 'normal' | 'critical'`. `type ReportExportQuery`, `type ReportExportParams`.
- `runCountsSchema` — one non-negative integer per `RUN_COUNT_KEYS` key, in that order
- `reportTrendDaySchema` / `type ReportTrendDay = { date: LocalDate; due: number; completed: number; completionPercent: number | null }`
- `reportSummarySchema` / `type ReportSummary = { counts: RunCounts; completionPercent: number | null; averageScore: number | null; trend: ReportTrendDay[] }` — one trend entry per day of the range, zero days included
- `siteReportRowSchema` / `type SiteReportRow = RunCounts & { siteId: string; name: string; path: string[] /* ancestor names, root first */; active: boolean; completionPercent: number | null; averageScore: number | null }`
- `employeeReportRowSchema` / `type EmployeeReportRow = RunCounts & { userId: string | null; name: string; active: boolean; completionPercent: number | null; averageScore: number | null }`
- `reportRunSchema` / `type ReportRun = { occurrenceId; executionId: string | null; localDate; dueAt; checklist: { id; name }; site: { id; name }; status: OccurrenceStatus; assignees: UserRef[] /* by name */; executor: UserRef | null; startedAt: string | null; completedAt: string | null /* device */; completedReceivedAt: string | null /* server */; score: number | null; problemCount: number; criticalCount: number; late: boolean; clockSuspect: boolean }`; `reportRunPageSchema = pageOf(reportRunSchema)`
- `reportProblemSchema` / `type ReportProblem = ProblemDto & { taskStatus: TaskStatus | null }` (the existing `/problems` row, with the linked task's status)
- `reportProblemCountsSchema` / `type ReportProblemCounts = { total; critical; resolution: { none; open; resolved; cancelled } }`
- `reportProblemsSchema` / `type ReportProblems = { counts: ReportProblemCounts; items: ReportProblem[]; nextCursor: string | null }`
- `reportTaskSchema` / `type ReportTask = { id; title; priority: TaskPriority; status: TaskStatus; site: { id; name } | null; assignee: UserRef | null; team: { id; name } | null; dueAt: string | null; completedAt: string | null; createdAt: string; overdue: boolean; problemId: string | null }`
- `reportTaskCountsSchema` / `type ReportTaskCounts = { byStatus: Record<TaskStatus, number> /* in TASK_STATUSES order */; overdueOpen: number; completedOnTime: number; completedLate: number }`
- `reportTasksSchema` / `type ReportTasks = { counts: ReportTaskCounts; items: ReportTask[]; nextCursor: string | null }`
- `REPORT_CONTENT_TYPES: Record<ReportFormat, string>` = `{ csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' }`
- `reportFileName(kind: ReportExportKind, from: LocalDate, to: LocalDate, format: ReportFormat): string` — `taskop-<kind>-<from>_<to>.<format>`

**Changes to existing contracts** (Part 1 Task 3):
- `permissions.ts`: `PERMISSION_GROUPS` gains `{ group: 'reports', keys: ['reports.view', 'reports.export'] }` (last). `SYSTEM_ROLE_DEFAULTS.manager.permissions` and `.auditor.permissions` gain both; owner and admin get both through `ALL_PERMISSIONS`; worker none.
- `errors.ts`: `ErrorCode.REPORT_RANGE_TOO_LONG` (400), `REPORT_TOO_LARGE` (422), `REPORT_TIMEOUT` (503); `errorBodySchema.error` gains `rows?: number` and `limit?: number` (set on `REPORT_TOO_LARGE`).
- `audit.ts`: `REPORT_AUDIT_ACTIONS = ['reports.exported'] as const`, `type ReportAuditAction`; entity type `report`, entity id `null`.

### `@taskop/i18n` (Part 1 Task 4)

- `az.reports` (new namespace):
  - `title` ("Hesabatlar"), `dashboard` ("İdarə paneli"), `trend` ("Gündəlik icra"), `empty` ("Bu dövr üçün məlumat yoxdur."), `inactive` ("Deaktiv"), `noValue` ("—"), `yes` ("Bəli"), `no` ("Xeyr"), `notCompleted` ("Tamamlanmayıb", the phone's "due − completed" tile)
  - `periods.<PeriodPreset>` and `periods.custom` ("Bu gün", "Dünən", "Bu həftə", "Bu ay", "Son 7 gün", "Son 30 gün", "Seçilmiş dövr")
  - `filters.{ period, from, to, site, employee, checklist, bucket, severity, showInactive, allSites, allEmployees, allChecklists }`
  - `counts.<RunCountKey>` — tile and column labels ("Planlaşdırılıb", "Vaxtı çatıb", "Tamamlanıb", "Davam edir", "Gözləyir", "Gecikib", "Yarımçıq", "Buraxılıb", "Problemli", "Kritik problemli")
  - `measures.{ completionPercent ("Tamamlanma faizi"), averageScore ("Orta bal"), completionHint ("Vaxtı çatmış icralardan tamamlananların payı") }`
  - `buckets.<RunBucket>` ("Gecikmiş", "Yarımçıq", "Buraxılmış", "Problemli", "Tamamlanmış", "Davam edən", "Hamısı")
  - `tabs.<ReportKind>` ("Xülasə", "Obyektlər", "Əməkdaşlar", "İcralar", "Problemlər", "Tapşırıqlar")
  - `columns.{ measure, value, date, dueAt, checklist, site, path, active, status, assignees, executor, startedAt, completedAt, completedReceivedAt, score, problemCount, criticalCount, late, clockSuspect, employee, item, severity, source, note, recordedAt, resolution, taskStatus, title, assignee, priority, due, completed, overdue }`
  - `employees.{ unassigned ("Təyin edilməyib"), overCountNote }`
  - `problems.{ total, critical }`, `tasks.{ overdueOpen, completedOnTime, completedLate }`
  - `export.{ menu ("İxrac et"), thisTable ("Bu cədvəl"), fullReport ("Tam hesabat"), csv ("CSV"), xlsx ("Excel"), pdf ("PDF"), preparing ("Fayl hazırlanır…"), tooLarge ("Hesabatda {{rows}} sətir var (limit {{limit}}). Filtrləri daraldın.") }`
  - `titles.<ReportExportKind>` (export document titles, e.g. `summary` "Xülasə hesabatı", `full` "Tam dövr hesabatı"), `sheets.{ summary, trend, sites, employees, runs, overdue, partial, missed, problems, tasks }` (section and sheet names), `pdf.{ period, filters, noFilters, generatedAt, page, empty }`
  - `issues.<code without the reports.issues. prefix>`
- `az.errors.REPORT_RANGE_TOO_LONG`, `az.errors.REPORT_TOO_LARGE` (with `{{rows}}` and `{{limit}}`), `az.errors.REPORT_TIMEOUT`
- `az.nav.reports` ("Hesabatlar")
- `az.roles.groups.reports` ("Hesabatlar"), `az.roles.keys.reports_view`, `az.roles.keys.reports_export`
- `az.audit.entityTypes.report` ("Hesabat")
- Existing labels reused as they are: `az.scheduling.statuses.<OccurrenceStatus>`, `az.tasks.statuses`, `az.tasks.priorities`, `az.tasks.resolutions`, `az.executions.severities`, `az.executions.problemSources`, `az.executions.flags.{ late, clockSuspect }`.
- Part 2 adds phone UI strings to `az.mobile`; Part 3 adds web-only UI strings to `az.reports` (new keys only; it never renames these).

### `@taskop/api-client` (Part 1 Task 5)

`createTaskopApi(c)` spreads `createReportsApi(c)`, also exported with `type ReportsApi`:

| Method | HTTP | Returns |
|---|---|---|
| `reports.summary(query: ReportFiltersQuery)` | `GET /reports/summary` | `ReportSummary` |
| `reports.sites(query: ReportFiltersQuery)` | `GET /reports/sites` | `SiteReportRow[]` |
| `reports.employees(query: ReportFiltersQuery)` | `GET /reports/employees` | `EmployeeReportRow[]` |
| `reports.runs(query: ReportRunsQuery)` | `GET /reports/runs` | `Page<ReportRun>` |
| `reports.problems(query: ReportProblemsQuery)` | `GET /reports/problems` | `ReportProblems` |
| `reports.tasks(query: ReportTasksQuery)` | `GET /reports/tasks` | `ReportTasks` |
| `reports.export(kind: ReportExportKind, query: ReportExportQuery)` | `GET /reports/:kind/export` | `ReportFile = { blob: Blob; filename: string }` (name from `Content-Disposition`, else `reportFileName(kind, from, to, format)`) |

Also exported from `client.ts`: `ApiClient.download(path: string, o?: { query?: QueryParams }): Promise<DownloadedFile>` (same auth, refresh and error handling as `request`, `Accept: */*`), `interface DownloadedFile { blob: Blob; filename: string | null; contentType: string | null }`, `parseContentDispositionFilename(header: string | null): string | null` (RFC 6266 `filename*=UTF-8''…` wins over `filename="…"`). `ApiError` gains `rows: number | null` and `limit: number | null` (set on `REPORT_TOO_LARGE`). The web saves a `ReportFile` with an object URL and an `<a download>`.

### Server behaviour Parts 2 and 3 rely on

- **Permissions:** the six GETs need `reports.view` (else `403`); exports need `reports.view` and `reports.export` (else `403`). The phone's Team tab shows when `me.permissions` has `reports.view` and `me.role.dataScope !== 'own'` (spec §7.1; no server flag).
- **Scope and filters:** every number is inside the viewer's data scope; a `siteId`, `userId` or `checklistId` outside it yields empty results, not 403. `siteId` includes the subtree. `userId` attribution follows spec §3.3, so the employees table's Planned column can sum to more than the sites table's (the UI shows `az.reports.employees.overCountNote`).
- **Errors:** `400 VALIDATION_FAILED` (`fields.to = 'reports.issues.toBeforeFrom'` for `from > to`; `fields.format = 'reports.issues.fullNotCsv'`), `400 REPORT_RANGE_TOO_LONG` (more than 366 days), `422 REPORT_TOO_LARGE` with `ApiError.rows` / `ApiError.limit` (exports only), `503 REPORT_TIMEOUT` (retry or narrow the range), `404` for an unknown export kind.
- **Numbers are live:** "Due" is measured when the request runs, so two requests a minute apart may differ; a late offline sync changes past days the next time they are read. Nothing is cached server-side.
- **Ordering:** sites in tree order with `path` = ancestor names; employees by name with the Unassigned row (`userId: null`) last; runs `dueAt` newest first; problems `createdAt` newest first (as `/problems`); tasks by due time (or creation time when undue) newest first. Each paged response has `nextCursor` (`null` on the last page); pass it back as `cursor` with the same filters. Problem and task `counts` are the same on every page.
- **Sites table** lists only sites with at least one planned run in the period; inactive sites and users keep their history and come with `active: false`.
- **Run detail:** `GET /occurrences/:id` (the `/schedule` drawer and the phone's unexecuted-run header with `assignees`), `GET /executions/:id` (answers, problems) and `GET /media/:id/url` accept `assignments.view` **or** `reports.view`, inside the viewer's scope (Spec decision 1). Use `ReportRun.executionId` for the execution and `ReportRun.occurrenceId` for the occurrence.
- **Downloads:** same-origin `GET` with the session's bearer token (no CORS needed); the response is the whole file with `Content-Disposition: attachment; filename="taskop-<kind>-<from>_<to>.<ext>"`. A file is built synchronously; large ones (thousands of rows, PDF) can take a few seconds, so show the spinner.

---

### Task 1: Report metric rules, attribution and period presets

**Files:**
- Create: `packages/contracts/src/report-logic.ts`
- Test: `packages/contracts/src/report-logic.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `type OccurrenceStatus`, `OCCURRENCE_STATUSES` from `occurrences.ts`; `addDays`, `dayNumber`, `fromDayNumber`, `isoWeekday`, `type LocalDate` from `scheduling-time.ts`.
- Produces: everything under **Metric rules** in *Interfaces for Parts 2 and 3*. The API's SQL (Tasks 8–11) mirrors `classifyRun` and uses `COMPLETED_STATUSES`, `IN_PROGRESS_STATUSES`, `completionPercent`, `roundOne`, `periodDays`, `REPORT_LIMITS`, `reportRangeTooLong`.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/report-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  attributeRun,
  averageScore,
  classifyRun,
  COMPLETED_STATUSES,
  completionPercent,
  emptyRunCounts,
  IN_PROGRESS_STATUSES,
  OCCURRENCE_STATUSES,
  type OccurrenceStatus,
  PERIOD_PRESETS,
  periodDays,
  REPORT_LIMITS,
  reportRangeTooLong,
  resolvePeriod,
  roundOne,
  RUN_COUNT_KEYS,
  type RunCountKey,
  tallyRuns,
} from './index.js';

const NOW = new Date('2026-11-04T08:00:00Z');
const PAST = '2026-11-04T06:00:00Z';
const FUTURE = '2026-11-04T12:00:00Z';
const run = (status: OccurrenceStatus, dueAt: string = PAST, hasProblems = false, hasCritical = false) => ({ status, dueAt, hasProblems, hasCritical });
const on = (...keys: RunCountKey[]) => Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, keys.includes(k)]));

describe('classifyRun (spec §3.1)', () => {
  it('puts every status in its buckets once its due time has passed', () => {
    const expected: Record<OccurrenceStatus, RunCountKey[]> = {
      pending: ['planned', 'due', 'pending'],
      started: ['planned', 'due', 'inProgress'],
      in_progress: ['planned', 'due', 'inProgress'],
      completed: ['planned', 'due', 'completed'],
      partial: ['planned', 'due', 'partial'],
      overdue: ['planned', 'due', 'overdue'],
      missed: ['planned', 'due', 'missed'],
      cancelled: [],
      audit_pending: ['planned', 'due', 'completed'],
      audited: ['planned', 'due', 'completed'],
    };
    for (const s of OCCURRENCE_STATUSES) expect(classifyRun(run(s), NOW), s).toEqual(on(...expected[s]));
  });

  it('counts a run as due only once its due time has passed, unless it is completed', () => {
    expect(classifyRun(run('pending', FUTURE), NOW).due).toBe(false);
    expect(classifyRun(run('in_progress', FUTURE), NOW).due).toBe(false);
    // Finished early: in the numerator and the denominator, so completion never exceeds 100%.
    expect(classifyRun(run('completed', FUTURE), NOW)).toMatchObject({ planned: true, due: true, completed: true });
    expect(classifyRun(run('audited', FUTURE), NOW)).toMatchObject({ due: true, completed: true });
    // Exactly at the due time is due.
    expect(classifyRun(run('pending', '2026-11-04T08:00:00Z'), NOW).due).toBe(true);
  });

  it('accepts the due time as a Date', () => {
    expect(classifyRun({ ...run('pending'), dueAt: new Date(FUTURE) }, NOW).due).toBe(false);
  });

  it('flags problems and critical problems, never on a cancelled run', () => {
    expect(classifyRun(run('completed', PAST, true, true), NOW)).toMatchObject({ withProblems: true, withCritical: true });
    expect(classifyRun(run('partial', PAST, true, false), NOW)).toMatchObject({ withProblems: true, withCritical: false });
    expect(classifyRun(run('cancelled', PAST, true, true), NOW)).toEqual(on());
  });

  it('names the status groups the SQL mirrors', () => {
    expect(COMPLETED_STATUSES).toEqual(['completed', 'audit_pending', 'audited']);
    expect(IN_PROGRESS_STATUSES).toEqual(['started', 'in_progress']);
    expect(RUN_COUNT_KEYS).toEqual(['planned', 'due', 'completed', 'inProgress', 'pending', 'overdue', 'partial', 'missed', 'withProblems', 'withCritical']);
  });
});

describe('tallyRuns', () => {
  it('sums the flags of every run', () => {
    const c = tallyRuns([run('completed', FUTURE), run('completed'), run('missed'), run('pending', FUTURE), run('cancelled')], NOW);
    expect(c).toEqual({ ...emptyRunCounts(), planned: 4, due: 3, completed: 2, missed: 1, pending: 1 });
    expect(completionPercent(c.completed, c.due)).toBe(66.7);
  });

  it('is all zeros for no runs', () => {
    expect(tallyRuns([], NOW)).toEqual(emptyRunCounts());
    expect(Object.values(emptyRunCounts())).toEqual(RUN_COUNT_KEYS.map(() => 0));
  });
});

describe('percentages', () => {
  it('rounds completion to one decimal and is null with nothing due', () => {
    expect(completionPercent(0, 0)).toBeNull();
    expect(completionPercent(0, 3)).toBe(0);
    expect(completionPercent(7, 13)).toBe(53.8);
    expect(completionPercent(2, 3)).toBe(66.7);
    expect(completionPercent(4, 7)).toBe(57.1);
    expect(completionPercent(5, 5)).toBe(100);
  });

  it('averages the scores that exist', () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([null, undefined])).toBeNull();
    expect(averageScore([80, 100, 60, 90, 50, 70, 100, null])).toBe(78.6);
    expect(averageScore([0])).toBe(0);
  });

  it('rounds to one decimal', () => {
    expect(roundOne(12.34)).toBe(12.3);
    expect(roundOne(12.36)).toBe(12.4);
    expect(roundOne(100)).toBe(100);
  });
});

describe('attributeRun (spec §3.3)', () => {
  const [a, b, c] = ['user-a', 'user-b', 'user-c'];

  it('gives a shared run completed by one assignee to that person only', () => {
    expect(attributeRun({ status: 'completed', executorUserId: b, assigneeIds: [a, b, c] })).toEqual([b]);
  });

  it('gives a missed shared run to every assignee, once each', () => {
    expect(attributeRun({ status: 'missed', executorUserId: null, assigneeIds: [a, b, c] })).toEqual([a, b, c]);
  });

  it('gives an unassigned missed run to the Unassigned row', () => {
    expect(attributeRun({ status: 'missed', executorUserId: null, assigneeIds: [] })).toEqual([null]);
  });

  it('gives a partial or in-progress run to its executor and a cancelled run to nobody', () => {
    expect(attributeRun({ status: 'partial', executorUserId: a, assigneeIds: [a, b] })).toEqual([a]);
    expect(attributeRun({ status: 'started', executorUserId: b, assigneeIds: [a, b] })).toEqual([b]);
    expect(attributeRun({ status: 'cancelled', executorUserId: null, assigneeIds: [a] })).toEqual([]);
  });
});

describe('periods', () => {
  it('resolves every preset from the tenant’s today (a Wednesday)', () => {
    expect(PERIOD_PRESETS.map((p) => [p, resolvePeriod(p, '2026-11-04')])).toEqual([
      ['today', { from: '2026-11-04', to: '2026-11-04' }],
      ['yesterday', { from: '2026-11-03', to: '2026-11-03' }],
      ['this_week', { from: '2026-11-02', to: '2026-11-04' }],
      ['this_month', { from: '2026-11-01', to: '2026-11-04' }],
      ['last_7', { from: '2026-10-29', to: '2026-11-04' }],
      ['last_30', { from: '2026-10-06', to: '2026-11-04' }],
    ]);
  });

  it('starts the week on Monday and wraps months and years', () => {
    expect(resolvePeriod('this_week', '2026-11-02')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(resolvePeriod('this_week', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(resolvePeriod('this_week', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-01' });
    expect(resolvePeriod('yesterday', '2027-01-01')).toEqual({ from: '2026-12-31', to: '2026-12-31' });
    expect(resolvePeriod('this_month', '2026-03-01')).toEqual({ from: '2026-03-01', to: '2026-03-01' });
  });

  it('lists every calendar day, also across a DST change', () => {
    expect(periodDays('2026-10-24', '2026-10-27')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(periodDays('2026-11-04', '2026-11-04')).toEqual(['2026-11-04']);
    expect(periodDays('2026-01-01', '2026-12-31')).toHaveLength(365);
  });

  it('allows to − from up to 365 days, so a range covers at most 366 days', () => {
    expect(REPORT_LIMITS).toEqual({ maxRangeDays: 366, pageSize: 50, exportRowCap: 10_000, statementTimeoutMs: 15_000 });
    expect(reportRangeTooLong('2026-01-01', '2027-01-01')).toBe(false);
    expect(periodDays('2026-01-01', '2027-01-01')).toHaveLength(366);
    expect(reportRangeTooLong('2026-01-01', '2027-01-02')).toBe(true);
    expect(reportRangeTooLong('2026-11-04', '2026-11-04')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- report-logic`
Expected: FAIL: `classifyRun` (and every other import from `./report-logic`) is not exported from `./index.js`.

- [ ] **Step 3: Implement**

`packages/contracts/src/report-logic.ts`:

```ts
import type { OccurrenceStatus } from './occurrences.js';
import { addDays, dayNumber, fromDayNumber, isoWeekday, type LocalDate } from './scheduling-time.js';

/**
 * Sub-project 7 spec §3: THE metric rules. apps/api/src/reports/report-queries.ts implements the same rules in SQL;
 * its cross-check test (reports-summary.test.ts) keeps the two equal. Change both together.
 */
export const RUN_COUNT_KEYS = ['planned', 'due', 'completed', 'inProgress', 'pending', 'overdue', 'partial', 'missed', 'withProblems', 'withCritical'] as const;
export type RunCountKey = (typeof RUN_COUNT_KEYS)[number];
export type RunCounts = Record<RunCountKey, number>;
export type RunFlags = Record<RunCountKey, boolean>;

export const COMPLETED_STATUSES = ['completed', 'audit_pending', 'audited'] as const satisfies readonly OccurrenceStatus[];
export const IN_PROGRESS_STATUSES = ['started', 'in_progress'] as const satisfies readonly OccurrenceStatus[];

const isCompleted = (s: OccurrenceStatus): boolean => (COMPLETED_STATUSES as readonly OccurrenceStatus[]).includes(s);
const isInProgress = (s: OccurrenceStatus): boolean => (IN_PROGRESS_STATUSES as readonly OccurrenceStatus[]).includes(s);

export interface RunFacts {
  status: OccurrenceStatus;
  dueAt: Date | string;
  /** At least one execution_problems row for the occurrence. */
  hasProblems: boolean;
  /** At least one of them critical. */
  hasCritical: boolean;
}

/** The buckets a run falls into at instant `now` (spec §3.1). A cancelled run falls into none. */
export function classifyRun(run: RunFacts, now: Date): RunFlags {
  const planned = run.status !== 'cancelled';
  const completed = isCompleted(run.status);
  return {
    planned,
    // A run that finished before its due time is due too, so completion % never exceeds 100.
    due: planned && (completed || +new Date(run.dueAt) <= +now),
    completed,
    inProgress: isInProgress(run.status),
    pending: run.status === 'pending',
    overdue: run.status === 'overdue',
    partial: run.status === 'partial',
    missed: run.status === 'missed',
    withProblems: planned && run.hasProblems,
    withCritical: planned && run.hasCritical,
  };
}

export const emptyRunCounts = (): RunCounts => Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, 0])) as RunCounts;

export function tallyRuns(runs: readonly RunFacts[], now: Date): RunCounts {
  const counts = emptyRunCounts();
  for (const r of runs) {
    const flags = classifyRun(r, now);
    for (const k of RUN_COUNT_KEYS) if (flags[k]) counts[k]++;
  }
  return counts;
}

export const roundOne = (x: number): number => Math.round(x * 10) / 10;

/** Completed ÷ Due × 100, one decimal; null when nothing is due yet (shown as "—"). */
export const completionPercent = (completed: number, due: number): number | null => (due > 0 ? roundOne((completed / due) * 100) : null);

/** Mean of the scores that exist, one decimal; null when there are none. */
export function averageScore(values: readonly (number | null | undefined)[]): number | null {
  const scores = values.filter((v): v is number => typeof v === 'number');
  return scores.length ? roundOne(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
}

export interface AttributionFacts {
  status: OccurrenceStatus;
  /** The counted (non-rejected) execution's executor, or null when the run was never started. */
  executorUserId: string | null;
  /** The occurrence's assignee snapshot. */
  assigneeIds: readonly string[];
}

/**
 * Spec §3.3: who a run counts for in the employee table. An executed run belongs only to its executor; an unexecuted
 * run to every assignee; one with no assignees to the Unassigned row (`null`); a cancelled run to nobody.
 */
export function attributeRun(run: AttributionFacts): (string | null)[] {
  if (run.status === 'cancelled') return [];
  if (run.executorUserId) return [run.executorUserId];
  return run.assigneeIds.length ? [...run.assigneeIds] : [null];
}

/** The filter bar's presets (spec §6.1). "Custom" is a free range, not a preset. */
export const PERIOD_PRESETS = ['today', 'yesterday', 'this_week', 'this_month', 'last_7', 'last_30'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface Period {
  from: LocalDate;
  to: LocalDate;
}

/** A preset as a range ending at the tenant's `today` (Spec decision 4). Weeks start on Monday. */
export function resolvePeriod(preset: PeriodPreset, today: LocalDate): Period {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'this_week':
      return { from: addDays(today, 1 - isoWeekday(today)), to: today };
    case 'this_month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'last_7':
      return { from: addDays(today, -6), to: today };
    case 'last_30':
      return { from: addDays(today, -29), to: today };
  }
}

/** Every calendar day from `from` to `to`, inclusive. Pure date arithmetic, so DST changes cannot drop or repeat a day. */
export function periodDays(from: LocalDate, to: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n++) days.push(fromDayNumber(n));
  return days;
}

export const REPORT_LIMITS = {
  /** `to − from` at most 365, so a range covers at most 366 days (spec §3.2). */
  maxRangeDays: 366,
  /** Rows per page of /reports/runs, /reports/problems and /reports/tasks (spec §5.3). */
  pageSize: 50,
  /** Rows per list section of an export (spec §5.4). */
  exportRowCap: 10_000,
  /** The API's default statement timeout per report request (spec §5.5). */
  statementTimeoutMs: 15_000,
} as const;

/** True when the range is longer than REPORT_LIMITS.maxRangeDays: the API answers 400 REPORT_RANGE_TOO_LONG. */
export const reportRangeTooLong = (from: LocalDate, to: LocalDate): boolean => dayNumber(to) - dayNumber(from) > REPORT_LIMITS.maxRangeDays - 1;
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './report-logic.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS. (If TypeScript reports "not all code paths return a value" for `resolvePeriod`, the switch is not seen as exhaustive: add `default: { const unhandled: never = preset; throw new Error('Unknown preset: ' + String(unhandled)); }` as the last case.)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/report-logic.ts packages/contracts/src/report-logic.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add report metric rules, attribution and period presets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Report query and response contracts

**Files:**
- Create: `packages/contracts/src/reports.ts`
- Test: `packages/contracts/src/reports.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Task 1 (`RUN_COUNT_KEYS`); `idSchema`, `isoDateTimeSchema`, `pageOf` from `common.ts`; `problemSeveritySchema` from `execution-logic.ts`; `problemDtoSchema` from `execution-views.ts`; `occurrenceStatusSchema`, `userRefSchema` from `occurrences.ts`; `dayNumber`, `localDateSchema` from `scheduling-time.ts`; `TASK_STATUSES`, `taskPrioritySchema`, `taskStatusSchema` from `tasks.ts`.
- Produces: everything under **Catalogue, queries and responses** in *Interfaces for Parts 2 and 3*. The API's DTOs (Task 8 onwards) are `createZodDto` over these schemas; its services take the `*Params` (zod output) types.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/reports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  employeeReportRowSchema,
  REPORT_CONTENT_TYPES,
  REPORT_EXPORT_KINDS,
  REPORT_FORMATS,
  REPORT_ISSUE_CODES,
  REPORT_KINDS,
  reportExportQuerySchema,
  reportFileName,
  reportFiltersSchema,
  reportProblemsQuerySchema,
  reportProblemsSchema,
  reportRunPageSchema,
  reportRunsQuerySchema,
  reportSummarySchema,
  reportTaskCountsSchema,
  reportTasksQuerySchema,
  reportTasksSchema,
  RUN_BUCKETS,
  RUN_COUNT_KEYS,
  runCountsSchema,
  siteReportRowSchema,
  TASK_STATUSES,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const AT = '2026-11-02T06:00:00.000Z';
const range = { from: '2026-11-02', to: '2026-11-04' };
const zero = Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, 0]));

describe('report catalogue', () => {
  it('lists the kinds, export kinds, formats, buckets and issue codes', () => {
    expect(REPORT_KINDS).toEqual(['summary', 'sites', 'employees', 'runs', 'problems', 'tasks']);
    expect(REPORT_EXPORT_KINDS).toEqual([...REPORT_KINDS, 'full']);
    expect(REPORT_FORMATS).toEqual(['csv', 'xlsx', 'pdf']);
    expect(RUN_BUCKETS).toEqual(['overdue', 'partial', 'missed', 'problems', 'completed', 'in_progress', 'all']);
    expect(REPORT_ISSUE_CODES).toEqual(['reports.issues.toBeforeFrom', 'reports.issues.fullNotCsv']);
  });

  it('names files taskop-<kind>-<from>_<to>.<ext> and types them', () => {
    expect(reportFileName('runs', '2026-11-01', '2026-11-30', 'csv')).toBe('taskop-runs-2026-11-01_2026-11-30.csv');
    expect(reportFileName('full', '2026-11-01', '2026-11-30', 'xlsx')).toBe('taskop-full-2026-11-01_2026-11-30.xlsx');
    expect(REPORT_CONTENT_TYPES).toEqual({
      csv: 'text/csv; charset=utf-8',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    });
  });
});

describe('report queries', () => {
  it('parses the shared filters and refuses a range that ends before it starts', () => {
    expect(reportFiltersSchema.parse({ ...range, siteId: ID, userId: ID, checklistId: ID })).toEqual({ ...range, siteId: ID, userId: ID, checklistId: ID });
    const inverted = reportFiltersSchema.safeParse({ from: '2026-11-04', to: '2026-11-02' });
    expect(inverted.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['to', 'reports.issues.toBeforeFrom']]);
    expect(reportFiltersSchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(reportFiltersSchema.safeParse({ from: '2026-11-02' }).success).toBe(false);
    expect(reportFiltersSchema.safeParse({ ...range, siteId: 'nope' }).success).toBe(false);
  });

  it('leaves the range length to the API (REPORT_RANGE_TOO_LONG)', () => {
    expect(reportFiltersSchema.safeParse({ from: '2026-01-01', to: '2027-06-01' }).success).toBe(true);
  });

  it('defaults the runs bucket to all and takes a cursor', () => {
    expect(reportRunsQuerySchema.parse(range)).toEqual({ ...range, bucket: 'all' });
    expect(reportRunsQuerySchema.parse({ ...range, bucket: 'missed', cursor: ID })).toEqual({ ...range, bucket: 'missed', cursor: ID });
    expect(reportRunsQuerySchema.safeParse({ ...range, bucket: 'late' }).success).toBe(false);
    expect(reportRunsQuerySchema.safeParse({ from: '2026-11-04', to: '2026-11-02' }).success).toBe(false);
  });

  it('filters problems by severity and pages tasks', () => {
    expect(reportProblemsQuerySchema.parse({ ...range, severity: 'critical' })).toEqual({ ...range, severity: 'critical' });
    expect(reportProblemsQuerySchema.safeParse({ ...range, severity: 'major' }).success).toBe(false);
    expect(reportTasksQuerySchema.parse({ ...range, cursor: ID })).toEqual({ ...range, cursor: ID });
  });

  it('needs a known format to export', () => {
    expect(reportExportQuerySchema.parse({ ...range, format: 'pdf', bucket: 'overdue' })).toEqual({ ...range, format: 'pdf', bucket: 'overdue' });
    expect(reportExportQuerySchema.safeParse(range).success).toBe(false);
    expect(reportExportQuerySchema.safeParse({ ...range, format: 'docx' }).success).toBe(false);
  });
});

describe('report responses', () => {
  it('has one count per RUN_COUNT_KEYS entry, in that order', () => {
    expect(Object.keys(runCountsSchema.shape)).toEqual([...RUN_COUNT_KEYS]);
  });

  it('parses a summary with a zero day in its trend', () => {
    const s = { counts: zero, completionPercent: null, averageScore: null, trend: [{ date: '2026-11-02', due: 0, completed: 0, completionPercent: null }] };
    expect(reportSummarySchema.parse(s)).toEqual(s);
    expect(reportSummarySchema.safeParse({ ...s, counts: { ...zero, planned: -1 } }).success).toBe(false);
  });

  it('parses site and employee rows, including the Unassigned row', () => {
    const site = { ...zero, planned: 1, siteId: ID, name: 'Zona A1', path: ['Filial A'], active: true, completionPercent: null, averageScore: null };
    expect(siteReportRowSchema.parse(site)).toEqual(site);
    const unassigned = { ...zero, planned: 1, due: 1, missed: 1, userId: null, name: 'Təyin edilməyib', active: true, completionPercent: 0, averageScore: null };
    expect(employeeReportRowSchema.parse(unassigned)).toEqual(unassigned);
  });

  it('parses a run row with the device and the server completion times', () => {
    const row = {
      occurrenceId: ID, executionId: ID, localDate: '2026-11-02', dueAt: AT,
      checklist: { id: ID, name: 'Açılış yoxlaması' }, site: { id: ID, name: 'Zona A1' }, status: 'completed',
      assignees: [{ id: ID, fullName: 'Aynur Quliyeva' }], executor: { id: ID, fullName: 'Aynur Quliyeva' },
      startedAt: AT, completedAt: AT, completedReceivedAt: '2026-11-04T05:00:00.000Z',
      score: 90, problemCount: 1, criticalCount: 0, late: true, clockSuspect: false,
    };
    expect(reportRunPageSchema.parse({ items: [row], nextCursor: null }).items[0]).toEqual(row);
  });

  it('parses problems and tasks with their counts', () => {
    const problems = { counts: { total: 0, critical: 0, resolution: { none: 0, open: 0, resolved: 0, cancelled: 0 } }, items: [], nextCursor: null };
    expect(reportProblemsSchema.parse(problems)).toEqual(problems);
    expect(Object.keys(reportTaskCountsSchema.shape.byStatus.shape)).toEqual([...TASK_STATUSES]);
    const tasks = {
      counts: { byStatus: Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])), overdueOpen: 0, completedOnTime: 0, completedLate: 0 },
      items: [{ id: ID, title: 'Qapını təmir et', priority: 'high', status: 'completed', site: null, assignee: null, team: { id: ID, name: 'Texniki xidmət' }, dueAt: null, completedAt: AT, createdAt: AT, overdue: false, problemId: null }],
      nextCursor: ID,
    };
    expect(reportTasksSchema.parse(tasks)).toEqual(tasks);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- reports`
Expected: FAIL: `REPORT_KINDS` and the schemas are not exported.

- [ ] **Step 3: Implement**

`packages/contracts/src/reports.ts`:

```ts
import { z } from 'zod';
import { idSchema, isoDateTimeSchema, pageOf } from './common.js';
import { problemSeveritySchema } from './execution-logic.js';
import { problemDtoSchema } from './execution-views.js';
import { occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, localDateSchema } from './scheduling-time.js';
import { taskPrioritySchema, taskStatusSchema } from './tasks.js';

/** Sub-project 7 spec §5.3: the six report tables. */
export const REPORT_KINDS = ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks'] as const;
export const reportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof reportKindSchema>;

/** Spec §5.4: every table can be exported, and so can the full period report. */
export const REPORT_EXPORT_KINDS = [...REPORT_KINDS, 'full'] as const;
export const reportExportKindSchema = z.enum(REPORT_EXPORT_KINDS);
export type ReportExportKind = z.infer<typeof reportExportKindSchema>;

export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** /reports/runs lists. `problems` = with problems, not cancelled; `all` includes cancelled runs (Spec decision 6). */
export const RUN_BUCKETS = ['overdue', 'partial', 'missed', 'problems', 'completed', 'in_progress', 'all'] as const;
export const runBucketSchema = z.enum(RUN_BUCKETS);
export type RunBucket = z.infer<typeof runBucketSchema>;

/** Field keys of report validation errors; also i18n keys. */
export const REPORT_ISSUE_CODES = ['reports.issues.toBeforeFrom', 'reports.issues.fullNotCsv'] as const;
export type ReportIssueCode = (typeof REPORT_ISSUE_CODES)[number];

/** Spec §5.2. The range length (to − from ≤ 365) is checked by the API: it answers REPORT_RANGE_TOO_LONG. */
const filterShape = {
  from: localDateSchema,
  to: localDateSchema,
  siteId: idSchema.optional(),
  userId: idSchema.optional(),
  checklistId: idSchema.optional(),
};
const toNotBeforeFrom = (v: { from: string; to: string }, ctx: z.RefinementCtx): void => {
  if (dayNumber(v.to) < dayNumber(v.from)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'reports.issues.toBeforeFrom' });
};

export const reportFiltersSchema = z.object(filterShape).superRefine(toNotBeforeFrom);
export type ReportFiltersQuery = z.input<typeof reportFiltersSchema>;
export type ReportFilters = z.output<typeof reportFiltersSchema>;

export const reportRunsQuerySchema = z
  .object({ ...filterShape, bucket: runBucketSchema.default('all'), cursor: idSchema.optional() })
  .superRefine(toNotBeforeFrom);
export type ReportRunsQuery = z.input<typeof reportRunsQuerySchema>;
export type ReportRunsParams = z.output<typeof reportRunsQuerySchema>;

/** `severity` feeds the dashboard's critical-problems panel (Spec decision 5). */
export const reportProblemsQuerySchema = z
  .object({ ...filterShape, severity: problemSeveritySchema.optional(), cursor: idSchema.optional() })
  .superRefine(toNotBeforeFrom);
export type ReportProblemsQuery = z.input<typeof reportProblemsQuerySchema>;
export type ReportProblemsParams = z.output<typeof reportProblemsQuerySchema>;

export const reportTasksQuerySchema = z.object({ ...filterShape, cursor: idSchema.optional() }).superRefine(toNotBeforeFrom);
export type ReportTasksQuery = z.input<typeof reportTasksQuerySchema>;
export type ReportTasksParams = z.output<typeof reportTasksQuerySchema>;

/** `bucket` applies to the runs export (default all), `severity` to the problems export; the full report ignores both. */
export const reportExportQuerySchema = z
  .object({ ...filterShape, format: reportFormatSchema, bucket: runBucketSchema.optional(), severity: problemSeveritySchema.optional() })
  .superRefine(toNotBeforeFrom);
export type ReportExportQuery = z.input<typeof reportExportQuerySchema>;
export type ReportExportParams = z.output<typeof reportExportQuerySchema>;

const count = z.number().int().min(0);
const percent = z.number().nullable();
const refSchema = z.object({ id: idSchema, name: z.string() });

/** One number per RUN_COUNT_KEYS entry, in that order (report-logic.ts). */
export const runCountsSchema = z.object({
  planned: count,
  due: count,
  completed: count,
  inProgress: count,
  pending: count,
  overdue: count,
  partial: count,
  missed: count,
  withProblems: count,
  withCritical: count,
});

export const reportTrendDaySchema = z.object({ date: localDateSchema, due: count, completed: count, completionPercent: percent });
export type ReportTrendDay = z.infer<typeof reportTrendDaySchema>;

/** GET /reports/summary. The trend has one entry per day of the range, zero days included. */
export const reportSummarySchema = z.object({ counts: runCountsSchema, completionPercent: percent, averageScore: percent, trend: z.array(reportTrendDaySchema) });
export type ReportSummary = z.infer<typeof reportSummarySchema>;

/** GET /reports/sites: sites with at least one planned run, in tree order. `path` = ancestor names, root first. */
export const siteReportRowSchema = runCountsSchema.extend({
  siteId: idSchema,
  name: z.string(),
  path: z.array(z.string()),
  active: z.boolean(),
  completionPercent: percent,
  averageScore: percent,
});
export type SiteReportRow = z.infer<typeof siteReportRowSchema>;

/** GET /reports/employees (spec §3.3). `userId: null` is the Unassigned row, last. */
export const employeeReportRowSchema = runCountsSchema.extend({
  userId: idSchema.nullable(),
  name: z.string(),
  active: z.boolean(),
  completionPercent: percent,
  averageScore: percent,
});
export type EmployeeReportRow = z.infer<typeof employeeReportRowSchema>;

/** A row of GET /reports/runs. Device times (startedAt, completedAt) beside the server receipt (FR-10.14). */
export const reportRunSchema = z.object({
  occurrenceId: idSchema,
  /** The counted execution; null when the run was never started. */
  executionId: idSchema.nullable(),
  localDate: localDateSchema,
  dueAt: isoDateTimeSchema,
  checklist: refSchema,
  site: refSchema,
  status: occurrenceStatusSchema,
  /** The assignee snapshot, by name. */
  assignees: z.array(userRefSchema),
  executor: userRefSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  completedReceivedAt: isoDateTimeSchema.nullable(),
  score: z.number().nullable(),
  problemCount: count,
  criticalCount: count,
  late: z.boolean(),
  clockSuspect: z.boolean(),
});
export type ReportRun = z.infer<typeof reportRunSchema>;
export const reportRunPageSchema = pageOf(reportRunSchema);

/** The /problems row with its linked task's status. */
export const reportProblemSchema = problemDtoSchema.extend({ taskStatus: taskStatusSchema.nullable() });
export type ReportProblem = z.infer<typeof reportProblemSchema>;

export const reportProblemCountsSchema = z.object({
  total: count,
  critical: count,
  resolution: z.object({ none: count, open: count, resolved: count, cancelled: count }),
});
export type ReportProblemCounts = z.infer<typeof reportProblemCountsSchema>;

/** GET /reports/problems: counts over the whole filtered set, then one page of rows. */
export const reportProblemsSchema = z.object({ counts: reportProblemCountsSchema, items: z.array(reportProblemSchema), nextCursor: idSchema.nullable() });
export type ReportProblems = z.infer<typeof reportProblemsSchema>;

export const reportTaskSchema = z.object({
  id: idSchema,
  title: z.string(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  site: refSchema.nullable(),
  assignee: userRefSchema.nullable(),
  team: refSchema.nullable(),
  dueAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  /** The sweep marked it overdue; stays after completion (Spec decision 11). */
  overdue: z.boolean(),
  problemId: idSchema.nullable(),
});
export type ReportTask = z.infer<typeof reportTaskSchema>;

/** Spec §3.4. `byStatus` keys in TASK_STATUSES order. */
export const reportTaskCountsSchema = z.object({
  byStatus: z.object({ new: count, accepted: count, in_progress: count, awaiting_review: count, completed: count, cancelled: count }),
  overdueOpen: count,
  completedOnTime: count,
  completedLate: count,
});
export type ReportTaskCounts = z.infer<typeof reportTaskCountsSchema>;

export const reportTasksSchema = z.object({ counts: reportTaskCountsSchema, items: z.array(reportTaskSchema), nextCursor: idSchema.nullable() });
export type ReportTasks = z.infer<typeof reportTasksSchema>;

export const REPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** The download's name (spec §5.4): `taskop-<kind>-<from>_<to>.<ext>`. */
export const reportFileName = (kind: ReportExportKind, from: string, to: string, format: ReportFormat): string => `taskop-${kind}-${from}_${to}.${format}`;
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './reports.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/reports.ts packages/contracts/src/reports.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add report query and response schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Report permissions, error codes and audit action

**Files:**
- Modify: `packages/contracts/src/permissions.ts`, `errors.ts`, `audit.ts`, `reports.test.ts`, `notifications.test.ts`
- Modify: `apps/api/src/common/app-error.ts`, `apps/api/src/common/error.filter.ts`, `apps/api/src/common/error.filter.test.ts`, `apps/api/test/roles.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: everything under **Changes to existing contracts** in *Interfaces for Parts 2 and 3*. In the API: `AppErrorDetails.rows?: number` and `.limit?: number` (the error filter already spreads details into the body), and `reports.*` zod messages pass through as field keys.

- [ ] **Step 1: Write the failing tests**

Append to `packages/contracts/src/reports.test.ts` (extend the `./index.js` import with `ERROR_HTTP_STATUS`, `errorBodySchema`, `PERMISSION_GROUPS`, `REPORT_AUDIT_ACTIONS` and `SYSTEM_ROLE_DEFAULTS`):

```ts
describe('report errors, permissions and audit', () => {
  it('adds the three report error codes with their statuses and the row cap details', () => {
    expect([ERROR_HTTP_STATUS.REPORT_RANGE_TOO_LONG, ERROR_HTTP_STATUS.REPORT_TOO_LARGE, ERROR_HTTP_STATUS.REPORT_TIMEOUT]).toEqual([400, 422, 503]);
    const body = errorBodySchema.parse({
      error: { code: 'REPORT_TOO_LARGE', messageKey: 'errors.REPORT_TOO_LARGE', fields: null, retryAfterSeconds: null, requestId: 'r1', rows: 12000, limit: 10000 },
    });
    expect(body.error).toMatchObject({ rows: 12000, limit: 10000 });
  });

  it('adds the reports permissions last, for Manager and Auditor by default', () => {
    expect(PERMISSION_GROUPS.at(-1)).toEqual({ group: 'reports', keys: ['reports.view', 'reports.export'] });
    for (const role of ['owner', 'admin', 'manager', 'auditor'] as const) {
      expect(SYSTEM_ROLE_DEFAULTS[role].permissions, role).toEqual(expect.arrayContaining(['reports.view', 'reports.export']));
    }
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
  });

  it('lists the audited report action', () => {
    expect(REPORT_AUDIT_ACTIONS).toEqual(['reports.exported']);
  });
});
```

Append to `apps/api/src/common/error.filter.test.ts`, inside `describe('toAppError', …)`:

```ts
  it('passes report issue keys through as field keys', () => {
    const r = z
      .object({ to: z.string() })
      .superRefine((_v, ctx) => ctx.addIssue({ code: 'custom', path: ['to'], message: 'reports.issues.toBeforeFrom' }))
      .safeParse({ to: '2026-11-01' });
    expect(toAppError(new ZodValidationException(r.error!)).fields).toEqual({ to: 'reports.issues.toBeforeFrom' });
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/contracts test -- reports && pnpm --filter @taskop/api test -- error.filter`
Expected: FAIL: `REPORT_AUDIT_ACTIONS` is undefined and the last permission group is `notifications`; the error filter maps the issue to `errors.validation.invalid`.

- [ ] **Step 3: Change the contracts**

In `packages/contracts/src/permissions.ts`:
- Add the last group to `PERMISSION_GROUPS`, after `notifications`:

```ts
  { group: 'reports', keys: ['reports.view', 'reports.export'] },
```

- The manager's and the auditor's `permissions` in `SYSTEM_ROLE_DEFAULTS` become:

```ts
    permissions: ['sites.view', 'teams.view', 'users.view', 'checklists.view', 'checklists.manage', 'assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage', 'tasks.view', 'tasks.manage', 'notifications.send', 'reports.view', 'reports.export'],
```

```ts
    permissions: ['sites.view', 'users.view', 'audit.view', 'checklists.view', 'assignments.view', 'shifts.view', 'tasks.view', 'reports.view', 'reports.export'],
```

In `packages/contracts/src/errors.ts`:
- In `ErrorCode`, after `EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED',` add:

```ts
  REPORT_RANGE_TOO_LONG: 'REPORT_RANGE_TOO_LONG',
  REPORT_TOO_LARGE: 'REPORT_TOO_LARGE',
  REPORT_TIMEOUT: 'REPORT_TIMEOUT',
```

- In `ERROR_HTTP_STATUS`, after `EVIDENCE_REQUIRED: 422,` add:

```ts
  REPORT_RANGE_TOO_LONG: 400,
  REPORT_TOO_LARGE: 422,
  REPORT_TIMEOUT: 503,
```

- In `errorBodySchema.error`, after `missing: z.array(missingSchema).optional(),` add:

```ts
    /** REPORT_TOO_LARGE: the rows the export would have and the cap. */
    rows: z.number().int().optional(),
    limit: z.number().int().optional(),
```

Append to `packages/contracts/src/audit.ts`:

```ts
/** Audited report action (SP7 spec §5.4): entity type `report`, entity id null, `after: { kind, format, filters, rows }`. */
export const REPORT_AUDIT_ACTIONS = ['reports.exported'] as const;
export type ReportAuditAction = (typeof REPORT_AUDIT_ACTIONS)[number];
```

In `packages/contracts/src/notifications.test.ts`, test `adds the notification permissions last, with the role defaults`, the two assertions that assumed the notifications group is last become:

```ts
    expect(PERMISSION_GROUPS.find((g) => g.group === 'notifications')).toEqual({ group: 'notifications', keys: ['notifications.manage', 'notifications.send'] });
```

```ts
    expect(ALL_PERMISSIONS.filter((k) => k.startsWith('notifications.'))).toEqual(['notifications.manage', 'notifications.send']);
```

- [ ] **Step 4: Keep the API compiling and passing**

In `apps/api/src/common/app-error.ts`, add the last two fields of `AppErrorDetails`:

```ts
  /** REPORT_TOO_LARGE: the rows the export would have, and the cap (SP7 spec §5.4). */
  rows?: number;
  limit?: number;
```

In `apps/api/src/common/error.filter.ts`, the field-key test in `toAppError` becomes:

```ts
      fields[key] ??= /^(errors|scheduling|executions|tasks|notifications|reports)\./.test(issue.message) ? issue.message : 'errors.validation.invalid';
```

In `apps/api/test/roles.test.ts`, the expected manager permissions become:

```ts
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual([
      'assignments.manage', 'assignments.view', 'checklists.manage', 'checklists.view', 'notifications.send', 'reports.export', 'reports.view', 'shifts.manage', 'shifts.view', 'sites.view', 'tasks.manage', 'tasks.view', 'teams.view', 'users.view',
    ]);
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- error.filter roles auth-signup`
Expected: PASS. `auth-signup` sees every permission for the owner (it compares with `ALL_PERMISSIONS`); new tenants' Manager and Auditor roles get the keys from `SYSTEM_ROLE_DEFAULTS` at signup. Do not run the i18n tests yet: `has a message for every API error code` and `labels every permission group and key` fail until Task 4.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src apps/api/src/common/app-error.ts apps/api/src/common/error.filter.ts apps/api/src/common/error.filter.test.ts apps/api/test/roles.test.ts
git commit -m "feat(contracts): add report permissions, error codes and the export audit action" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Azerbaijani strings for reports, report errors, permissions and the nav entry

**Files:**
- Create: `packages/i18n/src/az/reports.ts`
- Modify: `packages/i18n/src/az/errors.ts`, `roles.ts`, `audit.ts`, `nav.ts`, `index.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `RUN_COUNT_KEYS`, `RUN_BUCKETS`, `PERIOD_PRESETS`, `REPORT_KINDS`, `REPORT_EXPORT_KINDS`, `REPORT_ISSUE_CODES` (Tasks 1–2); the new error codes and the `reports` permission group (Task 3).
- Produces: `az.reports` and the keys listed under `@taskop/i18n` in *Interfaces for Parts 2 and 3*. The API's exporter (Tasks 9, 13–15) reads `az.reports.columns`, `counts`, `measures`, `buckets`, `sheets`, `titles`, `pdf`, `filters`, `employees.unassigned`, `yes` / `no`.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`. Extend the `@taskop/contracts` import with `PERIOD_PRESETS`, `REPORT_EXPORT_KINDS`, `REPORT_ISSUE_CODES`, `REPORT_KINDS`, `RUN_BUCKETS` and `RUN_COUNT_KEYS`:

```ts
describe('report translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('labels every count, bucket, period, tab, export title and issue', () => {
    for (const k of RUN_COUNT_KEYS) expect(az.reports.counts[k], k).toBeTypeOf('string');
    for (const b of RUN_BUCKETS) expect(az.reports.buckets[b], b).toBeTypeOf('string');
    for (const p of PERIOD_PRESETS) expect(az.reports.periods[p], p).toBeTypeOf('string');
    expect(az.reports.periods.custom).toBeTypeOf('string');
    for (const k of REPORT_KINDS) expect(az.reports.tabs[k], k).toBeTypeOf('string');
    for (const k of REPORT_EXPORT_KINDS) expect(az.reports.titles[k], k).toBeTypeOf('string');
    for (const code of REPORT_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
  });

  it('uses the agreed wording and registers the nav, audit, role and error labels', () => {
    expect(az.nav.reports).toBe('Hesabatlar');
    expect(az.reports.title).toBe('Hesabatlar');
    expect(az.reports.measures.completionPercent).toBe('Tamamlanma faizi');
    expect(az.reports.export.thisTable).toBe('Bu cədvəl');
    expect(az.reports.export.fullReport).toBe('Tam hesabat');
    expect(az.reports.employees.unassigned).toBe('Təyin edilməyib');
    expect(az.reports.periods.today).toBe('Bu gün');
    expect(az.roles.groups.reports).toBe('Hesabatlar');
    expect(az.audit.entityTypes.report).toBe('Hesabat');
    for (const s of [az.errors.REPORT_TOO_LARGE, az.reports.export.tooLarge]) {
      expect(s).toContain('{{rows}}');
      expect(s).toContain('{{limit}}');
    }
    expect(az.reports.pdf.page).toBe('Səhifə {{page}} / {{pages}}');
  });
});
```

(The existing tests `has a message for every API error code` and `labels every permission group and key` now also cover the three report codes and `reports.view` / `reports.export`.)

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.reports` is undefined, the error-code test fails for `REPORT_RANGE_TOO_LONG`, and the permission-label test fails for the `reports` group.

- [ ] **Step 3: Implement**

`packages/i18n/src/az/reports.ts`:

```ts
export default {
  title: 'Hesabatlar',
  dashboard: 'İdarə paneli',
  trend: 'Gündəlik icra',
  empty: 'Bu dövr üçün məlumat yoxdur.',
  inactive: 'Deaktiv',
  noValue: '—',
  yes: 'Bəli',
  no: 'Xeyr',
  /** The phone's "due − completed" tile (spec §7.1). */
  notCompleted: 'Tamamlanmayıb',
  periods: {
    today: 'Bu gün',
    yesterday: 'Dünən',
    this_week: 'Bu həftə',
    this_month: 'Bu ay',
    last_7: 'Son 7 gün',
    last_30: 'Son 30 gün',
    custom: 'Seçilmiş dövr',
  },
  filters: {
    period: 'Dövr',
    from: 'Başlanğıc tarixi',
    to: 'Son tarix',
    site: 'Obyekt',
    employee: 'Əməkdaş',
    checklist: 'Yoxlama vərəqəsi',
    bucket: 'İcralar',
    severity: 'Ciddilik',
    showInactive: 'Deaktivləri göstər',
    allSites: 'Bütün obyektlər',
    allEmployees: 'Bütün əməkdaşlar',
    allChecklists: 'Bütün yoxlama vərəqələri',
  },
  /** Tile labels and column headings, one per RUN_COUNT_KEYS entry. */
  counts: {
    planned: 'Planlaşdırılıb',
    due: 'Vaxtı çatıb',
    completed: 'Tamamlanıb',
    inProgress: 'Davam edir',
    pending: 'Gözləyir',
    overdue: 'Gecikib',
    partial: 'Yarımçıq',
    missed: 'Buraxılıb',
    withProblems: 'Problemli',
    withCritical: 'Kritik problemli',
  },
  measures: {
    completionPercent: 'Tamamlanma faizi',
    averageScore: 'Orta bal',
    completionHint: 'Vaxtı çatmış icralardan tamamlananların payı',
  },
  buckets: {
    overdue: 'Gecikmiş',
    partial: 'Yarımçıq',
    missed: 'Buraxılmış',
    problems: 'Problemli',
    completed: 'Tamamlanmış',
    in_progress: 'Davam edən',
    all: 'Hamısı',
  },
  tabs: { summary: 'Xülasə', sites: 'Obyektlər', employees: 'Əməkdaşlar', runs: 'İcralar', problems: 'Problemlər', tasks: 'Tapşırıqlar' },
  columns: {
    measure: 'Göstərici',
    value: 'Dəyər',
    date: 'Tarix',
    dueAt: 'Son vaxt',
    checklist: 'Yoxlama vərəqəsi',
    site: 'Obyekt',
    path: 'Yerləşmə',
    active: 'Aktiv',
    status: 'Status',
    assignees: 'İcraçılar',
    executor: 'İcra edən',
    startedAt: 'Başlanıb',
    completedAt: 'Tamamlanıb (cihaz)',
    completedReceivedAt: 'Serverə çatıb',
    score: 'Bal',
    problemCount: 'Problemlər',
    criticalCount: 'Kritik',
    late: 'Gecikmə ilə',
    clockSuspect: 'Saat şübhəli',
    employee: 'Əməkdaş',
    item: 'Sual',
    severity: 'Ciddilik',
    source: 'Mənbə',
    note: 'Qeyd',
    recordedAt: 'Qeydə alınıb',
    resolution: 'Həll',
    taskStatus: 'Tapşırığın statusu',
    title: 'Başlıq',
    assignee: 'İcraçı',
    priority: 'Prioritet',
    due: 'Son tarix',
    completed: 'Tamamlanıb',
    overdue: 'Gecikib',
  },
  employees: {
    unassigned: 'Təyin edilməyib',
    overCountNote: 'Bir neçə icraçıya təyin olunmuş və icra edilməmiş icra hər icraçı üçün ayrıca sayılır, ona görə cəm obyektlər cədvəlindəkindən çox ola bilər.',
  },
  problems: { total: 'Cəmi problem', critical: 'Kritik' },
  tasks: { overdueOpen: 'Gecikmiş (açıq)', completedOnTime: 'Vaxtında tamamlanıb', completedLate: 'Gecikmə ilə tamamlanıb' },
  export: {
    menu: 'İxrac et',
    thisTable: 'Bu cədvəl',
    fullReport: 'Tam hesabat',
    csv: 'CSV',
    xlsx: 'Excel',
    pdf: 'PDF',
    preparing: 'Fayl hazırlanır…',
    tooLarge: 'Hesabatda {{rows}} sətir var (limit {{limit}}). Filtrləri daraldın.',
  },
  /** Export document titles (PDF header). */
  titles: {
    summary: 'Xülasə hesabatı',
    sites: 'Obyektlər üzrə hesabat',
    employees: 'Əməkdaşlar üzrə hesabat',
    runs: 'İcralar hesabatı',
    problems: 'Problemlər hesabatı',
    tasks: 'Tapşırıqlar hesabatı',
    full: 'Tam dövr hesabatı',
  },
  /** Section headings and Excel sheet names (at most 31 characters). */
  sheets: {
    summary: 'Xülasə',
    trend: 'Gündəlik',
    sites: 'Obyektlər',
    employees: 'Əməkdaşlar',
    runs: 'İcralar',
    overdue: 'Gecikmiş icralar',
    partial: 'Yarımçıq icralar',
    missed: 'Buraxılmış icralar',
    problems: 'Problemlər',
    tasks: 'Tapşırıqlar',
  },
  pdf: {
    period: 'Dövr',
    filters: 'Filtrlər',
    noFilters: 'yoxdur',
    generatedAt: 'Hazırlanma vaxtı',
    page: 'Səhifə {{page}} / {{pages}}',
    empty: 'Məlumat yoxdur.',
  },
  issues: {
    toBeforeFrom: 'Son tarix başlanğıc tarixindən əvvəl ola bilməz.',
    fullNotCsv: 'Tam hesabat yalnız Excel və ya PDF formatında yüklənir.',
  },
} as const;
```

In `packages/i18n/src/az/errors.ts`, after `EVIDENCE_REQUIRED: …,` add:

```ts
  REPORT_RANGE_TOO_LONG: 'Hesabat dövrü ən çox 366 gün ola bilər.',
  REPORT_TOO_LARGE: 'Hesabatda çox sətir var ({{rows}}, limit {{limit}}). Filtrləri daraldın.',
  REPORT_TIMEOUT: 'Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.',
```

In `packages/i18n/src/az/roles.ts`, add `reports: 'Hesabatlar',` as the last entry of `groups`, and the last two entries of `keys`:

```ts
    reports_view: 'Hesabatlara və idarə panelinə baxmaq',
    reports_export: 'Hesabatları yükləmək (CSV, Excel, PDF)',
```

In `packages/i18n/src/az/audit.ts`, add the last entry of `entityTypes`:

```ts
    report: 'Hesabat',
```

In `packages/i18n/src/az/nav.ts`, after `messages: 'Mesajlar',` add:

```ts
  reports: 'Hesabatlar',
```

In `packages/i18n/src/az/index.ts`, import `reports from './reports.js'` and add it to `az` after `platform`:

```ts
export const az = { common, errors, executions, audit, auth, checklists, mobile, nav, notifications, platform, reports, roles, scheduling, settings, sites, tasks, teams, users } as const;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n typecheck && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. The apps only gain keys, so their typechecks stay green.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add Azerbaijani strings for reports, report errors and permissions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API client methods for reports and the export download

**Files:**
- Modify: `packages/api-client/src/client.ts`, `packages/api-client/src/errors.ts`, `packages/api-client/src/endpoints.ts`, `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: the schemas and types of Tasks 1–3 (`reportSummarySchema`, `siteReportRowSchema`, `employeeReportRowSchema`, `reportRunPageSchema`, `reportProblemsSchema`, `reportTasksSchema`, `reportFileName`, the `*Query` input types, `ReportExportKind`).
- Produces: `ApiClient.download`, `DownloadedFile`, `parseContentDispositionFilename`, `ApiError.rows` / `.limit`, `createReportsApi(c: ApiClient)`, `type ReportsApi`, `interface ReportFile`, spread into `createTaskopApi` (method table under **`@taskop/api-client`** in *Interfaces for Parts 2 and 3*).

- [ ] **Step 1: Write the failing test**

In `packages/api-client/src/client.test.ts`, add `parseContentDispositionFilename` to the `./index.js` import, then append:

```ts
describe('report endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'web', store);
  }
  const range = { from: '2026-11-02', to: '2026-11-04' };
  const zero = { planned: 0, due: 0, completed: 0, inProgress: 0, pending: 0, overdue: 0, partial: 0, missed: 0, withProblems: 0, withCritical: 0 };
  const summary = { counts: zero, completionPercent: null, averageScore: null, trend: [{ date: '2026-11-02', due: 0, completed: 0, completionPercent: null }] };
  const empty = { items: [], nextCursor: null };
  const problems = { counts: { total: 0, critical: 0, resolution: { none: 0, open: 0, resolved: 0, cancelled: 0 } }, ...empty };
  const tasks = {
    counts: { byStatus: { new: 0, accepted: 0, in_progress: 0, awaiting_review: 0, completed: 0, cancelled: 0 }, overdueOpen: 0, completedOnTime: 0, completedLate: 0 },
    ...empty,
  };
  const csvFile = () =>
    new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), {
      status: 200,
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="taskop-runs-2026-11-02_2026-11-04.csv"' },
    });

  it('builds every path and query string and parses each response', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('/reports/summary')) return json(200, summary);
      if (url.includes('/reports/sites') || url.includes('/reports/employees')) return json(200, []);
      if (url.includes('/reports/runs')) return json(200, empty);
      if (url.includes('/reports/problems')) return json(200, problems);
      return json(200, tasks);
    });
    const r = createTaskopApi(api).reports;
    expect(await r.summary({ ...range, siteId: id })).toEqual(summary);
    expect(await r.sites(range)).toEqual([]);
    expect(await r.employees({ ...range, userId: id })).toEqual([]);
    expect(await r.runs({ ...range, bucket: 'overdue', cursor: id })).toEqual(empty);
    expect(await r.problems({ ...range, severity: 'critical' })).toEqual(problems);
    expect(await r.tasks({ ...range, checklistId: id })).toEqual(tasks);
    expect(calls).toEqual([
      `GET /api/v1/reports/summary?from=2026-11-02&to=2026-11-04&siteId=${id}`,
      'GET /api/v1/reports/sites?from=2026-11-02&to=2026-11-04',
      `GET /api/v1/reports/employees?from=2026-11-02&to=2026-11-04&userId=${id}`,
      `GET /api/v1/reports/runs?from=2026-11-02&to=2026-11-04&bucket=overdue&cursor=${id}`,
      'GET /api/v1/reports/problems?from=2026-11-02&to=2026-11-04&severity=critical',
      `GET /api/v1/reports/tasks?from=2026-11-02&to=2026-11-04&checklistId=${id}`,
    ]);
  });

  it('downloads an export as a Blob named by Content-Disposition', async () => {
    const seen: Array<[string, string]> = [];
    const { api } = await authed((url, init) => {
      seen.push([url, (init.headers as Record<string, string>).Accept!]);
      return csvFile();
    });
    const file = await createTaskopApi(api).reports.export('runs', { ...range, format: 'csv', bucket: 'missed' });
    expect(file.filename).toBe('taskop-runs-2026-11-02_2026-11-04.csv');
    expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
    expect(seen).toEqual([['/api/v1/reports/runs/export?from=2026-11-02&to=2026-11-04&format=csv&bucket=missed', '*/*']]);
  });

  it('falls back to the contract file name without Content-Disposition', async () => {
    const { api } = await authed(() => new Response('x', { status: 200 }));
    expect((await createTaskopApi(api).reports.export('full', { ...range, format: 'pdf' })).filename).toBe('taskop-full-2026-11-02_2026-11-04.pdf');
  });

  it('refreshes and retries a download on UNAUTHENTICATED', async () => {
    const { api } = setup((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, loginResult('fresh'));
      return (init.headers as Record<string, string>).Authorization === 'Bearer fresh' ? csvFile() : err(401, 'UNAUTHENTICATED');
    });
    expect((await api.download('/reports/runs/export', { query: { ...range, format: 'csv' } })).filename).toBe('taskop-runs-2026-11-02_2026-11-04.csv');
  });

  it('exposes rows and limit on REPORT_TOO_LARGE', async () => {
    const { api } = await authed(() =>
      json(422, { error: { code: 'REPORT_TOO_LARGE', messageKey: 'errors.REPORT_TOO_LARGE', fields: null, retryAfterSeconds: null, requestId: 'r1', rows: 12000, limit: 10000 } }),
    );
    await expect(createTaskopApi(api).reports.export('runs', { ...range, format: 'xlsx' })).rejects.toMatchObject({ status: 422, code: 'REPORT_TOO_LARGE', rows: 12000, limit: 10000 });
  });

  it('reads RFC 6266 file names', () => {
    expect(parseContentDispositionFilename('attachment; filename="a b.csv"')).toBe('a b.csv');
    expect(parseContentDispositionFilename(`attachment; filename*=UTF-8''t%C9%99.csv; filename="t.csv"`)).toBe('tə.csv');
    expect(parseContentDispositionFilename('attachment; filename=plain.pdf')).toBe('plain.pdf');
    expect(parseContentDispositionFilename('attachment')).toBeNull();
    expect(parseContentDispositionFilename(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api-client test`
Expected: FAIL: `parseContentDispositionFilename` is not exported and `createTaskopApi(api).reports` is undefined.

- [ ] **Step 3: Implement the client changes**

In `packages/api-client/src/errors.ts`, add two last constructor parameters to `ApiError`, after `missing`:

```ts
    /** REPORT_TOO_LARGE: the rows the export would have, and the cap. */
    readonly rows: number | null = null,
    readonly limit: number | null = null,
```

In `packages/api-client/src/client.ts`:

1. In `RequestOptions<T>`, after `auth?: boolean;` add:

```ts
  /** The Accept header; JSON unless a file is downloaded. */
  accept?: string;
```

2. `toApiError` passes the two new fields:

```ts
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId, e.issues ?? null, e.currentRevision ?? null, e.userIds ?? null, e.missing ?? null, e.rows ?? null, e.limit ?? null);
```

3. Add, after `toApiError`:

```ts
export interface DownloadedFile {
  blob: Blob;
  /** From Content-Disposition; null when the server sent none. */
  filename: string | null;
  contentType: string | null;
}

/** The file name of a Content-Disposition header; RFC 6266 `filename*=UTF-8''…` wins over `filename="…"`. */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim());
    } catch {
      // A malformed escape: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  const name = plain?.[1] ?? plain?.[2]?.trim();
  return name ? name : null;
}
```

4. In `ApiClient`, replace `request` with the version below and add `download` and `sendAuthed`:

```ts
  request<T>(method: string, path: string, o: RequestOptions<T> = {}): Promise<T> {
    return this.bounded(async (signal) => this.parse(await this.sendAuthed(method, path, o, signal), o.schema));
  }

  /** A file download (SP7 report exports): the same auth, refresh, timeout and errors as `request`; the body is a Blob. */
  download(path: string, o: { query?: QueryParams } = {}): Promise<DownloadedFile> {
    return this.bounded(async (signal) => {
      const res = await this.sendAuthed('GET', path, { query: o.query, accept: '*/*' }, signal);
      if (!res.ok) throw await toApiError(res);
      return {
        blob: await res.blob(),
        filename: parseContentDispositionFilename(res.headers.get('content-disposition')),
        contentType: res.headers.get('content-type'),
      };
    });
  }

  /** Sends once; on UNAUTHENTICATED refreshes (single-flight) and sends again. */
  private async sendAuthed<T>(method: string, path: string, o: RequestOptions<T>, signal: AbortSignal | undefined): Promise<Response> {
    let res = await this.send(method, path, o, signal);
    if (res.status === 401 && o.auth !== false && this.opts.refresh !== false && (await isUnauthenticated(res))) {
      const refreshed = await this.refresh();
      if (!refreshed) {
        this.opts.onSessionExpired?.();
        throw await toApiError(res);
      }
      res = await this.send(method, path, o, signal);
    }
    return res;
  }
```

5. In `send`, the first line becomes:

```ts
    const headers: Record<string, string> = { Accept: o.accept ?? 'application/json' };
```

- [ ] **Step 4: Add the endpoints**

In `packages/api-client/src/endpoints.ts`, add these to the `@taskop/contracts` import:

```ts
  employeeReportRowSchema,
  type ReportExportKind,
  type ReportExportQuery,
  reportFileName,
  type ReportFiltersQuery,
  type ReportProblemsQuery,
  reportProblemsSchema,
  reportRunPageSchema,
  type ReportRunsQuery,
  reportSummarySchema,
  type ReportTasksQuery,
  reportTasksSchema,
  siteReportRowSchema,
```

Add `...createReportsApi(c),` as the last line of the object returned by `createTaskopApi` (after `...createNotificationsApi(c),`), and append:

```ts
/** A downloaded report file (SP7 spec §5.4). */
export interface ReportFile {
  blob: Blob;
  filename: string;
}

/** Sub-project 7: dashboards and reports (reports.view) and their files (reports.export). */
export function createReportsApi(c: ApiClient) {
  return {
    reports: {
      summary: (query: ReportFiltersQuery) => c.request('GET', '/reports/summary', { query: q(query), schema: reportSummarySchema }),
      sites: (query: ReportFiltersQuery) => c.request('GET', '/reports/sites', { query: q(query), schema: z.array(siteReportRowSchema) }),
      employees: (query: ReportFiltersQuery) => c.request('GET', '/reports/employees', { query: q(query), schema: z.array(employeeReportRowSchema) }),
      runs: (query: ReportRunsQuery) => c.request('GET', '/reports/runs', { query: q(query), schema: reportRunPageSchema }),
      problems: (query: ReportProblemsQuery) => c.request('GET', '/reports/problems', { query: q(query), schema: reportProblemsSchema }),
      tasks: (query: ReportTasksQuery) => c.request('GET', '/reports/tasks', { query: q(query), schema: reportTasksSchema }),
      /** The file and its name: Content-Disposition, else `taskop-<kind>-<from>_<to>.<ext>`. */
      export: async (kind: ReportExportKind, query: ReportExportQuery): Promise<ReportFile> => {
        const file = await c.download(`/reports/${kind}/export`, { query: q(query) });
        return { blob: file.blob, filename: file.filename ?? reportFileName(kind, query.from, query.to, query.format) };
      },
    },
  };
}
export type ReportsApi = ReturnType<typeof createReportsApi>;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. Every existing client test still passes: `request` behaves exactly as before (the refresh moved into `sendAuthed`).

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add report endpoints and file downloads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The local-day index and the report permission backfill

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0013_reports.sql` (generated), `apps/api/drizzle/0014_reports_permissions.sql` (custom)
- Test: `apps/api/test/reports-db.test.ts`

**Interfaces:**
- Consumes: the `reports.view` / `reports.export` keys (Task 3).
- Produces: the index `occurrences_local_date_idx` on `occurrences (tenant_id, local_date)` (spec §5.7); every existing `admin`, `manager` and `auditor` role holds both report keys, with its `version` bumped so cached permission sets reload. No executions index (Spec decision 24).

- [ ] **Step 1: Write the failing test**

`apps/api/test/reports-db.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { signupTenant } from './fixtures';
import { ownerQuery } from './owner-db';

describe('report index and permissions', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('indexes occurrences by tenant and local day, and relies on the existing execution indexes', async () => {
    const r = await ownerQuery<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where indexname in ('occurrences_local_date_idx', 'executions_occurrence_idx', 'executions_claim_uq') order by indexname`,
    );
    expect(r.rows.map((x) => x.indexname)).toEqual(['executions_claim_uq', 'executions_occurrence_idx', 'occurrences_local_date_idx']);
    expect(r.rows.find((x) => x.indexname === 'occurrences_local_date_idx')!.indexdef).toContain('(tenant_id, local_date)');
    expect(r.rows.find((x) => x.indexname === 'executions_claim_uq')!.indexdef).toContain("WHERE (state <> 'rejected'::execution_state)");
  });

  it('backfills the report keys for existing Admin, Manager and Auditor roles and bumps their version', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) =>
      (await ownerQuery<{ id: string; version: number }>('select id, version from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!;
    const before = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key like 'reports.%'", [Object.values(before).map((r) => r.id)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0014_reports_permissions.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = async (roleId: string) =>
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key like 'reports.%' order by 1", [roleId])).rows.map((r) => r.k);
    for (const key of ['admin', 'manager', 'auditor'] as const) {
      expect(await keys(before[key].id), key).toEqual(['reports.export', 'reports.view']);
      expect((await roleOf(key)).version, key).toBe(before[key].version + 1);
    }
    expect(await keys(before.worker.id)).toEqual([]);
    expect((await roleOf('worker')).version).toBe(before.worker.version);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- reports-db`
Expected: FAIL: `occurrences_local_date_idx` is missing and `0014_reports_permissions.sql` does not exist (ENOENT).

- [ ] **Step 3: Add the index to the Drizzle schema**

In `apps/api/src/db/schema.ts`, in the `occurrences` table's index list, after `index('occurrences_assignment_start_idx').on(t.tenantId, t.assignmentId, t.startsAt),` add:

```ts
    // Every report filters runs by their tenant-local day (SP7 spec §5.7).
    index('occurrences_local_date_idx').on(t.tenantId, t.localDate),
```

- [ ] **Step 4: Generate the migrations and write the backfill**

```bash
pnpm --filter @taskop/api exec drizzle-kit generate --name reports
pnpm --filter @taskop/api exec drizzle-kit generate --custom --name reports_permissions
```

Check the output:
- `apps/api/drizzle/0013_reports.sql` contains exactly `CREATE INDEX "occurrences_local_date_idx" ON "occurrences" USING btree ("tenant_id","local_date");`
- `meta/_journal.json` has entries `0013_reports` and `0014_reports_permissions`; `0014_reports_permissions.sql` is created empty.

Write `apps/api/drizzle/0014_reports_permissions.sql`:

```sql
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS report keys (new tenants get them at signup). Admin roles were seeded
-- with the permission list of their time, so they need the keys too (SP7 Spec decision 25).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['reports.view','reports.export']) AS k
  WHERE r.system_key IN ('admin', 'manager', 'auditor')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager', 'auditor');
--> statement-breakpoint
SET LOCAL row_security = on;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- reports-db notifications-db tasks-db roles`
Expected: PASS. The global test setup applies the new migrations to a fresh container.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/reports-db.test.ts
git commit -m "feat(api): index occurrences by local day and backfill the report permissions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Run detail for report viewers (spec §5.6)

**Files:**
- Modify: `apps/api/src/common/decorators.ts`, `apps/api/src/auth/permission.guard.ts`, `apps/api/src/auth/permission.guard.test.ts`, `apps/api/src/checklists/route-mode.ts`, `apps/api/src/scheduling/occurrences.controller.ts`, `apps/api/src/executions/execution-access.ts`, `apps/api/src/executions/executions.controller.ts`
- Test: `apps/api/test/reports-run-access.test.ts`

**What the check found (Spec decision 1).** `ExecutionAccess.assertCanRead` and `OccurrencesService.get` both filter with `SchedulingScope.occurrences(principal)`, so a `site_subtree` manager already reads the runs at their sites and below and a `subordinates` manager the runs of their chain; the first two tests below pin that. Both reads also demand `assignments.view`, which `reports.view` alone does not give, so this task accepts either key.

**Interfaces:**
- Consumes: the `reports.view` key (Task 3).
- Produces:
  - `type PermissionRequirement = PermissionKey[] | { any: PermissionKey[] }` and `RequireAnyPermission(...keys: PermissionKey[])` in `common/decorators.ts`; `PermissionGuard` honours both shapes.
  - `permAny(mode: RouteMode, ...keys: PermissionKey[]): MethodDecorator` in `checklists/route-mode.ts`.
  - `GET /occurrences/:id`, `GET /executions/:id` and `GET /media/:id/url` accept `assignments.view` **or** `reports.view`, still inside the data scope.

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/auth/permission.guard.test.ts`, the reflector helper accepts any metadata:

```ts
const reflector = (keys: unknown) => ({ getAllAndOverride: () => keys }) as unknown as Reflector;
```

and append inside `describe('PermissionGuard', …)`:

```ts
  it('allows an any-of requirement when one key is held, and refuses it when none is', () => {
    const guard = new PermissionGuard(reflector({ any: ['assignments.view', 'reports.view'] }));
    expect(guard.canActivate(ctx({ permissions: new Set(['reports.view']) }))).toBe(true);
    expect(guard.canActivate(ctx({ permissions: new Set(['assignments.view']) }))).toBe(true);
    expect(() => guard.canActivate(ctx({ permissions: new Set(['users.view']) }))).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
```

`apps/api/test/reports-run-access.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimOk, type ExecutionWorld, executionWorld } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

describe('run detail for report viewers (SP7 spec §5.6)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: ExecutionWorld;
  let executionId: string;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
  });
  afterAll(() => t.close());

  const staff = async (role: { roleKey?: 'manager'; roleId?: string }, siteIds: string[] = []) => {
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', emailVerified: true, ...role });
    if (siteIds.length) expect((await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds })).status).toBe(200);
    return { id: u.id, api: as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken) };
  };
  const customRole = async (dataScope: string, permissions: string[]) => {
    const res = await w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope, permissions });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  /** [GET /executions/:id, GET /occurrences/:id] statuses. */
  const reads = async (api: Api) => [(await api.get(`/api/v1/executions/${executionId}`)).status, (await api.get(`/api/v1/occurrences/${w.occurrenceId}`)).status];

  it('lets a site_subtree manager read runs at their site, and only there (already true)', async () => {
    expect(await reads((await staff({ roleKey: 'manager' }, [w.siteId])).api)).toEqual([200, 200]);
    expect(await reads((await staff({ roleKey: 'manager' }, [w.otherSiteId])).api)).toEqual([404, 404]);
  });

  it('lets a subordinates manager read the runs of their people, and only theirs (already true)', async () => {
    const boss = await staff({ roleId: await customRole('subordinates', ['assignments.view', 'reports.view']) });
    expect(await reads(boss.api)).toEqual([404, 404]);
    await ownerQuery('update users set manager_id = $1 where id = $2', [boss.id, w.workers[0].id]);
    expect(await reads(boss.api)).toEqual([200, 200]);
  });

  it('lets a reports.view holder without assignments.view open the run and its execution', async () => {
    const viewer = await staff({ roleId: await customRole('all', ['reports.view']) });
    expect(await reads(viewer.api)).toEqual([200, 200]);
  });

  it('still hides the run from a role with neither key', async () => {
    const other = await staff({ roleId: await customRole('all', ['checklists.view']) });
    expect(await reads(other.api)).toEqual([404, 403]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- permission.guard reports-run-access`
Expected: the guard test FAILS on the last expectation (the old guard reads `.length` of the `{ any }` object as `undefined` and lets everyone through); `reports-run-access`: the first two tests PASS (the scope already matches), `lets a reports.view holder…` FAILS with `[404, 403]`, the last one PASSES.

- [ ] **Step 3: Implement**

In `apps/api/src/common/decorators.ts`, replace the `RequirePermission` line with:

```ts
/** Every key of a list is needed; with `{ any }`, one of them is enough. */
export type PermissionRequirement = PermissionKey[] | { any: PermissionKey[] };
export const RequirePermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, keys satisfies PermissionRequirement);
/** One of `keys` is enough, e.g. the run drawer: assignments.view or reports.view (SP7 spec §5.6). */
export const RequireAnyPermission = (...keys: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, { any: keys } satisfies PermissionRequirement);
```

`apps/api/src/auth/permission.guard.ts` becomes:

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { type PermissionRequirement, REQUIRED_PERMISSIONS_KEY } from '../common/decorators';
import type { AppRequest } from '../common/request';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(REQUIRED_PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const keys = Array.isArray(required) ? required : required.any;
    if (!keys.length) return true;
    const principal = ctx.switchToHttp().getRequest<AppRequest>().principal;
    const has = (k: PermissionKey) => principal?.permissions.has(k) === true;
    const ok = Array.isArray(required) ? keys.every(has) : keys.some(has);
    if (!principal || !ok) throw new AppError('FORBIDDEN');
    return true;
  }
}
```

In `apps/api/src/checklists/route-mode.ts`, change the decorators import to `import { Public, RequireAnyPermission, RequirePermission } from '../common/decorators';` and add after `perm`:

```ts
/** Like `perm`, but one of `keys` is enough. */
export const permAny = (mode: RouteMode, ...keys: PermissionKey[]): MethodDecorator => (mode === 'tenant' ? RequireAnyPermission(...keys) : noop);
```

In `apps/api/src/scheduling/occurrences.controller.ts`:
- the route-mode import becomes `import { controllerDecorators, named, perm, permAny, type RouteMode } from '../checklists/route-mode';`
- after `const manage = …` add:

```ts
  // The run drawer is also opened from the reports (SP7 spec §5.6).
  const viewOrReports = permAny(mode, 'assignments.view', 'reports.view');
```

- the `get` handler's `@view` becomes `@viewOrReports`.

In `apps/api/src/executions/execution-access.ts`, `assertCanRead` becomes:

```ts
  /**
   * The executor, or an assignments.view or reports.view holder whose data scope covers the occurrence (SP7 spec §5.6);
   * anyone else gets 404.
   */
  async assertCanRead(p: Principal, executorUserId: string, occurrenceId: string): Promise<void> {
    if (p.userId === executorUserId) return;
    if (p.permissions.has('assignments.view') || p.permissions.has('reports.view')) {
      const [o] = await this.db
        .tx()
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(and(eq(occurrences.id, occurrenceId), this.scope.occurrences(p)));
      if (o) return;
    }
    throw new AppError('NOT_FOUND');
  }
```

In `apps/api/src/executions/executions.controller.ts`, the comment above `get` becomes:

```ts
  /** The executor, or assignments.view or reports.view within the data scope (spec §6.8, SP7 §5.6); anyone else gets 404. */
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- permission.guard reports-run-access executions-scope executions-read occurrences executions-media`
Expected: PASS. `executions-scope`'s `needs assignments.view to read someone else's execution…` still passes: its role has neither key.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/decorators.ts apps/api/src/auth/permission.guard.ts apps/api/src/auth/permission.guard.test.ts apps/api/src/checklists/route-mode.ts apps/api/src/scheduling/occurrences.controller.ts apps/api/src/executions/execution-access.ts apps/api/src/executions/executions.controller.ts apps/api/test/reports-run-access.test.ts
git commit -m "feat(api): let reports.view holders open the run drawer within their scope" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The reports module, the guard and `GET /reports/summary`

**Files:**
- Create: `apps/api/src/reports/report-filters.ts`, `report-queries.ts`, `reports.service.ts`, `reports.controller.ts`, `dto.ts`, `reports.module.ts`
- Create: `apps/api/test/report-fixtures.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/config/config.ts`, `apps/api/src/config/config.test.ts`, `apps/api/.env.example`
- Test: `apps/api/test/reports-summary.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`completionPercent`, `periodDays`, `reportRangeTooLong`, `COMPLETED_STATUSES`, `IN_PROGRESS_STATUSES`, `roundOne`, `reportFiltersSchema`, `reportSummarySchema`, `ReportFilters`, `ReportSummary`, `RunCounts`); `SchedulingScope.occurrences(a: ScopeHolder | null): SQL | undefined`; `pgErrorOf`; `Clock`; `APP_CONFIG`.
- Produces, used by Tasks 9–16:
  - `interface ResolvedFilters extends ReportFilters { sitePath?: string | null; timezone: string; tenantName: string; now: Date }` and `ReportFilterResolver.resolve(q: ReportFilters): Promise<ResolvedFilters>` (throws `REPORT_RANGE_TOO_LONG`)
  - in `report-queries.ts`: `statusList(list: readonly string[]): SQL`, `inFilterSubtree(f: ResolvedFilters, siteCol: AnyPgColumn): SQL | undefined`, `interface CountRow`, `countColumns(now: Date): SQL` (over `runs r`), `toCounts(r: CountRow): RunCounts`, `measuresOf(r: CountRow): { completionPercent; averageScore }`, `runsCte(f: ResolvedFilters, scope: SQL | undefined): SQL` (the CTE `runs`), and `ReportQueries.summary(f, scope): Promise<ReportSummary>`
  - `ReportsService.guarded<T>(q: ReportFilters, fn: (f: ResolvedFilters) => Promise<T>): Promise<T>` (timeout + 57014 → `REPORT_TIMEOUT`) and `ReportsService.summary(p: Principal, q: ReportFilters)`
  - `GET /reports/summary` (`reports.view`)
  - config `REPORTS_STATEMENT_TIMEOUT_MS` (default `15000`)
  - test fixtures in `apps/api/test/report-fixtures.ts`: `REPORT_NOW`, `PERIOD`, `qs`, `counts`, `reportBase`, `addSite`, `addChecklist`, `addRun`, `addProblem`, `addTask`, `reportWorld` and their types (below)

**The fixture tenant (spec §9).** `reportWorld` builds one tenant with "now" = Wednesday 2026-11-04 08:00Z (12:00 Baku) and the period Monday 2026-11-02 to Wednesday. Rows go straight into the database (owner connection), so every status and time is exact. Due times are 06:00Z (10:00 Baku) unless noted; windows open 2 h before and close 1 h after the due time.
- Sites: `Filial A` → `Zona A1`, `Zona A2`; `Filial B`. Checklists: `Açılış yoxlaması` (scored) and `Anbar sayımı` (scoring off: no score).
- People: Leyla Quliyeva (Manager, `site_subtree`, linked to Filial A); Rauf Kərimov (custom "Nəzarətçi", `subordinates`, `reports.view` + `assignments.view` + `tasks.view`, reports to Leyla); workers Aynur Quliyeva (Zona A1) and Kamran Əliyev (Zona A2), both reporting to Rauf; Nigar Həsənova (Filial B, no manager); Samir Məmmədov (deactivated, reports to Rauf).

| Run | Day | Site | Status | Assignees | Counted execution (score) |
|---|---|---|---|---|---|
| r1 | 02 | Zona A1 | completed | Aynur | Aynur (80); problem p1 (normal) |
| r2 | 02 | Zona A2 | completed | Aynur, Kamran, Samir | Kamran (100) |
| r3 | 02 | Zona A1 | missed | Aynur, Kamran, Samir | — |
| r4 | 02 | Filial B | completed | Nigar | Nigar (60); problems p2 (critical), p3 (normal) |
| r5 | 02 | Zona A2 | partial (Anbar) | Kamran | Kamran (none) |
| r6 | 02 | Filial A | cancelled | Aynur | — |
| r7 | 02 | Zona A1 | completed, synced on the 4th at 05:00Z, late | Aynur | Aynur (90), completed 07:00Z |
| r8 | 03 | Zona A1 | missed | nobody | — |
| r9 | 03 | Zona A2 | completed, clock suspect | Kamran | Kamran (50); problem p4 (critical) |
| r10 | 03 | Filial B | missed (Anbar) | Nigar | — |
| r11 | 03 | Zona A1 | completed | Samir | Samir (70) |
| r12 | 04 | Zona A1 | overdue | Aynur | — |
| r13 | 04, due 10:00Z | Zona A2 | in_progress | Kamran | Kamran (none) |
| r14 | 04, due 10:00Z | Filial A | pending | Aynur | — |
| r15 | 04, due 12:00Z | Zona A1 | completed early (07:30Z) | Aynur | Aynur (100) |
| r16 | 04 | Zona A2 | started | Aynur, Kamran | Kamran (none); Aynur's lost claim (rejected, score 10) |

Problems p1–p4 are created at 2026-11-02 05:00Z, 05:10Z, 05:20Z and 2026-11-03 05:00Z; p2's note has a comma, quotes and a line break, p3's note is `=1+2`. Tasks t1–t10 (all created by the owner) are listed in `reportWorld` below: t3 is linked to p2 (in progress, overdue), t5 to p3 (completed on time), t7 to p4 (cancelled), t6 is completed late, t8 has no due date, t9 is outside the period, t10 is due 21:30Z on 1 November (01:30 on the 2nd in Baku).

Whole-tenant numbers for the period (used in Tasks 8–15): planned 15, due 13, completed 7, in progress 2, pending 1, overdue 1, partial 1, missed 3, with problems 3, with critical 2; completion 53.8 %, average score 78.6.

- [ ] **Step 1: Write the fixtures**

`apps/api/test/report-fixtures.ts`:

```ts
import { emptyRunCounts, type OccurrenceStatus, type RunCounts, type TaskStatus } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { as, createUserDirect, loginStaff, type SignedUpTenant, signupTenant, siteTypeIdOf } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, publishedChecklist } from './scheduling-fixtures';

/** Wednesday 2026-11-04 12:00 in Baku (UTC+4): "now" of every report test. */
export const REPORT_NOW = '2026-11-04T08:00:00Z';
/** Monday to Wednesday of the fixture week. */
export const PERIOD = { from: '2026-11-02', to: '2026-11-04' };

/** A query string without the undefined entries. */
export const qs = (o: Record<string, string | undefined>): string =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined)).toString();

/** Run counts with zeros for everything not given. */
export const counts = (c: Partial<RunCounts> = {}): RunCounts => ({ ...emptyRunCounts(), ...c });

export interface ReportBase {
  s: SignedUpTenant;
  owner: Api;
  branchTypeId: string;
  zoneTypeId: string;
}

/** A fresh tenant with its owner logged in. */
export async function reportBase(t: TestApp): Promise<ReportBase> {
  const s = await signupTenant(t);
  return { s, owner: as(t, s.accessToken), branchTypeId: await siteTypeIdOf(s.tenantId, 'Filial'), zoneTypeId: await siteTypeIdOf(s.tenantId, 'Zona') };
}

export async function addSite(b: ReportBase, name: string, parentId: string | null = null): Promise<string> {
  const res = await b.owner.post('/api/v1/sites', { parentId, typeId: parentId ? b.zoneTypeId : b.branchTypeId, name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

export interface ChecklistRef {
  id: string;
  versionId: string;
}

export async function addChecklist(b: ReportBase, name: string): Promise<ChecklistRef> {
  const id = await publishedChecklist(b.owner, name);
  const r = await ownerQuery<{ v: string }>('select current_version_id as v from checklists where id = $1', [id]);
  return { id, versionId: r.rows[0]!.v };
}

export interface ExecutionSpec {
  executor: string;
  state: 'active' | 'completed' | 'partial' | 'rejected';
  /** score.percent; null for a scoring-off checklist or no answers yet. */
  score: number | null;
  completedAt?: string;
  /** Defaults to completedAt (synced at once). */
  completedReceivedAt?: string;
  late?: boolean;
  clockSuspect?: boolean;
}

export interface RunSpec {
  date: string;
  siteId: string;
  checklist: ChecklistRef;
  status: OccurrenceStatus;
  dueAt: string;
  /** Defaults to 2 h before dueAt; the window closes 1 h after dueAt; executions start 10 min after it opens. */
  startsAt?: string;
  assignees: string[];
  executions?: ExecutionSpec[];
}

export interface AddedRun {
  occurrenceId: string;
  /** In RunSpec.executions order. */
  executionIds: string[];
}

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** One occurrence with its own (ended) assignment, so any number of runs can share a day; plus assignees and executions. */
export async function addRun(b: ReportBase, r: RunSpec): Promise<AddedRun> {
  const assignmentId = uuidv7();
  await ownerQuery(
    `insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, status, created_by_user_id)
     values ($1, $2, $3, $4, '{}'::jsonb, '{}'::jsonb, 'ended', $5)`,
    [assignmentId, b.s.tenantId, r.checklist.id, r.siteId, b.s.ownerId],
  );
  const due = +new Date(r.dueAt);
  const starts = r.startsAt ? +new Date(r.startsAt) : due - 2 * HOUR;
  const occurrenceId = uuidv7();
  await ownerQuery(
    `insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status, cancel_reason, checklist_version_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [occurrenceId, b.s.tenantId, assignmentId, r.checklist.id, r.siteId, r.date, iso(starts), iso(due), iso(due + HOUR), r.status, r.status === 'cancelled' ? 'Test' : null, r.checklist.versionId],
  );
  for (const userId of r.assignees) {
    await ownerQuery('insert into occurrence_assignees (tenant_id, occurrence_id, user_id) values ($1, $2, $3)', [b.s.tenantId, occurrenceId, userId]);
  }
  const executionIds: string[] = [];
  for (const x of r.executions ?? []) {
    const id = uuidv7();
    await ownerQuery(
      `insert into executions (id, tenant_id, occurrence_id, checklist_version_id, executor_user_id, state, rejected_reason, started_at, started_received_at,
                               completed_at, completed_received_at, last_synced_at, progress, score, late, clock_suspect, device)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, coalesce($10, $8), '{"answered":1,"total":1,"requiredMissing":0}'::jsonb, $11::jsonb, $12, $13,
               '{"platform":"android","osVersion":"15","appVersion":"1.0.0"}'::jsonb)`,
      [
        id, b.s.tenantId, occurrenceId, r.checklist.versionId, x.executor, x.state, x.state === 'rejected' ? 'ALREADY_CLAIMED' : null, iso(starts + 10 * 60_000),
        x.completedAt ?? null, x.completedReceivedAt ?? x.completedAt ?? null, JSON.stringify({ earned: 0, possible: 0, percent: x.score, problems: [] }),
        x.late ?? false, x.clockSuspect ?? false,
      ],
    );
    executionIds.push(id);
  }
  return { occurrenceId, executionIds };
}

export interface ProblemSpec {
  run: AddedRun;
  siteId: string;
  checklistId: string;
  severity: 'normal' | 'critical';
  source?: 'rule' | 'manual';
  note?: string | null;
  createdAt: string;
}

/** A problem of the run's first (counted) execution, on a random item. */
export async function addProblem(b: ReportBase, p: ProblemSpec): Promise<string> {
  const id = uuidv7();
  await ownerQuery(
    `insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity, note, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [id, b.s.tenantId, p.run.executionIds[0], p.run.occurrenceId, p.siteId, p.checklistId, uuidv7(), p.source ?? 'rule', p.severity, p.note ?? null, p.createdAt],
  );
  return id;
}

export interface TaskSpec {
  title: string;
  status: TaskStatus;
  assigneeUserId: string;
  siteId?: string | null;
  dueAt?: string | null;
  createdAt: string;
  completedAt?: string | null;
  overdueAt?: string | null;
  problemId?: string | null;
}

/** A task created by the owner, straight in the DB. */
export async function addTask(b: ReportBase, x: TaskSpec): Promise<string> {
  const id = uuidv7();
  await ownerQuery(
    `insert into tasks (id, tenant_id, title, created_by_user_id, assignee_user_id, site_id, status, due_at, overdue_at, completed_at, cancelled_at, problem_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [
      id, b.s.tenantId, x.title, b.s.ownerId, x.assigneeUserId, x.siteId ?? null, x.status, x.dueAt ?? null, x.overdueAt ?? null, x.completedAt ?? null,
      x.status === 'cancelled' ? x.createdAt : null, x.problemId ?? null, x.createdAt,
    ],
  );
  return id;
}

export interface Worker {
  id: string;
  username: string;
  secret: string;
}

export type RunKey = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7' | 'r8' | 'r9' | 'r10' | 'r11' | 'r12' | 'r13' | 'r14' | 'r15' | 'r16';
export type TaskKey = 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7' | 't8' | 't9' | 't10';

export interface ReportWorld extends ReportBase {
  sites: { branchA: string; zoneA1: string; zoneA2: string; branchB: string };
  checklists: { opening: ChecklistRef; stock: ChecklistRef };
  leyla: { id: string; api: Api };
  rauf: { id: string; api: Api };
  aynur: Worker;
  kamran: Worker;
  nigar: Worker;
  samir: Worker;
  runs: Record<RunKey, AddedRun>;
  problems: { p1: string; p2: string; p3: string; p4: string };
  tasks: Record<TaskKey, string>;
}

const D02 = '2026-11-02T06:00:00Z';
const D03 = '2026-11-03T06:00:00Z';
const D04 = '2026-11-04T06:00:00Z';

/** The spec §9 fixture tenant; see the table in Part 1 Task 8. */
export async function reportWorld(t: TestApp): Promise<ReportWorld> {
  const b = await reportBase(t);
  const branchA = await addSite(b, 'Filial A');
  const zoneA1 = await addSite(b, 'Zona A1', branchA);
  const zoneA2 = await addSite(b, 'Zona A2', branchA);
  const branchB = await addSite(b, 'Filial B');
  const opening = await addChecklist(b, 'Açılış yoxlaması');
  // Scoring off: its executions carry no score.
  const stock = await addChecklist(b, 'Anbar sayımı');

  const leyla = await staffAt(t, b.s.tenantId, b.owner, 'manager', [branchA], 'Leyla Quliyeva');
  const supervisor = await b.owner.post('/api/v1/roles', { name: 'Nəzarətçi', dataScope: 'subordinates', permissions: ['reports.view', 'assignments.view', 'tasks.view'] });
  expect(supervisor.status, JSON.stringify(supervisor.body)).toBe(201);
  const raufUser = await createUserDirect(t, b.s.tenantId, { kind: 'staff', roleId: supervisor.body.id as string, fullName: 'Rauf Kərimov', managerId: leyla.id, emailVerified: true });
  const rauf = { id: raufUser.id, api: as(t, (await loginStaff(t, raufUser.email!, raufUser.secret, 'web')).accessToken) };
  const worker = async (fullName: string, siteId: string | null, managerId: string | null, status: 'active' | 'deactivated' = 'active'): Promise<Worker> => {
    const u = await createUserDirect(t, b.s.tenantId, { fullName, managerId, status });
    if (siteId) expect((await b.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] })).status).toBe(200);
    return { id: u.id, username: u.username!, secret: u.secret };
  };
  const aynur = await worker('Aynur Quliyeva', zoneA1, rauf.id);
  const kamran = await worker('Kamran Əliyev', zoneA2, rauf.id);
  const nigar = await worker('Nigar Həsənova', branchB, null);
  const samir = await worker('Samir Məmmədov', null, rauf.id, 'deactivated');

  const done = (executor: Worker, score: number | null, completedAt: string, extra: Partial<ExecutionSpec> = {}): ExecutionSpec => ({ executor: executor.id, state: 'completed', score, completedAt, ...extra });
  const run = (date: string, siteId: string, status: OccurrenceStatus, dueAt: string, assignees: Worker[], executions: ExecutionSpec[] = [], extra: Partial<RunSpec> = {}) =>
    addRun(b, { date, siteId, checklist: opening, status, dueAt, assignees: assignees.map((a) => a.id), executions, ...extra });

  const runs: Record<RunKey, AddedRun> = {
    r1: await run('2026-11-02', zoneA1, 'completed', D02, [aynur], [done(aynur, 80, '2026-11-02T05:30:00Z')]),
    r2: await run('2026-11-02', zoneA2, 'completed', D02, [aynur, kamran, samir], [done(kamran, 100, '2026-11-02T05:40:00Z')]),
    r3: await run('2026-11-02', zoneA1, 'missed', D02, [aynur, kamran, samir]),
    r4: await run('2026-11-02', branchB, 'completed', D02, [nigar], [done(nigar, 60, '2026-11-02T05:50:00Z')]),
    r5: await run('2026-11-02', zoneA2, 'partial', D02, [kamran], [{ executor: kamran.id, state: 'partial', score: null }], { checklist: stock }),
    r6: await run('2026-11-02', branchA, 'cancelled', D02, [aynur]),
    // Done on Monday, synced from the phone on Wednesday: it still belongs to Monday (FR-10.13).
    r7: await run('2026-11-02', zoneA1, 'completed', D02, [aynur], [done(aynur, 90, '2026-11-02T07:00:00Z', { completedReceivedAt: '2026-11-04T05:00:00Z', late: true })]),
    r8: await run('2026-11-03', zoneA1, 'missed', D03, []),
    r9: await run('2026-11-03', zoneA2, 'completed', D03, [kamran], [done(kamran, 50, '2026-11-03T05:30:00Z', { clockSuspect: true })]),
    r10: await run('2026-11-03', branchB, 'missed', D03, [nigar], [], { checklist: stock }),
    r11: await run('2026-11-03', zoneA1, 'completed', D03, [samir], [done(samir, 70, '2026-11-03T05:30:00Z')]),
    r12: await run('2026-11-04', zoneA1, 'overdue', D04, [aynur]),
    r13: await run('2026-11-04', zoneA2, 'in_progress', '2026-11-04T10:00:00Z', [kamran], [{ executor: kamran.id, state: 'active', score: null }], { startsAt: '2026-11-04T07:00:00Z' }),
    r14: await run('2026-11-04', branchA, 'pending', '2026-11-04T10:00:00Z', [aynur]),
    // Finished before its due time: due and completed.
    r15: await run('2026-11-04', zoneA1, 'completed', '2026-11-04T12:00:00Z', [aynur], [done(aynur, 100, '2026-11-04T07:30:00Z')], { startsAt: '2026-11-04T05:00:00Z' }),
    // Kamran's claim won; Aynur's lost claim (score 10) must never count.
    r16: await run('2026-11-04', zoneA2, 'started', D04, [aynur, kamran], [
      { executor: kamran.id, state: 'active', score: null },
      { executor: aynur.id, state: 'rejected', score: 10 },
    ]),
  };

  const problems = {
    p1: await addProblem(b, { run: runs.r1, siteId: zoneA1, checklistId: opening.id, severity: 'normal', note: 'Qapı sınıqdır', createdAt: '2026-11-02T05:00:00Z' }),
    // A comma, quotes and a line break: the CSV round trip.
    p2: await addProblem(b, { run: runs.r4, siteId: branchB, checklistId: opening.id, severity: 'critical', source: 'manual', note: 'Kondisioner, "xarab"\nyenisi lazımdır', createdAt: '2026-11-02T05:10:00Z' }),
    // Looks like a formula: CSV must neutralise it.
    p3: await addProblem(b, { run: runs.r4, siteId: branchB, checklistId: opening.id, severity: 'normal', note: '=1+2', createdAt: '2026-11-02T05:20:00Z' }),
    p4: await addProblem(b, { run: runs.r9, siteId: zoneA2, checklistId: opening.id, severity: 'critical', note: null, createdAt: '2026-11-03T05:00:00Z' }),
  };

  const tasks: Record<TaskKey, string> = {
    t1: await addTask(b, { title: 'Qapını təmir et', status: 'new', assigneeUserId: aynur.id, siteId: zoneA1, dueAt: '2026-11-02T10:00:00Z', createdAt: '2026-11-01T08:00:00Z' }),
    t2: await addTask(b, { title: 'Rəfləri say', status: 'accepted', assigneeUserId: kamran.id, siteId: zoneA2, dueAt: '2026-11-03T10:00:00Z', createdAt: '2026-11-01T08:00:00Z' }),
    t3: await addTask(b, { title: 'Kondisioneri dəyiş', status: 'in_progress', assigneeUserId: nigar.id, siteId: branchB, dueAt: '2026-11-03T12:00:00Z', overdueAt: '2026-11-03T12:00:00Z', problemId: problems.p2, createdAt: '2026-11-02T08:00:00Z' }),
    t4: await addTask(b, { title: 'Hesabatı yoxla', status: 'awaiting_review', assigneeUserId: aynur.id, siteId: zoneA1, createdAt: '2026-11-03T05:00:00Z' }),
    t5: await addTask(b, { title: 'Ölçünü düzəlt', status: 'completed', assigneeUserId: nigar.id, siteId: branchB, dueAt: '2026-11-02T12:00:00Z', completedAt: '2026-11-02T11:00:00Z', problemId: problems.p3, createdAt: '2026-11-02T08:00:00Z' }),
    t6: await addTask(b, { title: 'Soyuducunu yoxla', status: 'completed', assigneeUserId: kamran.id, siteId: zoneA2, dueAt: '2026-11-03T08:00:00Z', completedAt: '2026-11-03T09:00:00Z', overdueAt: '2026-11-03T08:00:00Z', createdAt: '2026-11-02T08:00:00Z' }),
    t7: await addTask(b, { title: 'Termometri dəyiş', status: 'cancelled', assigneeUserId: kamran.id, siteId: zoneA2, dueAt: '2026-11-04T10:00:00Z', problemId: problems.p4, createdAt: '2026-11-03T08:00:00Z' }),
    t8: await addTask(b, { title: 'Açarları təhvil ver', status: 'completed', assigneeUserId: aynur.id, completedAt: '2026-11-04T05:00:00Z', createdAt: '2026-11-04T04:00:00Z' }),
    t9: await addTask(b, { title: 'Gələn həftə', status: 'new', assigneeUserId: aynur.id, siteId: zoneA1, dueAt: '2026-11-10T10:00:00Z', createdAt: '2026-11-03T08:00:00Z' }),
    // 21:30Z on 1 November is 01:30 on 2 November in Baku: inside the period.
    t10: await addTask(b, { title: 'Gecə yoxlaması', status: 'new', assigneeUserId: nigar.id, siteId: branchB, dueAt: '2026-11-01T21:30:00Z', createdAt: '2026-11-01T08:00:00Z' }),
  };

  return { ...b, sites: { branchA, zoneA1, zoneA2, branchB }, checklists: { opening, stock }, leyla: { id: leyla.id, api: leyla.api }, rauf, aynur, kamran, nigar, samir, runs, problems, tasks };
}
```

- [ ] **Step 2: Write the failing test**

`apps/api/test/reports-summary.test.ts`:

```ts
import { completionPercent, OCCURRENCE_STATUSES, type OccurrenceStatus, type ReportSummary, tallyRuns } from '@taskop/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { ReportQueries } from '../src/reports/report-queries';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addRun, addSite, counts, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

const summary = async (api: Api, q: Record<string, string | undefined>): Promise<ReportSummary> => {
  const res = await api.get(`/api/v1/reports/summary?${qs(q)}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ReportSummary;
};

describe('GET /reports/summary', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  it('counts the period’s runs by bucket, with completion and average score (spec §3.1)', async () => {
    expect(await summary(w.owner, PERIOD)).toEqual({
      counts: counts({ planned: 15, due: 13, completed: 7, inProgress: 2, pending: 1, overdue: 1, partial: 1, missed: 3, withProblems: 3, withCritical: 2 }),
      completionPercent: 53.8,
      // 80, 100, 60, 90, 50, 70, 100: the scoring-off and open runs have no score, and Aynur's lost claim (10) is ignored.
      averageScore: 78.6,
      trend: [
        { date: '2026-11-02', due: 6, completed: 4, completionPercent: 66.7 },
        { date: '2026-11-03', due: 4, completed: 2, completionPercent: 50 },
        // r15 finished early: due and completed; r13 and r14 are not due yet.
        { date: '2026-11-04', due: 3, completed: 1, completionPercent: 33.3 },
      ],
    });
  });

  it('agrees with classifyRun on the same rows (cross-check)', async () => {
    const rows = await ownerQuery<{ status: OccurrenceStatus; due_at: Date; local_date: string; has_problems: boolean; has_critical: boolean }>(
      `select o.status, o.due_at, to_char(o.local_date, 'YYYY-MM-DD') as local_date,
              exists (select 1 from execution_problems p where p.occurrence_id = o.id) as has_problems,
              exists (select 1 from execution_problems p where p.occurrence_id = o.id and p.severity = 'critical') as has_critical
         from occurrences o where o.tenant_id = $1 and o.local_date between $2 and $3`,
      [w.s.tenantId, PERIOD.from, PERIOD.to],
    );
    const facts = rows.rows.map((r) => ({ status: r.status, dueAt: r.due_at, hasProblems: r.has_problems, hasCritical: r.has_critical, date: r.local_date }));
    const now = new Date(REPORT_NOW);
    const s = await summary(w.owner, PERIOD);
    expect(s.counts).toEqual(tallyRuns(facts, now));
    expect(s.completionPercent).toBe(completionPercent(s.counts.completed, s.counts.due));
    for (const day of s.trend) {
      const c = tallyRuns(facts.filter((f) => f.date === day.date), now);
      expect(day, day.date).toEqual({ date: day.date, due: c.due, completed: c.completed, completionPercent: completionPercent(c.completed, c.due) });
    }
  });

  it('agrees with classifyRun for every status, due or not yet due', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    const executionState: Partial<Record<OccurrenceStatus, 'active' | 'completed' | 'partial'>> = {
      started: 'active', in_progress: 'active', completed: 'completed', partial: 'partial', audit_pending: 'completed', audited: 'completed',
    };
    const facts: { status: OccurrenceStatus; dueAt: string; hasProblems: boolean; hasCritical: boolean }[] = [];
    for (const status of OCCURRENCE_STATUSES) {
      for (const dueAt of ['2026-11-04T06:00:00Z', '2026-11-04T10:00:00Z']) {
        const state = executionState[status];
        await addRun(b, { date: '2026-11-04', siteId: site, checklist, status, dueAt, assignees: [worker.id], executions: state ? [{ executor: worker.id, state, score: 50 }] : [] });
        facts.push({ status, dueAt, hasProblems: false, hasCritical: false });
      }
    }
    expect((await summary(b.owner, { from: '2026-11-04', to: '2026-11-04' })).counts).toEqual(tallyRuns(facts, new Date(REPORT_NOW)));
  });

  it('narrows by site subtree, checklist and employee (spec §3.3, §4)', async () => {
    expect((await summary(w.owner, { ...PERIOD, siteId: w.sites.branchA })).counts.planned).toBe(13);
    expect((await summary(w.owner, { ...PERIOD, siteId: w.sites.zoneA1 })).counts.planned).toBe(7);
    expect((await summary(w.owner, { ...PERIOD, checklistId: w.checklists.stock.id })).counts).toEqual(counts({ planned: 2, due: 2, partial: 1, missed: 1 }));
    // Aynur: her three completions, the shared missed run, the overdue and the pending one; not r16 (her claim lost), not r6 (cancelled).
    expect(await summary(w.owner, { ...PERIOD, userId: w.aynur.id })).toMatchObject({
      counts: counts({ planned: 6, due: 5, completed: 3, pending: 1, overdue: 1, missed: 1, withProblems: 1 }),
      completionPercent: 60,
      averageScore: 90,
    });
    expect((await summary(w.owner, { ...PERIOD, siteId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f' })).counts).toEqual(counts());
  });

  it('answers zeros, no percentages and one entry per day for an empty period', async () => {
    expect(await summary(w.owner, { from: '2026-12-01', to: '2026-12-03' })).toEqual({
      counts: counts(),
      completionPercent: null,
      averageScore: null,
      trend: ['2026-12-01', '2026-12-02', '2026-12-03'].map((date) => ({ date, due: 0, completed: 0, completionPercent: null })),
    });
  });

  it('keeps one trend entry per calendar day across a DST change (Europe/Berlin)', async () => {
    const b = await reportBase(t);
    await ownerQuery("update tenants set timezone = 'Europe/Berlin' where id = $1", [b.s.tenantId]);
    const site = await addSite(b, 'Berlin');
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    // 23:30 on the 25-hour day 25 October (CET, UTC+1): the run's day is its stored local_date.
    await addRun(b, { date: '2026-10-25', siteId: site, checklist, status: 'missed', dueAt: '2026-10-25T22:30:00Z', startsAt: '2026-10-25T21:30:00Z', assignees: [worker.id] });
    const s = await summary(b.owner, { from: '2026-10-24', to: '2026-10-27' });
    expect(s.trend.map((d) => [d.date, d.due])).toEqual([['2026-10-24', 0], ['2026-10-25', 1], ['2026-10-26', 0], ['2026-10-27', 0]]);
  });

  it('validates the range (spec §5.2)', async () => {
    const get = (q: Record<string, string>) => w.owner.get(`/api/v1/reports/summary?${qs(q)}`);
    expect((await get({ from: '2026-01-01', to: '2027-01-01' })).status).toBe(200);
    const long = await get({ from: '2026-01-01', to: '2027-01-02' });
    expect([long.status, long.body.error.code]).toEqual([400, 'REPORT_RANGE_TOO_LONG']);
    const inverted = await get({ from: '2026-11-04', to: '2026-11-02' });
    expect([inverted.status, inverted.body.error.code, inverted.body.error.fields]).toEqual([400, 'VALIDATION_FAILED', { to: 'reports.issues.toBeforeFrom' }]);
    expect((await get({ from: '2026-11-02' })).status).toBe(400);
    expect((await get({ from: '2026-11-31', to: '2026-12-01' })).status).toBe(400);
  });

  it('needs reports.view', async () => {
    const worker = as(t, (await loginWorker(t, w.s.orgCode, w.aynur.username, w.aynur.secret)).accessToken);
    expect((await worker.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(403);
  });
});

describe('report statement timeout (spec §5.5)', () => {
  it('maps a cancelled statement to 503 REPORT_TIMEOUT', async () => {
    const t = await createTestApp({ REPORTS_STATEMENT_TIMEOUT_MS: '200' });
    try {
      const b = await reportBase(t);
      const spy = vi.spyOn(t.app.get(ReportQueries), 'summary').mockImplementationOnce(async () => {
        await t.app.get(DbService).tx().execute(sql`select pg_sleep(2)`);
        throw new Error('pg_sleep should have been cancelled');
      });
      const res = await b.owner.get(`/api/v1/reports/summary?${qs(PERIOD)}`);
      expect([res.status, res.body.error.code]).toEqual([503, 'REPORT_TIMEOUT']);
      expect(spy).toHaveBeenCalledOnce();
      // The next request has its own transaction and works.
      expect((await b.owner.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});
```

Append to `apps/api/src/config/config.test.ts`, inside `describe('loadConfig', …)`:

```ts
  it('reads the report statement timeout, 15 s by default', () => {
    expect(loadConfig(valid).REPORTS_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(loadConfig({ ...valid, REPORTS_STATEMENT_TIMEOUT_MS: '250' }).REPORTS_STATEMENT_TIMEOUT_MS).toBe(250);
    expect(() => loadConfig({ ...valid, REPORTS_STATEMENT_TIMEOUT_MS: '0' })).toThrow(/REPORTS_STATEMENT_TIMEOUT_MS/);
  });
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- reports-summary config`
Expected: FAIL: `../src/reports/report-queries` does not exist (the summary suite cannot load), and `REPORTS_STATEMENT_TIMEOUT_MS` is `undefined`.

- [ ] **Step 4: Add the config**

In `apps/api/src/config/config.ts`, after `NOTIFICATIONS_PUSH_ENABLED: z.stringbool().optional(),` add:

```ts
  /** SP7 spec §5.5: statement timeout of every report request, in ms (503 REPORT_TIMEOUT). Tests lower it. */
  REPORTS_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1).default(15_000),
```

Append to `apps/api/.env.example`:

```
# Report requests are cancelled after this many ms with 503 REPORT_TIMEOUT (default 15000).
# REPORTS_STATEMENT_TIMEOUT_MS=15000
```

- [ ] **Step 5: Write the filters, the queries, the service and the controller**

`apps/api/src/reports/report-filters.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type ReportFilters, reportRangeTooLong } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { sites, tenants } from '../db/schema';

/** The shared filters (spec §5.2) with what every query needs from the tenant. */
export interface ResolvedFilters extends ReportFilters {
  /** The `siteId` site's ltree path; null when it names no site of this tenant (the filter then matches nothing); absent without siteId. */
  sitePath?: string | null;
  timezone: string;
  tenantName: string;
  /** The instant "due" is measured against: one Clock reading per request (Spec decision 2). */
  now: Date;
}

@Injectable()
export class ReportFilterResolver {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  async resolve(q: ReportFilters): Promise<ResolvedFilters> {
    if (reportRangeTooLong(q.from, q.to)) throw new AppError('REPORT_RANGE_TOO_LONG');
    const tx = this.db.tx();
    // RLS returns the current tenant's row only.
    const [tenant] = await tx.select({ timezone: tenants.timezone, name: tenants.name }).from(tenants);
    const f: ResolvedFilters = {
      from: q.from,
      to: q.to,
      siteId: q.siteId,
      userId: q.userId,
      checklistId: q.checklistId,
      timezone: tenant!.timezone,
      tenantName: tenant!.name,
      now: this.clock.now(),
    };
    if (q.siteId) {
      const [site] = await tx.select({ path: sites.path }).from(sites).where(eq(sites.id, q.siteId));
      f.sitePath = site?.path ?? null;
    }
    return f;
  }
}
```

`apps/api/src/reports/report-queries.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { COMPLETED_STATUSES, completionPercent, IN_PROGRESS_STATUSES, periodDays, type ReportSummary, roundOne, type RunCounts } from '@taskop/contracts';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import type { ResolvedFilters } from './report-filters';

/** A SQL list of status literals from a contracts constant (never user input). */
export const statusList = (list: readonly string[]): SQL => sql.raw(`(${list.map((s) => `'${s}'`).join(', ')})`);

/** The siteId filter: the column's site lies in the filter site's subtree (spec §4). Undefined without a siteId. */
export function inFilterSubtree(f: ResolvedFilters, siteCol: AnyPgColumn): SQL | undefined {
  if (f.sitePath === undefined) return undefined;
  if (f.sitePath === null) return sql`false`;
  return sql`exists (select 1 from sites fs where fs.id = ${siteCol} and fs.path <@ ${f.sitePath}::ltree)`;
}

/** The spec §3.1 buckets as one row of counts over `runs r`, plus the score sum and count. */
export interface CountRow {
  planned: number;
  due: number;
  completed: number;
  in_progress: number;
  pending: number;
  overdue: number;
  partial: number;
  missed: number;
  with_problems: number;
  with_critical: number;
  score_sum: number;
  score_count: number;
}

/** classifyRun (report-logic.ts) in SQL; the cross-check test in reports-summary.test.ts keeps the two equal. */
export function countColumns(now: Date): SQL {
  const completed = statusList(COMPLETED_STATUSES);
  return sql`
    (count(*) filter (where r.status <> 'cancelled'))::int as planned,
    (count(*) filter (where r.status <> 'cancelled' and (r.status in ${completed} or r.due_at <= ${now})))::int as due,
    (count(*) filter (where r.status in ${completed}))::int as completed,
    (count(*) filter (where r.status in ${statusList(IN_PROGRESS_STATUSES)}))::int as in_progress,
    (count(*) filter (where r.status = 'pending'))::int as pending,
    (count(*) filter (where r.status = 'overdue'))::int as overdue,
    (count(*) filter (where r.status = 'partial'))::int as partial,
    (count(*) filter (where r.status = 'missed'))::int as missed,
    (count(*) filter (where r.status <> 'cancelled' and r.has_problems))::int as with_problems,
    (count(*) filter (where r.status <> 'cancelled' and r.has_critical))::int as with_critical,
    coalesce(sum(r.score_percent), 0)::float8 as score_sum,
    count(r.score_percent)::int as score_count`;
}

export const toCounts = (r: CountRow): RunCounts => ({
  planned: r.planned,
  due: r.due,
  completed: r.completed,
  inProgress: r.in_progress,
  pending: r.pending,
  overdue: r.overdue,
  partial: r.partial,
  missed: r.missed,
  withProblems: r.with_problems,
  withCritical: r.with_critical,
});

/** Percentages in TypeScript from the SQL counts, so they round exactly as report-logic.ts (Spec decision 3). */
export const measuresOf = (r: CountRow): { completionPercent: number | null; averageScore: number | null } => ({
  completionPercent: completionPercent(r.completed, r.due),
  averageScore: r.score_count ? roundOne(r.score_sum / r.score_count) : null,
});

const ZERO: CountRow = { planned: 0, due: 0, completed: 0, in_progress: 0, pending: 0, overdue: 0, partial: 0, missed: 0, with_problems: 0, with_critical: 0, score_sum: 0, score_count: 0 };
const addRows = (a: CountRow, b: CountRow): CountRow => Object.fromEntries(Object.keys(ZERO).map((k) => [k, a[k as keyof CountRow] + b[k as keyof CountRow]])) as unknown as CountRow;

/**
 * Scope and filters on the period's occurrences (spec §3.2, §4). `x` is the counted (non-rejected) execution. The
 * userId filter is spec §3.3: executed runs belong to their executor, unexecuted (not cancelled) runs to their assignees.
 */
function runConditions(f: ResolvedFilters, scope: SQL | undefined): SQL {
  const conds: (SQL | undefined)[] = [scope, sql`${occurrences.localDate} between ${f.from}::date and ${f.to}::date`, inFilterSubtree(f, occurrences.siteId)];
  if (f.checklistId) conds.push(eq(occurrences.checklistId, f.checklistId));
  if (f.userId) {
    conds.push(sql`((x.id is not null and x.executor_user_id = ${f.userId})
      or (x.id is null and ${occurrences.status} <> 'cancelled'
          and exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${f.userId})))`);
  }
  return and(...conds)!;
}

/**
 * The CTE `runs`: one row per occurrence of the period after scope and filters, with its counted execution and its
 * problem counts. Problems are aggregated once for the period's occurrences (Spec decision 26).
 */
export function runsCte(f: ResolvedFilters, scope: SQL | undefined): SQL {
  return sql`runs as (
    select ${occurrences.id} as id, ${occurrences.status}::text as status, ${occurrences.dueAt} as due_at,
           ${occurrences.localDate}::text as local_date, ${occurrences.siteId} as site_id, ${occurrences.checklistId} as checklist_id,
           x.id as execution_id, x.executor_user_id, (x.score->>'percent')::float8 as score_percent,
           pr.occurrence_id is not null as has_problems, coalesce(pr.critical, 0) > 0 as has_critical,
           coalesce(pr.total, 0) as problem_count, coalesce(pr.critical, 0) as critical_count
      from occurrences
      left join executions x on x.occurrence_id = ${occurrences.id} and x.state <> 'rejected'
      left join (
        select ep.occurrence_id, count(*)::int as total, (count(*) filter (where ep.severity = 'critical'))::int as critical
          from execution_problems ep
          join occurrences po on po.id = ep.occurrence_id
         where po.local_date between ${f.from}::date and ${f.to}::date
         group by ep.occurrence_id
      ) pr on pr.occurrence_id = ${occurrences.id}
     where ${runConditions(f, scope)})`;
}

/** The report SQL (spec §5.1). Every method runs in the request's tenant transaction and returns contract shapes. */
@Injectable()
export class ReportQueries {
  constructor(private readonly db: DbService) {}

  /** Counts, percentages and the daily trend; one query grouped by day, summed for the totals. */
  async summary(f: ResolvedFilters, scope: SQL | undefined): Promise<ReportSummary> {
    const days = (
      await this.db.tx().execute<CountRow & { local_date: string }>(sql`
        with ${runsCte(f, scope)}
        select r.local_date, ${countColumns(f.now)} from runs r group by r.local_date`)
    ).rows;
    const total = days.reduce<CountRow>(addRows, ZERO);
    const byDay = new Map(days.map((d) => [d.local_date, d]));
    return {
      counts: toCounts(total),
      ...measuresOf(total),
      trend: periodDays(f.from, f.to).map((date) => {
        const d = byDay.get(date);
        return { date, due: d?.due ?? 0, completed: d?.completed ?? 0, completionPercent: d ? completionPercent(d.completed, d.due) : null };
      }),
    };
  }
}
```

`apps/api/src/reports/reports.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ReportFilters, ReportSummary } from '@taskop/contracts';
import { sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { pgErrorOf } from '../common/pg-errors';
import type { Principal } from '../common/request';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { ReportFilterResolver, type ResolvedFilters } from './report-filters';
import { ReportQueries } from './report-queries';

/** SQLSTATE query_canceled: the statement timeout fired. */
const QUERY_CANCELED = '57014';

/** The report endpoints (spec §5.3): scope from the principal, filters from the query, one guarded transaction. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly filters: ReportFilterResolver,
    private readonly scheduling: SchedulingScope,
    private readonly queries: ReportQueries,
  ) {}

  /**
   * Spec §5.5: a statement timeout for the rest of the request's transaction (TenantContextInterceptor opened it), the
   * range check, then `fn`. A cancelled statement aborts the transaction; it is answered 503 REPORT_TIMEOUT.
   */
  async guarded<T>(q: ReportFilters, fn: (f: ResolvedFilters) => Promise<T>): Promise<T> {
    // A config integer, never user input; SET takes no bind parameters.
    await this.db.tx().execute(sql.raw(`set local statement_timeout = ${Math.trunc(this.config.REPORTS_STATEMENT_TIMEOUT_MS)}`));
    try {
      return await fn(await this.filters.resolve(q));
    } catch (e) {
      if (pgErrorOf(e)?.code === QUERY_CANCELED) throw new AppError('REPORT_TIMEOUT');
      throw e;
    }
  }

  summary(p: Principal, q: ReportFilters): Promise<ReportSummary> {
    return this.guarded(q, (f) => this.queries.summary(f, this.scheduling.occurrences(p)));
  }
}
```

`apps/api/src/reports/dto.ts`:

```ts
import { reportFiltersSchema, reportSummarySchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}
export class ReportSummaryResponse extends createZodDto(reportSummarySchema) {}
```

`apps/api/src/reports/reports.controller.ts`:

```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ReportSummary } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import type { Principal } from '../common/request';
import { ReportFiltersDto, ReportSummaryResponse } from './dto';
import { ReportsService } from './reports.service';

/** Sub-project 7 spec §5.3–§5.4. Every number follows the caller's data scope. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get('summary')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportSummaryResponse })
  summary(@CurrentPrincipal() p: Principal, @Query() q: ReportFiltersDto): Promise<ReportSummary> {
    return this.reports.summary(p, q);
  }
}
```

`apps/api/src/reports/reports.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ReportFilterResolver } from './report-filters';
import { ReportQueries } from './report-queries';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Sub-project 7: dashboards, reports and export. No tables of its own; reads scheduling, executions and tasks. */
@Module({
  imports: [SchedulingModule],
  controllers: [ReportsController],
  providers: [ReportFilterResolver, ReportQueries, ReportsService],
})
export class ReportsModule {}
```

In `apps/api/src/app.module.ts`, import `ReportsModule` from `./reports/reports.module` and add it to `imports` after `NotificationsModule`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- reports-summary config`
Expected: PASS. If the cross-check fails while the hand-counted test passes (or the other way round), the SQL in `countColumns` and `classifyRun` disagree: fix the SQL, never the expected numbers.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reports apps/api/src/app.module.ts apps/api/src/config apps/api/.env.example apps/api/test/report-fixtures.ts apps/api/test/reports-summary.test.ts
git commit -m "feat(api): add the reports module with the statement-timeout guard and GET /reports/summary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `GET /reports/sites` and `GET /reports/employees` (attribution, Unassigned row)

**Files:**
- Modify: `apps/api/package.json` (+ `@taskop/i18n`), `apps/api/src/reports/report-queries.ts`, `reports.service.ts`, `reports.controller.ts`, `dto.ts`
- Test: `apps/api/test/reports-tables.test.ts`

**Interfaces:**
- Consumes: Task 8 (`runsCte`, `countColumns`, `CountRow`, `toCounts`, `measuresOf`, `ReportsService.guarded`, the fixtures); `az.reports.employees.unassigned` (Task 4).
- Produces: `ReportQueries.sites(f, scope): Promise<SiteReportRow[]>`, `ReportQueries.employees(f, scope): Promise<EmployeeReportRow[]>`, the matching `ReportsService` methods, `GET /reports/sites` and `GET /reports/employees` (`reports.view`). The exporter (Task 15) reuses both query methods.

- [ ] **Step 1: Write the failing test**

`apps/api/test/reports-tables.test.ts`:

```ts
import type { EmployeeReportRow, SiteReportRow } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addRun, addSite, counts, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('GET /reports/sites and /reports/employees', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const sites = async (api: Api, q: Record<string, string | undefined>): Promise<SiteReportRow[]> => {
    const res = await api.get(`/api/v1/reports/sites?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as SiteReportRow[];
  };
  const employees = async (api: Api, q: Record<string, string | undefined>): Promise<EmployeeReportRow[]> => {
    const res = await api.get(`/api/v1/reports/employees?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as EmployeeReportRow[];
  };

  it('compares the sites that had planned runs, in tree order with their ancestors', async () => {
    expect(await sites(w.owner, PERIOD)).toEqual([
      // Only the pending r14 (r6 is cancelled): planned, not due yet.
      { siteId: w.sites.branchA, name: 'Filial A', path: [], active: true, ...counts({ planned: 1, pending: 1 }), completionPercent: null, averageScore: null },
      { siteId: w.sites.zoneA1, name: 'Zona A1', path: ['Filial A'], active: true, ...counts({ planned: 7, due: 7, completed: 4, overdue: 1, missed: 2, withProblems: 1 }), completionPercent: 57.1, averageScore: 85 },
      { siteId: w.sites.zoneA2, name: 'Zona A2', path: ['Filial A'], active: true, ...counts({ planned: 5, due: 4, completed: 2, inProgress: 2, partial: 1, withProblems: 1, withCritical: 1 }), completionPercent: 50, averageScore: 75 },
      { siteId: w.sites.branchB, name: 'Filial B', path: [], active: true, ...counts({ planned: 2, due: 2, completed: 1, missed: 1, withProblems: 1, withCritical: 1 }), completionPercent: 50, averageScore: 60 },
    ]);
  });

  it('attributes executed runs to the executor only and unexecuted runs to every assignee (spec §3.3)', async () => {
    const rows = await employees(w.owner, PERIOD);
    expect(rows).toEqual([
      // r1, r7, r15 done; r3 shared and missed; r12 overdue; r14 pending. Not r16: her claim lost.
      { userId: w.aynur.id, name: 'Aynur Quliyeva', active: true, ...counts({ planned: 6, due: 5, completed: 3, pending: 1, overdue: 1, missed: 1, withProblems: 1 }), completionPercent: 60, averageScore: 90 },
      // r2 (shared, done by him), r5, r9, r13, r16; and the shared missed r3.
      { userId: w.kamran.id, name: 'Kamran Əliyev', active: true, ...counts({ planned: 6, due: 5, completed: 2, inProgress: 2, partial: 1, missed: 1, withProblems: 1, withCritical: 1 }), completionPercent: 40, averageScore: 75 },
      { userId: w.nigar.id, name: 'Nigar Həsənova', active: true, ...counts({ planned: 2, due: 2, completed: 1, missed: 1, withProblems: 1, withCritical: 1 }), completionPercent: 50, averageScore: 60 },
      // Deactivated: history kept, marked inactive (FR-04.11).
      { userId: w.samir.id, name: 'Samir Məmmədov', active: false, ...counts({ planned: 2, due: 2, completed: 1, missed: 1 }), completionPercent: 50, averageScore: 70 },
      { userId: null, name: 'Təyin edilməyib', active: true, ...counts({ planned: 1, due: 1, missed: 1 }), completionPercent: 0, averageScore: null },
    ]);
    // The shared missed r3 counts three times: 17 planned against the sites' 15.
    expect(rows.reduce((n, r) => n + r.planned, 0)).toBe(17);
  });

  it('narrows both tables by employee, and never matches the Unassigned row', async () => {
    expect((await employees(w.owner, { ...PERIOD, userId: w.kamran.id })).map((r) => [r.name, r.planned])).toEqual([['Kamran Əliyev', 6]]);
    expect((await sites(w.owner, { ...PERIOD, userId: w.kamran.id })).map((r) => [r.name, r.planned])).toEqual([['Zona A1', 1], ['Zona A2', 5]]);
    expect((await employees(w.owner, { ...PERIOD, siteId: w.sites.zoneA1 })).map((r) => [r.name, r.planned])).toEqual([
      ['Aynur Quliyeva', 5], ['Kamran Əliyev', 1], ['Samir Məmmədov', 2], ['Təyin edilməyib', 1],
    ]);
  });

  it('follows a site moved in the tree: the subtree filter and the ancestor names use where it is now', async () => {
    const b = await reportBase(t);
    const north = await addSite(b, 'Şimal');
    const south = await addSite(b, 'Cənub');
    const zone = await addSite(b, 'Zona 1', north);
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    await addRun(b, { date: '2026-11-03', siteId: zone, checklist, status: 'completed', dueAt: '2026-11-03T06:00:00Z', assignees: [worker.id], executions: [{ executor: worker.id, state: 'completed', score: 100, completedAt: '2026-11-03T05:00:00Z' }] });
    expect((await sites(b.owner, { ...PERIOD, siteId: north })).map((r) => r.path)).toEqual([['Şimal']]);
    expect((await b.owner.post(`/api/v1/sites/${zone}/move`, { parentId: south })).status).toBe(200);
    await ownerQuery('update sites set active = false where id = $1', [zone]);
    expect(await sites(b.owner, { ...PERIOD, siteId: north })).toEqual([]);
    expect((await sites(b.owner, { ...PERIOD, siteId: south })).map((r) => [r.name, r.path, r.active, r.completed])).toEqual([['Zona 1', ['Cənub'], false, 1]]);
  });
});
```

(Zona A1's employees: Aynur r1, r3, r7, r12, r15; Kamran and Samir the shared r3, Samir also r11; the Unassigned r8.)

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- reports-tables`
Expected: FAIL: `GET /api/v1/reports/sites` answers 404.

- [ ] **Step 3: Add the i18n dependency**

```bash
pnpm --filter @taskop/api add '@taskop/i18n@workspace:*'
```

`apps/api/package.json` now lists `"@taskop/i18n": "workspace:*"` under `dependencies`. It is ESM like `@taskop/contracts` and loads the same way (Node 24 `require(esm)` in the swc CommonJS build, native ESM under Vitest).

- [ ] **Step 4: Implement the queries**

In `apps/api/src/reports/report-queries.ts`:
- the `@taskop/contracts` import becomes:

```ts
import { COMPLETED_STATUSES, completionPercent, type EmployeeReportRow, IN_PROGRESS_STATUSES, periodDays, type ReportSummary, roundOne, type RunCounts, type SiteReportRow } from '@taskop/contracts';
import { az } from '@taskop/i18n';
```

- add these methods inside `ReportQueries`, after `summary`:

```ts
  /** Spec §5.3: one row per site with a planned run, in tree order; `path` = ancestor names, root first. */
  async sites(f: ResolvedFilters, scope: SQL | undefined): Promise<SiteReportRow[]> {
    const rows = await this.db.tx().execute<CountRow & { site_id: string; name: string; active: boolean; path: string[] }>(sql`
      with ${runsCte(f, scope)}
      select s.id as site_id, s.name, s.active,
             array(select a.name from sites a where a.path @> s.path and a.id <> s.id order by nlevel(a.path)) as path,
             ${countColumns(f.now)}
        from runs r
        join sites s on s.id = r.site_id
       group by s.id
      having count(*) filter (where r.status <> 'cancelled') > 0
       order by s.path`);
    return rows.rows.map((r) => ({ siteId: r.site_id, name: r.name, path: r.path, active: r.active, ...toCounts(r), ...measuresOf(r) }));
  }

  /**
   * Spec §3.3: an executed run counts for its executor only; an unexecuted run for each assignee; one without assignees
   * for the Unassigned row (user_id null, last). Cancelled runs count for nobody. Executors' scores only.
   */
  async employees(f: ResolvedFilters, scope: SQL | undefined): Promise<EmployeeReportRow[]> {
    const rows = await this.db.tx().execute<CountRow & { user_id: string | null; full_name: string | null; status: string | null }>(sql`
      with ${runsCte(f, scope)},
      attributed as (
        select r.*, r.executor_user_id as user_id from runs r
         where r.execution_id is not null and r.status <> 'cancelled'
        union all
        select r.*, oa.user_id from runs r join occurrence_assignees oa on oa.occurrence_id = r.id
         where r.execution_id is null and r.status <> 'cancelled'
        union all
        select r.*, null::uuid from runs r
         where r.execution_id is null and r.status <> 'cancelled'
           and not exists (select 1 from occurrence_assignees oa where oa.occurrence_id = r.id)
      )
      select r.user_id, u.full_name, u.status::text as status, ${countColumns(f.now)}
        from attributed r
        left join users u on u.id = r.user_id
       where ${f.userId ? sql`r.user_id = ${f.userId}` : sql`true`}
       group by r.user_id, u.full_name, u.status
       order by r.user_id is null, u.full_name, r.user_id`);
    return rows.rows.map((r) => ({
      userId: r.user_id,
      name: r.user_id ? (r.full_name ?? '') : az.reports.employees.unassigned,
      active: r.user_id ? r.status === 'active' : true,
      ...toCounts(r),
      ...measuresOf(r),
    }));
  }
```

- [ ] **Step 5: Wire the service, the DTOs and the controller**

In `apps/api/src/reports/reports.service.ts`, the contracts import becomes `import type { EmployeeReportRow, ReportFilters, ReportSummary, SiteReportRow } from '@taskop/contracts';` and these methods follow `summary`:

```ts
  sites(p: Principal, q: ReportFilters): Promise<SiteReportRow[]> {
    return this.guarded(q, (f) => this.queries.sites(f, this.scheduling.occurrences(p)));
  }

  employees(p: Principal, q: ReportFilters): Promise<EmployeeReportRow[]> {
    return this.guarded(q, (f) => this.queries.employees(f, this.scheduling.occurrences(p)));
  }
```

`apps/api/src/reports/dto.ts` becomes:

```ts
import { employeeReportRowSchema, reportFiltersSchema, reportSummarySchema, siteReportRowSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}
export class ReportSummaryResponse extends createZodDto(reportSummarySchema) {}
export class SiteReportRowResponse extends createZodDto(siteReportRowSchema) {}
export class EmployeeReportRowResponse extends createZodDto(employeeReportRowSchema) {}
```

In `apps/api/src/reports/reports.controller.ts`, the contracts import becomes `import type { EmployeeReportRow, ReportSummary, SiteReportRow } from '@taskop/contracts';`, the dto import becomes `import { EmployeeReportRowResponse, ReportFiltersDto, ReportSummaryResponse, SiteReportRowResponse } from './dto';`, and these handlers follow `summary`:

```ts
  @Get('sites')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: SiteReportRowResponse, isArray: true })
  sites(@CurrentPrincipal() p: Principal, @Query() q: ReportFiltersDto): Promise<SiteReportRow[]> {
    return this.reports.sites(p, q);
  }

  @Get('employees')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: EmployeeReportRowResponse, isArray: true })
  employees(@CurrentPrincipal() p: Principal, @Query() q: ReportFiltersDto): Promise<EmployeeReportRow[]> {
    return this.reports.employees(p, q);
  }
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- reports-tables reports-summary`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/reports apps/api/test/reports-tables.test.ts
git commit -m "feat(api): add the site and employee report tables" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `GET /reports/runs` with buckets and keyset paging

**Files:**
- Modify: `apps/api/src/reports/report-queries.ts`, `reports.service.ts`, `reports.controller.ts`, `dto.ts`
- Test: `apps/api/test/reports-runs.test.ts`

**Interfaces:**
- Consumes: Task 8 (`runsCte`, `statusList`, the fixtures), `REPORT_LIMITS.pageSize`, `reportRunsQuerySchema`, `reportRunPageSchema`, `ReportRunsParams`, `RunBucket`.
- Produces:
  - `bucketCondition(b: RunBucket): SQL` (over `runs r`)
  - `ReportQueries.runs(f, scope, bucket: RunBucket, opts: { cursor?: string; limit: number | null }): Promise<Page<ReportRun>>` (`limit: null` = every row, for exports)
  - `ReportQueries.countRuns(f, scope, bucket: RunBucket): Promise<number>` (the export's count-first check)
  - `ReportsService.runs(p, q: ReportRunsParams)` and `GET /reports/runs` (`reports.view`)

- [ ] **Step 1: Write the failing test**

`apps/api/test/reports-runs.test.ts`:

```ts
import type { Page, ReportRun } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addChecklist, addRun, addSite, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld, type RunKey } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('GET /reports/runs', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const page = async (api: Api, q: Record<string, string | undefined>): Promise<Page<ReportRun>> => {
    const res = await api.get(`/api/v1/reports/runs?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Page<ReportRun>;
  };
  const ids = (p: Page<ReportRun>) => p.items.map((r) => r.occurrenceId);
  const runs = (...keys: RunKey[]) => keys.map((k) => w.runs[k].occurrenceId);

  it('lists each bucket, latest due time first (ties: newest id first)', async () => {
    const bucket = async (b?: string) => ids(await page(w.owner, { ...PERIOD, bucket: b }));
    expect(await bucket('overdue')).toEqual(runs('r12'));
    expect(await bucket('partial')).toEqual(runs('r5'));
    expect(await bucket('missed')).toEqual(runs('r10', 'r8', 'r3'));
    expect(await bucket('problems')).toEqual(runs('r9', 'r4', 'r1'));
    expect(await bucket('completed')).toEqual(runs('r15', 'r11', 'r9', 'r7', 'r4', 'r2', 'r1'));
    expect(await bucket('in_progress')).toEqual(runs('r13', 'r16'));
    // `all` (the default) includes the cancelled r6.
    expect(await bucket()).toEqual(runs('r15', 'r14', 'r13', 'r16', 'r12', 'r11', 'r10', 'r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1'));
  });

  it('returns the run row with its people, both completion times and the flags', async () => {
    const completed = (await page(w.owner, { ...PERIOD, bucket: 'completed' })).items;
    expect(completed.find((r) => r.occurrenceId === w.runs.r7.occurrenceId)).toEqual({
      occurrenceId: w.runs.r7.occurrenceId,
      executionId: w.runs.r7.executionIds[0],
      localDate: '2026-11-02',
      dueAt: '2026-11-02T06:00:00.000Z',
      checklist: { id: w.checklists.opening.id, name: 'Açılış yoxlaması' },
      site: { id: w.sites.zoneA1, name: 'Zona A1' },
      status: 'completed',
      assignees: [{ id: w.aynur.id, fullName: 'Aynur Quliyeva' }],
      executor: { id: w.aynur.id, fullName: 'Aynur Quliyeva' },
      startedAt: '2026-11-02T04:10:00.000Z',
      completedAt: '2026-11-02T07:00:00.000Z',
      completedReceivedAt: '2026-11-04T05:00:00.000Z',
      score: 90,
      problemCount: 0,
      criticalCount: 0,
      late: true,
      clockSuspect: false,
    });
    expect(completed.find((r) => r.occurrenceId === w.runs.r9.occurrenceId)).toMatchObject({ clockSuspect: true, problemCount: 1, criticalCount: 1 });
    expect(completed.find((r) => r.occurrenceId === w.runs.r4.occurrenceId)).toMatchObject({ problemCount: 2, criticalCount: 1 });
    // The lost claim is never the run's execution.
    const r16 = (await page(w.owner, { ...PERIOD, bucket: 'in_progress' })).items.find((r) => r.occurrenceId === w.runs.r16.occurrenceId)!;
    expect([r16.executionId, r16.executor?.fullName, r16.assignees.map((a) => a.fullName)]).toEqual([w.runs.r16.executionIds[0], 'Kamran Əliyev', ['Aynur Quliyeva', 'Kamran Əliyev']]);
    const r8 = (await page(w.owner, { ...PERIOD, bucket: 'missed' })).items.find((r) => r.occurrenceId === w.runs.r8.occurrenceId)!;
    expect(r8).toMatchObject({ executionId: null, executor: null, assignees: [], startedAt: null, completedAt: null, completedReceivedAt: null, score: null, late: false, clockSuspect: false });
  });

  it('filters by employee with the spec §3.3 attribution', async () => {
    expect(ids(await page(w.owner, { ...PERIOD, userId: w.kamran.id }))).toEqual(runs('r13', 'r16', 'r9', 'r5', 'r3', 'r2'));
    expect(ids(await page(w.owner, { ...PERIOD, userId: w.aynur.id, bucket: 'in_progress' }))).toEqual([]);
  });

  it('pages 50 at a time by (due_at, id) without repeating or skipping runs with the same due time', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    const created: string[] = [];
    for (let i = 0; i < 55; i++) {
      created.push((await addRun(b, { date: '2026-11-03', siteId: site, checklist, status: 'missed', dueAt: '2026-11-03T06:00:00Z', assignees: [] })).occurrenceId);
    }
    const first = await page(b.owner, { ...PERIOD, bucket: 'missed' });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(first.items[49]!.occurrenceId);
    const second = await page(b.owner, { ...PERIOD, bucket: 'missed', cursor: first.nextCursor! });
    expect(second.nextCursor).toBeNull();
    expect([...ids(first), ...ids(second)]).toEqual([...created].reverse());
  });

  it('refuses an unknown bucket', async () => {
    expect((await w.owner.get(`/api/v1/reports/runs?${qs({ ...PERIOD, bucket: 'late' })}`)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- reports-runs`
Expected: FAIL: `GET /api/v1/reports/runs` answers 404.

- [ ] **Step 3: Implement the queries**

In `apps/api/src/reports/report-queries.ts`:
- the `@taskop/contracts` import gains `type OccurrenceStatus`, `type Page`, `type ReportRun`, `type RunBucket`, `type UserRef`.
- add after `runsCte`:

```ts
/** /reports/runs buckets over `runs r` (Spec decision 6). */
export function bucketCondition(b: RunBucket): SQL {
  switch (b) {
    case 'overdue':
      return sql`r.status = 'overdue'`;
    case 'partial':
      return sql`r.status = 'partial'`;
    case 'missed':
      return sql`r.status = 'missed'`;
    case 'problems':
      return sql`r.status <> 'cancelled' and r.has_problems`;
    case 'completed':
      return sql`r.status in ${statusList(COMPLETED_STATUSES)}`;
    case 'in_progress':
      return sql`r.status in ${statusList(IN_PROGRESS_STATUSES)}`;
    case 'all':
      return sql`true`;
  }
}

interface RunRow {
  id: string;
  execution_id: string | null;
  local_date: string;
  due_at: string;
  status: OccurrenceStatus;
  checklist_id: string;
  checklist_name: string;
  site_id: string;
  site_name: string;
  assignees: UserRef[];
  executor_user_id: string | null;
  executor_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed_received_at: string | null;
  score_percent: number | null;
  late: boolean;
  clock_suspect: boolean;
  problem_count: number;
  critical_count: number;
}

// Drizzle's pg driver returns timestamps from `execute` as raw strings.
const isoOf = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

const toReportRun = (r: RunRow): ReportRun => ({
  occurrenceId: r.id,
  executionId: r.execution_id,
  localDate: r.local_date,
  dueAt: isoOf(r.due_at)!,
  checklist: { id: r.checklist_id, name: r.checklist_name },
  site: { id: r.site_id, name: r.site_name },
  status: r.status,
  assignees: r.assignees,
  executor: r.executor_user_id ? { id: r.executor_user_id, fullName: r.executor_name ?? '' } : null,
  startedAt: isoOf(r.started_at),
  completedAt: isoOf(r.completed_at),
  completedReceivedAt: isoOf(r.completed_received_at),
  score: r.score_percent,
  problemCount: r.problem_count,
  criticalCount: r.critical_count,
  late: r.late,
  clockSuspect: r.clock_suspect,
});
```

- add these methods inside `ReportQueries`:

```ts
  /** Spec §5.3: newest due first, keyset on (due_at, id) like /problems (Spec decision 7). `limit: null` reads every row. */
  async runs(f: ResolvedFilters, scope: SQL | undefined, bucket: RunBucket, opts: { cursor?: string; limit: number | null }): Promise<Page<ReportRun>> {
    const conds = [bucketCondition(bucket)];
    if (opts.cursor) conds.push(sql`(r.due_at, r.id) < (select c.due_at, c.id from occurrences c where c.id = ${opts.cursor})`);
    const rows = (
      await this.db.tx().execute<RunRow>(sql`
        with ${runsCte(f, scope)}
        select r.id, r.execution_id, r.local_date, r.due_at, r.status, r.checklist_id, c.name as checklist_name, r.site_id, s.name as site_name,
               coalesce((select json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by u.full_name, u.id)
                           from occurrence_assignees oa join users u on u.id = oa.user_id where oa.occurrence_id = r.id), '[]'::json) as assignees,
               x.executor_user_id, eu.full_name as executor_name, x.started_at, x.completed_at, x.completed_received_at, r.score_percent,
               coalesce(x.late, false) as late, coalesce(x.clock_suspect, false) as clock_suspect, r.problem_count, r.critical_count
          from runs r
          join checklists c on c.id = r.checklist_id
          join sites s on s.id = r.site_id
          left join executions x on x.id = r.execution_id
          left join users eu on eu.id = x.executor_user_id
         where ${sql.join(conds, sql` and `)}
         order by r.due_at desc, r.id desc
         ${opts.limit === null ? sql.empty() : sql`limit ${opts.limit + 1}`}`)
    ).rows;
    const items = opts.limit === null ? rows : rows.slice(0, opts.limit);
    const more = opts.limit !== null && rows.length > opts.limit;
    return { items: items.map(toReportRun), nextCursor: more ? items[items.length - 1]!.id : null };
  }

  /** The export's count-first check (spec §5.4). */
  async countRuns(f: ResolvedFilters, scope: SQL | undefined, bucket: RunBucket): Promise<number> {
    const r = await this.db.tx().execute<{ n: number }>(sql`with ${runsCte(f, scope)} select count(*)::int as n from runs r where ${bucketCondition(bucket)}`);
    return r.rows[0]!.n;
  }
```

- [ ] **Step 4: Wire the service, the DTOs and the controller**

In `apps/api/src/reports/reports.service.ts`, the contracts import becomes:

```ts
import { type EmployeeReportRow, type Page, REPORT_LIMITS, type ReportFilters, type ReportRun, type ReportRunsParams, type ReportSummary, type SiteReportRow } from '@taskop/contracts';
```

and this method follows `employees`:

```ts
  runs(p: Principal, q: ReportRunsParams): Promise<Page<ReportRun>> {
    return this.guarded(q, (f) => this.queries.runs(f, this.scheduling.occurrences(p), q.bucket, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize }));
  }
```

In `apps/api/src/reports/dto.ts`, add `pageOf`, `reportRunSchema` and `reportRunsQuerySchema` to the contracts import and append:

```ts
export class ReportRunsQueryDto extends createZodDto(reportRunsQuerySchema) {}
export class ReportRunPageResponse extends createZodDto(pageOf(reportRunSchema)) {}
```

In `apps/api/src/reports/reports.controller.ts`, add `Page` and `ReportRun` to the contracts type import, `ReportRunPageResponse` and `ReportRunsQueryDto` to the dto import, and this handler after `employees`:

```ts
  @Get('runs')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportRunPageResponse })
  runs(@CurrentPrincipal() p: Principal, @Query() q: ReportRunsQueryDto): Promise<Page<ReportRun>> {
    return this.reports.runs(p, q);
  }
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- reports-runs`
Expected: PASS. (If TypeScript complains that `bucketCondition` does not return on every path, add `default: { const unhandled: never = b; throw new Error('Unknown bucket: ' + String(unhandled)); }`.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports apps/api/test/reports-runs.test.ts
git commit -m "feat(api): add the paged run list with buckets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `GET /reports/problems` (with `severity`) and `GET /reports/tasks`

**Files:**
- Modify: `apps/api/src/reports/report-queries.ts`, `reports.service.ts`, `reports.controller.ts`, `dto.ts`, `reports.module.ts`
- Test: `apps/api/test/reports-problems-tasks.test.ts`

**Interfaces:**
- Consumes: Task 8 (`inFilterSubtree`, `statusList`, the fixtures); `selectProblemRows(tx)`, `toProblemDtos(tx, rows)` from `executions/problem-rows.ts`; `selectTasks(tx)` from `tasks/task-rows.ts`; `TaskScope.readable(p: TaskReader): SQL` (exported by `TasksModule`); `FINAL_TASK_STATUSES`.
- Produces:
  - `ReportQueries.problems(f, scope, severity: ProblemSeverity | undefined, opts: { cursor?: string; limit: number | null }): Promise<{ items: ReportProblem[]; nextCursor: string | null }>` and `ReportQueries.problemCounts(f, scope, severity): Promise<ReportProblemCounts>`
  - `ReportQueries.tasks(f, scope: SQL, opts: { cursor?: string; limit: number | null }): Promise<{ items: ReportTask[]; nextCursor: string | null }>` and `ReportQueries.taskCounts(f, scope: SQL): Promise<ReportTaskCounts>`
  - `ReportsService.problems(p, q: ReportProblemsParams): Promise<ReportProblems>`, `ReportsService.tasks(p, q: ReportTasksParams): Promise<ReportTasks>`; `GET /reports/problems`, `GET /reports/tasks` (`reports.view`)

- [ ] **Step 1: Write the failing test**

`apps/api/test/reports-problems-tasks.test.ts`:

```ts
import type { ReportProblems, ReportTasks } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addProblem, addRun, addSite, addTask, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld, type TaskKey } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('GET /reports/problems and /reports/tasks', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const problems = async (api: Api, q: Record<string, string | undefined>): Promise<ReportProblems> => {
    const res = await api.get(`/api/v1/reports/problems?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ReportProblems;
  };
  const tasks = async (api: Api, q: Record<string, string | undefined>): Promise<ReportTasks> => {
    const res = await api.get(`/api/v1/reports/tasks?${qs(q)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ReportTasks;
  };
  const taskIds = (...keys: TaskKey[]) => keys.map((k) => w.tasks[k]);

  it('counts problems by severity and resolution and lists them newest first', async () => {
    const r = await problems(w.owner, PERIOD);
    expect(r.counts).toEqual({ total: 4, critical: 2, resolution: { none: 1, open: 1, resolved: 1, cancelled: 1 } });
    expect(r.items.map((p) => [p.id, p.severity, p.resolution, p.taskStatus])).toEqual([
      [w.problems.p4, 'critical', 'cancelled', 'cancelled'],
      [w.problems.p3, 'normal', 'resolved', 'completed'],
      [w.problems.p2, 'critical', 'open', 'in_progress'],
      [w.problems.p1, 'normal', 'none', null],
    ]);
    expect(r.items[2]).toMatchObject({
      localDate: '2026-11-02', siteName: 'Filial B', checklistName: 'Açılış yoxlaması', source: 'manual',
      note: 'Kondisioner, "xarab"\nyenisi lazımdır', executorName: 'Nigar Həsənova', taskId: w.tasks.t3, occurrenceId: w.runs.r4.occurrenceId,
    });
    expect(r.nextCursor).toBeNull();
  });

  it('filters problems by severity (the dashboard’s critical panel), employee and site subtree', async () => {
    const critical = await problems(w.owner, { ...PERIOD, severity: 'critical' });
    expect(critical.counts).toEqual({ total: 2, critical: 2, resolution: { none: 0, open: 1, resolved: 0, cancelled: 1 } });
    expect(critical.items.map((p) => p.id)).toEqual([w.problems.p4, w.problems.p2]);
    expect((await problems(w.owner, { ...PERIOD, userId: w.nigar.id })).items.map((p) => p.id)).toEqual([w.problems.p3, w.problems.p2]);
    expect((await problems(w.owner, { ...PERIOD, siteId: w.sites.branchA })).items.map((p) => p.id)).toEqual([w.problems.p4, w.problems.p1]);
    expect((await problems(w.owner, { from: '2026-11-03', to: '2026-11-03' })).counts.total).toBe(1);
  });

  it('pages problems with the /problems cursor, keeping the counts on every page', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    const run = await addRun(b, { date: '2026-11-03', siteId: site, checklist, status: 'completed', dueAt: '2026-11-03T06:00:00Z', assignees: [worker.id], executions: [{ executor: worker.id, state: 'completed', score: 10, completedAt: '2026-11-03T05:00:00Z' }] });
    const created: string[] = [];
    for (let i = 0; i < 52; i++) created.push(await addProblem(b, { run, siteId: site, checklistId: checklist.id, severity: 'normal', createdAt: '2026-11-03T05:00:00Z' }));
    const first = await problems(b.owner, PERIOD);
    expect([first.items.length, first.counts.total]).toEqual([50, 52]);
    const second = await problems(b.owner, { ...PERIOD, cursor: first.nextCursor! });
    expect([second.items.length, second.counts.total, second.nextCursor]).toEqual([2, 52, null]);
    expect([...first.items, ...second.items].map((p) => p.id)).toEqual([...created].reverse());
  });

  it('counts the period’s tasks by status, overdue and on time (spec §3.4), by their local due day', async () => {
    const r = await tasks(w.owner, PERIOD);
    expect(r.counts).toEqual({
      byStatus: { new: 2, accepted: 1, in_progress: 1, awaiting_review: 1, completed: 3, cancelled: 1 },
      overdueOpen: 1,
      completedOnTime: 2,
      completedLate: 1,
    });
    // By due time (creation time when there is none), newest first; t9 is due next week.
    expect(r.items.map((x) => x.id)).toEqual(taskIds('t7', 't8', 't3', 't2', 't6', 't4', 't5', 't1', 't10'));
    expect(r.items.find((x) => x.id === w.tasks.t6)).toEqual({
      id: w.tasks.t6, title: 'Soyuducunu yoxla', priority: 'normal', status: 'completed',
      site: { id: w.sites.zoneA2, name: 'Zona A2' }, assignee: { id: w.kamran.id, fullName: 'Kamran Əliyev' }, team: null,
      dueAt: '2026-11-03T08:00:00.000Z', completedAt: '2026-11-03T09:00:00.000Z', createdAt: '2026-11-02T08:00:00.000Z', overdue: true, problemId: null,
    });
    expect(r.nextCursor).toBeNull();
  });

  it('filters tasks by site subtree, assignee and the checklist of their problem', async () => {
    expect((await tasks(w.owner, { ...PERIOD, siteId: w.sites.branchB })).items.map((x) => x.id)).toEqual(taskIds('t3', 't5', 't10'));
    expect((await tasks(w.owner, { ...PERIOD, userId: w.aynur.id })).items.map((x) => x.id)).toEqual(taskIds('t8', 't4', 't1'));
    expect((await tasks(w.owner, { ...PERIOD, checklistId: w.checklists.opening.id })).items.map((x) => x.id)).toEqual(taskIds('t7', 't3', 't5'));
    expect((await tasks(w.owner, { ...PERIOD, checklistId: w.checklists.stock.id })).items).toEqual([]);
  });

  it('places a task by its due time’s local day in the tenant timezone (Europe/Berlin, DST end)', async () => {
    const b = await reportBase(t);
    await ownerQuery("update tenants set timezone = 'Europe/Berlin' where id = $1", [b.s.tenantId]);
    const worker = await createUserDirect(t, b.s.tenantId, { fullName: 'İşçi' });
    const task = (dueAt: string) => addTask(b, { title: dueAt, status: 'new', assigneeUserId: worker.id, dueAt, createdAt: '2026-10-20T08:00:00Z' });
    // 22:30Z on the 24th is 00:30 on the 25th in Berlin (CEST, UTC+2).
    const early = await task('2026-10-24T22:30:00Z');
    // 21:30Z on the 25th is 22:30 the same day in Berlin (CET, UTC+1), but already the 26th in Baku.
    const mid = await task('2026-10-25T21:30:00Z');
    // 23:30Z on the 25th is 00:30 on the 26th in Berlin.
    const late = await task('2026-10-25T23:30:00Z');
    const day = async (d: string) => (await tasks(b.owner, { from: d, to: d })).items.map((x) => x.id);
    expect(await day('2026-10-24')).toEqual([]);
    expect(await day('2026-10-25')).toEqual([mid, early]);
    expect(await day('2026-10-26')).toEqual([late]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- reports-problems-tasks`
Expected: FAIL: `GET /api/v1/reports/problems` answers 404.

- [ ] **Step 3: Implement the queries**

In `apps/api/src/reports/report-queries.ts`:
- the imports become:

```ts
import { Injectable } from '@nestjs/common';
import {
  COMPLETED_STATUSES,
  completionPercent,
  type EmployeeReportRow,
  FINAL_TASK_STATUSES,
  IN_PROGRESS_STATUSES,
  type OccurrenceStatus,
  type Page,
  periodDays,
  type ProblemSeverity,
  type ReportProblem,
  type ReportProblemCounts,
  type ReportRun,
  type ReportSummary,
  type ReportTask,
  type ReportTaskCounts,
  roundOne,
  type RunBucket,
  type RunCounts,
  type SiteReportRow,
  type UserRef,
} from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DbService } from '../db/db.service';
import { executionProblems, executions, occurrences, tasks } from '../db/schema';
import { selectProblemRows, toProblemDtos } from '../executions/problem-rows';
import { selectTasks } from '../tasks/task-rows';
import type { ResolvedFilters } from './report-filters';
```

- add after `toReportRun`:

```ts
/** Problems of the period's occurrences (spec §3.2) under scope and filters; a problem's user is its run's executor (Spec decision 10). */
function problemConditions(f: ResolvedFilters, scope: SQL | undefined, severity: ProblemSeverity | undefined): SQL {
  const conds: (SQL | undefined)[] = [scope, sql`${occurrences.localDate} between ${f.from}::date and ${f.to}::date`, inFilterSubtree(f, occurrences.siteId)];
  if (f.checklistId) conds.push(eq(executionProblems.checklistId, f.checklistId));
  if (f.userId) conds.push(eq(executions.executorUserId, f.userId));
  if (severity) conds.push(eq(executionProblems.severity, severity));
  return and(...conds)!;
}

/** Tasks of the period by the tenant-local day of their due time, else their creation (spec §3.2), under scope and filters (Spec decision 10). */
function taskConditions(f: ResolvedFilters, scope: SQL): SQL {
  const conds: (SQL | undefined)[] = [
    scope,
    sql`(coalesce(${tasks.dueAt}, ${tasks.createdAt}) at time zone ${f.timezone})::date between ${f.from}::date and ${f.to}::date`,
    inFilterSubtree(f, tasks.siteId),
  ];
  if (f.userId) conds.push(eq(tasks.assigneeUserId, f.userId));
  if (f.checklistId) conds.push(sql`exists (select 1 from execution_problems fp where fp.id = ${tasks.problemId} and fp.checklist_id = ${f.checklistId})`);
  return and(...conds)!;
}

const taskPeriodKey = sql`coalesce(${tasks.dueAt}, ${tasks.createdAt})`;
```

- add these methods inside `ReportQueries`:

```ts
  /** Spec §5.3: the /problems rows (newest first, the same keyset) with the linked task's status. */
  async problems(f: ResolvedFilters, scope: SQL | undefined, severity: ProblemSeverity | undefined, opts: { cursor?: string; limit: number | null }): Promise<{ items: ReportProblem[]; nextCursor: string | null }> {
    const conds = [problemConditions(f, scope, severity)];
    if (opts.cursor) {
      conds.push(sql`(${executionProblems.createdAt}, ${executionProblems.id}) < (select c.created_at, c.id from execution_problems c where c.id = ${opts.cursor})`);
    }
    const tx = this.db.tx();
    const query = selectProblemRows(tx).where(and(...conds)).orderBy(desc(executionProblems.createdAt), desc(executionProblems.id));
    const rows = opts.limit === null ? await query : await query.limit(opts.limit + 1);
    const page = opts.limit === null ? rows : rows.slice(0, opts.limit);
    const dtos = await toProblemDtos(tx, page);
    const more = opts.limit !== null && rows.length > opts.limit;
    return { items: dtos.map((d, i) => ({ ...d, taskStatus: page[i]!.taskStatus })), nextCursor: more ? page[page.length - 1]!.pr.id : null };
  }

  /** Over the whole filtered set, cursor ignored (Spec decision 12); resolution as SP5's problemResolutionOf. */
  async problemCounts(f: ResolvedFilters, scope: SQL | undefined, severity: ProblemSeverity | undefined): Promise<ReportProblemCounts> {
    const [r] = await this.db
      .tx()
      .select({
        total: sql<number>`count(*)::int`,
        critical: sql<number>`(count(*) filter (where ${executionProblems.severity} = 'critical'))::int`,
        none: sql<number>`(count(*) filter (where ${tasks.id} is null))::int`,
        open: sql<number>`(count(*) filter (where ${tasks.id} is not null and ${tasks.status} not in ${statusList(FINAL_TASK_STATUSES)}))::int`,
        resolved: sql<number>`(count(*) filter (where ${tasks.status} = 'completed'))::int`,
        cancelled: sql<number>`(count(*) filter (where ${tasks.status} = 'cancelled'))::int`,
      })
      .from(executionProblems)
      .innerJoin(occurrences, eq(occurrences.id, executionProblems.occurrenceId))
      .innerJoin(executions, eq(executions.id, executionProblems.executionId))
      .leftJoin(tasks, eq(tasks.problemId, executionProblems.id))
      .where(problemConditions(f, scope, severity));
    return { total: r!.total, critical: r!.critical, resolution: { none: r!.none, open: r!.open, resolved: r!.resolved, cancelled: r!.cancelled } };
  }

  /** Spec §5.3: newest period key first, keyset on (coalesce(due_at, created_at), id) (Spec decision 11). */
  async tasks(f: ResolvedFilters, scope: SQL, opts: { cursor?: string; limit: number | null }): Promise<{ items: ReportTask[]; nextCursor: string | null }> {
    const conds = [taskConditions(f, scope)];
    if (opts.cursor) conds.push(sql`(${taskPeriodKey}, ${tasks.id}) < (select coalesce(c.due_at, c.created_at), c.id from tasks c where c.id = ${opts.cursor})`);
    const query = selectTasks(this.db.tx()).where(and(...conds)).orderBy(sql`${taskPeriodKey} desc`, desc(tasks.id));
    const rows = opts.limit === null ? await query : await query.limit(opts.limit + 1);
    const page = opts.limit === null ? rows : rows.slice(0, opts.limit);
    const more = opts.limit !== null && rows.length > opts.limit;
    return {
      items: page.map((r) => ({
        id: r.t.id,
        title: r.t.title,
        priority: r.t.priority,
        status: r.t.status,
        site: r.t.siteId ? { id: r.t.siteId, name: r.siteName ?? '' } : null,
        assignee: r.t.assigneeUserId ? { id: r.t.assigneeUserId, fullName: r.assigneeName ?? '' } : null,
        team: r.t.assigneeTeamId ? { id: r.t.assigneeTeamId, name: r.teamName ?? '' } : null,
        dueAt: r.t.dueAt?.toISOString() ?? null,
        completedAt: r.t.completedAt?.toISOString() ?? null,
        createdAt: r.t.createdAt.toISOString(),
        overdue: r.t.overdueAt !== null,
        problemId: r.t.problemId,
      })),
      nextCursor: more ? page[page.length - 1]!.t.id : null,
    };
  }

  /** Spec §3.4 over the whole filtered set. "On time" / "late" count completed tasks only. */
  async taskCounts(f: ResolvedFilters, scope: SQL): Promise<ReportTaskCounts> {
    const n = (cond: SQL) => sql<number>`(count(*) filter (where ${cond}))::int`;
    const [r] = await this.db
      .tx()
      .select({
        new: n(sql`${tasks.status} = 'new'`),
        accepted: n(sql`${tasks.status} = 'accepted'`),
        in_progress: n(sql`${tasks.status} = 'in_progress'`),
        awaiting_review: n(sql`${tasks.status} = 'awaiting_review'`),
        completed: n(sql`${tasks.status} = 'completed'`),
        cancelled: n(sql`${tasks.status} = 'cancelled'`),
        overdueOpen: n(sql`${tasks.status} not in ${statusList(FINAL_TASK_STATUSES)} and ${tasks.overdueAt} is not null`),
        completedOnTime: n(sql`${tasks.status} = 'completed' and (${tasks.dueAt} is null or ${tasks.completedAt} <= ${tasks.dueAt})`),
        completedLate: n(sql`${tasks.status} = 'completed' and ${tasks.completedAt} > ${tasks.dueAt}`),
      })
      .from(tasks)
      .where(taskConditions(f, scope));
    const { overdueOpen, completedOnTime, completedLate, ...byStatus } = r!;
    return { byStatus, overdueOpen, completedOnTime, completedLate };
  }
```

(In the single-table `taskCounts` select, Drizzle prints the select-list columns unqualified; `tasks` is the only table in that `from`, so they resolve to it. The `where` is always printed qualified.)

- [ ] **Step 4: Wire the service, the DTOs, the controller and the module**

In `apps/api/src/reports/reports.module.ts`, add `import { TasksModule } from '../tasks/tasks.module';` and make the imports `imports: [SchedulingModule, TasksModule],` (TasksModule exports `TaskScope`).

In `apps/api/src/reports/reports.service.ts`:
- the contracts import becomes:

```ts
import {
  type EmployeeReportRow,
  type Page,
  REPORT_LIMITS,
  type ReportFilters,
  type ReportProblems,
  type ReportProblemsParams,
  type ReportRun,
  type ReportRunsParams,
  type ReportSummary,
  type ReportTasks,
  type ReportTasksParams,
  type SiteReportRow,
} from '@taskop/contracts';
```

- add `import { TaskScope } from '../tasks/task-scope';`, and the constructor gains `private readonly taskScope: TaskScope,` after `private readonly scheduling: SchedulingScope,`.
- add after `runs`:

```ts
  problems(p: Principal, q: ReportProblemsParams): Promise<ReportProblems> {
    return this.guarded(q, async (f) => {
      const scope = this.scheduling.occurrences(p);
      const counts = await this.queries.problemCounts(f, scope, q.severity);
      return { counts, ...(await this.queries.problems(f, scope, q.severity, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize })) };
    });
  }

  tasks(p: Principal, q: ReportTasksParams): Promise<ReportTasks> {
    return this.guarded(q, async (f) => {
      const scope = this.taskScope.readable(p);
      const counts = await this.queries.taskCounts(f, scope);
      return { counts, ...(await this.queries.tasks(f, scope, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize })) };
    });
  }
```

In `apps/api/src/reports/dto.ts`, add `reportProblemsQuerySchema`, `reportProblemsSchema`, `reportTasksQuerySchema` and `reportTasksSchema` to the contracts import and append:

```ts
export class ReportProblemsQueryDto extends createZodDto(reportProblemsQuerySchema) {}
export class ReportProblemsResponse extends createZodDto(reportProblemsSchema) {}
export class ReportTasksQueryDto extends createZodDto(reportTasksQuerySchema) {}
export class ReportTasksResponse extends createZodDto(reportTasksSchema) {}
```

In `apps/api/src/reports/reports.controller.ts`, add `ReportProblems` and `ReportTasks` to the contracts type import, the four new DTOs to the dto import, and these handlers after `runs`:

```ts
  @Get('problems')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportProblemsResponse })
  problems(@CurrentPrincipal() p: Principal, @Query() q: ReportProblemsQueryDto): Promise<ReportProblems> {
    return this.reports.problems(p, q);
  }

  @Get('tasks')
  @RequirePermission('reports.view')
  @ApiOkResponse({ type: ReportTasksResponse })
  tasks(@CurrentPrincipal() p: Principal, @Query() q: ReportTasksQueryDto): Promise<ReportTasks> {
    return this.reports.tasks(p, q);
  }
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- reports-problems-tasks reports-runs reports-tables reports-summary`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports apps/api/test/reports-problems-tasks.test.ts
git commit -m "feat(api): add the problem and task reports, with the severity filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The report scope suite (spec §4, §9)

**Files:**
- Test: `apps/api/test/reports-scope.test.ts`

**Interfaces:**
- Consumes: the six endpoints (Tasks 8–11) and the fixtures; no new code. Every report query ANDs the scope SQL first, so this suite is expected to pass at once; a failure here is a scope leak to fix in `report-queries.ts` (or in the scope helper it calls) before going on.
- Produces: the pinned scope behaviour Parts 2 and 3 rely on (*Server behaviour*, "Scope and filters").

In the fixture, Leyla (`site_subtree`, Filial A) sees every run except r4 and r10 (Filial B); Rauf (`subordinates`: Aynur, Kamran, Samir) sees the runs those three are assigned to: all but r4, r8 and r10.

- [ ] **Step 1: Write the test**

`apps/api/test/reports-scope.test.ts`:

```ts
import type { EmployeeReportRow, Page, ReportProblems, ReportRun, ReportSummary, ReportTasks, SiteReportRow } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld, type RunKey, type TaskKey } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('report data scope (spec §4)', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const get = async <T>(api: Api, path: string, q: Record<string, string | undefined> = {}): Promise<T> => {
    const res = await api.get(`/api/v1/reports/${path}?${qs({ ...PERIOD, ...q })}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as T;
  };
  const planned = async (api: Api, q: Record<string, string | undefined> = {}) => (await get<ReportSummary>(api, 'summary', q)).counts.planned;
  const runIds = async (api: Api) => (await get<Page<ReportRun>>(api, 'runs')).items.map((r) => r.occurrenceId).sort();
  const runs = (...keys: RunKey[]) => keys.map((k) => w.runs[k].occurrenceId).sort();
  const tasks = (...keys: TaskKey[]) => keys.map((k) => w.tasks[k]);
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('shows a site_subtree manager only their branch and its zones', async () => {
    const api = w.leyla.api;
    expect(await planned(api)).toBe(13);
    expect(await runIds(api)).toEqual(runs('r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'r8', 'r9', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16'));
    expect(names(await get<SiteReportRow[]>(api, 'sites'))).toEqual(['Filial A', 'Zona A1', 'Zona A2']);
    expect(names(await get<EmployeeReportRow[]>(api, 'employees'))).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Samir Məmmədov', 'Təyin edilməyib']);
    const problems = await get<ReportProblems>(api, 'problems');
    expect([problems.counts.total, problems.items.map((p) => p.id)]).toEqual([2, [w.problems.p4, w.problems.p1]]);
    // Tasks at her sites, or assigned to people at her sites (TaskScope): t8 has no site but Aynur works at Zona A1.
    expect((await get<ReportTasks>(api, 'tasks')).items.map((x) => x.id)).toEqual(tasks('t7', 't8', 't2', 't6', 't4', 't1'));
  });

  it('shows a subordinates manager only the runs of their people', async () => {
    const api = w.rauf.api;
    expect(await planned(api)).toBe(12);
    expect(await runIds(api)).toEqual(runs('r1', 'r2', 'r3', 'r5', 'r6', 'r7', 'r9', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16'));
    expect(names(await get<EmployeeReportRow[]>(api, 'employees'))).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Samir Məmmədov']);
    expect((await get<ReportProblems>(api, 'problems')).items.map((p) => p.id)).toEqual([w.problems.p4, w.problems.p1]);
    expect((await get<ReportTasks>(api, 'tasks')).items.map((x) => x.id)).toEqual(tasks('t7', 't8', 't2', 't6', 't4', 't1'));
  });

  it('treats filters outside the scope as empty, not forbidden', async () => {
    expect(await planned(w.leyla.api, { siteId: w.sites.branchB })).toBe(0);
    expect(await planned(w.leyla.api, { userId: w.nigar.id })).toBe(0);
    expect(await get<SiteReportRow[]>(w.leyla.api, 'sites', { siteId: w.sites.branchB })).toEqual([]);
    expect((await get<ReportProblems>(w.leyla.api, 'problems', { userId: w.nigar.id })).counts.total).toBe(0);
    expect((await get<ReportTasks>(w.leyla.api, 'tasks', { siteId: w.sites.branchB })).items).toEqual([]);
    expect(await planned(w.rauf.api, { userId: w.nigar.id })).toBe(0);
    expect(await planned(w.owner, { siteId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f' })).toBe(0);
  });

  it('limits an own-scope report viewer to their own runs and tasks', async () => {
    const own = await w.owner.post('/api/v1/roles', { name: 'Öz hesabatı', dataScope: 'own', permissions: ['reports.view'] });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    await ownerQuery('update users set role_id = $1 where id = $2', [own.body.id, w.aynur.id]);
    try {
      const api = as(t, (await loginWorker(t, w.s.orgCode, w.aynur.username, w.aynur.secret)).accessToken);
      // Runs she is assigned to: r1, r2, r3, r7, r12, r14, r15, r16 (and the cancelled r6).
      expect(await planned(api)).toBe(8);
      // Without tasks.view: only tasks assigned to her (t9 is outside the period).
      expect((await get<ReportTasks>(api, 'tasks')).items.map((x) => x.id)).toEqual(tasks('t8', 't4', 't1'));
    } finally {
      await ownerQuery("update users set role_id = (select id from roles where tenant_id = $1 and system_key = 'worker') where id = $2", [w.s.tenantId, w.aynur.id]);
    }
  });

  it('refuses every report without reports.view', async () => {
    const worker = as(t, (await loginWorker(t, w.s.orgCode, w.kamran.username, w.kamran.secret)).accessToken);
    for (const path of ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks']) {
      expect((await worker.get(`/api/v1/reports/${path}?${qs(PERIOD)}`)).status, path).toBe(403);
    }
    const noReports = await w.owner.post('/api/v1/roles', { name: 'Təyinatlar', dataScope: 'all', permissions: ['assignments.view', 'tasks.view'] });
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: noReports.body.id as string, emailVerified: true });
    const api = as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    expect((await api.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(403);
  });

  it('never shows another tenant’s runs', async () => {
    const other = await reportBase(t);
    expect(await planned(other.owner)).toBe(0);
    expect(await get<SiteReportRow[]>(other.owner, 'sites', { siteId: w.sites.zoneA1 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @taskop/api test -- reports-scope`
Expected: PASS. A failure is a scope leak: the failing line names the endpoint and the principal; fix the query in `report-queries.ts` so the scope SQL is part of its `where`, and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/reports-scope.test.ts
git commit -m "test(api): pin the data scope of every report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The export table model, the Azerbaijani report tables and the CSV writer

**Files:**
- Create: `apps/api/src/reports/export/report-table.ts`, `export/report-tables.ts`, `export/csv.ts`
- Test: `apps/api/src/reports/export/report-table.test.ts`, `export/report-tables.test.ts`, `export/csv.test.ts`
- Modify: `apps/api/package.json` (+ `csv-parse` dev dependency)

**Interfaces:**
- Consumes: the contract shapes of Tasks 2 and 8–11 (`ReportSummary`, `SiteReportRow`, `EmployeeReportRow`, `ReportRun`, `ReportProblem`, `ReportTask`, `RunBucket`, `RUN_COUNT_KEYS`); `tzOffsetMinutes` from contracts; `az` (Task 4).
- Produces, used by Tasks 14–15:
  - `report-table.ts`: `type ColumnType = 'text' | 'int' | 'decimal' | 'number' | 'date' | 'datetime' | 'bool'`, `interface ReportColumn { label: string; type: ColumnType; width?: number }`, `type CellValue = string | number | boolean | null` (text → string; int/decimal/number → number; date → `YYYY-MM-DD`; datetime → ISO instant; bool → boolean), `interface ReportTable { title: string; columns: ReportColumn[]; rows: CellValue[][] }`, `interface ReportDocument { title; tenantName; from; to; filters: string[]; generatedAt: Date; timezone: string; sections: ReportTable[] }`, `formatDate(d: string): string`, `wallClock(instant: string | Date, tz: string): Date`, `formatInstant(instant: string | Date, tz: string): string`, `cellText(col: ReportColumn, v: CellValue, tz: string): string`
  - `report-tables.ts`: `summaryTables(s: ReportSummary): ReportTable[]` (measures, trend), `sitesTable(rows)`, `employeesTable(rows)`, `runsTable(rows: ReportRun[], title: string)`, `runsTitle(bucket: RunBucket): string`, `problemsTable(rows: ReportProblem[])`, `tasksTable(rows: ReportTask[])`
  - `csv.ts`: `csvField(s: string): string`, `neutralise(s: string): string`, `toCsv(doc: ReportDocument): Buffer`

- [ ] **Step 1: Add the test-only CSV parser**

```bash
pnpm --filter @taskop/api add -D csv-parse@^7.0.3
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/reports/export/report-table.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cellText, formatDate, formatInstant, wallClock } from './report-table';

describe('export cell formatting', () => {
  it('writes dates as DD.MM.YYYY and instants on the tenant’s wall clock', () => {
    expect(formatDate('2026-11-02')).toBe('02.11.2026');
    expect(formatInstant('2026-11-02T07:00:00.000Z', 'Asia/Baku')).toBe('02.11.2026 11:00');
    expect(formatInstant('2026-11-01T21:30:00.000Z', 'Asia/Baku')).toBe('02.11.2026 01:30');
    expect(formatInstant(new Date('2026-11-04T08:00:00Z'), 'Asia/Baku')).toBe('04.11.2026 12:00');
  });

  it('reads both sides of a DST change correctly (Europe/Berlin, 25 October 2026)', () => {
    expect(formatInstant('2026-10-25T00:30:00.000Z', 'Europe/Berlin')).toBe('25.10.2026 02:30');
    expect(formatInstant('2026-10-25T01:30:00.000Z', 'Europe/Berlin')).toBe('25.10.2026 02:30');
    expect(formatInstant('2026-10-25T02:30:00.000Z', 'Europe/Berlin')).toBe('25.10.2026 03:30');
    expect(wallClock('2026-10-24T22:30:00.000Z', 'Europe/Berlin').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('writes each column type', () => {
    const tz = 'Asia/Baku';
    expect(cellText({ label: 'a', type: 'text' }, 'Zona A1', tz)).toBe('Zona A1');
    expect(cellText({ label: 'a', type: 'int' }, 7, tz)).toBe('7');
    expect(cellText({ label: 'a', type: 'decimal' }, 50, tz)).toBe('50.0');
    expect(cellText({ label: 'a', type: 'decimal' }, 57.1, tz)).toBe('57.1');
    expect(cellText({ label: 'a', type: 'number' }, 53.8, tz)).toBe('53.8');
    expect(cellText({ label: 'a', type: 'date' }, '2026-11-02', tz)).toBe('02.11.2026');
    expect(cellText({ label: 'a', type: 'datetime' }, '2026-11-02T06:00:00.000Z', tz)).toBe('02.11.2026 10:00');
    expect(cellText({ label: 'a', type: 'bool' }, true, tz)).toBe('Bəli');
    expect(cellText({ label: 'a', type: 'bool' }, false, tz)).toBe('Xeyr');
    expect(cellText({ label: 'a', type: 'decimal' }, null, tz)).toBe('');
  });
});
```

`apps/api/src/reports/export/csv.test.ts`:

```ts
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { csvField, neutralise, toCsv } from './csv';
import type { ReportDocument, ReportTable } from './report-table';

const doc = (sections: ReportTable[]): ReportDocument => ({
  title: 'T', tenantName: 'Acme MMC', from: '2026-11-02', to: '2026-11-04', filters: [], generatedAt: new Date('2026-11-04T08:00:00Z'), timezone: 'Asia/Baku', sections,
});
const text = (b: Buffer) => b.toString('utf8');

describe('CSV writer', () => {
  it('quotes per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField('cr\rhere')).toBe('"cr\rhere"');
  });

  it('neutralises formula-looking text', () => {
    for (const s of ['=1+2', '+7', '-3', '@SUM(A1)', '\tx', '\rx']) expect(neutralise(s), JSON.stringify(s)).toBe(`'${s}`);
    expect(neutralise('Qapı = açıq')).toBe('Qapı = açıq');
    expect(neutralise('')).toBe('');
  });

  it('writes a BOM, CRLF rows, one header per section and an empty line between sections', () => {
    const out = toCsv(doc([
      { title: 'A', columns: [{ label: 'Ad', type: 'text' }, { label: 'Say', type: 'int' }], rows: [['Zona, A1', -5], ['=HYPERLINK("x")', null]] },
      { title: 'B', columns: [{ label: 'Tarix', type: 'date' }], rows: [['2026-11-02']] },
    ]));
    expect([...out.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // Numbers are never neutralised: -5 stays a number.
    expect(text(out).slice(1)).toBe('Ad,Say\r\n"Zona, A1",-5\r\n"\'=HYPERLINK(""x"")",\r\n\r\nTarix\r\n02.11.2026\r\n');
  });

  it('round-trips Azerbaijani text, quotes and line breaks through a CSV parser', () => {
    const cells = ['Şəki, "Mərkəz"', 'ilk sətir\nikinci sətir', 'ğ ı ö ü ç ş ə Ə İ', '@admin'];
    const out = toCsv(doc([{ title: 'A', columns: cells.map((_, i) => ({ label: `S${i}`, type: 'text' as const })), rows: [cells] }]));
    expect(parse(text(out), { bom: true })).toEqual([
      ['S0', 'S1', 'S2', 'S3'],
      ['Şəki, "Mərkəz"', 'ilk sətir\nikinci sətir', 'ğ ı ö ü ç ş ə Ə İ', "'@admin"],
    ]);
  });

  it('writes times on the tenant’s wall clock and booleans in Azerbaijani', () => {
    const out = toCsv(doc([{ title: 'A', columns: [{ label: 'Vaxt', type: 'datetime' }, { label: 'Gecikib', type: 'bool' }, { label: 'Bal', type: 'decimal' }], rows: [['2026-11-02T07:00:00.000Z', true, 90], [null, false, null]] }]));
    expect(text(out).slice(1)).toBe('Vaxt,Gecikib,Bal\r\n02.11.2026 11:00,Bəli,90.0\r\n,Xeyr,\r\n');
  });

  it('writes only the header of an empty table', () => {
    expect(text(toCsv(doc([{ title: 'A', columns: [{ label: 'Ad', type: 'text' }], rows: [] }]))).slice(1)).toBe('Ad\r\n');
  });
});
```

`apps/api/src/reports/export/report-tables.test.ts`:

```ts
import { emptyRunCounts, type ReportProblem, type ReportRun, type ReportSummary, type ReportTask, type SiteReportRow } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { employeesTable, problemsTable, runsTable, runsTitle, sitesTable, summaryTables, tasksTable } from './report-tables';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';

describe('report tables', () => {
  it('lays out the summary as measures and a daily trend', () => {
    const s: ReportSummary = {
      counts: { ...emptyRunCounts(), planned: 15, due: 13, completed: 7 },
      completionPercent: 53.8,
      averageScore: null,
      trend: [{ date: '2026-11-02', due: 6, completed: 4, completionPercent: 66.7 }],
    };
    const [measures, trend] = summaryTables(s);
    expect(measures!.title).toBe('Xülasə');
    expect(measures!.columns.map((c) => c.label)).toEqual(['Göstərici', 'Dəyər']);
    expect(measures!.rows).toHaveLength(12);
    expect(measures!.rows.slice(0, 3)).toEqual([['Planlaşdırılıb', 15], ['Vaxtı çatıb', 13], ['Tamamlanıb', 7]]);
    expect(measures!.rows.slice(-2)).toEqual([['Tamamlanma faizi', 53.8], ['Orta bal', null]]);
    expect(trend).toEqual({
      title: 'Gündəlik',
      columns: [{ label: 'Tarix', type: 'date' }, { label: 'Vaxtı çatıb', type: 'int' }, { label: 'Tamamlanıb', type: 'int' }, { label: 'Tamamlanma faizi', type: 'decimal' }],
      rows: [['2026-11-02', 6, 4, 66.7]],
    });
  });

  it('writes run rows with Azerbaijani statuses and the device and server times', () => {
    const run: ReportRun = {
      occurrenceId: ID, executionId: ID, localDate: '2026-11-02', dueAt: '2026-11-02T06:00:00.000Z',
      checklist: { id: ID, name: 'Açılış yoxlaması' }, site: { id: ID, name: 'Zona A1' }, status: 'completed',
      assignees: [{ id: ID, fullName: 'Aynur' }, { id: ID, fullName: 'Kamran' }], executor: { id: ID, fullName: 'Kamran' },
      startedAt: '2026-11-02T04:10:00.000Z', completedAt: '2026-11-02T05:40:00.000Z', completedReceivedAt: '2026-11-04T05:00:00.000Z',
      score: 100, problemCount: 1, criticalCount: 0, late: false, clockSuspect: true,
    };
    const t = runsTable([run], runsTitle('all'));
    expect(t.title).toBe('İcralar');
    expect(t.columns.map((c) => c.label)).toEqual([
      'Tarix', 'Son vaxt', 'Yoxlama vərəqəsi', 'Obyekt', 'Status', 'İcraçılar', 'İcra edən', 'Başlanıb', 'Tamamlanıb (cihaz)', 'Serverə çatıb', 'Bal', 'Problemlər', 'Kritik', 'Gecikmə ilə', 'Saat şübhəli',
    ]);
    expect(t.rows[0]).toEqual([
      '2026-11-02', '2026-11-02T06:00:00.000Z', 'Açılış yoxlaması', 'Zona A1', 'Tamamlanıb', 'Aynur, Kamran', 'Kamran',
      '2026-11-02T04:10:00.000Z', '2026-11-02T05:40:00.000Z', '2026-11-04T05:00:00.000Z', 100, 1, 0, false, true,
    ]);
    expect(runsTitle('missed')).toBe('İcralar (Buraxılmış)');
  });

  it('joins a site’s ancestors and labels the Unassigned employee', () => {
    const site: SiteReportRow = { ...emptyRunCounts(), planned: 7, siteId: ID, name: 'Zona A1', path: ['Filial A', 'Mərkəz'], active: false, completionPercent: 57.1, averageScore: 85 };
    const t = sitesTable([site]);
    expect(t.rows[0]!.slice(0, 4)).toEqual(['Zona A1', 'Filial A › Mərkəz', false, 7]);
    expect(t.rows[0]!.slice(-2)).toEqual([57.1, 85]);
    const e = employeesTable([{ ...emptyRunCounts(), userId: null, name: 'Təyin edilməyib', active: true, completionPercent: 0, averageScore: null }]);
    expect(e.columns.slice(0, 2).map((c) => c.label)).toEqual(['Əməkdaş', 'Aktiv']);
    expect(e.rows[0]!.slice(0, 2)).toEqual(['Təyin edilməyib', true]);
  });

  it('writes problem and task rows with their Azerbaijani labels', () => {
    const problem = {
      id: ID, executionId: ID, occurrenceId: ID, localDate: '2026-11-02', siteId: ID, siteName: 'Filial B', checklistId: ID, checklistName: 'Açılış yoxlaması',
      itemId: ID, itemLabel: 'Temperatur', source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [], media: [],
      executorName: 'Nigar', createdAt: '2026-11-02T05:10:00.000Z', resolution: 'open', taskId: ID, executionState: 'completed', taskStatus: 'in_progress',
    } satisfies ReportProblem;
    expect(problemsTable([problem]).rows[0]).toEqual([
      '2026-11-02', 'Filial B', 'Açılış yoxlaması', 'Temperatur', 'Kritik', 'Əl ilə qeyd', 'Kondisioner xarabdır', 'Nigar', '2026-11-02T05:10:00.000Z', 'Açıq', 'İcradadır',
    ]);
    const task: ReportTask = {
      id: ID, title: 'Qapını təmir et', priority: 'high', status: 'completed', site: null, assignee: null, team: { id: ID, name: 'Texniki xidmət' },
      dueAt: '2026-11-03T08:00:00.000Z', completedAt: '2026-11-03T09:00:00.000Z', createdAt: '2026-11-01T08:00:00.000Z', overdue: true, problemId: null,
    };
    expect(tasksTable([task]).rows[0]).toEqual(['Qapını təmir et', null, 'Texniki xidmət', 'Tamamlanıb', 'Yüksək', '2026-11-03T08:00:00.000Z', '2026-11-03T09:00:00.000Z', true]);
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- export/`
Expected: FAIL: `./report-table`, `./csv` and `./report-tables` do not exist.

- [ ] **Step 4: Implement**

`apps/api/src/reports/export/report-table.ts`:

```ts
import { tzOffsetMinutes } from '@taskop/contracts';
import { az } from '@taskop/i18n';

/** How a column is typed in Excel and printed in CSV and PDF. */
export type ColumnType = 'text' | 'int' | 'decimal' | 'number' | 'date' | 'datetime' | 'bool';

export interface ReportColumn {
  label: string;
  type: ColumnType;
  /** Excel column width in characters. */
  width?: number;
}

/** text → string; int / decimal / number → number; date → 'YYYY-MM-DD'; datetime → ISO instant; bool → boolean; null = empty. */
export type CellValue = string | number | boolean | null;

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: CellValue[][];
}

/** One export: the PDF header fields and its sections (one sheet each in Excel). */
export interface ReportDocument {
  title: string;
  tenantName: string;
  from: string;
  to: string;
  /** "Obyekt: Zona A1"-style lines; empty without filters. */
  filters: string[];
  generatedAt: Date;
  timezone: string;
  sections: ReportTable[];
}

/** 'YYYY-MM-DD' → 'DD.MM.YYYY'. */
export const formatDate = (d: string): string => d.split('-').reverse().join('.');

/** The tenant's wall-clock reading of an instant, as a Date whose UTC fields hold it (Excel dates have no zone). */
export function wallClock(instant: string | Date, tz: string): Date {
  const ms = +new Date(instant);
  return new Date(ms + tzOffsetMinutes(tz, ms) * 60_000);
}

/** 'DD.MM.YYYY HH:mm' on the tenant's wall clock (Spec decision 21). */
export function formatInstant(instant: string | Date, tz: string): string {
  const w = wallClock(instant, tz).toISOString();
  return `${formatDate(w.slice(0, 10))} ${w.slice(11, 16)}`;
}

/** A cell as CSV and PDF print it; null is empty. */
export function cellText(col: ReportColumn, v: CellValue, tz: string): string {
  if (v === null) return '';
  switch (col.type) {
    case 'text':
    case 'int':
    case 'number':
      return String(v);
    case 'decimal':
      return (v as number).toFixed(1);
    case 'date':
      return formatDate(v as string);
    case 'datetime':
      return formatInstant(v as string, tz);
    case 'bool':
      return v ? az.reports.yes : az.reports.no;
  }
}
```

`apps/api/src/reports/export/csv.ts`:

```ts
import { cellText, type ReportDocument, type ReportTable } from './report-table';

const BOM = '﻿';
/** OWASP's CSV-injection triggers: the spec's =, +, -, @ plus a leading tab or CR (Spec decision 19). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefixes text a spreadsheet would run as a formula with an apostrophe. */
export const neutralise = (s: string): string => (FORMULA_START.test(s) ? `'${s}` : s);

/** RFC 4180: quote a field with a comma, quote, CR or LF; double the quotes inside. */
export const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

function block(t: ReportTable, tz: string): string {
  const header = t.columns.map((c) => csvField(neutralise(c.label))).join(',');
  const rows = t.rows.map((r) =>
    r
      .map((v, i) => {
        const col = t.columns[i]!;
        const s = cellText(col, v, tz);
        // Only text can be a formula; numbers, dates and booleans are written as they are.
        return csvField(col.type === 'text' ? neutralise(s) : s);
      })
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

/** UTF-8 with a BOM (Excel then reads Azerbaijani letters), comma-separated, CRLF; sections separated by an empty line (Spec decision 17). */
export function toCsv(doc: ReportDocument): Buffer {
  return Buffer.from(`${BOM}${doc.sections.map((t) => block(t, doc.timezone)).join('\r\n\r\n')}\r\n`, 'utf8');
}
```

`apps/api/src/reports/export/report-tables.ts`:

```ts
import {
  type EmployeeReportRow,
  type ReportProblem,
  type ReportRun,
  type ReportSummary,
  type ReportTask,
  RUN_COUNT_KEYS,
  type RunBucket,
  type RunCounts,
  type SiteReportRow,
} from '@taskop/contracts';
import { az } from '@taskop/i18n';
import type { CellValue, ReportColumn, ReportTable } from './report-table';

const L = az.reports;
const C = L.columns;

const countColumns: ReportColumn[] = RUN_COUNT_KEYS.map((k) => ({ label: L.counts[k], type: 'int' }));
const countCells = (c: RunCounts): CellValue[] => RUN_COUNT_KEYS.map((k) => c[k]);
const measureColumns: ReportColumn[] = [
  { label: L.measures.completionPercent, type: 'decimal' },
  { label: L.measures.averageScore, type: 'decimal' },
];

/** The summary export: the measures, then the daily trend (Spec decision 17). */
export function summaryTables(s: ReportSummary): ReportTable[] {
  return [
    {
      title: L.sheets.summary,
      columns: [{ label: C.measure, type: 'text', width: 24 }, { label: C.value, type: 'number' }],
      rows: [...RUN_COUNT_KEYS.map((k): CellValue[] => [L.counts[k], s.counts[k]]), [L.measures.completionPercent, s.completionPercent], [L.measures.averageScore, s.averageScore]],
    },
    {
      title: L.sheets.trend,
      columns: [{ label: C.date, type: 'date' }, { label: L.counts.due, type: 'int' }, { label: L.counts.completed, type: 'int' }, { label: L.measures.completionPercent, type: 'decimal' }],
      rows: s.trend.map((d) => [d.date, d.due, d.completed, d.completionPercent]),
    },
  ];
}

export function sitesTable(rows: SiteReportRow[]): ReportTable {
  return {
    title: L.sheets.sites,
    columns: [{ label: C.site, type: 'text', width: 24 }, { label: C.path, type: 'text', width: 30 }, { label: C.active, type: 'bool' }, ...countColumns, ...measureColumns],
    rows: rows.map((r) => [r.name, r.path.join(' › '), r.active, ...countCells(r), r.completionPercent, r.averageScore]),
  };
}

export function employeesTable(rows: EmployeeReportRow[]): ReportTable {
  return {
    title: L.sheets.employees,
    columns: [{ label: C.employee, type: 'text', width: 24 }, { label: C.active, type: 'bool' }, ...countColumns, ...measureColumns],
    rows: rows.map((r) => [r.name, r.active, ...countCells(r), r.completionPercent, r.averageScore]),
  };
}

/** "İcralar", or "İcralar (Buraxılmış)" for one bucket. */
export const runsTitle = (bucket: RunBucket): string => (bucket === 'all' ? L.sheets.runs : `${L.sheets.runs} (${L.buckets[bucket]})`);

/** Device start and completion beside the server receipt (FR-10.14), with the late and clock-suspect flags (spec §8). */
export function runsTable(rows: ReportRun[], title: string): ReportTable {
  return {
    title,
    columns: [
      { label: C.date, type: 'date' },
      { label: C.dueAt, type: 'datetime' },
      { label: C.checklist, type: 'text', width: 24 },
      { label: C.site, type: 'text', width: 20 },
      { label: C.status, type: 'text' },
      { label: C.assignees, type: 'text', width: 30 },
      { label: C.executor, type: 'text', width: 20 },
      { label: C.startedAt, type: 'datetime' },
      { label: C.completedAt, type: 'datetime' },
      { label: C.completedReceivedAt, type: 'datetime' },
      { label: C.score, type: 'decimal' },
      { label: C.problemCount, type: 'int' },
      { label: C.criticalCount, type: 'int' },
      { label: C.late, type: 'bool' },
      { label: C.clockSuspect, type: 'bool' },
    ],
    rows: rows.map((r) => [
      r.localDate,
      r.dueAt,
      r.checklist.name,
      r.site.name,
      az.scheduling.statuses[r.status],
      r.assignees.map((a) => a.fullName).join(', '),
      r.executor?.fullName ?? null,
      r.startedAt,
      r.completedAt,
      r.completedReceivedAt,
      r.score,
      r.problemCount,
      r.criticalCount,
      r.late,
      r.clockSuspect,
    ]),
  };
}

export function problemsTable(rows: ReportProblem[]): ReportTable {
  return {
    title: L.sheets.problems,
    columns: [
      { label: C.date, type: 'date' },
      { label: C.site, type: 'text', width: 20 },
      { label: C.checklist, type: 'text', width: 24 },
      { label: C.item, type: 'text', width: 30 },
      { label: C.severity, type: 'text' },
      { label: C.source, type: 'text' },
      { label: C.note, type: 'text', width: 40 },
      { label: C.executor, type: 'text', width: 20 },
      { label: C.recordedAt, type: 'datetime' },
      { label: C.resolution, type: 'text' },
      { label: C.taskStatus, type: 'text' },
    ],
    rows: rows.map((p) => [
      p.localDate,
      p.siteName,
      p.checklistName,
      p.itemLabel,
      az.executions.severities[p.severity],
      az.executions.problemSources[p.source],
      p.note,
      p.executorName,
      p.createdAt,
      az.tasks.resolutions[p.resolution],
      p.taskStatus ? az.tasks.statuses[p.taskStatus] : null,
    ]),
  };
}

export function tasksTable(rows: ReportTask[]): ReportTable {
  return {
    title: L.sheets.tasks,
    columns: [
      { label: C.title, type: 'text', width: 30 },
      { label: C.site, type: 'text', width: 20 },
      { label: C.assignee, type: 'text', width: 24 },
      { label: C.status, type: 'text' },
      { label: C.priority, type: 'text' },
      { label: C.due, type: 'datetime' },
      { label: C.completed, type: 'datetime' },
      { label: C.overdue, type: 'bool' },
    ],
    rows: rows.map((x) => [
      x.title,
      x.site?.name ?? null,
      x.assignee?.fullName ?? x.team?.name ?? null,
      az.tasks.statuses[x.status],
      az.tasks.priorities[x.priority],
      x.dueAt,
      x.completedAt,
      x.overdue,
    ]),
  };
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- export/`
Expected: PASS. (If TypeScript reports that `cellText` does not return on every path, add `default: return String(v);` as the last case.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/reports/export
git commit -m "feat(api): add the export table model, the Azerbaijani report tables and the CSV writer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The Excel and PDF writers, with the embedded Noto Sans font

**Files:**
- Create: `apps/api/src/reports/export/xlsx.ts`, `apps/api/src/reports/pdf/pdf-document.ts`
- Create (binary, committed): `apps/api/src/reports/pdf/fonts/NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `OFL.txt`
- Test: `apps/api/src/reports/export/xlsx.test.ts`, `apps/api/src/reports/pdf/pdf-document.test.ts`
- Modify: `apps/api/package.json` (dependencies; the `build` script copies the fonts)

**Interfaces:**
- Consumes: Task 13 (`ReportDocument`, `ReportTable`, `ReportColumn`, `CellValue`, `cellText`, `formatDate`, `formatInstant`, `wallClock`); `az.reports.pdf`, `az.reports.yes` / `no`.
- Produces: `toXlsx(doc: ReportDocument): Promise<Buffer>`, `sheetName(title: string, used: Set<string>): string`; `toPdf(doc: ReportDocument): Promise<Buffer>`, `pdfDefinition(doc: ReportDocument): TDocumentDefinitions`, `FONTS_DIR: string`. Both writers are pure (no database), so Task 15 only feeds them documents.

**Library notes (checked against the published packages on 2026-10-14):**
- `write-excel-file@4.1.1`: `import writeXlsxFile, { type Cell, type Row, type Sheet } from 'write-excel-file/node'`; several sheets = an array of `{ sheet, data, columns, stickyRowsCount }`; a cell is `{ type: String | Number | Date, value, format?, fontWeight? }`; `.toBuffer()` gives a `Buffer`. Dates are written as UTC serial numbers, hence `wallClock` for tenant times.
- `pdfmake@0.3.11` (Node): `import pdfmake from 'pdfmake'` (CommonJS `module.exports = new pdfmake()`; a default import, because the instance's methods live on its prototype and a namespace import would not copy them), then `pdfmake.setFonts({ … })`, `pdfmake.setUrlAccessPolicy(…)`, `pdfmake.setLocalAccessPolicy(…)` and `await pdfmake.createPdf(definition).getBuffer()`. Fonts are file paths; without both access policies pdfmake prints a warning on every document. Types: `@types/pdfmake@0.3.3` (`import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'`).
- `read-excel-file@9.3.12` (tests): `import readXlsxFile from 'read-excel-file/node'` returns `[{ sheet, data }]`; date cells come back as `Date`, numbers as `number`.
- `unpdf@1.8.1` (tests): `import { extractText } from 'unpdf'`; `await extractText(new Uint8Array(buf), { mergePages: true })` returns `{ text }`.

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @taskop/api add pdfmake@^0.3.11 write-excel-file@^4.1.1
pnpm --filter @taskop/api add -D @types/pdfmake@^0.3.3 read-excel-file@^9.3.12 unpdf@^1.8.1
```

None of them runs an install script, so `pnpm-workspace.yaml`'s `allowBuilds` needs no entry.

- [ ] **Step 2: Commit the fonts**

The fonts come from the npm tarball of `@expo-google-fonts/noto-sans@0.4.2` (Google Fonts' static Noto Sans instances, SIL OFL 1.1, Latin Extended: ə Ə ğ Ğ ı İ ş Ş ç Ç ö Ö ü Ü):

```bash
FONTS_TMP=$(mktemp -d)
(cd "$FONTS_TMP" && npm pack @expo-google-fonts/noto-sans@0.4.2 --silent && tar xzf expo-google-fonts-noto-sans-0.4.2.tgz)
mkdir -p apps/api/src/reports/pdf/fonts
cp "$FONTS_TMP/package/400Regular/NotoSans_400Regular.ttf" apps/api/src/reports/pdf/fonts/NotoSans-Regular.ttf
cp "$FONTS_TMP/package/700Bold/NotoSans_700Bold.ttf" apps/api/src/reports/pdf/fonts/NotoSans-Bold.ttf
cp "$FONTS_TMP/package/LICENSE_FONT" apps/api/src/reports/pdf/fonts/OFL.txt
rm -rf "$FONTS_TMP"
shasum -a 256 apps/api/src/reports/pdf/fonts/*.ttf
head -3 apps/api/src/reports/pdf/fonts/OFL.txt
```

Expected:

```
13a813c49624ae3ba3c5c6e72c5ebffc4b9e1e6ea32f421c04069b037c6ad431  apps/api/src/reports/pdf/fonts/NotoSans-Bold.ttf
fe8c022f48d8dd29f17b744d16f9346f4357e16f7d4f7be58b000ae7c291b614  apps/api/src/reports/pdf/fonts/NotoSans-Regular.ttf
Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

(Both files are about 630 KB. If npm is unreachable, the same family is at `https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf` and `…/NotoSans-Bold.ttf`, with the licence at `https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/main/OFL.txt`; those files have other checksums, so record the new ones in the commit message.)

In `apps/api/package.json`, the `build` script becomes (swc compiles TypeScript only, so the fonts are copied next to the compiled `pdf-document.js`):

```json
    "build": "swc src -d dist --strip-leading-paths --config-file .swcrc && node -e \"require('node:fs').cpSync('src/reports/pdf/fonts', 'dist/reports/pdf/fonts', { recursive: true })\"",
```

- [ ] **Step 3: Write the failing tests**

`apps/api/src/reports/export/xlsx.test.ts`:

```ts
import readXlsxFile from 'read-excel-file/node';
import { describe, expect, it } from 'vitest';
import type { ReportDocument, ReportTable } from './report-table';
import { sheetName, toXlsx } from './xlsx';

const doc = (sections: ReportTable[]): ReportDocument => ({
  title: 'T', tenantName: 'Acme MMC', from: '2026-11-02', to: '2026-11-04', filters: [], generatedAt: new Date('2026-11-04T08:00:00Z'), timezone: 'Asia/Baku', sections,
});

describe('XLSX writer', () => {
  it('writes one sheet per section with typed number, date and time cells', async () => {
    const out = await toXlsx(doc([
      {
        title: 'Obyektlər',
        columns: [
          { label: 'Obyekt', type: 'text' }, { label: 'Planlaşdırılıb', type: 'int' }, { label: 'Tamamlanma faizi', type: 'decimal' },
          { label: 'Tarix', type: 'date' }, { label: 'Son vaxt', type: 'datetime' }, { label: 'Aktiv', type: 'bool' },
        ],
        rows: [
          ['Zona A1', 7, 57.1, '2026-11-02', '2026-11-02T07:00:00.000Z', true],
          ['Zona A2', 5, null, null, null, false],
        ],
      },
      { title: 'Gündəlik', columns: [{ label: 'Tarix', type: 'date' }], rows: [] },
    ]));
    const sheets = await readXlsxFile(out);
    expect(sheets.map((s) => s.sheet)).toEqual(['Obyektlər', 'Gündəlik']);
    const [header, a1, a2] = sheets[0]!.data;
    expect(header).toEqual(['Obyekt', 'Planlaşdırılıb', 'Tamamlanma faizi', 'Tarix', 'Son vaxt', 'Aktiv']);
    expect([a1![0], a1![1], a1![2], a1![3], a1![5]]).toEqual(['Zona A1', 7, 57.1, new Date('2026-11-02T00:00:00.000Z'), 'Bəli']);
    // 07:00Z is 11:00 in Baku: the cell holds the tenant's wall clock. Excel stores a fraction of a day, so allow a millisecond.
    expect(a1![4]).toBeInstanceOf(Date);
    expect(Math.abs(+(a1![4] as unknown as Date) - +new Date('2026-11-02T11:00:00.000Z'))).toBeLessThan(1000);
    expect(a2).toEqual(['Zona A2', 5, null, null, null, 'Xeyr']);
    expect(sheets[1]!.data).toEqual([['Tarix']]);
  });

  it('keeps sheet names valid (31 characters, no []:*?/\\) and unique', () => {
    const used = new Set<string>();
    expect(sheetName('İcralar [a/b]: *?', used)).toBe('İcralar  a b');
    expect(sheetName('X'.repeat(40), used)).toBe('X'.repeat(31));
    expect(sheetName('X'.repeat(40), used)).toBe(`${'X'.repeat(28)} 2`);
    expect(sheetName('Problemlər', used)).toBe('Problemlər');
    expect(sheetName('Problemlər', used)).toBe('Problemlər 2');
  });
});
```

`apps/api/src/reports/pdf/pdf-document.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import { extractText } from 'unpdf';
import { describe, expect, it } from 'vitest';
import type { ReportDocument } from '../export/report-table';
import { FONTS_DIR, toPdf } from './pdf-document';

const doc: ReportDocument = {
  title: 'Xülasə hesabatı',
  tenantName: 'Acme MMC',
  from: '2026-11-02',
  to: '2026-11-04',
  filters: ['Obyekt: Zona A1'],
  generatedAt: new Date('2026-11-04T08:00:00Z'),
  timezone: 'Asia/Baku',
  sections: [
    { title: 'Xülasə', columns: [{ label: 'Göstərici', type: 'text' }, { label: 'Dəyər', type: 'number' }], rows: [['Tamamlanma faizi', 53.8], ['Planlaşdırılıb', 15], ['Orta bal', null]] },
    { title: 'Tapşırıqlar', columns: [{ label: 'Başlıq', type: 'text' }], rows: [] },
  ],
};

describe('PDF writer', () => {
  it('ships Noto Sans regular and bold with their licence', () => {
    expect(readdirSync(FONTS_DIR).sort()).toEqual(['NotoSans-Bold.ttf', 'NotoSans-Regular.ttf', 'OFL.txt']);
  });

  it('prints the header, every section and Azerbaijani letters', async () => {
    const out = await toPdf(doc);
    expect(out.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { text } = await extractText(new Uint8Array(out), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of [
      'Acme MMC', 'Xülasə hesabatı', 'Dövr: 02.11.2026 – 04.11.2026', 'Filtrlər: Obyekt: Zona A1', 'Hazırlanma vaxtı: 04.11.2026 12:00',
      'Tamamlanma faizi 53.8', 'Planlaşdırılıb 15', 'Orta bal —', 'Tapşırıqlar', 'Məlumat yoxdur.', 'Səhifə 1 / 1',
    ]) {
      expect(flat, s).toContain(s);
    }
  });

  it('says "yoxdur" without filters', async () => {
    const { text } = await extractText(new Uint8Array(await toPdf({ ...doc, filters: [] })), { mergePages: true });
    expect(text.replace(/\s+/g, ' ')).toContain('Filtrlər: yoxdur');
  });
});
```

- [ ] **Step 4: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- xlsx pdf-document`
Expected: FAIL: `./xlsx` and `./pdf-document` do not exist.

- [ ] **Step 5: Implement**

`apps/api/src/reports/export/xlsx.ts`:

```ts
import { az } from '@taskop/i18n';
import writeXlsxFile, { type Cell, type Row, type Sheet } from 'write-excel-file/node';
import { type CellValue, type ReportColumn, type ReportDocument, wallClock } from './report-table';

const FORBIDDEN = /[\\/?*[\]:]/g;
const MAX_NAME = 31;

/** An Excel-valid sheet name (at most 31 characters, none of \ / ? * [ ] :), unique within `used`. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(FORBIDDEN, ' ').trim().slice(0, MAX_NAME) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base.slice(0, MAX_NAME - 3)} ${i}`;
  used.add(name);
  return name;
}

/** Typed cells, so people can sort and sum (spec §5.4). Dates hold the tenant's wall clock (Spec decision 21). */
function xlsxCell(col: ReportColumn, v: CellValue, tz: string): Cell {
  if (v === null) return null;
  switch (col.type) {
    case 'text':
      return { type: String, value: String(v) };
    case 'int':
      return { type: Number, value: v as number, format: '0' };
    case 'decimal':
      return { type: Number, value: v as number, format: '0.0' };
    case 'number':
      return { type: Number, value: v as number };
    case 'date': {
      const [y, m, d] = (v as string).split('-').map(Number) as [number, number, number];
      return { type: Date, value: new Date(Date.UTC(y, m - 1, d)), format: 'dd.mm.yyyy' };
    }
    case 'datetime':
      return { type: Date, value: wallClock(v as string, tz), format: 'dd.mm.yyyy hh:mm' };
    case 'bool':
      return { type: String, value: v ? az.reports.yes : az.reports.no };
  }
}

const widthOf = (c: ReportColumn): number => c.width ?? (c.type === 'datetime' ? 17 : c.type === 'text' ? 18 : 12);

/** One sheet per section, a bold frozen header row (spec §5.4). */
export function toXlsx(doc: ReportDocument): Promise<Buffer> {
  const used = new Set<string>();
  const sheets: Sheet<Buffer>[] = doc.sections.map((t) => ({
    sheet: sheetName(t.title, used),
    data: [
      t.columns.map((c): Cell => ({ type: String, value: c.label, fontWeight: 'bold' })),
      ...t.rows.map((r): Row => r.map((v, i) => xlsxCell(t.columns[i]!, v, doc.timezone))),
    ],
    columns: t.columns.map((c) => ({ width: widthOf(c) })),
    stickyRowsCount: 1,
  }));
  return writeXlsxFile(sheets).toBuffer();
}
```

`apps/api/src/reports/pdf/pdf-document.ts`:

```ts
import path from 'node:path';
import { az } from '@taskop/i18n';
import pdfmake from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { cellText, formatDate, formatInstant, type ReportDocument, type ReportTable } from '../export/report-table';

/** Noto Sans regular and bold (SIL OFL 1.1, see fonts/OFL.txt); `pnpm build` copies them next to the compiled file. */
export const FONTS_DIR = path.join(__dirname, 'fonts');
const REGULAR = path.join(FONTS_DIR, 'NotoSans-Regular.ttf');
const BOLD = path.join(FONTS_DIR, 'NotoSans-Bold.ttf');

// Every variant maps to a file, so a style can never ask for a missing font.
pdfmake.setFonts({ NotoSans: { normal: REGULAR, bold: BOLD, italics: REGULAR, bolditalics: BOLD } });
// Documents are built from our own data: no URL is ever fetched and only the two font files are read.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((p) => p === REGULAR || p === BOLD);

const L = az.reports.pdf;

function section(t: ReportTable, tz: string): Content[] {
  if (!t.rows.length) return [{ text: t.title, style: 'section' }, { text: L.empty, style: 'muted' }];
  const header: TableCell[] = t.columns.map((c) => ({ text: c.label, bold: true, fillColor: '#eeeeee' }));
  const body: TableCell[][] = t.rows.map((r) =>
    r.map((v, i) => {
      const col = t.columns[i]!;
      return { text: cellText(col, v, tz) || az.reports.noValue, alignment: col.type === 'text' ? 'left' : 'right' };
    }),
  );
  return [
    { text: t.title, style: 'section' },
    { table: { headerRows: 1, widths: t.columns.map(() => '*'), body: [header, ...body] }, layout: 'lightHorizontalLines', fontSize: t.columns.length > 10 ? 6.5 : 8 },
  ];
}

/** A4 landscape; header: tenant, title, period, filters, generation time (spec §5.4); one heading per section. */
export function pdfDefinition(doc: ReportDocument): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 28, 28, 36],
    info: { title: `${doc.title} ${doc.from}_${doc.to}`, creator: 'Taskop' },
    defaultStyle: { font: 'NotoSans', fontSize: 8 },
    styles: {
      tenant: { fontSize: 14, bold: true },
      title: { fontSize: 11, margin: [0, 2, 0, 6] },
      section: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      muted: { color: '#666666' },
    },
    footer: (current, total) => ({
      text: L.page.replace('{{page}}', String(current)).replace('{{pages}}', String(total)),
      alignment: 'right',
      margin: [28, 8, 28, 0],
      fontSize: 7,
      color: '#666666',
    }),
    content: [
      { text: doc.tenantName, style: 'tenant' },
      { text: doc.title, style: 'title' },
      { text: `${L.period}: ${formatDate(doc.from)} – ${formatDate(doc.to)}` },
      { text: `${L.filters}: ${doc.filters.length ? doc.filters.join('; ') : L.noFilters}` },
      { text: `${L.generatedAt}: ${formatInstant(doc.generatedAt, doc.timezone)}`, style: 'muted' },
      ...doc.sections.flatMap((s) => section(s, doc.timezone)),
    ],
  };
}

export function toPdf(doc: ReportDocument): Promise<Buffer> {
  return pdfmake.createPdf(pdfDefinition(doc)).getBuffer();
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test -- xlsx pdf-document export/`
Expected: PASS. (If TypeScript reports that `xlsxCell` does not return on every path, add `default: return { type: String, value: String(v) };`.)

- [ ] **Step 7: Check the build ships the fonts**

Run: `pnpm --filter @taskop/api build && ls apps/api/dist/reports/pdf/fonts`
Expected: `NotoSans-Bold.ttf  NotoSans-Regular.ttf  OFL.txt`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/reports/export/xlsx.ts apps/api/src/reports/export/xlsx.test.ts apps/api/src/reports/pdf
git commit -m "feat(api): add the Excel and PDF writers with embedded Noto Sans" -m "Noto Sans 400/700 from @expo-google-fonts/noto-sans@0.4.2 (SIL OFL 1.1)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: `GET /reports/:kind/export`: row cap, audit, files

**Files:**
- Create: `apps/api/src/reports/report-exporter.ts`
- Modify: `apps/api/src/reports/reports.controller.ts`, `dto.ts`, `reports.module.ts`
- Test: `apps/api/test/reports-export.test.ts`

**Interfaces:**
- Consumes: `ReportsService.guarded` (Task 8); `ReportQueries.summary`, `sites`, `employees`, `runs`, `countRuns`, `problems`, `problemCounts`, `tasks`, `taskCounts` (Tasks 8–11); the tables and writers (Tasks 13–14); `AuditService.record`; `REPORT_CONTENT_TYPES`, `reportFileName`, `reportExportKindSchema`, `reportExportQuerySchema`, `ReportExportParams`, `REPORT_LIMITS.exportRowCap`.
- Produces: `interface ExportedFile { body: Buffer; contentType: string; filename: string }`, `ReportExporter.export(p: Principal, kind: ReportExportKind, q: ReportExportParams): Promise<ExportedFile>`, and `GET /reports/:kind/export` (`reports.view` + `reports.export`) answering a `StreamableFile` with `Content-Type`, `Content-Disposition` and `Content-Length`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/reports-export.test.ts`:

```ts
import { parse } from 'csv-parse/sync';
import readXlsxFile from 'read-excel-file/node';
import { extractText } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff } from './fixtures';
import { ownerQuery } from './owner-db';
import { addChecklist, addSite, PERIOD, qs, REPORT_NOW, reportBase, type ReportWorld, reportWorld } from './report-fixtures';
import type { Api } from './scheduling-fixtures';

describe('report exports (spec §5.4)', () => {
  const clock = new FakeClock(REPORT_NOW);
  let t: TestApp;
  let w: ReportWorld;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await reportWorld(t);
  });
  afterAll(() => t.close());

  const file = async (api: Api, kind: string, q: Record<string, string | undefined>) => {
    const res = await api.get(`/api/v1/reports/${kind}/export?${qs(q)}`).responseType('blob');
    expect(res.status, String(res.body)).toBe(200);
    return { body: res.body as Buffer, type: res.headers['content-type'] as string, disposition: res.headers['content-disposition'] as string };
  };
  const csvRows = (b: Buffer) => parse(b.toString('utf8'), { bom: true }) as string[][];
  const pdfText = async (b: Buffer) => (await extractText(new Uint8Array(b), { mergePages: true })).text.replace(/\s+/g, ' ');

  it('exports runs as CSV with a BOM, Azerbaijani labels and both completion times', async () => {
    const f = await file(w.owner, 'runs', { ...PERIOD, format: 'csv' });
    expect(f.type).toBe('text/csv; charset=utf-8');
    expect(f.disposition).toBe('attachment; filename="taskop-runs-2026-11-02_2026-11-04.csv"');
    expect([...f.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = csvRows(f.body);
    expect(rows[0]).toEqual([
      'Tarix', 'Son vaxt', 'Yoxlama vərəqəsi', 'Obyekt', 'Status', 'İcraçılar', 'İcra edən', 'Başlanıb', 'Tamamlanıb (cihaz)', 'Serverə çatıb', 'Bal', 'Problemlər', 'Kritik', 'Gecikmə ilə', 'Saat şübhəli',
    ]);
    expect(rows).toHaveLength(17);
    // r7: done on the phone at 11:00 Baku on Monday, received by the server on Wednesday at 09:00 (FR-10.14).
    expect(rows.find((r) => r[9] === '04.11.2026 09:00')).toEqual([
      '02.11.2026', '02.11.2026 10:00', 'Açılış yoxlaması', 'Zona A1', 'Tamamlanıb', 'Aynur Quliyeva', 'Aynur Quliyeva', '02.11.2026 08:10', '02.11.2026 11:00', '04.11.2026 09:00', '90.0', '0', '0', 'Bəli', 'Xeyr',
    ]);
  });

  it('keeps problem notes intact and neutralises formulas in CSV', async () => {
    const rows = csvRows((await file(w.owner, 'problems', { ...PERIOD, format: 'csv' })).body);
    expect(rows.map((r) => r[6])).toEqual(['Qeyd', '', "'=1+2", 'Kondisioner, "xarab"\nyenisi lazımdır', 'Qapı sınıqdır']);
  });

  it('exports the full report as one Excel sheet per section with typed cells', async () => {
    const f = await file(w.owner, 'full', { ...PERIOD, format: 'xlsx' });
    expect(f.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(f.disposition).toBe('attachment; filename="taskop-full-2026-11-02_2026-11-04.xlsx"');
    const sheets = await readXlsxFile(f.body);
    expect(sheets.map((s) => [s.sheet, s.data.length])).toEqual([
      ['Xülasə', 13], ['Gündəlik', 4], ['Obyektlər', 5], ['Əməkdaşlar', 6],
      ['Gecikmiş icralar', 2], ['Yarımçıq icralar', 2], ['Buraxılmış icralar', 4], ['Problemlər', 5], ['Tapşırıqlar', 10],
    ]);
    const sites = sheets[2]!.data;
    expect(sites[2]!.slice(0, 4)).toEqual(['Zona A1', 'Filial A', 'Bəli', 7]);
    expect(sites[2]![sites[0]!.indexOf('Tamamlanma faizi')]).toBe(57.1);
    expect(sheets[1]!.data[1]).toEqual([new Date('2026-11-02T00:00:00.000Z'), 6, 4, 66.7]);
    // r10 (the first missed run) was due at 10:00 Baku: a Date cell on the tenant's wall clock.
    const due = sheets[6]!.data[1]![1] as unknown as Date;
    expect(due).toBeInstanceOf(Date);
    expect(Math.abs(+due - +new Date('2026-11-03T10:00:00.000Z'))).toBeLessThan(1000);
  });

  it('exports a PDF with the tenant, the period, the filters and Azerbaijani labels', async () => {
    const f = await file(w.owner, 'summary', { ...PERIOD, siteId: w.sites.zoneA1, format: 'pdf' });
    expect(f.type).toBe('application/pdf');
    expect(f.disposition).toBe('attachment; filename="taskop-summary-2026-11-02_2026-11-04.pdf"');
    expect(f.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = await pdfText(f.body);
    for (const s of ['Acme MMC', 'Xülasə hesabatı', 'Dövr: 02.11.2026 – 04.11.2026', 'Filtrlər: Obyekt: Zona A1', 'Hazırlanma vaxtı: 04.11.2026 12:00', 'Tamamlanma faizi 57.1', 'Gündəlik']) {
      expect(text, s).toContain(s);
    }
  });

  it('exports within the caller’s scope and filters, and audits each export', async () => {
    const rows = csvRows((await file(w.leyla.api, 'runs', { ...PERIOD, format: 'csv', bucket: 'missed', siteId: w.sites.branchA })).body);
    expect(rows.slice(1).map((r) => r[3])).toEqual(['Zona A1', 'Zona A1']);
    const audit = await ownerQuery<{ entity_type: string; entity_id: string | null; after: unknown }>(
      "select entity_type, entity_id, after from audit_log where tenant_id = $1 and action = 'reports.exported' and actor_user_id = $2",
      [w.s.tenantId, w.leyla.id],
    );
    expect(audit.rows).toEqual([
      {
        entity_type: 'report',
        entity_id: null,
        after: { kind: 'runs', format: 'csv', filters: { from: '2026-11-02', to: '2026-11-04', siteId: w.sites.branchA, userId: null, checklistId: null, bucket: 'missed', severity: null }, rows: 2 },
      },
    ]);
  });

  it('produces header-only files for an empty period', async () => {
    const empty = { from: '2026-12-01', to: '2026-12-01' };
    expect(csvRows((await file(w.owner, 'runs', { ...empty, format: 'csv' })).body)).toHaveLength(1);
    expect((await readXlsxFile((await file(w.owner, 'tasks', { ...empty, format: 'xlsx' })).body)).map((s) => s.data.length)).toEqual([1]);
    expect(await pdfText((await file(w.owner, 'problems', { ...empty, format: 'pdf' })).body)).toContain('Məlumat yoxdur.');
  });

  it('refuses CSV for the full report, unknown kinds and callers without reports.export', async () => {
    const csv = await w.owner.get(`/api/v1/reports/full/export?${qs({ ...PERIOD, format: 'csv' })}`);
    expect([csv.status, csv.body.error.code, csv.body.error.fields]).toEqual([400, 'VALIDATION_FAILED', { format: 'reports.issues.fullNotCsv' }]);
    expect((await w.owner.get(`/api/v1/reports/attendance/export?${qs({ ...PERIOD, format: 'csv' })}`)).status).toBe(404);
    expect((await w.owner.get(`/api/v1/reports/runs/export?${qs(PERIOD)}`)).status).toBe(400);
    // Rauf has reports.view but not reports.export.
    expect((await w.rauf.api.get(`/api/v1/reports/runs/export?${qs({ ...PERIOD, format: 'csv' })}`)).status).toBe(403);
    const viewOnly = await w.owner.post('/api/v1/roles', { name: 'Hesabat baxışı', dataScope: 'all', permissions: ['reports.view'] });
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: viewOnly.body.id as string, emailVerified: true });
    const api = as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    expect((await api.get(`/api/v1/reports/summary?${qs(PERIOD)}`)).status).toBe(200);
    expect((await api.get(`/api/v1/reports/summary/export?${qs({ ...PERIOD, format: 'pdf' })}`)).status).toBe(403);
  });

  it('refuses more than 10,000 rows with 422 before building the file, and audits nothing', async () => {
    const b = await reportBase(t);
    const site = await addSite(b, 'Böyük filial');
    const checklist = await addChecklist(b, 'Yoxlama');
    await ownerQuery(
      `with a as (
         insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, status, created_by_user_id)
         select gen_random_uuid(), $1, $2, $3, '{}'::jsonb, '{}'::jsonb, 'ended', $4 from generate_series(1, 10001)
         returning id)
       insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status, checklist_version_id)
       select gen_random_uuid(), $1, a.id, $2, $3, '2026-11-03', '2026-11-03T04:00:00Z', '2026-11-03T06:00:00Z', '2026-11-03T07:00:00Z', 'missed', $5 from a`,
      [b.s.tenantId, checklist.id, site, b.s.ownerId, checklist.versionId],
    );
    const runs = await b.owner.get(`/api/v1/reports/runs/export?${qs({ ...PERIOD, format: 'xlsx' })}`);
    expect([runs.status, runs.body.error.code, runs.body.error.rows, runs.body.error.limit]).toEqual([422, 'REPORT_TOO_LARGE', 10001, 10000]);
    const full = await b.owner.get(`/api/v1/reports/full/export?${qs({ ...PERIOD, format: 'pdf' })}`);
    expect([full.status, full.body.error.rows]).toEqual([422, 10001]);
    // The site table has one row: fine.
    expect((await file(b.owner, 'sites', { ...PERIOD, format: 'csv' })).body.length).toBeGreaterThan(0);
    expect((await ownerQuery("select after->>'kind' as kind from audit_log where tenant_id = $1 and action = 'reports.exported'", [b.s.tenantId])).rows).toEqual([{ kind: 'sites' }]);
  }, 60_000);
});
```

(In superagent under Node, `.responseType('blob')` buffers any body into a `Buffer`, whatever its type.)

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- reports-export`
Expected: FAIL: `GET /api/v1/reports/runs/export` answers 404.

- [ ] **Step 3: Implement the exporter**

`apps/api/src/reports/report-exporter.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { REPORT_CONTENT_TYPES, REPORT_LIMITS, type ReportExportKind, type ReportExportParams, type ReportTaskCounts, reportFileName, type RunBucket } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { eq, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { checklists, sites, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { TaskScope } from '../tasks/task-scope';
import { toCsv } from './export/csv';
import type { ReportDocument, ReportTable } from './export/report-table';
import { employeesTable, problemsTable, runsTable, runsTitle, sitesTable, summaryTables, tasksTable } from './export/report-tables';
import { toXlsx } from './export/xlsx';
import { toPdf } from './pdf/pdf-document';
import type { ResolvedFilters } from './report-filters';
import { ReportQueries } from './report-queries';
import { ReportsService } from './reports.service';

export interface ExportedFile {
  body: Buffer;
  contentType: string;
  filename: string;
}

/** The full report's run sections, one per bucket (spec §5.4). */
const FULL_RUN_BUCKETS = ['overdue', 'partial', 'missed'] as const satisfies readonly RunBucket[];

/** Spec §5.4: refuses before any rows are read when a list section is over the cap (Spec decision 18). */
function assertCap(rows: number): void {
  if (rows > REPORT_LIMITS.exportRowCap) throw new AppError('REPORT_TOO_LARGE', { details: { rows, limit: REPORT_LIMITS.exportRowCap } });
}

const taskTotal = (c: ReportTaskCounts): number => Object.values(c.byStatus).reduce((a, b) => a + b, 0);

@Injectable()
export class ReportExporter {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly queries: ReportQueries,
    private readonly scheduling: SchedulingScope,
    private readonly taskScope: TaskScope,
  ) {}

  async export(p: Principal, kind: ReportExportKind, q: ReportExportParams): Promise<ExportedFile> {
    if (kind === 'full' && q.format === 'csv') throw new AppError('VALIDATION_FAILED', { fields: { format: 'reports.issues.fullNotCsv' } });
    return this.reports.guarded(q, async (f) => {
      const sections = await this.sections(p, kind, f, q);
      const doc: ReportDocument = {
        title: az.reports.titles[kind],
        tenantName: f.tenantName,
        from: f.from,
        to: f.to,
        filters: await this.filterLabels(kind, f, q),
        generatedAt: f.now,
        timezone: f.timezone,
        sections,
      };
      const body = q.format === 'csv' ? toCsv(doc) : q.format === 'xlsx' ? await toXlsx(doc) : await toPdf(doc);
      // In the request's transaction: a failed export records nothing (Spec decision 20).
      await this.audit.record({
        action: 'reports.exported',
        entityType: 'report',
        entityId: null,
        after: {
          kind,
          format: q.format,
          filters: {
            from: q.from,
            to: q.to,
            siteId: q.siteId ?? null,
            userId: q.userId ?? null,
            checklistId: q.checklistId ?? null,
            bucket: kind === 'runs' ? (q.bucket ?? 'all') : null,
            severity: kind === 'problems' ? (q.severity ?? null) : null,
          },
          rows: sections.reduce((n, s) => n + s.rows.length, 0),
        },
      });
      return { body, contentType: REPORT_CONTENT_TYPES[q.format], filename: reportFileName(kind, q.from, q.to, q.format) };
    });
  }

  private async sections(p: Principal, kind: ReportExportKind, f: ResolvedFilters, q: ReportExportParams): Promise<ReportTable[]> {
    const occ: SQL | undefined = this.scheduling.occurrences(p);
    const taskScope = this.taskScope.readable(p);
    switch (kind) {
      case 'summary':
        return summaryTables(await this.queries.summary(f, occ));
      case 'sites': {
        const rows = await this.queries.sites(f, occ);
        assertCap(rows.length);
        return [sitesTable(rows)];
      }
      case 'employees': {
        const rows = await this.queries.employees(f, occ);
        assertCap(rows.length);
        return [employeesTable(rows)];
      }
      case 'runs': {
        const bucket = q.bucket ?? 'all';
        assertCap(await this.queries.countRuns(f, occ, bucket));
        return [runsTable((await this.queries.runs(f, occ, bucket, { limit: null })).items, runsTitle(bucket))];
      }
      case 'problems': {
        assertCap((await this.queries.problemCounts(f, occ, q.severity)).total);
        return [problemsTable((await this.queries.problems(f, occ, q.severity, { limit: null })).items)];
      }
      case 'tasks': {
        assertCap(taskTotal(await this.queries.taskCounts(f, taskScope)));
        return [tasksTable((await this.queries.tasks(f, taskScope, { limit: null })).items)];
      }
      case 'full': {
        // Every list section is counted before any rows are read.
        const siteRows = await this.queries.sites(f, occ);
        const employeeRows = await this.queries.employees(f, occ);
        const runCounts: number[] = [];
        for (const b of FULL_RUN_BUCKETS) runCounts.push(await this.queries.countRuns(f, occ, b));
        const problemTotal = (await this.queries.problemCounts(f, occ, undefined)).total;
        const taskCount = taskTotal(await this.queries.taskCounts(f, taskScope));
        assertCap(Math.max(siteRows.length, employeeRows.length, ...runCounts, problemTotal, taskCount));
        const runSections: ReportTable[] = [];
        for (const b of FULL_RUN_BUCKETS) runSections.push(runsTable((await this.queries.runs(f, occ, b, { limit: null })).items, az.reports.sheets[b]));
        return [
          ...summaryTables(await this.queries.summary(f, occ)),
          sitesTable(siteRows),
          employeesTable(employeeRows),
          ...runSections,
          problemsTable((await this.queries.problems(f, occ, undefined, { limit: null })).items),
          tasksTable((await this.queries.tasks(f, taskScope, { limit: null })).items),
        ];
      }
    }
  }

  /** "Obyekt: Zona A1"-style lines for the PDF header; names as they are now. */
  private async filterLabels(kind: ReportExportKind, f: ResolvedFilters, q: ReportExportParams): Promise<string[]> {
    const tx = this.db.tx();
    const F = az.reports.filters;
    const out: string[] = [];
    if (f.siteId) {
      const [s] = await tx.select({ name: sites.name }).from(sites).where(eq(sites.id, f.siteId));
      out.push(`${F.site}: ${s?.name ?? az.reports.noValue}`);
    }
    if (f.userId) {
      const [u] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, f.userId));
      out.push(`${F.employee}: ${u?.name ?? az.reports.noValue}`);
    }
    if (f.checklistId) {
      const [c] = await tx.select({ name: checklists.name }).from(checklists).where(eq(checklists.id, f.checklistId));
      out.push(`${F.checklist}: ${c?.name ?? az.reports.noValue}`);
    }
    if (kind === 'runs' && q.bucket && q.bucket !== 'all') out.push(`${F.bucket}: ${az.reports.buckets[q.bucket]}`);
    if (kind === 'problems' && q.severity) out.push(`${F.severity}: ${az.executions.severities[q.severity]}`);
    return out;
  }
}
```

- [ ] **Step 4: Wire the controller, the DTO and the module**

In `apps/api/src/reports/dto.ts`, add `reportExportQuerySchema` to the contracts import and append:

```ts
export class ReportExportQueryDto extends createZodDto(reportExportQuerySchema) {}
```

In `apps/api/src/reports/reports.controller.ts`:
- the imports become:

```ts
import { Controller, Get, Inject, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type EmployeeReportRow,
  type Page,
  REPORT_CONTENT_TYPES,
  REPORT_EXPORT_KINDS,
  reportExportKindSchema,
  type ReportProblems,
  type ReportRun,
  type ReportSummary,
  type ReportTasks,
  type SiteReportRow,
} from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import type { Principal } from '../common/request';
import {
  EmployeeReportRowResponse,
  ReportExportQueryDto,
  ReportFiltersDto,
  ReportProblemsQueryDto,
  ReportProblemsResponse,
  ReportRunPageResponse,
  ReportRunsQueryDto,
  ReportSummaryResponse,
  ReportTasksQueryDto,
  ReportTasksResponse,
  SiteReportRowResponse,
} from './dto';
import { ReportExporter } from './report-exporter';
import { ReportsService } from './reports.service';
```

- the constructor becomes:

```ts
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportExporter) private readonly exporter: ReportExporter,
  ) {}
```

- add this handler last:

```ts
  /** Spec §5.4: the whole file in one response; `full` takes xlsx or pdf. An unknown kind is 404. */
  @Get(':kind/export')
  @RequirePermission('reports.view', 'reports.export')
  @ApiParam({ name: 'kind', enum: REPORT_EXPORT_KINDS })
  @ApiProduces(...Object.values(REPORT_CONTENT_TYPES))
  @ApiOkResponse({ description: 'The report file', schema: { type: 'string', format: 'binary' } })
  async export(@CurrentPrincipal() p: Principal, @Param('kind') kind: string, @Query() q: ReportExportQueryDto): Promise<StreamableFile> {
    const parsed = reportExportKindSchema.safeParse(kind);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    const file = await this.exporter.export(p, parsed.data, q);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `attachment; filename="${file.filename}"`, length: file.body.length });
  }
```

In `apps/api/src/reports/reports.module.ts`, add `import { ReportExporter } from './report-exporter';` and `ReportExporter` to `providers`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test -- reports-`
Expected: PASS, every `reports-*` file. (The handler returns after `TenantContextInterceptor` commits the transaction with the audit row; Nest then writes the `StreamableFile` with its headers.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/reports apps/api/test/reports-export.test.ts
git commit -m "feat(api): export reports as CSV, Excel and PDF with the row cap and an audit entry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The performance seed and the 500 ms timing check (spec §9)

**Files:**
- Create: `apps/api/src/scripts/seed-report-volume.ts`, `apps/api/test/perf/time-reports.ts`
- Modify: `apps/api/package.json` (scripts `db:seed-report-volume`, `perf:reports`)

**Interfaces:**
- Consumes: the six endpoints; `seedTenantDefaults`, `siteLabel`, `GLOBAL_TEMPLATE_FIXTURES`; `addDays`, `localDateOf`, `regenerateIds` from contracts.
- Produces:
  - `seedReportVolume(url: string): Promise<void>`: tenant `perf` ("Perf MMC", Asia/Baku) with 50 sites (5 branches with 9 zones each), 200 workers (4 per site), owner `perf-owner@taskop.test` and `site_subtree` manager `perf-manager@taskop.test` (password `PerfPassword123`, linked to "Filial 1"), 200 assignments and one occurrence per assignment per day for the last 366 days (73,200 runs; about 80 % completed, 8 % missed, 7 % partial, 5 % cancelled, today's pending), executions for completed and partial runs, problems on about 5 % of executions (a fifth critical) and 2,000 tasks. Idempotent: an existing `perf` tenant is left alone.
  - `test/perf/time-reports.ts`: times every report endpoint for 7-, 31- and 366-day ranges as the owner (`all`) and the manager (`site_subtree`), prints the median of 5 runs per endpoint, and exits 1 when any 366-day median is ≥ 500 ms.

- [ ] **Step 1: Write the seed**

`apps/api/src/scripts/seed-report-volume.ts`:

```ts
import { hash } from '@node-rs/argon2';
import { addDays, localDateOf, regenerateIds } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { uuidv7 } from 'uuidv7';
import * as schema from '../db/schema';
import { GLOBAL_TEMPLATE_FIXTURES } from '../db/scripts/seed-templates';
import { seedTenantDefaults } from '../tenancy/bootstrap';
import { siteLabel } from '../tenancy/sites.service';

const TZ = 'Asia/Baku';
const BRANCHES = 5;
const ZONES_PER_BRANCH = 9;
const WORKERS = 200;
const ASSIGNMENTS_PER_SITE = 4;
const DAYS = 366;
const TASKS = 2000;
const PASSWORD = 'PerfPassword123';
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

/**
 * SP7 spec §9 performance data. Set-based SQL on the owner connection (bypasses RLS); about a minute on a laptop.
 * Statuses are spread with a hash of (assignment, day), so a re-created database gets the same mix.
 */
export async function seedReportVolume(url: string): Promise<void> {
  const db = drizzle(url, { schema });
  try {
    const [existing] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.orgCode, 'perf'));
    if (existing) {
      console.log('Tenant "perf" already exists; nothing to do.');
      return;
    }
    const today = localDateOf(new Date(), TZ);
    const first = addDays(today, 1 - DAYS);
    const tenantId = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(schema.tenants).values({ id: tenantId, name: 'Perf MMC', orgCode: 'perf', timezone: TZ });
      const roleIds = await seedTenantDefaults(tx, tenantId);
      const types = await tx.select().from(schema.siteTypes).where(eq(schema.siteTypes.tenantId, tenantId));
      const typeId = (name: string) => types.find((x) => x.name === name)!.id;

      const siteIds: string[] = [];
      const branchIds: string[] = [];
      for (let b = 1; b <= BRANCHES; b++) {
        const branchId = uuidv7();
        await tx.insert(schema.sites).values({ id: branchId, tenantId, typeId: typeId('Filial'), name: `Filial ${b}`, path: siteLabel(branchId) });
        branchIds.push(branchId);
        siteIds.push(branchId);
        for (let z = 1; z <= ZONES_PER_BRANCH; z++) {
          const id = uuidv7();
          await tx.insert(schema.sites).values({ id, tenantId, parentId: branchId, typeId: typeId('Zona'), name: `Filial ${b} / Zona ${z}`, path: `${siteLabel(branchId)}.${siteLabel(id)}` });
          siteIds.push(id);
        }
      }

      const passwordHash = await hash(PASSWORD, ARGON);
      const ownerId = uuidv7();
      await tx.insert(schema.users).values({
        id: ownerId, tenantId, fullName: 'Perf Sahib', roleId: roleIds.owner, kind: 'staff', email: 'perf-owner@taskop.test',
        credentialHash: passwordHash, credentialKind: 'password', status: 'active', emailVerifiedAt: new Date(),
      });
      const managerId = uuidv7();
      await tx.insert(schema.users).values({
        id: managerId, tenantId, fullName: 'Perf Menecer', roleId: roleIds.manager, kind: 'staff', email: 'perf-manager@taskop.test',
        credentialHash: passwordHash, credentialKind: 'password', status: 'active', emailVerifiedAt: new Date(), managerId: ownerId,
      });
      await tx.insert(schema.userSites).values({ tenantId, userId: managerId, siteId: branchIds[0]! });

      const pinHash = await hash('482915', ARGON);
      const workerIds: string[] = [];
      for (let i = 0; i < WORKERS; i++) {
        const id = uuidv7();
        const n = String(i + 1).padStart(3, '0');
        workerIds.push(id);
        await tx.insert(schema.users).values({ id, tenantId, fullName: `İşçi ${n}`, roleId: roleIds.worker, kind: 'worker', username: `p${n}`, credentialHash: pinHash, credentialKind: 'pin', status: 'active', managerId });
        await tx.insert(schema.userSites).values({ tenantId, userId: id, siteId: siteIds[i % siteIds.length]! });
      }

      const checklistId = uuidv7();
      const versionId = uuidv7();
      await tx.insert(schema.checklists).values({ id: checklistId, tenantId, name: 'Gündəlik yoxlama', createdByUserId: ownerId });
      await tx.insert(schema.checklistVersions).values({
        id: versionId, tenantId, checklistId, content: regenerateIds(GLOBAL_TEMPLATE_FIXTURES[0]!.build()), createdByUserId: ownerId,
        state: 'published', number: 1, changeNote: 'Perf', publishedByUserId: ownerId, publishedAt: new Date(),
      });
      await tx.update(schema.checklists).set({ currentVersionId: versionId, latestVersionNumber: 1 }).where(eq(schema.checklists.id, checklistId));

      // Four assignments per site, each with two of the site's four workers.
      for (let s = 0; s < siteIds.length; s++) {
        const here = workerIds.filter((_, i) => i % siteIds.length === s);
        for (let k = 0; k < ASSIGNMENTS_PER_SITE; k++) {
          const id = uuidv7();
          await tx.insert(schema.assignments).values({ id, tenantId, checklistId, siteId: siteIds[s]!, schedule: {}, timing: {}, status: 'ended', createdByUserId: ownerId });
          await tx.insert(schema.assignmentAssignees).values([here[k % here.length]!, here[(k + 1) % here.length]!].map((userId) => ({ tenantId, assignmentId: id, userId })));
        }
      }

      await tx.execute(sql`
        insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status, status_changed_at, checklist_version_id)
        select gen_random_uuid(), a.tenant_id, a.id, a.checklist_id, a.site_id, d::date,
               (d::date + time '08:00') at time zone ${TZ}, (d::date + time '10:00') at time zone ${TZ}, (d::date + time '11:00') at time zone ${TZ},
               (case when d::date = ${today}::date then 'pending'
                     when h.v < 80 then 'completed' when h.v < 88 then 'missed' when h.v < 95 then 'partial' else 'cancelled' end)::occurrence_status,
               (d::date + time '11:00') at time zone ${TZ}, ${versionId}
          from assignments a
          cross join generate_series(${first}::date, ${today}::date, interval '1 day') d
          cross join lateral (select abs(hashtext(a.id::text || d::text)) % 100 as v) h
         where a.tenant_id = ${tenantId}`);
      await tx.execute(sql`
        insert into occurrence_assignees (tenant_id, occurrence_id, user_id)
        select o.tenant_id, o.id, aa.user_id from occurrences o join assignment_assignees aa on aa.assignment_id = o.assignment_id
         where o.tenant_id = ${tenantId}`);
      await tx.execute(sql`
        insert into executions (id, tenant_id, occurrence_id, checklist_version_id, executor_user_id, state, started_at, started_received_at,
                                completed_at, completed_received_at, last_synced_at, progress, score, device)
        select gen_random_uuid(), o.tenant_id, o.id, o.checklist_version_id,
               (select min(oa.user_id::text)::uuid from occurrence_assignees oa where oa.occurrence_id = o.id),
               (case when o.status = 'completed' then 'completed' else 'partial' end)::execution_state,
               o.starts_at + interval '15 minutes', o.starts_at + interval '16 minutes',
               case when o.status = 'completed' then o.starts_at + interval '50 minutes' end,
               case when o.status = 'completed' then o.starts_at + interval '51 minutes' end,
               o.starts_at + interval '51 minutes',
               '{"answered":10,"total":10,"requiredMissing":0}'::jsonb,
               jsonb_build_object('earned', 0, 'possible', 0, 'percent', 50 + abs(hashtext(o.id::text)) % 51, 'problems', '[]'::jsonb),
               '{"platform":"android","osVersion":"15","appVersion":"1.0.0"}'::jsonb
          from occurrences o
         where o.tenant_id = ${tenantId} and o.status in ('completed', 'partial')`);
      await tx.execute(sql`
        insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity, note)
        select gen_random_uuid(), x.tenant_id, x.id, x.occurrence_id, o.site_id, o.checklist_id, gen_random_uuid(), 'manual',
               (case when abs(hashtext(x.id::text)) % 5 = 0 then 'critical' else 'normal' end)::problem_severity, 'Yoxlama zamanı problem'
          from executions x join occurrences o on o.id = x.occurrence_id
         where x.tenant_id = ${tenantId} and abs(hashtext(x.id::text || 'p')) % 20 = 0`);
      await tx.execute(sql`
        insert into tasks (id, tenant_id, title, created_by_user_id, assignee_user_id, site_id, status, due_at, overdue_at, completed_at, created_at, updated_at)
        select gen_random_uuid(), ${tenantId}, 'Tapşırıq ' || g, ${ownerId},
               (${workerIds}::uuid[])[1 + g % ${WORKERS}], (${siteIds}::uuid[])[1 + g % ${siteIds.length}],
               s.status::task_status, s.due,
               case when s.status not in ('completed', 'cancelled') and s.due < now() then s.due end,
               case when s.status = 'completed' then s.due - interval '1 hour' end,
               s.due - interval '2 days', s.due - interval '2 days'
          from generate_series(1, ${TASKS}) g
          cross join lateral (
            select (array['new', 'accepted', 'in_progress', 'awaiting_review', 'completed', 'completed', 'cancelled'])[1 + g % 7] as status,
                   ((${first}::date + (g % ${DAYS})) + time '12:00') at time zone ${TZ} as due
          ) s`);
    });
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from occurrences where tenant_id = ${tenantId}`)).rows as [{ n: number }];
    console.log(`Tenant "perf" created: ${n} occurrences from ${first} to ${today}.`);
    console.log(`  Owner (all):            perf-owner@taskop.test / ${PASSWORD}`);
    console.log(`  Manager (site_subtree): perf-manager@taskop.test / ${PASSWORD} (Filial 1 and its zones)`);
  } finally {
    await db.$client.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('DATABASE_OWNER_URL is required');
  await seedReportVolume(url);
}

// Run only as a script (tsx seed-report-volume.ts), not when imported.
if (process.argv[1]?.endsWith('seed-report-volume.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Write the timing script**

`apps/api/test/perf/time-reports.ts`:

```ts
/**
 * SP7 spec §9 performance check against a running API on the seeded "perf" tenant:
 *   pnpm --filter @taskop/api db:seed-report-volume
 *   pnpm --filter @taskop/api dev                      (another terminal)
 *   pnpm --filter @taskop/api perf:reports [baseUrl]
 * Prints the median of 5 timed runs (after one warm-up) per endpoint, range and principal; exits 1 when any 366-day
 * median is at or above the 500 ms target.
 */
import { addDays, localDateOf } from '@taskop/contracts';

const BASE = process.argv[2] ?? 'http://localhost:3000/api/v1';
const TARGET_MS = 500;
const RUNS = 5;
const RANGES = [7, 31, 366];
const ENDPOINTS = ['summary', 'sites', 'employees', 'runs', 'problems', 'tasks'];
const PASSWORD = 'PerfPassword123';

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login/staff`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, client: 'web' }) });
  if (!res.ok) throw new Error(`Login ${email} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function timed(token: string, path: string): Promise<number> {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return performance.now() - started;
}

async function main(): Promise<void> {
  const today = localDateOf(new Date(), 'Asia/Baku');
  const principals: [string, string][] = [
    ['all', await login('perf-owner@taskop.test')],
    ['site_subtree', await login('perf-manager@taskop.test')],
  ];
  const rows: { scope: string; days: number; endpoint: string; medianMs: number }[] = [];
  for (const [scope, token] of principals) {
    for (const days of RANGES) {
      for (const endpoint of ENDPOINTS) {
        const path = `/reports/${endpoint}?from=${addDays(today, 1 - days)}&to=${today}`;
        await timed(token, path);
        const samples: number[] = [];
        for (let i = 0; i < RUNS; i++) samples.push(await timed(token, path));
        samples.sort((a, b) => a - b);
        rows.push({ scope, days, endpoint, medianMs: Math.round(samples[Math.floor(RUNS / 2)]!) });
      }
    }
  }
  console.table(rows);
  const slow = rows.filter((r) => r.days === 366 && r.medianMs >= TARGET_MS);
  if (slow.length) {
    console.error(`Over the ${TARGET_MS} ms target at 366 days: ${slow.map((r) => `${r.scope} ${r.endpoint} ${r.medianMs} ms`).join(', ')}`);
    process.exit(1);
  }
  console.log(`Every endpoint is under ${TARGET_MS} ms at 366 days.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

In `apps/api/package.json`, add to `scripts`:

```json
    "db:seed-report-volume": "tsx --env-file=.env src/scripts/seed-report-volume.ts",
    "perf:reports": "tsx test/perf/time-reports.ts",
```

- [ ] **Step 3: Check both scripts compile and lint**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint`
Expected: PASS (`test/` is in the API's `tsconfig.json`; `time-reports.ts` is not a `*.test.ts`, so Vitest never runs it).

- [ ] **Step 4: Seed and time**

```bash
docker compose up -d
pnpm --filter @taskop/api db:setup
pnpm --filter @taskop/api db:seed-report-volume
pnpm --filter @taskop/api dev
```

In another terminal: `pnpm --filter @taskop/api perf:reports`
Expected: the seed prints `Tenant "perf" created: 73200 occurrences …`; the timing script prints its table and `Every endpoint is under 500 ms at 366 days.` (exit 0). Keep the printed table: Task 17 records it.

- [ ] **Step 5: Only if an endpoint misses the target**

Find the slow statement: `docker compose exec postgres psql -U taskop_owner taskop -c "alter system set log_min_duration_statement = 300" -c "select pg_reload_conf()"`, re-run `perf:reports`, copy the logged SQL from `docker compose logs postgres`, and run it with `explain (analyze, buffers)` in `psql` after `select set_config('app.tenant_id', '<perf tenant id>', false)`. Add an index only for the plan node that dominates. The likely candidate is the problems aggregation of `runsCte` (a sequential scan of `execution_problems`); then, in `apps/api/src/db/schema.ts`, `executionProblems`' index list gains:

```ts
    // Report problem counts per run (SP7 spec §9 performance check).
    index('execution_problems_occurrence_idx').on(t.tenantId, t.occurrenceId),
```

and `pnpm --filter @taskop/api exec drizzle-kit generate --name reports_perf` writes `0015_reports_perf.sql`. Re-run Steps 4–5 until the target holds, then reset the logging with `alter system reset log_min_duration_statement` and `select pg_reload_conf()`. Add `apps/api/drizzle` and the schema change to the commit below.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/scripts/seed-report-volume.ts apps/api/test/perf/time-reports.ts
git commit -m "test(api): add the report volume seed and the 500 ms timing check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: OpenAPI, the full run and the performance notes

**Files:**
- Modify: `apps/api/test/openapi.test.ts`, this plan file (section **Performance results** at the end)

**Interfaces:**
- Consumes: everything above.
- Produces: the report paths in the OpenAPI document (`/api/docs-json`), a green run of every package this part touched, and the recorded timings.

- [ ] **Step 1: Write the test**

In `apps/api/test/openapi.test.ts`, append inside `describe('OpenAPI', …)`:

```ts
  it('documents the report paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/reports/summary',
        '/api/v1/reports/sites',
        '/api/v1/reports/employees',
        '/api/v1/reports/runs',
        '/api/v1/reports/problems',
        '/api/v1/reports/tasks',
        '/api/v1/reports/{kind}/export',
      ]),
    );
    expect(Object.keys(res.body.paths['/api/v1/reports/{kind}/export'].get.responses['200'].content)).toEqual(
      expect.arrayContaining(['text/csv; charset=utf-8', 'application/pdf']),
    );
  });
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @taskop/api test -- openapi`
Expected: PASS (Tasks 8–15 registered the controller with `@ApiTags('reports')`, `@ApiOkResponse` DTOs and `@ApiProduces`). If the `content` assertion fails because the swagger plugin lists the produced types elsewhere, assert on `res.body.paths['/api/v1/reports/{kind}/export'].get.produces ?? …` as the document shows, never drop the path assertion.

- [ ] **Step 3: Run the full suite**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test && pnpm typecheck && pnpm lint`
Expected: PASS: every API test file, including the eight new `reports-*` files, the five export unit tests and the extended `roles`, `error.filter`, `permission.guard`, `config` and `openapi` tests; the repo-wide typecheck and lint (web and mobile included: this part only added contract fields and keys).

- [ ] **Step 4: Try it locally**

```bash
docker compose up -d
pnpm --filter @taskop/api db:setup
pnpm --filter @taskop/api db:seed
pnpm --filter @taskop/api dev
```

In another terminal:

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login/staff -H 'content-type: application/json' \
  -d '{"email":"manager@demo.taskop.az","password":"DemoPassword123","client":"web"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
TODAY=$(node -pe 'new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Baku"}).format(new Date())')
curl -s "localhost:3000/api/v1/reports/summary?from=2026-01-01&to=$TODAY" -H "Authorization: Bearer $TOKEN"
curl -s -OJ "localhost:3000/api/v1/reports/full/export?from=2026-01-01&to=$TODAY&format=pdf" -H "Authorization: Bearer $TOKEN"
```

Expected: a summary JSON with the demo run (Leyla is a Manager, so she has `reports.view` after the backfill) and a file `taskop-full-2026-01-01_<today>.pdf` in the current directory that opens with Azerbaijani text. Delete the PDF afterwards.

- [ ] **Step 5: Record the performance results**

Append to the end of this plan file a section `## Performance results` with the date, the machine (CPU, RAM), the Postgres version, the table printed by `perf:reports` in Task 16 (scope, days, endpoint, median ms) and, if Task 16 Step 5 added an index, which query needed it and its time before and after.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/openapi.test.ts docs/superpowers/plans/2026-10-14-reports-1-api.md
git commit -m "test(api): document the report paths and record the report timings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (spec section → task):
- §3.1 buckets, completion %, average score → Task 1 (`classifyRun`, `completionPercent`, `averageScore`); SQL and cross-check → Task 8 (`countColumns`, `agrees with classifyRun…` for the fixture and for every status).
- §3.2 period membership: runs by `local_date` (Task 8), problems by their occurrence's day (Task 11), tasks by tenant-local due day or creation day (Task 11, incl. Berlin DST); inclusive range, `to − from ≤ 365` → Tasks 1, 2, 8.
- §3.3 attribution, the Unassigned row, the over-count → Task 1 (`attributeRun`), Task 9 (employees), Task 8 / 10 (`userId` filter).
- §3.4 task measures → Task 11 (`taskCounts`).
- §4 keys, defaults, backfill → Tasks 3 and 6; scope helpers, subtree filter, out-of-scope = empty, `own` scope, 403 → Tasks 8–12 (suite in Task 12); Team-tab visibility rule → *Interfaces*.
- §5.1 module layout → Tasks 8 (`report-filters`, `report-queries`, `reports.service`, `reports.controller`, `reports.module`), 13–15 (`export/`, `pdf/`, `report-exporter`).
- §5.2 validation → Tasks 2 and 8; §5.3 six endpoints and keyset paging → Tasks 8–11; §5.4 exports (CSV, XLSX, PDF, full report, file names, Azerbaijani labels, tenant times with device and server receipt, 10,000-row cap with count first, audit) → Tasks 13–15; §5.5 timeout and error codes → Tasks 3, 4, 8; §5.6 run detail → Task 7 (verified, then widened); §5.7 indexes → Task 6 (Spec decision 24).
- §8 edge cases: deactivated users and sites (Task 9), scoring-off checklist (fixture `Anbar sayımı`, Tasks 8–9), rejected executions (r16, Tasks 8–10), open runs at period end (r16 counts as in progress and due), clock-suspect flag in the list and exports (Tasks 10, 13), one snapshot per request (one transaction), empty period (Tasks 8, 15).
- §9 API tests: fixture tenant (Task 8), number checks and cross-check (Tasks 8–11), scope suite (Task 12), exports incl. 422 / 400 / 503 / audit (Tasks 8, 15), performance seed, timing script and 500 ms target (Task 16), results in the final task's notes (Task 17).
- §6 and §7 (web, mobile) → Parts 2 and 3, against *Interfaces for Parts 2 and 3*; the gap they needed (`severity` on problems, `completed` / `in_progress` buckets, run-detail access) is closed here.

**Placeholder scan:** every code step carries its code. The conditional lines are exact alternatives for a toolchain difference (exhaustive `switch` defaults in Tasks 1, 10, 13, 14; the swagger `produces` shape in Task 17) or a measured outcome (the optional index in Task 16 Step 5, with its code).

**Type consistency:** `ResolvedFilters` (Task 8) is what every `ReportQueries` method takes; `runs(f, scope, bucket, { cursor?, limit })`, `problems(f, scope, severity, { cursor?, limit })` and `tasks(f, scope, { cursor?, limit })` have the same shapes in Tasks 10, 11 and 15; `limit: null` means "every row" everywhere. `ReportsService.guarded(q, fn)` (Task 8) is reused by `ReportExporter` (Task 15). `ReportTable` / `ReportDocument` / `CellValue` (Task 13) feed `toCsv`, `toXlsx` and `toPdf` (Tasks 13–14). The fixture names (`reportWorld`, `reportBase`, `addSite`, `addChecklist`, `addRun`, `addProblem`, `addTask`, `counts`, `qs`, `PERIOD`, `REPORT_NOW`, `RunKey`, `TaskKey`) are defined in Task 8 before any later test uses them.

**Review Focus:** each of the five lines has its test in the owning task: lost claims (Tasks 8, 9), DST days (Tasks 1, 8, 11, 13), moved sites (Task 9), spreadsheet-hostile text (Tasks 13, 15), empty periods (Tasks 8, 15).
