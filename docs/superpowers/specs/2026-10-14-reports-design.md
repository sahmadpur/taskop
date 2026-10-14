# Taskop — Sub-project 7: Dashboards, Reports and Export — Design Spec

- **Date:** 2026-10-14
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf`: FR-16.01–04 (manager on mobile), FR-17.01–05 (web monitoring dashboard), FR-18.01–13 (reports and export), FR-05.04 ("hesabatlara baxış" right), FR-10.13–14 (actual vs sync time in reports), FR-04.11 (history of deactivated users kept)
- **Builds on:**
  - `2026-10-07-foundation-design.md`: RLS, roles, data scopes.
  - `2026-10-09-scheduling-assignment-design.md`: occurrences, statuses, `SchedulingScope`, tenant-local days.
  - `2026-10-09-mobile-execution-design.md`: executions, `score`, `execution_problems`, device vs server times.
  - `2026-10-12-tasks-design.md`: tasks, `TaskScope`, problem resolution.
  - `2026-10-13-notifications-design.md` (PR #6).
- **Prerequisite:** merge PR #6 (SP6 notifications) into `main` and bring this branch up to date before implementation starts. SP7 doesn't use SP6 features, but both touch `packages/contracts` permissions, `packages/i18n` and the migration sequence.

## 1. Context and decisions

Sub-projects 3–6 produce all the operational data: scheduled runs (`occurrences`), what was done (`executions` with a frozen `score`), problems found (`execution_problems`) and follow-up work (`tasks`). Sub-project 7 lets people see it. It adds:

- a live dashboard on the web home page;
- a Reports page that compares sites and employees and lists the runs that went wrong;
- PDF, Excel and CSV export;
- a read-only "Team" tab for managers on the phone.

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| "Automatic reports" (FR-18.01) | **On-demand only.** Reports are always available for any period and are computed live when opened or exported. No scheduled emails, no stored snapshots. |
| Computation | **Live SQL over the existing tables.** No rollup tables or materialized views. Numbers always match `/schedule`. Revisit only if the performance check (§9) fails. |
| Completion % | **Completed ÷ due.** Due = planned (not cancelled) runs whose `due_at` has passed. Runs not yet due don't count. Average score % is a separate measure. |
| Employee attribution | **Executed runs go to the executor; unexecuted runs go to every assignee.** A run completed by a colleague doesn't count for the other assignees. |
| Mobile (FR-16) | **A Team tab.** Count tiles, a filterable run list and a read-only run detail screen. Online only. No export on mobile. |
| Export | **Server-side in the API.** CSV is written by hand, XLSX uses `write-excel-file`, PDF uses `pdfmake` with an embedded Noto Sans font. Synchronous streamed download. |
| Charts | `recharts` on the web dashboard only: the daily completion trend. Everything else is tiles and tables. |
| Permissions | New `reports.view` and `reports.export`, both following the viewer's existing data scope. |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A `reports.view` holder opens the web home page and sees, for a chosen period and filters, counts of:
   - planned, completed, in-progress, overdue and problem runs;
   - completion % and average score;
   - a daily trend;
   - what needs attention right now (FR-17.01–05).
2. The Reports page shows:
   - a summary;
   - a site comparison and an employee comparison;
   - overdue, partial and missed runs;
   - problems;
   - task status.

   Each is available for today, this week, this month or any custom range, in the tenant's timezone (FR-18.02–12).
3. A `reports.export` holder downloads any report table as CSV, Excel or PDF, and the full period report as Excel or PDF (FR-18.13).
4. A manager (scope wider than `own`) opens the Team tab on the phone and sees their people's runs by status, then opens any run read-only (FR-16.01–04).
5. Every number respects the viewer's data scope. Filters narrow it and never widen it (FR-16.04, FR-25.04).

**Non-goals:**

- Scheduled or emailed reports, stored report snapshots.
- Per-question or per-item analytics. Score trend per checklist item.
- Attendance (FR-22), KPI (FR-21) and plan-vs-actual targets (FR-20) reports. These belong to SP9.
- Audit reports (FR-19.07–08). These belong to SP8.
- Notification delivery analytics.
- Export from mobile. Offline caching of team data.
- Charts inside PDF exports.
- Custom report builders or saved report definitions. A URL with filters is the "saved report".

## 3. Metric definitions

One pure module, `packages/contracts/src/report-logic.ts`, defines these rules. The SQL in §5 implements the same rules, and tests check the two agree (§9).

### 3.1 Run buckets

Every occurrence in the period falls into one or more of these buckets, based on its `status`:

| Measure | Rule |
|---|---|
| Planned | `status <> 'cancelled'` |
| Due | Planned **and** (`due_at <= now()` **or** Completed) — see below |
| Completed | `status in ('completed', 'audit_pending', 'audited')` |
| In progress | `status in ('started', 'in_progress')` |
| Pending | `status = 'pending'` (not yet due) |
| Overdue | `status = 'overdue'`: past due, not started, window still open |
| Partial | `status = 'partial'` |
| Missed | `status = 'missed'` |
| Cancelled | `status = 'cancelled'`. Shown only in the runs list with the "all" bucket, and excluded from every count above. |
| With problems | At least one `execution_problems` row for the occurrence. `critical` = at least one row with `severity = 'critical'`. |

Derived measures:

- **Completion %** = Completed ÷ Due × 100, rounded to one decimal. It is `null` when Due = 0 and is shown as "—".
  - A completed run whose `due_at` is still in the future, because it finished early, counts in both the numerator and the denominator, so the result never exceeds 100%. That is why Due includes Completed.
- **Average score %** = mean of `executions.score->>'percent'` over the period's non-rejected executions where it isn't null. It is `null` when there are none.

`classifyRun({status, dueAt, hasProblems, hasCritical}, now)` returns the bucket flags. `completionPercent(completed, due)` and `averageScore(values)` complete the module.

### 3.2 Period membership

- **Runs** belong to a period by `occurrences.local_date`, the tenant-local day the run is scheduled for. Late offline syncs therefore land on the day the work belonged to (FR-10.13). Nothing is cached, so a late sync updates that past day the next time anyone asks.
- **Problems** belong to a period by their occurrence's `local_date`, the same rule as `/problems`.
- **Tasks** belong to a period by `due_at` converted to the tenant-local day, falling back to `created_at` when there is no due date.

`from` and `to` are tenant-local dates and both are inclusive. `to - from` is at most 365 days, so a range covers at most 366 days.

### 3.3 Employee attribution

For the employee table and the `userId` filter:

- A run that has a non-rejected execution (completed, partial or in progress) belongs **only to its executor** (`executions.executor_user_id`).
- A run with no execution (pending, overdue or missed) belongs to **every user in its assignee snapshot** (`occurrence_assignees`), and counts once for each of them.
- A run with no execution and no assignees belongs to a synthetic **"Unassigned"** row in the employee table. A `userId` filter never matches it.
- Cancelled runs belong to nobody in the employee table.

Consequence: summing the employee table's Planned column can exceed the site table's total, because a missed run with three assignees counts three times. The UI notes this under the employee table.

### 3.4 Task measures

Counted over tasks in the period (§3.2):

- by status: `new`, `accepted`, `in_progress`, `awaiting_review`, `completed`, `cancelled`;
- **Overdue open:** not completed or cancelled, and `overdue_at is not null`;
- **Completed on time:** `completed_at <= due_at`, or no due date;
- **Completed late:** `completed_at > due_at`.

## 4. Permissions and scope

- New keys in `packages/contracts/src/permissions.ts`:
  - `reports.view`: dashboard, Reports page, Team tab.
  - `reports.export`: file downloads. Also requires `reports.view`.
- `SYSTEM_ROLES` defaults add both keys to Manager and Auditor (Owner and Admin already get `ALL_PERMISSIONS`). A migration inserts the matching `role_permissions` rows for the existing system roles in every tenant. Worker gets neither. Custom roles get them only when an admin adds them.
- **Scope** comes from the viewer's role `data_scope`, applied with the existing helpers:
  - runs and problems: `SchedulingScope.occurrences(principal)`;
  - tasks: `TaskScope.readable(principal)`.
  - Both fail closed on an unknown scope.
- `own` scope with `reports.view`, which only happens if an admin grants it to a worker-scoped role: the reports show only the viewer's own runs and tasks. The Team tab stays hidden, because it is only shown when the scope is wider than `own`.
- **Filters** are ANDed with the scope:
  - `siteId` matches the site **and its subtree** (`sites.path <@ :path`). This differs from `/schedule`'s exact match, because comparing a branch should include its zones.
  - `userId` follows §3.3.
  - `checklistId` is an exact match.
  - A filter that points outside the viewer's scope returns empty results, not 403. It works like the existing list endpoints.

## 5. API

### 5.1 Module

`apps/api/src/reports/` has no tables of its own:

| File | Role |
|---|---|
| `reports.module.ts` | Wires the controller, service, queries and exporter. Imports scheduling (for `SchedulingScope`) and tasks (for `TaskScope`). |
| `report-filters.ts` | Parses and validates the shared query parameters (zod from contracts). Resolves the `siteId` path and the tenant timezone. |
| `report-queries.ts` | Drizzle/SQL builders, one function per report. They take the filters and a scope condition and return plain rows. |
| `reports.service.ts` | Opens the tenant transaction, sets the statement timeout, applies scope, calls the queries and maps rows to contract shapes. |
| `report-exporter.ts` | `toCsv`, `toXlsx`, `toPdf` for each report kind, plus the full report. |
| `pdf/` | The pdfmake document builder and the Noto Sans font files (regular and bold, with Latin Extended glyphs for ə, ğ, ı, ş, ç, ö, ü). |
| `reports.controller.ts` | The endpoints below. |

### 5.2 Shared query parameters

`from`, `to` (required, `YYYY-MM-DD`), `siteId?`, `userId?`, `checklistId?`.

Validation:
- `from <= to`;
- `to - from <= 365` days, otherwise `400 REPORT_RANGE_TOO_LONG`.

### 5.3 Endpoints

All are `GET` and need `reports.view`. Response schemas live in `packages/contracts/src/reports.ts`, and typed calls in `packages/api-client`.

| Endpoint | Returns |
|---|---|
| `/reports/summary` | `{ counts: {planned, due, completed, inProgress, pending, overdue, partial, missed, withProblems, withCritical}, completionPercent, averageScore, trend: [{date, due, completed, completionPercent}] }`. The trend has one entry per day in the range, with zero days included. |
| `/reports/sites` | `[{ siteId, name, path: [ancestor names], active, ...counts, completionPercent, averageScore }]`, one row per site that has at least one planned run in the period. Not paged. Sorting happens on the client. |
| `/reports/employees` | `[{ userId \| null, name, active, ...counts, completionPercent, averageScore }]`, attributed per §3.3, including the Unassigned row when non-empty. Not paged. |
| `/reports/runs?bucket=overdue\|partial\|missed\|problems\|all&cursor` | Page of 50: `{ occurrenceId, executionId?, localDate, dueAt, checklist, site, status, assignees[], executor?, startedAt?, completedAt?, completedReceivedAt?, score?, problemCount, criticalCount }`. Ordered by `due_at desc, id`. `problems` = with problems. `all` includes cancelled runs. |
| `/reports/problems?cursor` | `{ counts: {total, critical, resolution: {none, open, resolved, cancelled}}, items: page of 50 }`. Each item is a problem with its checklist, site, run date, severity, source, note, and linked task with status. Resolution is derived the same way as in SP5's problems list. |
| `/reports/tasks?cursor` | `{ counts: {byStatus, overdueOpen, completedOnTime, completedLate}, items: page of 50 }`. Each item: title, site, assignee or team, status, priority, due, completed, overdue flag. |

Paging uses keyset cursors in the same format as `/problems`.

### 5.4 Export endpoints

These need `reports.view` **and** `reports.export`.

- `GET /reports/:kind/export?format=csv|xlsx|pdf&…filters[&bucket]`
  - `kind` is one of `summary`, `sites`, `employees`, `runs`, `problems`, `tasks`.
  - List kinds export **all** rows, not just one page.
- `GET /reports/full/export?format=xlsx|pdf&…filters` produces the complete period report:
  - summary and trend table, sites, employees;
  - overdue, partial and missed runs (one section each);
  - problems and tasks.
  - In XLSX each section is its own sheet. In PDF each is a section with a heading.
  - `format=csv` returns 400.

Behaviour:

- **Streaming:** the response has `Content-Type` and `Content-Disposition: attachment; filename="taskop-<kind>-<from>_<to>.<ext>"`.
  - CSV is UTF-8 with a BOM so Excel opens Azerbaijani letters correctly, comma-separated, RFC 4180 quoting.
  - Formula injection is neutralised: cells starting with `=`, `+`, `-`, `@` are prefixed with `'`.
- **Language and dates:** headings, status labels and the PDF header are in Azerbaijani, via `packages/i18n`, the only locale today. The PDF header shows the tenant name, period, filters applied and generation time.
  - Timestamps are shown in the tenant timezone.
  - Run exports include both the device completion time and the server receipt time (FR-10.14).
- **Excel cell types:** numbers and dates are typed cells, not text, so people can sort and sum.
- **Row cap:** 10,000 rows per list section. Above that, `422 REPORT_TOO_LARGE` with `{ rows, limit }`, checked by a count query before generating.
- **Audit:** each export writes an audit-log entry (`reports.exported`, with kind, format and filters). Exports take data out of the system, so they are worth recording.

### 5.5 Guards

- Each report request runs inside `db.withTenant` with `SET LOCAL statement_timeout = '15s'`. A cancelled statement (SQLSTATE `57014`) maps to `503 REPORT_TIMEOUT`.
- New error codes `REPORT_RANGE_TOO_LONG`, `REPORT_TOO_LARGE` and `REPORT_TIMEOUT` are added to the contracts error list and to `packages/i18n` `errors`.

### 5.6 Run detail

The phone's read-only run screen and the web drawers use the existing `GET /executions/:id` (`ExecutionAccess.assertCanRead`) and the occurrence detail the `/schedule` drawer already uses. Media uses `GET /media/:id/url`. No new endpoint is needed.

The plan's first API task checks that a `site_subtree` and a `subordinates` manager can read their people's executions through it. If either can't, the plan widens `assertCanRead` to match `SchedulingScope.occurrences()`.

### 5.7 Indexes

Existing indexes cover the main access paths:
- occurrences by `(tenant, site, starts_at)` and `(tenant, status, due_at)`;
- assignees by user;
- executions by `(tenant, executor, started_at)`;
- problems by `(tenant, site, created_at)`.

Reports filter on `local_date`, so the plan adds `occurrences (tenant_id, local_date)` and `executions (tenant_id, occurrence_id)` if it isn't already covered by the unique constraint. Further indexes are added only when the performance check (§9) asks for them.

## 6. Web

### 6.1 Dashboard at `/`

Shown when the viewer has `reports.view`. Others keep the current welcome page.

- **Filter bar**, shared component `ReportFilters`:
  - period preset (Today by default, Yesterday, This week, This month, Last 7 days, Last 30 days, Custom);
  - site picker (tree, includes the subtree);
  - employee picker;
  - checklist picker;
  - "show inactive" toggle for the pickers.
  - Presets resolve from the tenant's today (`useTenantToday`). Weeks start on Monday.
- **Count tiles:** Planned, Completed, In progress, Overdue, With problems, Completion %, Average score.
  - The Completion % tile's tooltip explains "of runs already due".
  - Each count tile links to `/reports?tab=runs&bucket=…` with the same filters.
- **Trend chart** (recharts `ComposedChart`): due vs completed bars per day, plus a completion % line. Hidden when the period is a single day.
- **"Needs attention" panel:**
  - runs overdue right now (`/reports/runs?bucket=overdue` for today, first 10);
  - critical problems in the period (first 10).
  - Rows open the existing run drawer (`occurrence-dialog`).
- **Refresh:** react-query `refetchInterval: 60_000` while the document is visible, plus a manual refresh button with a "last updated" time.

### 6.2 Reports page at `/reports`

There is a menu entry "Hesabatlar", shown with `reports.view`.

- **Filters:** the same `ReportFilters` bar. All filters, the tab and the bucket live in URL search params (TanStack Router validated search), so a URL is a shareable, bookmarkable report.
- **Tabs:**
  - **Summary:** tiles and trend, the same components as the dashboard.
  - **Sites:** sortable table (§5.3 columns) with the parent path shown under the name and inactive sites marked. Clicking a row sets the `siteId` filter and switches to Summary.
  - **Employees:** sortable table with the Unassigned row and the over-count note (§3.3). Clicking a row sets `userId`.
  - **Runs:** bucket chips (overdue, partial, missed, with problems, all) and a paged table with "load more". A row opens the run drawer.
  - **Problems:** counts by severity and resolution, and a paged list. A row opens the run drawer at its problem. The linked task opens the task drawer.
  - **Tasks:** status count tiles, on-time vs late, and a paged list. A row opens the existing task drawer.
- **Export menu** (shown with `reports.export`):
  - "Bu cədvəl": CSV, Excel or PDF for the current tab;
  - "Tam hesabat": Excel or PDF.
  - The download goes through `api-client` with session auth into a Blob, then an anchor download. The button shows a spinner while the file is built.
  - `REPORT_TOO_LARGE` shows a toast with the row count and a hint to narrow the filters.

### 6.3 Shared pieces

- The run drawer from `/schedule` (`features/scheduling/occurrence-dialog.tsx`) and the task drawer from `/tasks` are reused as they are. If they are tied to their page's state, the plan pulls them into components that take an id and work standalone.
- `features/reports/` holds the pages, `ReportFilters`, `CountTiles`, `TrendChart`, the tables and `queries.ts` (react-query hooks keyed by filters).
- New dependency: `recharts` ^3.10.

## 7. Mobile

### 7.1 Team tab

- **Visibility:** a tab `(app)/team` that exists only when `me.permissions` includes `reports.view` **and** `me.role.dataScope !== 'own'`. Workers never see it.
- **Header:** period chips (Bu gün / 7 gün / 30 gün), then the count tiles from `/reports/summary`: completed, not completed (= due − completed), overdue, partial, with problems, completion % (FR-16.03).
- **Filters:**
  - status chips (all, overdue, partial, missed, with problems), which map to `/reports/runs` buckets;
  - an employee picker filled from the period's `/reports/employees` rows.
- **List:** `/reports/runs` with infinite scroll and pull-to-refresh. Each row shows checklist, site, person, due time, status badge and problem count.
- **Data:** react-query only. Nothing is written to SQLite.
- **Offline:** when offline, the tab shows "Komandanı görmək üçün internetə qoşulun" and a retry button, and caches nothing.

### 7.2 Read-only run screen at `(app)/team/run/[id]`

- **Header:** checklist, site, run date, status; executor; started and completed times (device time, and server receipt time when it differs); score; the late and clock-suspect flags when set.
- **Body:** answers rendered by the execution screen's answer components in read-only mode, followed by the problems with notes and media.
- **Media:** loaded through `GET /media/:id/url`.
- **Unexecuted runs** (overdue or missed): the header and the assignee list, with "Hələ icra edilməyib".

The plan pulls a read-only display out of the existing answer components if they can't render read-only. The worker's execution flow must not change.

## 8. Edge cases

- **Deactivated users and sites** stay in reports with their history (FR-04.11), marked inactive. Pickers hide them unless "show inactive" is on.
- **Checklist with scoring off:** its runs count toward completion but not toward average score. The score cell shows "—".
- **Runs moved between sites:** a run belongs to `occurrences.site_id` as stored, which is the site when the run was materialised.
- **Rejected executions** (a lost claim) are ignored. Only the non-rejected execution counts.
- **Open runs at period end:** an in-progress run in the past that the sweep hasn't closed yet still counts as In progress and Due, not completed. It lowers completion % until it closes.
- **Clock-suspect executions** count normally. The flag is visible in the run list and in exports.
- **Concurrent changes:** each request reads one transaction snapshot, so its numbers are consistent with each other. Two requests a minute apart may differ. That's expected for a live dashboard.
- **Empty period:** counts are 0, percentages "—", tables show an empty state.

## 9. Testing

**Contracts (vitest):**
- `classifyRun` for every status;
- the early-completion denominator rule;
- `completionPercent` null and rounding;
- attribution examples:
  - a shared run completed by one assignee;
  - a missed shared run;
  - an unassigned missed run.

**API (vitest on the test Postgres):**
- **Fixture tenant:** a site tree (branch → two zones), five users including a manager chain, and runs in every status across several days.
  - It includes a three-assignee run completed by one person and a three-assignee missed run.
  - It includes a late offline sync on a past day, critical and normal problems, tasks in every status (overdue, on-time and late completions), a deactivated user and a scoring-off checklist.
- **Number checks:** each report endpoint is checked against hand-counted expected numbers. A cross-check asserts that the SQL bucket counts equal `classifyRun` applied to the same rows.
- **Scope suite:** a `site_subtree` manager and a `subordinates` manager each see only their slice. A `siteId` or `userId` outside scope returns empty results. A worker without `reports.view` gets 403. Export without `reports.export` gets 403.
- **Exports:**
  - CSV parses back to the same rows, has a BOM, and neutralises formulas;
  - XLSX opens (read back with a test-only reader) with the expected sheets, row counts and typed number/date cells;
  - PDF starts with `%PDF`, and its extracted text contains an Azerbaijani string ("Tamamlanma faizi").
  - The row cap returns 422, the range limit returns 400, and a forced timeout returns 503.
  - Each export writes its audit entry.

**Web (vitest + Testing Library):**
- presets resolve against the tenant's today;
- filters round-trip through the URL;
- tiles link to the right bucket;
- a sites row drills down;
- the export menu is hidden without `reports.export` and shows the too-large toast;
- the dashboard shows the welcome page without `reports.view`.

**Web e2e (Playwright):**
1. seeded tenant → dashboard tiles show the seeded numbers;
2. click Overdue → Reports runs tab with the overdue bucket;
3. export Excel → a file is downloaded with the expected name.

**Mobile (jest-expo):**
- Team tab visibility by permission and scope;
- chip → bucket mapping;
- employee filter;
- the offline state;
- the read-only run screen for executed and unexecuted runs;
- the worker execution screen is unchanged (its tests still pass).

**Performance check:**
- `apps/api/src/scripts/seed-report-volume.ts` creates one year of runs for 50 sites and 200 users (about 70k occurrences).
- A test-only script times every report endpoint for 7-, 31- and 366-day ranges as an `all`-scope and a `site_subtree` principal.
- Target: under 500 ms each at 366 days. Indexes are added only for the queries that miss it. The results go into the plan's final task notes.

## 10. Implementation plans

Three plans, following SP5 and SP6:

1. **`2026-10-14-reports-1-api.md`:** contracts (permissions, `report-logic`, response schemas, error codes, i18n keys), the permission migration and indexes, api-client, report queries and endpoints, exporter (CSV, XLSX, PDF, full report), audit, guards, performance check.
   - Its first tasks (contracts, api-client, permission migration) unblock plans 2 and 3.
2. **`2026-10-14-reports-2-mobile.md`:** Team tab, filters, run list, read-only run screen, offline state.
3. **`2026-10-14-reports-3-web.md`:** `ReportFilters`, dashboard, Reports page tabs, standalone drawers, export menu, e2e.

New dependencies:
- API: `pdfmake` ^0.3 and `write-excel-file` ^4.1, plus a Noto Sans font in the repo (SIL OFL).
- Web: `recharts` ^3.10.
- Mobile: none.

## 11. Later

- Scheduled report emails (daily, weekly or monthly digest with attachments), if admins ask for them. They would reuse the exporter and SP6's email channel.
- Rollup tables, if the performance check or real tenants outgrow live queries.
- Charts in PDF exports.
- Per-item and per-question analytics (which checklist items most often raise problems).
- SP8 corrections: once corrected answers exist, decide whether reports show original or corrected scores (default: corrected, with the original kept in the audit trail).
