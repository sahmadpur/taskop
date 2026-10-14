# Taskop Reports — Part 2: Mobile Team Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager whose role has `reports.view` and a data scope wider than `own` gets a "Komanda" tab on the phone. It shows count tiles for today, 7 or 30 days, and a list of their people's runs that can be filtered by status and by employee, with infinite scroll and pull-to-refresh. Any run opens on a read-only screen with its answers, its problems with media, and both device and server times. The tab works online only and stores nothing on the phone.

**Architecture:**
- **Pure rules first.** `src/features/team/team-rules.ts` decides who sees the tab (`canSeeTeam`), turns the three period chips into Part 1 periods on the tenant's calendar (`teamPeriod` over `resolvePeriod` and `localDateOf`), maps the five status chips onto `RunBucket`s, builds the employee picker from `/reports/employees` rows without the Unassigned row, and removes duplicate run rows. `team-format.ts` holds the display rules: percent, receipt tolerance, status tone, run person, local day and cancel reason.
- **Data through react-query only.** `src/features/team/queries.ts` is the only code that calls `api.reports.*`, plus `api.occurrences.get` and `api.executions.get` for the run screen.
  - Every query key starts with `['team', viewerId]`, so a second manager on the same phone never sees the first one's cache.
  - Nothing is persisted and nothing touches SQLite.
  - Each query is enabled only while `useSyncStatus().online` is true.
  - There are no automatic retries. A report can take up to 15 s on the server, so the user retries.
- **Screens.**
  - `TeamScreen` is one `FlatList`. Its header holds the period chips, the six tiles, the status chips, the employee picker and the error banner. The rows come from `useInfiniteQuery` over `nextCursor`.
  - `TeamRunScreen` reads `GET /occurrences/:id` for the header. When the run has an execution, it also reads `GET /executions/:id` for the body.
- **Read-only answers are pulled out, the worker flow stays as it is.** The worker's `ItemField` draws values inside disabled inputs, shows disabled capture, "İndi" and ⚑ controls, and can only draw media that exist as files on the phone.
  - `src/features/execution/answer-view.tsx` (`ReadOnlyAnswers`, `ReadOnlyProblems`) reuses the worker's option chips. `Options` and the new `choiceOptions` move into `parts.tsx`.
  - It also reuses the worker's date formatting (`fromAnswerDatetime`) and the server-media strip from SP5 (`RemoteMediaStrip` over `GET /media/:id/url`).
  - The worker's execution tests do not change and must stay green.
- **Tab and guard.**
  - `app/(app)/_layout.tsx` adds the `team/index` tab between Tapşırıqlar and Profil, with `href: null` unless `canSeeTeam(me)`.
  - `team/run/[id]` is a hidden screen.
  - Both route files wrap their screen in `TeamGate`, which redirects a deep link without access to `/`.

**Tech Stack:** Expo SDK 57 (React Native 0.86, React 19.2.3, TypeScript 6 in `apps/mobile`), Expo Router (`Tabs` with hidden screens, `Redirect`, `useFocusEffect`), `@tanstack/react-query` 5.104 (already a dependency, used here for the first time), i18next, Jest 29 (`jest-expo`) + React Native Testing Library 14. **No new dependencies** (spec §10: "Mobile: none").

**Spec:** `docs/superpowers/specs/2026-10-14-reports-design.md`. This plan covers §7, the mobile edge cases of §8 and the mobile tests of §9. The interface source is `docs/superpowers/plans/2026-10-14-reports-1-api.md` → **Interfaces for Parts 2 and 3**. Names from that section are used exactly. This plan invents no endpoint and no field.

**This plan is Part 2 of 3.** It depends on **Part 1 Tasks 1–5** being merged into the feature branch. They deliver:
- `report-logic.ts` and `reports.ts` in `@taskop/contracts`;
- the `reports.*` permissions and error codes;
- `az.reports` and `az.errors.REPORT_*`;
- `createReportsApi` in `@taskop/api-client`.

Every Jest test here runs against a mocked `api`. Part 3 (web) is independent of this part.

| This plan's task | Needs from Part 1, merged first |
|---|---|
| Task 1 (strings, fixtures) | Tasks 1, 2, 3, 4: report types and schemas, the `reports.view` key, `az.reports`, `az.errors.REPORT_TIMEOUT` |
| Task 2 (rules) | Task 1 (`resolvePeriod`, `PERIOD_PRESETS`), Task 2 (`RUN_BUCKETS`, `RunBucket`, `ReportRun`, `EmployeeReportRow`) |
| Task 3 (queries) | Task 5 (`api.reports.summary / employees / runs`) |
| Tasks 4–8 | Tasks 1–5 |
| Task 9 (device run) | All of Part 1. Task 6 (the backfill gives existing Manager roles `reports.view`), Task 7 (`GET /occurrences/:id`, `GET /executions/:id` and `GET /media/:id/url` accept `reports.view`), Tasks 8–11 (the endpoints). Task 16 is optional: its `perf` tenant is used for the paging check. |

## Gaps against Part 1

**None found.** These Part 1 interfaces were checked against what this plan needs. Each one exists with the fields used:
- `reports.summary` returns `ReportSummary.counts.{completed, due, overdue, partial, withProblems}` and `completionPercent`.
- `reports.employees` returns `EmployeeReportRow.userId | null`, `name` and `active`.
- `reports.runs` takes `bucket` and `cursor` and returns `ReportRun.{occurrenceId, executionId, dueAt, checklist, site, status, assignees, executor, problemCount, criticalCount, late, clockSuspect}` with `nextCursor`.
- `GET /occurrences/:id` returns `OccurrenceDetail.assignees` and `.execution` (an `ExecutionSummary` with `startedAt`, `startedReceivedAt`, `completedAt`, `completedReceivedAt`, `late`, `clockSuspect`, `scorePercent` and `state`).
- `GET /executions/:id` returns `ExecutionDetail.{content, answers, media, problems}`.
- `GET /media/:id/url` goes through `ExecutionAccess.assertCanRead`, which Part 1 Task 7 widens to `reports.view` (checked in `apps/api/src/executions/media.service.ts`).
- The strings `az.reports.{notCompleted, buckets, counts, measures, noValue, empty, inactive, employees.unassigned, filters.employee, filters.allEmployees, columns.date, columns.assignees, tabs.problems}` and `az.errors.REPORT_TIMEOUT` exist.

## Global Constraints

- All Foundation Part 3, SP4 Part 2, SP5 Part 2 and SP6 Part 2 mobile constraints still apply.
  - All text comes from `@taskop/i18n`. This part adds only `az.mobile.tabs.team` and `az.mobile.team.*`.
  - It reuses Part 1's `az.reports.*` and `az.errors.REPORT_*` keys, plus `az.executions.*`, `az.scheduling.statuses`, `az.scheduling.cancelReasons`, `az.tasks.resolutions`, `az.common.{retry, close}` and `mobile.execution.problemFlagged`.
  - Touch targets are at least 44 pt. A network failure never logs the user out.
- **Visibility, exactly:** `me.permissions.includes('reports.view') && me.role.dataScope !== 'own'` (`canSeeTeam`). The tab and both Team routes use this rule and no other.
- **Period chips, exactly:**
  - `Bu gün` → `today`, `7 gün` → `last_7`, `30 gün` → `last_30`. The default is `today`.
  - The period is `resolvePeriod(preset, localDateOf(new Date(clock.now()), me.tenant.timezone))`.
  - It is recomputed on every `useNow()` tick, so it turns over at the tenant's midnight.
- **Status chips, exactly:** `Hamısı` → `all`, `Gecikmiş` → `overdue`, `Yarımçıq` → `partial`, `Buraxılmış` → `missed`, `Problemli` → `problems`, in that order. The default is `all`.
- **Tiles, exactly, in order:**

  | Tile | Value | Label |
  |---|---|---|
  | Completed | `counts.completed` | `az.reports.counts.completed` |
  | Not completed | `max(0, counts.due − counts.completed)` | `az.reports.notCompleted` |
  | Overdue | `counts.overdue` | `az.reports.counts.overdue` |
  | Partial | `counts.partial` | `az.reports.counts.partial` |
  | With problems | `counts.withProblems` | `az.reports.counts.withProblems` |
  | Completion % | `completionPercent`, or `—` when `null` | `az.reports.measures.completionPercent` |

  Each tile's accessibility label is `<label>: <value>`.
- **Exact phone strings:**
  - offline: `Komandanı görmək üçün internetə qoşulun`, followed by the `az.common.retry` button;
  - an unexecuted run: `Hələ icra edilməyib`;
  - the tab: `Komanda`.
- **Data:**
  - Only `src/features/team/queries.ts` calls `api.reports.*`. No team code reads or writes `services.db` or the stores.
  - There is no local migration and no persistence of the query cache.
  - Query keys start with `['team', viewerId]`.
  - `staleTime` is **30,000 ms** (`TEAM_STALE_MS`), and every team query has `retry: false`.
- **Paging:** pages of 50 come from the server (Part 1 `REPORT_LIMITS.pageSize`). The phone sends no `limit`. It passes `nextCursor` back as `cursor` with the same filters.
- **Times:**
  - Every time is shown in the tenant's timezone (`me.tenant.timezone`).
  - A server receipt time is shown under a device time only when the two differ by more than **60,000 ms** (`RECEIPT_TOLERANCE_MS`, the web's SP4 rule).
- **Routes:**
  - `/team` is the file `app/(app)/team/index.tsx`, the `Tabs.Screen` named `team/index`.
  - `/team/run/[id]` is the file `app/(app)/team/run/[id].tsx`, the `Tabs.Screen` named `team/run/[id]`, with `HIDDEN` options. `id` is the **occurrence** id.
- **The worker flow stays the same.**
  - `src/features/execution/execution-screen.test.tsx` and `finish-screen.test.tsx` are not edited, and they pass after every task.
  - The only edits in `features/execution` are moving `Options` into `parts.tsx`, adding `choiceOptions`, and the new `answer-view.tsx`.
- **The shared packages ship `dist/`.** Before any mobile test or typecheck, run `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build`.
- **Tests:**
  - The mobile tests are Jest (`jest-expo`), run with `pnpm --filter @taskop/mobile test -- <path>`. RNTL 14's `render`, `renderHook`, `rerender`, `fireEvent.*` and `act` are awaited.
  - Every test that renders `RemoteMediaStrip` mocks `@/features/execution/capture`, which imports the camera.
  - `packages/i18n` tests are Vitest.
- **Typed routes:** a fresh worktree has no `.expo/types`, so `router.push` takes the loose `Href` type. Do not run `expo start` before Task 8 has added `app/(app)/team/…`. Task 9 starts the dev server, which generates the route types with every route present.
- Commits use explicit paths (`git add <paths>`, never `-A`). Messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spec decisions (ambiguities resolved against the real code)

1. **The Team tab is a `Tabs.Screen`, hidden with `href: null` when the viewer may not see it, and its routes guard themselves.**
   - `app/(app)/_layout.tsx` is a `Tabs` navigator. Hidden screens such as `task/[id]` and `notifications` are entries with `HIDDEN` options.
   - A hidden tab can still be reached by URL (`taskop://team`, a notification, a typed route). So `TeamGate` checks `canSeeTeam` again in both route files and renders `<Redirect href="/" />` without access.
   - When a profile refresh removes `reports.view`, the layout re-renders, the tab disappears, and an open Team screen redirects.
2. **"Today" is the tenant's day, recomputed while the screen stays open.**
   - The period is computed on each render from `services.clock.now()` (through `useNow()`, which ticks every 15 s and on every local change) and `me.tenant.timezone`.
   - A screen left open over the tenant's midnight therefore moves to the new day by itself, because the query keys change.
3. **The period chips get their own short phone labels** (`az.mobile.team.periods`: "Bu gün", "7 gün", "30 gün", the spec's wording). They map onto Part 1's `today`, `last_7` and `last_30` presets. Part 1's labels ("Son 7 gün") stay for the web.
4. **The tiles follow the employee filter, not the status chip.**
   - `GET /reports/summary` gets `userId` when someone is picked, so the tiles describe that person.
   - The status chip only chooses the list's bucket, because tiles per bucket would be trivially equal to the chip.
   - The picker's own list (`GET /reports/employees`) depends only on the period, so choosing someone never shrinks the list of people.
5. **Five status chips, the spec's.** Part 1 added `completed` and `in_progress` buckets for the web tiles (its Spec decision 6). The phone keeps the five chips of spec §7.1.
6. **The employee picker:**
   - It never offers the Unassigned row (`userId: null`), since a `userId` filter never matches it (spec §3.3).
   - It lists inactive people last, marked "(Deaktiv)". The phone has no "show inactive" toggle, and the rows only exist for people who have runs in the period, so hiding them would hide those runs' owner.
   - It keeps the chosen person when the period changes, even when the new period's rows do not include them. The list is then empty, and "Bütün əməkdaşlar" clears the choice.
7. **The cache is held in memory, per viewer and briefly.**
   - The app's single `QueryClient` (`app/_layout.tsx`) outlives sign-outs, so every team key starts with `['team', viewerId]`.
   - `staleTime` is 30 s: switching chips back and forth reuses fresh pages.
   - Tabs keep visited screens mounted, so coming back to the Team tab (not the first focus) refetches the list queries that have gone stale.
   - `retry: false` applies to all team queries. A `REPORT_TIMEOUT` already cost the server 15 s, and the error banner has a retry button.
8. **The offline signal is `useSyncStatus().online`**, the same signal the inbox and the review screen use.
   - Every team query is enabled only while it is true. Going offline hides data already loaded, so the tab shows only the spec's message.
   - The retry button runs `services.syncNow('manual')`, which reads the connection again, as the sync screen's retry does. The queries load by themselves as soon as the phone is back online.
9. **A `403` refreshes the profile, once per screen.**
   - A `FORBIDDEN` from any team query means the role changed after the profile was cached, so the screen calls `session.refreshMe()`. If the new profile lacks access, decision 1 removes the tab and redirects.
   - The refresh happens at most once per mounted screen, because the three header queries fail together. A failed refresh is only logged.
10. **The run screen's route param is the occurrence id.**
    - The header comes from `GET /occurrences/:id`: checklist, site, date, status, assignees, and the counted execution's executor, device and receipt times, flags and score.
    - The body comes from `GET /executions/:id`, requested only when `occurrence.execution` is not `null`. A deep link to a run therefore needs no other parameter.
11. **The server receipt time is shown only when it differs from the device time by more than a minute.** This is the web's rule from SP4 §8 (`RECEIPT_TOLERANCE_MS = 60_000`, mirrored in `team-format.ts`). The start and the completion are each checked.
12. **The read-only display is pulled out, without changing what the worker sees.**
    - `ItemField` cannot draw media the phone does not hold as files, and in read-only mode it still draws input boxes and disabled controls.
    - `answer-view.tsx` draws the same option chips (`Options` and `Choice`, disabled), with the same labels (`choiceOptions`, used by `ItemField` too).
    - It writes values as text: numbers with their unit, and dates through `fromAnswerDatetime`, as the worker's field shows them.
    - Evidence goes through `RemoteMediaStrip`.
13. **Layout of the read-only body:**
    - All sections are on one scroll, with no section pager. Hidden follow-ups are left out (`visibleItems`).
    - Problems come after the answers. Each shows its item, severity, source, resolution, note and media.
    - A medium the server has not registered or uploaded yet is drawn as "Yüklənməyib".
14. **The score row** is hidden while the execution is still `active`. A `null` score on a closed run shows "Bal hesablanmır", which covers scoring that is off (spec §8).
15. **A cancelled run** (it appears under "Hamısı") shows its cancel reason: a system code is put into words (`az.scheduling.cancelReasons`), and a manager's own reason is shown as typed.
16. **List paging rules:**
    - The next page is requested with `fetchNextPage({ cancelRefetch: false })`, and only when `hasNextPage && !isFetching && !isFetchNextPageError`. Reaching the end twice therefore asks once, and a running refresh is never cancelled by a page request.
    - Pull-to-refresh uses `refetch()` (react-query's default `cancelRefetch: true`), which drops a next page still loading.
    - Rows are deduplicated by `occurrenceId` across pages.
17. **No pull-to-refresh on the run screen.** It is read-only and short-lived, so it has a retry button on errors.
18. **Errors:**
    - Every error is shown with `mobileErrorText`, so `REPORT_TIMEOUT`, `NETWORK`, `FORBIDDEN` and `NOT_FOUND` read as their `az.errors` text.
    - The banner's retry refetches only the queries that failed.
    - A failed next page keeps the rows already shown and asks for that same page again.

## Review Focus

These are the five failure modes most likely to bite real users that no spec test names. Each line names the task and the test that pins it.

1. **The tenant's day is not the phone's day.** Two cases:
   - A manager whose phone is set to another timezone, or who keeps the tab open past the tenant's midnight, must see the tenant's "Bu gün".
   - Late in the evening in Baku the phone may already say tomorrow, and an open screen must move to the new day by itself.

   Pinned in Task 2 (`takes the tenant’s day, not the phone’s`) and Task 4 (`counts "Bu gün" on the tenant’s calendar, not the phone’s` and `moves to the new day at the tenant’s midnight while the screen stays open`).
2. **List paging races.** The manager pulls to refresh while the next page loads, scrolls to the end twice quickly, or gets the same run on two pages after a late sync moved it. A page can also fail on a weak connection. Expected:
   - no row twice;
   - no stale page appended;
   - no page requested twice;
   - after a failed page, no endless requests, and no lost rows.

   Pinned in Task 5 (`asks for a page once…`, `pull to refresh reloads tiles, people and runs, and drops a next page that was loading`, `shows a run once when it comes on two pages`, `keeps the rows when a next page fails…`).
3. **A shared phone.** Manager A signs out, manager B signs in on the same phone, and the app's single query client still holds A's team data. B must never see A's numbers, not even while B's first request is loading. Pinned in Task 3 (`keeps each viewer’s data apart on one client`) and Task 4 (`never shows the previous manager’s numbers to the next one`).
4. **The role changes while the app is open, or the server is slow.**
   - An admin removes `reports.view`, so the next request answers 403. The phone must refresh the profile once, so the tab goes away, and must not loop.
   - A 15 s report timeout must show its message and must not be retried automatically.

   Pinned in Task 3 (`refreshes the profile once after a 403, never for other errors` and `does not retry a failed report by itself…`), Task 4 (`refreshes the profile once when the server says 403` and `shows a report timeout with a retry and does not retry by itself`) and Task 8 (`send a deep link without access Home`).
5. **The chosen employee is absent from the new period.** The manager picks Aynur for today, then switches to 30 days, where Aynur has no rows, or Aynur was deactivated. The choice must stay visible and keep filtering (an empty list, not everyone's runs). Inactive people stay pickable and marked, and Unassigned is never offered. Pinned in Task 2 (`offers every employee row but the Unassigned one, active people first`) and Task 4 (`keeps the chosen employee when the period changes and shows the empty state`).

---

## File Structure

```
packages/i18n/src/az/mobile.ts                       + tabs.team, team.* (title, offline, periods, row and run-screen strings)
packages/i18n/src/i18n.test.ts                       + mobile team strings
apps/mobile/
  app/(app)/_layout.tsx                              + "team/index" tab (href: null unless canSeeTeam), hidden "team/run/[id]"
  app/(app)/team/index.tsx                           (new) /team → <TeamGate><TeamScreen /></TeamGate>
  app/(app)/team/run/[id].tsx                        (new) /team/run/[id] → <TeamGate><TeamRunScreen key=id /></TeamGate>
  src/features/team/
    team-rules.ts (+ test)                           canSeeTeam, TEAM_PERIODS, teamPeriod, TEAM_CHIPS, CHIP_BUCKETS, notCompleted,
                                                     EmployeeChoice, employeeChoices, uniqueRuns
    team-format.ts (+ test)                          RECEIPT_TOLERANCE_MS, receiptDiffers, percentText, statusTone, runPerson,
                                                     formatLocalDay, cancelReasonText
    queries.ts (+ queries.test.tsx)                  TEAM_STALE_MS, TeamFilters, teamKeys, filterQuery, useTeamSummary,
                                                     useTeamEmployees, useTeamRuns, useTeamOccurrence, useTeamExecution,
                                                     useRefreshMeOnForbidden
    team-screen.tsx (+ team-screen.test.tsx,         TeamScreen: header (periods, tiles, chips, picker, errors) + run list
                       team-list.test.tsx)
    count-tiles.tsx                                  CountTiles
    run-row.tsx                                      RunRow
    employee-picker.tsx                              EmployeePicker (modal)
    team-offline.tsx                                 TeamOffline (message + retry)
    run-screen.tsx (+ run-screen.test.tsx)           TeamRunScreen
    team-gate.tsx                                    TeamGate
    team-routes.test.tsx                             tab visibility, deep-link guard
    testing/fixtures.ts (+ fixtures.test.ts)         teamMe, counts, reportSummary, employeeRow, unassignedRow, reportRun, runPage,
                                                     executionSummary, occurrenceDetail, missedOccurrence, executionMedia,
                                                     executionProblem, executionDetail, ids
    testing/render.tsx                               testQueryClient, TeamProviders, renderTeam, gate
  src/features/execution/
    parts.tsx                                        + choiceOptions, Options (moved here from item-field.tsx)
    item-field.tsx                                   uses choiceOptions and Options from parts (no behaviour change)
    answer-view.tsx (+ answer-view.test.tsx)         remoteMedia, answerText, ReadOnlyAnswers, ReadOnlyProblems
```

---

### Task 1: Phone strings, team fixtures and the query test harness

**Files:**
- Modify: `packages/i18n/src/az/mobile.ts`
- Test: `packages/i18n/src/i18n.test.ts`
- Create: `apps/mobile/src/features/team/testing/fixtures.ts`, `apps/mobile/src/features/team/testing/render.tsx`
- Test: `apps/mobile/src/features/team/testing/fixtures.test.ts`

**Interfaces:**
- Consumes (Part 1):
  - `az.reports.{notCompleted, buckets, periods}` and `az.errors.REPORT_TIMEOUT`;
  - `PERIOD_PRESETS` and `RUN_COUNT_KEYS`;
  - the types `ReportRun`, `ReportSummary`, `EmployeeReportRow` and `RunCounts`;
  - the schemas `reportSummarySchema`, `employeeReportRowSchema` and `reportRunPageSchema`;
  - the permission key `reports.view`.

  Existing: `meSchema`, `occurrenceDetailSchema`, `executionDetailSchema`, `Page`, `PermissionKey`, `DataScope`, and the offline fixtures (`ME`, `OCC`, `CHECKLIST`, `SITE`, `T`, `VERSION`, `DEVICE`, `TASK`, `TENANT`, `checklist()`).
- Produces:
  - Strings:
    - `az.mobile.tabs.team`;
    - `az.mobile.team.{title, offline, due, problems, critical}`;
    - `az.mobile.team.periods.{today, last_7, last_30}`;
    - `az.mobile.team.run.{title, answers, notExecuted, cancelReason}`.
  - `testing/fixtures.ts`:
    - ids `WORKER_A`, `WORKER_B`, `ASSIGNMENT`, `EXECUTION`, `PHOTO`, `PROBLEM_PHOTO`, `UNREGISTERED_PHOTO`, `PROBLEM`, `PROBLEM2`, `ITEM`, `RUN_CURSOR`, `VIEWER2`, `ROLE`;
    - `AYNUR`, `KAMRAN` (`UserRef`) and `RUN_T.{completed, received}`;
    - builders `teamMe(o?)`, `counts(over?)`, `reportSummary(over?)`, `employeeRow(over?)`, `unassignedRow()`, `reportRun(over?)`, `runPage(items, nextCursor?)`, `executionSummary(over?)`, `occurrenceDetail(over?)`, `missedOccurrence(over?)`, `executionMedia(id, over?)`, `executionProblem(over?)` and `executionDetail(c, over?)`.
  - `testing/render.tsx`: `testQueryClient(): QueryClient`, `TeamProviders`, `renderTeam(services, ui, client?)` (resolves to RNTL's render result plus `client`), and `gate(): { open(): void; opened: Promise<void> }`.

- [ ] **Step 1: Write the failing i18n test**

Append to `packages/i18n/src/i18n.test.ts`. `PERIOD_PRESETS` is already in the `@taskop/contracts` import, added by Part 1 Task 4.

```ts
describe('mobile team translations', () => {
  it('labels the Team tab, its periods, its offline state, its rows and the run screen', () => {
    expect(az.mobile.tabs.team).toBe('Komanda');
    expect(az.mobile.team.title).toBe('Komanda');
    expect(az.mobile.team.offline).toBe('Komandanı görmək üçün internetə qoşulun');
    expect(az.mobile.team.periods).toEqual({ today: 'Bu gün', last_7: '7 gün', last_30: '30 gün' });
    for (const p of Object.keys(az.mobile.team.periods)) expect(PERIOD_PRESETS, p).toContain(p);
    expect(az.mobile.team.due.replace('{{time}}', '10:00')).toBe('Son vaxt: 10:00');
    expect(az.mobile.team.problems.replace('{{count}}', '2')).toBe('Problem: 2');
    expect(az.mobile.team.critical.replace('{{count}}', '1')).toBe('Kritik: 1');
    expect(az.mobile.team.run.notExecuted).toBe('Hələ icra edilməyib');
    for (const k of ['title', 'answers', 'cancelReason'] as const) expect(az.mobile.team.run[k], k).toBeTypeOf('string');
  });

  it('shares the report wording with the web (Part 1)', () => {
    expect(az.reports.notCompleted).toBe('Tamamlanmayıb');
    expect(az.reports.buckets).toMatchObject({ all: 'Hamısı', overdue: 'Gecikmiş', partial: 'Yarımçıq', missed: 'Buraxılmış', problems: 'Problemli' });
    expect(az.reports.measures.completionPercent).toBe('Tamamlanma faizi');
    expect(az.errors.REPORT_TIMEOUT).toBeTypeOf('string');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL in `labels the Team tab…`, because `az.mobile.tabs.team` is undefined. `shares the report wording…` passes, because Part 1 Task 4 added `az.reports`.

- [ ] **Step 3: Add the strings**

In `packages/i18n/src/az/mobile.ts`, replace the `tabs` line with:

```ts
  tabs: { home: 'Əsas', tasks: 'Tapşırıqlar', team: 'Komanda', profile: 'Profil' },
```

and add after the `notifications` block (before the closing `} as const;`):

```ts
  team: {
    title: 'Komanda',
    offline: 'Komandanı görmək üçün internetə qoşulun',
    /** The header's period chips (spec §7.1), keyed by Part 1's period presets. */
    periods: { today: 'Bu gün', last_7: '7 gün', last_30: '30 gün' },
    due: 'Son vaxt: {{time}}',
    problems: 'Problem: {{count}}',
    critical: 'Kritik: {{count}}',
    run: {
      title: 'İcra',
      answers: 'Cavablar',
      notExecuted: 'Hələ icra edilməyib',
      cancelReason: 'Ləğv səbəbi',
    },
  },
```

- [ ] **Step 4: Run the i18n tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 5: Write the failing fixture test**

`apps/mobile/src/features/team/testing/fixtures.test.ts`:

```ts
import { employeeReportRowSchema, executionDetailSchema, meSchema, occurrenceDetailSchema, reportRunPageSchema, reportSummarySchema } from '@taskop/contracts';
import { checklist } from '@/offline/testing/fixtures';
import { employeeRow, executionDetail, missedOccurrence, occurrenceDetail, reportRun, reportSummary, RUN_CURSOR, runPage, teamMe, unassignedRow } from './fixtures';

/** The issues a schema finds; [] when it accepts the value. */
const issues = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) => schema.safeParse(value).error?.issues ?? [];

describe('team fixtures', () => {
  it('match Part 1’s report schemas', () => {
    expect(issues(reportSummarySchema, reportSummary())).toEqual([]);
    expect(issues(employeeReportRowSchema, employeeRow())).toEqual([]);
    expect(issues(employeeReportRowSchema, unassignedRow())).toEqual([]);
    expect(issues(reportRunPageSchema, runPage([reportRun()], RUN_CURSOR))).toEqual([]);
  });

  it('match the profile and run-detail schemas', () => {
    expect(issues(meSchema, teamMe())).toEqual([]);
    expect(issues(occurrenceDetailSchema, occurrenceDetail())).toEqual([]);
    expect(issues(occurrenceDetailSchema, missedOccurrence())).toEqual([]);
    expect(issues(executionDetailSchema, executionDetail(checklist()))).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it and check it fails**

Run: `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build && pnpm --filter @taskop/mobile test -- src/features/team/testing`
Expected: FAIL with `Cannot find module './fixtures'`.

- [ ] **Step 7: Write the fixtures and the render helper**

`apps/mobile/src/features/team/testing/fixtures.ts`:

```ts
import {
  type DataScope,
  type EmployeeReportRow,
  type ExecutionDetail,
  type ExecutionMediaDto,
  type ExecutionProblem,
  type ExecutionSummary,
  type Me,
  type OccurrenceDetail,
  type Page,
  type PermissionKey,
  type ReportRun,
  type ReportSummary,
  RUN_COUNT_KEYS,
  type RunCounts,
} from '@taskop/contracts';
import { type Checklist, CHECKLIST, DEVICE, ME, OCC, SITE, T, TASK, TENANT, VERSION } from '@/offline/testing/fixtures';

export const WORKER_A = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb0';
export const WORKER_B = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb1';
export const ASSIGNMENT = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb2';
export const EXECUTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb3';
export const PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb4';
export const PROBLEM_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb5';
export const PROBLEM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb6';
export const PROBLEM2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb7';
export const RUN_CURSOR = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb8';
/** A second manager signing in on the same phone. */
export const VIEWER2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eb9';
export const ROLE = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4eba';
export const ITEM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ebb';
/** A photo id an answer holds that the server has not registered yet. */
export const UNREGISTERED_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ebc';

export const AYNUR = { id: WORKER_A, fullName: 'Aynur Quliyeva' };
export const KAMRAN = { id: WORKER_B, fullName: 'Kamran Əliyev' };

/** The executed run of OCC: started 08:10, completed 09:30 in Baku (device), received 13:00 (a late offline sync). */
export const RUN_T = { completed: '2026-11-02T05:30:00.000Z', received: '2026-11-02T09:00:00.000Z' } as const;

/** Leyla, a site_subtree Manager with the report keys: the viewer of the Team tab. */
export function teamMe(o: { id?: string; permissions?: PermissionKey[]; dataScope?: DataScope; timezone?: string } = {}): Me {
  return {
    user: {
      id: o.id ?? ME,
      fullName: 'Leyla Məmmədova',
      jobTitle: 'Menecer',
      kind: 'staff',
      email: 'manager@demo.taskop.az',
      username: null,
      emailVerified: true,
      credentialKind: 'password',
      emailNotifications: true,
    },
    role: { id: ROLE, name: 'Manager', systemKey: 'manager', dataScope: o.dataScope ?? 'site_subtree' },
    permissions: o.permissions ?? ['assignments.view', 'reports.view', 'reports.export'],
    tenant: { id: TENANT, name: 'Demo MMC', orgCode: 'demo', timezone: o.timezone ?? 'Asia/Baku', locale: 'az' },
  };
}

export const counts = (over: Partial<RunCounts> = {}): RunCounts => ({ ...(Object.fromEntries(RUN_COUNT_KEYS.map((k) => [k, 0])) as RunCounts), ...over });

/** An empty one-day period. */
export const reportSummary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  counts: counts(),
  completionPercent: null,
  averageScore: null,
  trend: [{ date: '2026-11-02', due: 0, completed: 0, completionPercent: null }],
  ...over,
});

/** Aynur's row: one run, completed. */
export const employeeRow = (over: Partial<EmployeeReportRow> = {}): EmployeeReportRow => ({
  ...counts({ planned: 1, due: 1, completed: 1 }),
  userId: WORKER_A,
  name: AYNUR.fullName,
  active: true,
  completionPercent: 100,
  averageScore: null,
  ...over,
});

/** Spec §3.3: the synthetic row of runs with no execution and no assignee. */
export const unassignedRow = (): EmployeeReportRow =>
  employeeRow({ ...counts({ planned: 1, due: 1, missed: 1 }), userId: null, name: 'Təyin edilməyib', completionPercent: 0 });

/** OCC, assigned to Aynur and Kamran, completed by Aynur, with two problems (one critical). */
export const reportRun = (over: Partial<ReportRun> = {}): ReportRun => ({
  occurrenceId: OCC,
  executionId: EXECUTION,
  localDate: '2026-11-02',
  dueAt: T.due,
  checklist: { id: CHECKLIST, name: 'Açılış yoxlaması' },
  site: { id: SITE, name: 'Bakı filialı 1' },
  status: 'completed',
  assignees: [AYNUR, KAMRAN],
  executor: AYNUR,
  startedAt: T.open,
  completedAt: RUN_T.completed,
  completedReceivedAt: RUN_T.received,
  score: 50,
  problemCount: 2,
  criticalCount: 1,
  late: false,
  clockSuspect: false,
  ...over,
});

export const runPage = (items: ReportRun[], nextCursor: string | null = null): Page<ReportRun> => ({ items, nextCursor });

/** Aynur's counted execution of OCC: late, clock-suspect, 50 %, completion received hours after the device time. */
export const executionSummary = (over: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
  id: EXECUTION,
  executor: AYNUR,
  state: 'completed',
  rejectedReason: null,
  startedAt: T.open,
  startedReceivedAt: T.open,
  completedAt: RUN_T.completed,
  completedReceivedAt: RUN_T.received,
  late: true,
  clockSuspect: true,
  progress: { answered: 4, total: 5, requiredMissing: 0 },
  scorePercent: 50,
  problemCount: 2,
  mediaPending: 1,
  ...over,
});

/** GET /occurrences/:id of the executed OCC. */
export const occurrenceDetail = (over: Partial<OccurrenceDetail> = {}): OccurrenceDetail => ({
  id: OCC,
  assignmentId: ASSIGNMENT,
  assignmentName: 'Səhər açılışı',
  checklistId: CHECKLIST,
  checklistName: 'Açılış yoxlaması',
  siteId: SITE,
  siteName: 'Bakı filialı 1',
  shiftId: null,
  shiftName: null,
  localDate: '2026-11-02',
  startsAt: T.starts,
  dueAt: T.due,
  closesAt: T.closes,
  status: 'completed',
  statusChangedAt: RUN_T.received,
  cancelReason: null,
  assigneeIds: [WORKER_A, WORKER_B],
  unassigned: false,
  executionBrief: {
    executionId: EXECUTION,
    executorName: AYNUR.fullName,
    state: 'completed',
    progress: { answered: 4, total: 5, requiredMissing: 0 },
    scorePercent: 50,
    late: true,
    clockSuspect: true,
  },
  assignees: [AYNUR, KAMRAN],
  history: [],
  execution: executionSummary(),
  rejectedExecutions: [],
  ...over,
});

/** The same run, missed: nobody started it. */
export const missedOccurrence = (over: Partial<OccurrenceDetail> = {}): OccurrenceDetail =>
  occurrenceDetail({ status: 'missed', executionBrief: null, execution: null, ...over });

export const executionMedia = (id: string, over: Partial<ExecutionMediaDto> = {}): ExecutionMediaDto => ({
  id,
  itemId: null,
  kind: 'photo',
  source: 'camera',
  mime: 'image/jpeg',
  bytes: 1000,
  width: 1600,
  height: 1200,
  durationMs: null,
  capturedAt: T.open,
  capturedBy: AYNUR,
  status: 'uploaded',
  uploadedAt: RUN_T.received,
  ...over,
});

export const executionProblem = (over: Partial<ExecutionProblem> = {}): ExecutionProblem => ({
  id: PROBLEM,
  itemId: ITEM,
  source: 'rule',
  severity: 'critical',
  note: null,
  mediaIds: [],
  createdAt: T.open,
  resolution: 'none',
  taskId: null,
  ...over,
});

/**
 * GET /executions/:id of Aynur's run over `c` (offline fixtures' `checklist()`):
 * - "Bəli" with an uploaded photo (a critical rule problem) and its follow-up comment;
 * - 10 °C with a note, and a manual problem whose photo is not uploaded yet;
 * - the photo item and the optional note unanswered.
 */
export function executionDetail(c: Checklist, over: Partial<ExecutionDetail> = {}): ExecutionDetail {
  const { assignees: _assignees, history: _history, execution: _execution, rejectedExecutions: _rejected, ...occurrence } = occurrenceDetail();
  return {
    ...executionSummary(),
    occurrence,
    checklistVersionId: VERSION,
    versionNumber: 1,
    content: c.content,
    answers: {
      [c.problem.id]: { optionIds: [c.yes.id], photos: [PHOTO] },
      [c.comment.id]: { text: 'Kompressor səs salır' },
      [c.temp.id]: { number: 10, note: 'Kondisioner xarabdır' },
    },
    answersRev: 3,
    score: { earned: 1, possible: 2, percent: 50, problems: [{ itemId: c.problem.id, severity: 'critical' }, { itemId: c.temp.id, severity: 'normal' }] },
    clockOffsetMs: 0,
    device: DEVICE,
    lastSyncedAt: RUN_T.received,
    media: [executionMedia(PHOTO, { itemId: c.problem.id }), executionMedia(PROBLEM_PHOTO, { itemId: c.temp.id, status: 'pending', uploadedAt: null })],
    problems: [
      executionProblem({ id: PROBLEM, itemId: c.problem.id, severity: 'critical', source: 'rule', mediaIds: [PHOTO] }),
      executionProblem({ id: PROBLEM2, itemId: c.temp.id, severity: 'normal', source: 'manual', note: 'Termometr sınıb', mediaIds: [PROBLEM_PHOTO], resolution: 'open', taskId: TASK }),
    ],
    ...over,
  };
}
```

`apps/mobile/src/features/team/testing/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { OfflineServicesProvider } from '@/offline/context';
import type { OfflineServices } from '@/offline/services';

/** Like the app's client (app/_layout.tsx), minus retries and garbage-collection timers, so Jest sees no open handles. */
export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

export function TeamProviders({ services, client, children }: { services: OfflineServices; client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <OfflineServicesProvider services={services}>{children}</OfflineServicesProvider>
    </QueryClientProvider>
  );
}

/** Renders `ui` under the offline services and a query client (a fresh one unless given). */
export async function renderTeam(services: OfflineServices, ui: ReactElement, client: QueryClient = testQueryClient()) {
  const view = await render(
    <TeamProviders services={services} client={client}>
      {ui}
    </TeamProviders>,
  );
  return { ...view, client };
}

/** A promise a test opens when it wants: holds a request in flight. */
export function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}
```

- [ ] **Step 8: Run the fixture test, then the whole mobile suite, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/testing && pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. The existing suites are unchanged by Part 1, which made no existing contract field required.

- [ ] **Step 9: Commit**

```bash
git add packages/i18n/src/az/mobile.ts packages/i18n/src/i18n.test.ts apps/mobile/src/features/team/testing
git commit -m "feat(mobile): Team tab strings, report fixtures and the query test harness" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Team rules and display formatting

**Files:**
- Create: `apps/mobile/src/features/team/team-rules.ts`, `apps/mobile/src/features/team/team-format.ts`
- Test: `apps/mobile/src/features/team/team-rules.test.ts`, `apps/mobile/src/features/team/team-format.test.ts`

**Interfaces:**
- Consumes (Part 1): `resolvePeriod(preset, today)`, `type Period`, `type PeriodPreset`, `PERIOD_PRESETS`, `RUN_BUCKETS`, `type RunBucket`, `type RunCounts`, `type ReportRun`, `type EmployeeReportRow`. Existing: `localDateOf(instant: Date, tz: string)`, `type Me`, `type LocalDate`, `OCCURRENCE_STATUSES`, `type OccurrenceStatus`, `CANCEL_REASON_CODES`, `intlLocale` from `@taskop/i18n`. Task 1 fixtures.
- Produces:
  - `team-rules.ts`:
    - `canSeeTeam(me: { permissions: Me['permissions']; role: Pick<Me['role'], 'dataScope'> }): boolean`;
    - `TEAM_PERIODS = ['today', 'last_7', 'last_30'] as const`, `type TeamPeriod`, `teamPeriod(preset: TeamPeriod, nowMs: number, tenantTimeZone: string): Period`;
    - `TEAM_CHIPS = ['all', 'overdue', 'partial', 'missed', 'problems'] as const`, `type TeamChip`, `CHIP_BUCKETS: Record<TeamChip, RunBucket>`;
    - `notCompleted(c: Pick<RunCounts, 'due' | 'completed'>): number`;
    - `interface EmployeeChoice { userId: string; name: string; active: boolean }`, `employeeChoices(rows: readonly EmployeeReportRow[]): EmployeeChoice[]`;
    - `uniqueRuns(pages: readonly { items: readonly ReportRun[] }[]): ReportRun[]`.
  - `team-format.ts`:
    - `RECEIPT_TOLERANCE_MS = 60_000` and `receiptDiffers(deviceAt: string, receivedAt: string | null): boolean`;
    - `percentText(t: TFunction, value: number | null): string`;
    - `type StatusTone = 'neutral' | 'warning' | 'danger' | 'success'` and `statusTone(status: OccurrenceStatus): StatusTone`;
    - `runPerson(t: TFunction, run: Pick<ReportRun, 'executor' | 'assignees'>): string`;
    - `formatLocalDay(day: LocalDate): string`;
    - `cancelReasonText(t: TFunction, reason: string): string`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/features/team/team-rules.test.ts`:

```ts
import { type DataScope, PERIOD_PRESETS, type PermissionKey, RUN_BUCKETS } from '@taskop/contracts';
import { OCC, OCC2, OCC3 } from '@/offline/testing/fixtures';
import { canSeeTeam, CHIP_BUCKETS, employeeChoices, notCompleted, TEAM_CHIPS, TEAM_PERIODS, teamPeriod, uniqueRuns } from './team-rules';
import { employeeRow, KAMRAN, reportRun, unassignedRow, WORKER_A, WORKER_B } from './testing/fixtures';

const viewer = (permissions: PermissionKey[], dataScope: DataScope) => ({ permissions, role: { dataScope } });

describe('canSeeTeam (spec §7.1)', () => {
  it('needs reports.view and a data scope wider than own', () => {
    expect(canSeeTeam(viewer(['reports.view'], 'site_subtree'))).toBe(true);
    expect(canSeeTeam(viewer(['reports.view'], 'subordinates'))).toBe(true);
    expect(canSeeTeam(viewer(['reports.view', 'reports.export'], 'all'))).toBe(true);
    expect(canSeeTeam(viewer(['reports.view'], 'own'))).toBe(false);
    expect(canSeeTeam(viewer(['assignments.view', 'reports.export'], 'all'))).toBe(false);
    expect(canSeeTeam(viewer([], 'own'))).toBe(false);
  });
});

describe('periods', () => {
  const monday = Date.parse('2026-11-02T04:10:00.000Z'); // 08:10 on Monday 2 Nov in Baku

  it('offers today, 7 and 30 days as Part 1 presets', () => {
    expect(TEAM_PERIODS).toEqual(['today', 'last_7', 'last_30']);
    for (const p of TEAM_PERIODS) expect(PERIOD_PRESETS).toContain(p);
  });

  it('resolves each chip from the tenant’s today', () => {
    expect(teamPeriod('today', monday, 'Asia/Baku')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(teamPeriod('last_7', monday, 'Asia/Baku')).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(teamPeriod('last_30', monday, 'Asia/Baku')).toEqual({ from: '2026-10-04', to: '2026-11-02' });
  });

  it('takes the tenant’s day, not the phone’s', () => {
    const instant = Date.parse('2026-11-01T21:30:00.000Z'); // 01:30 on 2 Nov in Baku, 16:30 on 1 Nov in New York
    expect(teamPeriod('today', instant, 'Asia/Baku')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(teamPeriod('today', instant, 'America/New_York')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });
});

describe('status chips', () => {
  it('map onto the runs buckets of the same name, all first', () => {
    expect(TEAM_CHIPS.map((c) => CHIP_BUCKETS[c])).toEqual(['all', 'overdue', 'partial', 'missed', 'problems']);
    for (const c of TEAM_CHIPS) expect(RUN_BUCKETS).toContain(CHIP_BUCKETS[c]);
  });
});

describe('tiles and people', () => {
  it('counts the due runs that are not completed', () => {
    expect(notCompleted({ due: 10, completed: 7 })).toBe(3);
    expect(notCompleted({ due: 0, completed: 0 })).toBe(0);
  });

  it('offers every employee row but the Unassigned one, active people first', () => {
    const rows = [employeeRow({ userId: WORKER_B, name: KAMRAN.fullName, active: false }), employeeRow(), unassignedRow()];
    expect(employeeChoices(rows)).toEqual([
      { userId: WORKER_A, name: 'Aynur Quliyeva', active: true },
      { userId: WORKER_B, name: 'Kamran Əliyev', active: false },
    ]);
    expect(employeeChoices([unassignedRow()])).toEqual([]);
  });
});

describe('uniqueRuns', () => {
  it('keeps each run once, at its first place', () => {
    const pages = [
      { items: [reportRun(), reportRun({ occurrenceId: OCC2 })] },
      { items: [reportRun({ occurrenceId: OCC2, status: 'missed' }), reportRun({ occurrenceId: OCC3 })] },
    ];
    expect(uniqueRuns(pages).map((r) => [r.occurrenceId, r.status])).toEqual([
      [OCC, 'completed'],
      [OCC2, 'completed'],
      [OCC3, 'completed'],
    ]);
    expect(uniqueRuns([])).toEqual([]);
  });
});
```

`apps/mobile/src/features/team/team-format.test.ts`:

```ts
import { OCCURRENCE_STATUSES } from '@taskop/contracts';
import i18n from '@/lib/i18n';
import { cancelReasonText, formatLocalDay, percentText, receiptDiffers, runPerson, statusTone } from './team-format';
import { AYNUR, KAMRAN } from './testing/fixtures';

const t = i18n.t.bind(i18n);

describe('team formatting', () => {
  it('writes percentages the Azerbaijani way, and a dash for none', () => {
    expect(percentText(t, 70)).toBe('70%');
    expect(percentText(t, 66.7)).toBe('66,7%');
    expect(percentText(t, 0)).toBe('0%');
    expect(percentText(t, null)).toBe('—');
  });

  it('shows a server receipt only when it is more than a minute from the device time', () => {
    const device = '2026-11-02T05:30:00.000Z';
    expect(receiptDiffers(device, '2026-11-02T05:31:00.000Z')).toBe(false);
    expect(receiptDiffers(device, '2026-11-02T05:31:00.001Z')).toBe(true);
    expect(receiptDiffers(device, '2026-11-02T05:28:59.000Z')).toBe(true);
    expect(receiptDiffers(device, null)).toBe(false);
  });

  it('colours every status', () => {
    expect(Object.fromEntries(OCCURRENCE_STATUSES.map((s) => [s, statusTone(s)]))).toEqual({
      pending: 'neutral',
      started: 'neutral',
      in_progress: 'neutral',
      completed: 'success',
      partial: 'warning',
      overdue: 'danger',
      missed: 'danger',
      cancelled: 'neutral',
      audit_pending: 'success',
      audited: 'success',
    });
  });

  it('names the executor, else every assignee, else Təyin edilməyib', () => {
    expect(runPerson(t, { executor: AYNUR, assignees: [AYNUR, KAMRAN] })).toBe('Aynur Quliyeva');
    expect(runPerson(t, { executor: null, assignees: [AYNUR, KAMRAN] })).toBe('Aynur Quliyeva, Kamran Əliyev');
    expect(runPerson(t, { executor: null, assignees: [] })).toBe('Təyin edilməyib');
  });

  it('writes a local day and a cancel reason', () => {
    expect(formatLocalDay('2026-11-02')).toBe('02.11.2026');
    expect(cancelReasonText(t, 'assignment_edited')).toBe('Təyinat dəyişdirildi');
    expect(cancelReasonText(t, 'Mağaza təmirə bağlanıb')).toBe('Mağaza təmirə bağlanıb');
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/team-rules src/features/team/team-format`
Expected: FAIL with `Cannot find module './team-rules'` and `Cannot find module './team-format'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/features/team/team-rules.ts`:

```ts
import {
  type EmployeeReportRow,
  localDateOf,
  type Me,
  type Period,
  type PeriodPreset,
  type ReportRun,
  resolvePeriod,
  type RunBucket,
  type RunCounts,
} from '@taskop/contracts';

/** Spec §7.1: the Team tab and its routes exist only for reports.view with a data scope wider than `own`. */
export function canSeeTeam(me: { permissions: Me['permissions']; role: Pick<Me['role'], 'dataScope'> }): boolean {
  return me.permissions.includes('reports.view') && me.role.dataScope !== 'own';
}

/** The header's period chips (spec §7.1: Bu gün / 7 gün / 30 gün), as Part 1 presets. */
export const TEAM_PERIODS = ['today', 'last_7', 'last_30'] as const satisfies readonly PeriodPreset[];
export type TeamPeriod = (typeof TEAM_PERIODS)[number];

/** A chip's period on the tenant's calendar (decision 2): "today" is the tenant's day, whatever the phone's timezone says. */
export function teamPeriod(preset: TeamPeriod, nowMs: number, tenantTimeZone: string): Period {
  return resolvePeriod(preset, localDateOf(new Date(nowMs), tenantTimeZone));
}

/** The status chips, in display order (spec §7.1). */
export const TEAM_CHIPS = ['all', 'overdue', 'partial', 'missed', 'problems'] as const;
export type TeamChip = (typeof TEAM_CHIPS)[number];

/** Each chip lists one /reports/runs bucket (decision 5). */
export const CHIP_BUCKETS: Record<TeamChip, RunBucket> = { all: 'all', overdue: 'overdue', partial: 'partial', missed: 'missed', problems: 'problems' };

/** The "not completed" tile: due − completed (spec §7.1), never negative. */
export const notCompleted = (c: Pick<RunCounts, 'due' | 'completed'>): number => Math.max(0, c.due - c.completed);

export interface EmployeeChoice {
  userId: string;
  name: string;
  active: boolean;
}

/**
 * The employee picker's people (decision 6): the period's employee rows without the Unassigned row (a userId filter
 * never matches it, spec §3.3), active people first, each group in the server's name order.
 */
export function employeeChoices(rows: readonly EmployeeReportRow[]): EmployeeChoice[] {
  const people = rows.flatMap((r) => (r.userId === null ? [] : [{ userId: r.userId, name: r.name, active: r.active }]));
  return [...people.filter((p) => p.active), ...people.filter((p) => !p.active)];
}

/** Every loaded page's rows, each run once at its first place (decision 16): a late sync can move a run between pages. */
export function uniqueRuns(pages: readonly { items: readonly ReportRun[] }[]): ReportRun[] {
  const seen = new Set<string>();
  const out: ReportRun[] = [];
  for (const page of pages) {
    for (const run of page.items) {
      if (seen.has(run.occurrenceId)) continue;
      seen.add(run.occurrenceId);
      out.push(run);
    }
  }
  return out;
}
```

`apps/mobile/src/features/team/team-format.ts`:

```ts
import { CANCEL_REASON_CODES, type LocalDate, type OccurrenceStatus, type ReportRun } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import type { TFunction } from 'i18next';

/** A server receipt is shown under a device time only when they differ by more than this (decision 11, as on the web). */
export const RECEIPT_TOLERANCE_MS = 60_000;

export const receiptDiffers = (deviceAt: string, receivedAt: string | null): boolean =>
  receivedAt !== null && Math.abs(Date.parse(receivedAt) - Date.parse(deviceAt)) > RECEIPT_TOLERANCE_MS;

/** "70%", "66,7%"; "—" when there is nothing to divide (spec §3.1, §8 "Empty period"). */
export function percentText(t: TFunction, value: number | null): string {
  if (value === null) return t('reports.noValue');
  return t('executions.percent', { value: new Intl.NumberFormat(intlLocale('az'), { maximumFractionDigits: 1 }).format(value) });
}

export type StatusTone = 'neutral' | 'warning' | 'danger' | 'success';

/** The colour of a run's status badge. */
export function statusTone(status: OccurrenceStatus): StatusTone {
  switch (status) {
    case 'completed':
    case 'audit_pending':
    case 'audited':
      return 'success';
    case 'overdue':
    case 'missed':
      return 'danger';
    case 'partial':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Who a run row names, as spec §3.3 attributes it: the executor; else every assignee; else "Təyin edilməyib". */
export function runPerson(t: TFunction, run: Pick<ReportRun, 'executor' | 'assignees'>): string {
  if (run.executor) return run.executor.fullName;
  if (run.assignees.length > 0) return run.assignees.map((a) => a.fullName).join(', ');
  return t('reports.employees.unassigned');
}

/** 2026-11-02 → 02.11.2026. */
export function formatLocalDay(day: LocalDate): string {
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

/** A system cancel reason in words (decision 15); a manager's own reason as typed. */
export function cancelReasonText(t: TFunction, reason: string): string {
  return (CANCEL_REASON_CODES as readonly string[]).includes(reason) ? t(`scheduling.cancelReasons.${reason}`) : reason;
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/team-rules src/features/team/team-format && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/team/team-rules.ts apps/mobile/src/features/team/team-rules.test.ts apps/mobile/src/features/team/team-format.ts apps/mobile/src/features/team/team-format.test.ts
git commit -m "feat(mobile): Team tab rules (visibility, tenant-day periods, chips, people) and formatting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The team queries (react-query only, keyed per viewer)

**Files:**
- Create: `apps/mobile/src/features/team/queries.ts`
- Test: `apps/mobile/src/features/team/queries.test.tsx`

**Interfaces:**
- Consumes (Part 1): `api.reports.summary(query: ReportFiltersQuery)`, `api.reports.employees(query: ReportFiltersQuery)`, `api.reports.runs(query: ReportRunsQuery)`, `type RunBucket`, `type ReportFiltersQuery`. Existing: `api.occurrences.get(id)`, `api.executions.get(id)`, `session.refreshMe()`, `ApiError`. Task 1 (`testQueryClient`, `gate`, fixtures).
- Produces:
  - `TEAM_STALE_MS = 30_000`;
  - `interface TeamFilters { from: LocalDate; to: LocalDate; userId: string | null }`;
  - `teamKeys.{all(viewerId), list(viewerId), summary(viewerId, f), employees(viewerId, from, to), runs(viewerId, f, bucket), occurrence(viewerId, id), execution(viewerId, id)}`. All of them begin with `['team', viewerId]`; the list keys begin with `['team', viewerId, 'list']`;
  - `filterQuery(f: TeamFilters): ReportFiltersQuery`;
  - `useTeamSummary(viewerId, f, enabled)`, `useTeamEmployees(viewerId, from, to, enabled)`, `useTeamRuns(viewerId, f, bucket, enabled)` (`useInfiniteQuery`, page param `string | null`), `useTeamOccurrence(viewerId, occurrenceId, enabled)`, `useTeamExecution(viewerId, executionId: string | null, enabled)`;
  - `useRefreshMeOnForbidden(errors: readonly unknown[]): void`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/queries.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { ME, OCC, OCC2 } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import {
  filterQuery,
  teamKeys,
  type TeamFilters,
  useRefreshMeOnForbidden,
  useTeamEmployees,
  useTeamExecution,
  useTeamOccurrence,
  useTeamRuns,
  useTeamSummary,
} from './queries';
import { counts, employeeRow, EXECUTION, occurrenceDetail, reportRun, reportSummary, RUN_CURSOR, runPage, VIEWER2, WORKER_A } from './testing/fixtures';
import { gate, testQueryClient } from './testing/render';

const mockSummary = jest.fn();
const mockEmployees = jest.fn();
const mockRuns = jest.fn();
const mockOccurrence = jest.fn();
const mockExecution = jest.fn();
const mockRefreshMe = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    reports: {
      summary: (...a: unknown[]) => mockSummary(...a),
      employees: (...a: unknown[]) => mockEmployees(...a),
      runs: (...a: unknown[]) => mockRuns(...a),
    },
    occurrences: { get: (...a: unknown[]) => mockOccurrence(...a) },
    executions: { get: (...a: unknown[]) => mockExecution(...a) },
  },
  session: { refreshMe: () => mockRefreshMe() },
}));

const TODAY: TeamFilters = { from: '2026-11-02', to: '2026-11-02', userId: null };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN');

async function hook<R, P>(fn: (props: P) => R, o: { initialProps?: P; client?: QueryClient } = {}) {
  const client = o.client ?? testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...(await renderHook(fn, { wrapper, initialProps: o.initialProps as P })), client };
}

beforeEach(() => jest.clearAllMocks());

describe('team queries', () => {
  it('sends the period, and the employee only when one is chosen', () => {
    expect(filterQuery(TODAY)).toStrictEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(filterQuery({ ...TODAY, userId: WORKER_A })).toStrictEqual({ from: '2026-11-02', to: '2026-11-02', userId: WORKER_A });
  });

  it('loads the summary and the period’s employees', async () => {
    mockSummary.mockResolvedValue(reportSummary({ counts: counts({ completed: 7 }) }));
    mockEmployees.mockResolvedValue([employeeRow()]);
    const s = await hook(() => useTeamSummary(ME, { ...TODAY, userId: WORKER_A }, true));
    const e = await hook(() => useTeamEmployees(ME, '2026-10-27', '2026-11-02', true));
    await eventually(async () => expect(s.result.current.data?.counts.completed).toBe(7));
    await eventually(async () => expect(e.result.current.data).toEqual([employeeRow()]));
    expect(mockSummary).toHaveBeenCalledWith({ from: '2026-11-02', to: '2026-11-02', userId: WORKER_A });
    expect(mockEmployees).toHaveBeenCalledWith({ from: '2026-10-27', to: '2026-11-02' });
  });

  it('asks nothing while disabled (offline)', async () => {
    const s = await hook(() => useTeamSummary(ME, TODAY, false));
    await hook(() => useTeamRuns(ME, TODAY, 'all', false));
    await settle();
    expect(mockSummary).not.toHaveBeenCalled();
    expect(mockRuns).not.toHaveBeenCalled();
    expect(s.result.current.fetchStatus).toBe('idle');
  });

  it('keeps each viewer’s data apart on one client', async () => {
    const second = gate();
    mockSummary
      .mockResolvedValueOnce(reportSummary({ counts: counts({ completed: 7 }) }))
      .mockImplementationOnce(async () => {
        await second.opened;
        return reportSummary({ counts: counts({ completed: 1 }) });
      });
    const h = await hook(({ viewer }: { viewer: string }) => useTeamSummary(viewer, TODAY, true), { initialProps: { viewer: ME } });
    await eventually(async () => expect(h.result.current.data?.counts.completed).toBe(7));
    await h.rerender({ viewer: VIEWER2 });
    // Manager B, signed in on the same phone, never sees manager A's numbers, not even while B's own load is running.
    expect(h.result.current.data).toBeUndefined();
    await act(async () => second.open());
    await eventually(async () => expect(h.result.current.data?.counts.completed).toBe(1));
    expect(teamKeys.summary(VIEWER2, TODAY).slice(0, 3)).toEqual(['team', VIEWER2, 'list']);
  });

  it('pages the runs with the cursor and stops at the last page', async () => {
    mockRuns.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? runPage([reportRun({ occurrenceId: OCC2 })]) : runPage([reportRun()], RUN_CURSOR)));
    const h = await hook(() => useTeamRuns(ME, TODAY, 'overdue', true));
    await eventually(async () => expect(h.result.current.hasNextPage).toBe(true));
    await act(async () => {
      await h.result.current.fetchNextPage();
    });
    expect(mockRuns.mock.calls.map(([q]) => q)).toEqual([
      { from: '2026-11-02', to: '2026-11-02', bucket: 'overdue' },
      { from: '2026-11-02', to: '2026-11-02', bucket: 'overdue', cursor: RUN_CURSOR },
    ]);
    expect(h.result.current.hasNextPage).toBe(false);
    expect(h.result.current.data?.pages.flatMap((p) => p.items.map((r) => r.occurrenceId))).toEqual([OCC, OCC2]);
  });

  it('does not retry a failed report by itself, even where the app’s client would', async () => {
    // The app's client retries once (app/_layout.tsx); a report that timed out already cost the server 15 s.
    const appLike = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0, gcTime: Infinity } } });
    mockSummary.mockRejectedValue(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    const h = await hook(() => useTeamSummary(ME, TODAY, true), { client: appLike });
    await eventually(async () => expect(h.result.current.error).toMatchObject({ code: 'REPORT_TIMEOUT' }));
    await settle();
    expect(mockSummary).toHaveBeenCalledTimes(1);
  });

  it('loads a run’s occurrence, and its execution only once there is one', async () => {
    mockOccurrence.mockResolvedValue(occurrenceDetail());
    mockExecution.mockResolvedValue({ id: EXECUTION });
    const o = await hook(() => useTeamOccurrence(ME, OCC, true));
    await eventually(async () => expect(o.result.current.data?.id).toBe(OCC));
    expect(mockOccurrence).toHaveBeenCalledWith(OCC);
    const none = await hook(() => useTeamExecution(ME, null, true));
    await settle();
    expect(mockExecution).not.toHaveBeenCalled();
    expect(none.result.current.fetchStatus).toBe('idle');
    await hook(() => useTeamExecution(ME, EXECUTION, true));
    await eventually(async () => expect(mockExecution).toHaveBeenCalledWith(EXECUTION));
  });

  it('refreshes the profile once after a 403, never for other errors', async () => {
    mockRefreshMe.mockResolvedValue(undefined);
    const timeout = new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT');
    const h = await hook(({ errors }: { errors: unknown[] }) => useRefreshMeOnForbidden(errors), { initialProps: { errors: [timeout, null] } });
    expect(mockRefreshMe).not.toHaveBeenCalled();
    await h.rerender({ errors: [forbidden(), forbidden()] });
    await h.rerender({ errors: [null] });
    await h.rerender({ errors: [forbidden()] });
    expect(mockRefreshMe).toHaveBeenCalledTimes(1);
  });

  it('logs a failed profile refresh instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRefreshMe.mockRejectedValue(ApiError.network());
    await hook(() => useRefreshMeOnForbidden([forbidden()]));
    await eventually(async () => expect(warn).toHaveBeenCalledWith('[team] Could not refresh the profile', 'NETWORK'));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/queries`
Expected: FAIL with `Cannot find module './queries'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/features/team/queries.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import type { LocalDate, ReportFiltersQuery, RunBucket } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, session } from '@/lib/session';

/** Team data this young counts as fresh (decision 7): switching chips back and forth reuses it. */
export const TEAM_STALE_MS = 30_000;

export interface TeamFilters {
  from: LocalDate;
  to: LocalDate;
  /** The picked employee; null = everyone in the viewer's scope. */
  userId: string | null;
}

/**
 * Every key starts with the viewer (decision 7): the app has one QueryClient for its whole life, so another manager
 * signing in on this phone must never be served this one's cache. The tab's own queries share `list`.
 */
export const teamKeys = {
  all: (viewerId: string) => ['team', viewerId] as const,
  list: (viewerId: string) => ['team', viewerId, 'list'] as const,
  summary: (viewerId: string, f: TeamFilters) => ['team', viewerId, 'list', 'summary', f.from, f.to, f.userId] as const,
  employees: (viewerId: string, from: LocalDate, to: LocalDate) => ['team', viewerId, 'list', 'employees', from, to] as const,
  runs: (viewerId: string, f: TeamFilters, bucket: RunBucket) => ['team', viewerId, 'list', 'runs', f.from, f.to, f.userId, bucket] as const,
  occurrence: (viewerId: string, id: string) => ['team', viewerId, 'run', 'occurrence', id] as const,
  execution: (viewerId: string, id: string) => ['team', viewerId, 'run', 'execution', id] as const,
};

/** The shared report filters (Part 1 `reportFiltersSchema`); `userId` only when someone is picked. */
export const filterQuery = (f: TeamFilters): ReportFiltersQuery => (f.userId ? { from: f.from, to: f.to, userId: f.userId } : { from: f.from, to: f.to });

/** Decision 7: no automatic retries (the user has a retry button; a timed-out report already cost the server 15 s). */
const common = { retry: false, staleTime: TEAM_STALE_MS } as const;

/** GET /reports/summary: the tiles. They follow the employee, not the status chip (decision 4). */
export const useTeamSummary = (viewerId: string, f: TeamFilters, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.summary(viewerId, f), queryFn: () => api.reports.summary(filterQuery(f)), enabled, ...common });

/** GET /reports/employees for the period only: the picker's list never shrinks to the person picked (decision 4). */
export const useTeamEmployees = (viewerId: string, from: LocalDate, to: LocalDate, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.employees(viewerId, from, to), queryFn: () => api.reports.employees({ from, to }), enabled, ...common });

/** GET /reports/runs, 50 a page; `nextCursor` goes back as `cursor` with the same filters. */
export const useTeamRuns = (viewerId: string, f: TeamFilters, bucket: RunBucket, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: teamKeys.runs(viewerId, f, bucket),
    queryFn: ({ pageParam }) => api.reports.runs({ ...filterQuery(f), bucket, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    ...common,
  });

/** GET /occurrences/:id: the run screen's header (decision 10). Part 1 Task 7 lets reports.view read it. */
export const useTeamOccurrence = (viewerId: string, occurrenceId: string, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.occurrence(viewerId, occurrenceId), queryFn: () => api.occurrences.get(occurrenceId), enabled, ...common });

/** GET /executions/:id: the answers and problems, only for a run that has an execution. */
export const useTeamExecution = (viewerId: string, executionId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: teamKeys.execution(viewerId, executionId ?? ''),
    queryFn: () => api.executions.get(executionId!),
    enabled: enabled && executionId !== null,
    ...common,
  });

/**
 * Decision 9: a 403 means the role changed after the profile was cached. Refreshing it lets the tab and the routes follow
 * (decision 1). Once per mounted screen: the header's queries fail together. A failed refresh is only logged.
 */
export function useRefreshMeOnForbidden(errors: readonly unknown[]): void {
  const asked = useRef(false);
  const forbidden = errors.some((e) => e instanceof ApiError && e.code === 'FORBIDDEN');
  useEffect(() => {
    if (!forbidden || asked.current) return;
    asked.current = true;
    session.refreshMe().catch((e: unknown) => console.warn('[team] Could not refresh the profile', e instanceof Error ? e.message : 'unknown error'));
  }, [forbidden]);
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/queries && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS, and Jest reports no open handles.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/team/queries.ts apps/mobile/src/features/team/queries.test.tsx
git commit -m "feat(mobile): team report queries, keyed per viewer, online only, without automatic retries" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Team screen: periods, tiles, status chips, employee picker, run rows, offline and errors

**Files:**
- Create: `apps/mobile/src/features/team/team-screen.tsx`, `count-tiles.tsx`, `run-row.tsx`, `employee-picker.tsx`, `team-offline.tsx` (all in `apps/mobile/src/features/team/`)
- Test: `apps/mobile/src/features/team/team-screen.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`teamPeriod`, `TEAM_PERIODS`, `TEAM_CHIPS`, `CHIP_BUCKETS`, `notCompleted`, `employeeChoices`, `EmployeeChoice`, `percentText`, `statusTone`, `runPerson`) and Task 3 (`useTeamSummary`, `useTeamEmployees`, `useTeamRuns`, `useRefreshMeOnForbidden`). Existing: `Choice` (`features/execution/parts`), `Badge` (`features/tasks/task-row`), `FormError` and `mobileErrorText`, `PrimaryButton`, `useSession`, `useOffline`, `useSyncStatus`, `useNow`, `formatDateTime`.
- Produces:
  - `TeamScreen()`;
  - `CountTiles({ summary: ReportSummary })`;
  - `RunRow({ run: ReportRun; timeZone: string; onPress(): void })`, with testID `run-<occurrenceId>`;
  - `EmployeePicker({ choices: EmployeeChoice[]; selected: EmployeeChoice | null; onChange(c: EmployeeChoice | null): void })`;
  - `TeamOffline()`.
  - The run list's `FlatList` has testID `team-runs`. A row press calls `router.push({ pathname: '/team/run/[id]', params: { id: occurrenceId } })`. Task 8 adds that route.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/team-screen.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { formatDateTime } from '@taskop/i18n';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { CHECKLIST, OCC, OCC2, OCC3, T } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TeamScreen } from './team-screen';
import { counts, employeeRow, KAMRAN, reportRun, reportSummary, runPage, teamMe, unassignedRow, VIEWER2, WORKER_A, WORKER_B } from './testing/fixtures';
import { gate, renderTeam, TeamProviders } from './testing/render';

const mockPush = jest.fn();
// useFocusEffect is a no-op here; Task 5's team-list.test.tsx drives focus.
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) }, useFocusEffect: () => undefined }));
const mockSummary = jest.fn();
const mockEmployees = jest.fn();
const mockRuns = jest.fn();
const mockRefreshMe = jest.fn();
let mockMe = teamMe();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: () => mockRefreshMe() },
  api: {
    reports: {
      summary: (...a: unknown[]) => mockSummary(...a),
      employees: (...a: unknown[]) => mockEmployees(...a),
      runs: (...a: unknown[]) => mockRuns(...a),
    },
  },
}));

const DAY = { from: '2026-11-02', to: '2026-11-02' };
const TIMEOUT_TEXT = 'Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.';
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Online by default; the clock at 08:10 on Monday 2 Nov in Baku unless `at` says otherwise. */
const world = (o: { online?: boolean; at?: string } = {}) => createTestServices({ online: o.online ?? true, at: o.at });

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = teamMe();
  mockSummary.mockResolvedValue(reportSummary({ counts: counts({ planned: 12, due: 10, completed: 7, overdue: 2, partial: 1, withProblems: 3 }), completionPercent: 70 }));
  mockEmployees.mockResolvedValue([employeeRow(), employeeRow({ userId: WORKER_B, name: KAMRAN.fullName, active: false }), unassignedRow()]);
  mockRuns.mockResolvedValue(runPage([reportRun()]));
  mockRefreshMe.mockResolvedValue(undefined);
});

describe('Team screen', () => {
  it('shows today’s six tiles and asks for every run of the tenant’s day', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    for (const label of ['Tamamlanıb: 7', 'Tamamlanmayıb: 3', 'Gecikib: 2', 'Yarımçıq: 1', 'Problemli: 3', 'Tamamlanma faizi: 70%']) {
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
    expect(mockSummary).toHaveBeenCalledWith(DAY);
    expect(mockEmployees).toHaveBeenCalledWith(DAY);
    expect(mockRuns).toHaveBeenCalledWith({ ...DAY, bucket: 'all' });
    expect(screen.getByRole('radio', { name: 'Bu gün' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('radio', { name: 'Hamısı' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('switches the period to 7 and 30 days, and writes — for an empty period', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await screen.findByLabelText('Tamamlanıb: 7');
    await fireEvent.press(screen.getByRole('radio', { name: '7 gün' }));
    await eventually(async () => expect(mockSummary).toHaveBeenLastCalledWith({ from: '2026-10-27', to: '2026-11-02' }));
    expect(mockRuns).toHaveBeenLastCalledWith({ from: '2026-10-27', to: '2026-11-02', bucket: 'all' });
    expect(mockEmployees).toHaveBeenLastCalledWith({ from: '2026-10-27', to: '2026-11-02' });
    mockSummary.mockResolvedValue(reportSummary());
    await fireEvent.press(screen.getByRole('radio', { name: '30 gün' }));
    expect(await screen.findByLabelText('Tamamlanma faizi: —')).toBeTruthy();
    expect(screen.getByLabelText('Tamamlanmayıb: 0')).toBeTruthy();
    expect(mockSummary).toHaveBeenLastCalledWith({ from: '2026-10-04', to: '2026-11-02' });
  });

  it('counts "Bu gün" on the tenant’s calendar, not the phone’s', async () => {
    mockMe = teamMe({ timezone: 'Pacific/Auckland' });
    const t = await world({ at: '2026-11-02T12:00:00.000Z' }); // 01:00 on 3 Nov in Auckland, still 2 Nov almost everywhere else
    await renderTeam(t.services, <TeamScreen />);
    await eventually(async () => expect(mockSummary).toHaveBeenCalledWith({ from: '2026-11-03', to: '2026-11-03' }));
    expect(mockRuns).toHaveBeenCalledWith({ from: '2026-11-03', to: '2026-11-03', bucket: 'all' });
  });

  it('moves to the new day at the tenant’s midnight while the screen stays open', async () => {
    const t = await world({ at: '2026-11-02T19:59:00.000Z' }); // 23:59 in Baku
    await renderTeam(t.services, <TeamScreen />);
    await eventually(async () => expect(mockSummary).toHaveBeenLastCalledWith(DAY));
    t.clock.set('2026-11-02T20:01:00.000Z'); // 00:01 on 3 Nov in Baku
    await act(async () => t.services.feed.emit());
    await eventually(async () => expect(mockSummary).toHaveBeenLastCalledWith({ from: '2026-11-03', to: '2026-11-03' }));
    expect(mockRuns).toHaveBeenLastCalledWith({ from: '2026-11-03', to: '2026-11-03', bucket: 'all' });
  });

  it('maps each status chip to its runs bucket and keeps the tiles', async () => {
    mockRuns.mockImplementation(async (q: { bucket: string }) => runPage([reportRun({ checklist: { id: CHECKLIST, name: `Yoxlama ${q.bucket}` } })]));
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText('Yoxlama all')).toBeTruthy();
    for (const [chip, bucket] of [['Gecikmiş', 'overdue'], ['Yarımçıq', 'partial'], ['Buraxılmış', 'missed'], ['Problemli', 'problems']] as const) {
      await fireEvent.press(screen.getByRole('radio', { name: chip }));
      expect(await screen.findByText(`Yoxlama ${bucket}`)).toBeTruthy();
      expect(mockRuns).toHaveBeenLastCalledWith({ ...DAY, bucket });
    }
    // Back to Hamısı within 30 s: the page from the start is still fresh, so it is shown without asking again.
    await fireEvent.press(screen.getByRole('radio', { name: 'Hamısı' }));
    expect(await screen.findByText('Yoxlama all')).toBeTruthy();
    expect(mockRuns).toHaveBeenCalledTimes(5);
    expect(mockSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Tamamlanıb: 7')).toBeTruthy();
  });

  it('filters by an employee of the period, never offering the Unassigned row', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Əməkdaş: Bütün əməkdaşlar' }));
    expect(screen.getByRole('radio', { name: 'Aynur Quliyeva' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Kamran Əliyev (Deaktiv)' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Təyin edilməyib' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Aynur Quliyeva' }));
    await eventually(async () => expect(mockRuns).toHaveBeenLastCalledWith({ ...DAY, userId: WORKER_A, bucket: 'all' }));
    expect(mockSummary).toHaveBeenLastCalledWith({ ...DAY, userId: WORKER_A });
    expect(mockEmployees).toHaveBeenCalledTimes(1); // the picker's list is the period's, not the person's
    await fireEvent.press(screen.getByRole('button', { name: 'Əməkdaş: Aynur Quliyeva' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Bütün əməkdaşlar' }));
    expect(await screen.findByRole('button', { name: 'Əməkdaş: Bütün əməkdaşlar' })).toBeTruthy();
    expect(mockSummary).toHaveBeenCalledTimes(2); // everyone's tiles are still fresh
  });

  it('keeps the chosen employee when the period changes and shows the empty state', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Əməkdaş: Bütün əməkdaşlar' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Aynur Quliyeva' }));
    // Aynur has nothing in the last 30 days.
    mockEmployees.mockResolvedValue([employeeRow({ userId: WORKER_B, name: KAMRAN.fullName })]);
    mockRuns.mockResolvedValue(runPage([]));
    await fireEvent.press(screen.getByRole('radio', { name: '30 gün' }));
    await eventually(async () => expect(mockRuns).toHaveBeenLastCalledWith({ from: '2026-10-04', to: '2026-11-02', userId: WORKER_A, bucket: 'all' }));
    expect(await screen.findByText('Bu dövr üçün məlumat yoxdur.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Əməkdaş: Aynur Quliyeva' })).toBeTruthy();
  });

  it('shows each run with checklist, site, person, due time, status and problems, and opens it', async () => {
    mockRuns.mockResolvedValue(
      runPage([
        reportRun({ clockSuspect: true }),
        reportRun({ occurrenceId: OCC2, executionId: null, status: 'missed', executor: null, startedAt: null, completedAt: null, completedReceivedAt: null, score: null, problemCount: 0, criticalCount: 0 }),
        reportRun({ occurrenceId: OCC3, executionId: null, status: 'overdue', assignees: [], executor: null, startedAt: null, completedAt: null, completedReceivedAt: null, score: null, problemCount: 0, criticalCount: 0 }),
      ]),
    );
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    const due = `Son vaxt: ${formatDateTime(T.due, { locale: 'az', timeZone: 'Asia/Baku' })}`;
    const done = within(await screen.findByTestId(`run-${OCC}`));
    for (const text of ['Açılış yoxlaması', 'Bakı filialı 1', 'Aynur Quliyeva', due, 'Tamamlanıb', 'Problem: 2', 'Kritik: 1', 'Telefon saatı şübhəlidir']) {
      expect(done.getByText(text)).toBeTruthy();
    }
    const missed = within(screen.getByTestId(`run-${OCC2}`));
    expect(missed.getByText('Aynur Quliyeva, Kamran Əliyev')).toBeTruthy();
    expect(missed.getByText('Buraxılıb')).toBeTruthy();
    expect(missed.queryByText(/^Problem:/)).toBeNull();
    const unassigned = within(screen.getByTestId(`run-${OCC3}`));
    expect(unassigned.getByText('Təyin edilməyib')).toBeTruthy();
    expect(unassigned.getByText('Gecikib')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`run-${OCC}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/team/run/[id]', params: { id: OCC } });
  });

  it('offline it asks for a connection, requests nothing, and loads once back online', async () => {
    const t = await world({ online: false });
    const sync = jest.spyOn(t.services, 'syncNow').mockResolvedValue(undefined);
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(sync).toHaveBeenCalledWith('manual');
    await settle();
    expect(mockSummary).not.toHaveBeenCalled();
    expect(mockEmployees).not.toHaveBeenCalled();
    expect(mockRuns).not.toHaveBeenCalled();
    t.net.online = true;
    await act(async () => t.services.engine.refresh());
    expect(await screen.findByLabelText('Tamamlanıb: 7')).toBeTruthy();
    expect(screen.queryByText('Komandanı görmək üçün internetə qoşulun')).toBeNull();
  });

  it('hides the team data it had when the phone goes offline', async () => {
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    await screen.findByLabelText('Tamamlanıb: 7');
    t.net.online = false;
    await act(async () => t.services.engine.refresh());
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(screen.queryByLabelText('Tamamlanıb: 7')).toBeNull();
    expect(screen.queryByTestId(`run-${OCC}`)).toBeNull();
  });

  it('shows a report timeout with a retry and does not retry by itself', async () => {
    mockSummary.mockRejectedValueOnce(new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT'));
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText(TIMEOUT_TEXT)).toBeTruthy();
    await settle();
    expect(mockSummary).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByLabelText('Tamamlanıb: 7')).toBeTruthy();
    expect(screen.queryByText(TIMEOUT_TEXT)).toBeNull();
    expect(mockSummary).toHaveBeenCalledTimes(2);
    expect(mockRuns).toHaveBeenCalledTimes(1); // only what failed is asked again
  });

  it('refreshes the profile once when the server says 403', async () => {
    const no = () => new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN');
    mockSummary.mockImplementation(async () => Promise.reject(no()));
    mockEmployees.mockImplementation(async () => Promise.reject(no()));
    mockRuns.mockImplementation(async () => Promise.reject(no()));
    const t = await world();
    await renderTeam(t.services, <TeamScreen />);
    expect(await screen.findByText('Bu əməliyyat üçün icazəniz yoxdur.')).toBeTruthy();
    await settle();
    expect(mockRefreshMe).toHaveBeenCalledTimes(1);
  });

  it('never shows the previous manager’s numbers to the next one', async () => {
    const t = await world();
    const view = await renderTeam(t.services, <TeamScreen />);
    await screen.findByLabelText('Tamamlanıb: 7');
    const next = gate();
    mockSummary.mockImplementation(async () => {
      await next.opened;
      return reportSummary({ counts: counts({ due: 1, completed: 1 }), completionPercent: 100 });
    });
    mockMe = teamMe({ id: VIEWER2 });
    await view.rerender(
      <TeamProviders services={t.services} client={view.client}>
        <TeamScreen />
      </TeamProviders>,
    );
    await eventually(async () => expect(mockSummary).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Tamamlanıb: 7')).toBeNull();
    await act(async () => next.open());
    expect(await screen.findByLabelText('Tamamlanıb: 1')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/team-screen`
Expected: FAIL with `Cannot find module './team-screen'`.

- [ ] **Step 3: Write the pieces**

`apps/mobile/src/features/team/team-offline.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';

/** Spec §7.1: team data is online only. Retry runs a manual sync, which reads the connection again (decision 8). */
export function TeamOffline() {
  const { t } = useTranslation();
  const services = useOffline();
  const retry = () =>
    void services.syncNow('manual').catch((e: unknown) => console.warn('[team] Manual sync failed', e instanceof Error ? e.message : 'unknown error'));
  return (
    <View style={styles.pad}>
      <Text style={styles.muted}>{t('mobile.team.offline')}</Text>
      <PrimaryButton title={t('common.retry')} onPress={retry} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md },
  muted: { color: colors.muted, fontSize: 16 },
});
```

`apps/mobile/src/features/team/count-tiles.tsx`:

```tsx
import type { ReportSummary } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { percentText } from './team-format';
import { notCompleted } from './team-rules';

/** Spec §7.1 (FR-16.03): completed, not completed, overdue, partial, with problems, completion %. */
export function CountTiles({ summary }: { summary: ReportSummary }) {
  const { t } = useTranslation();
  const c = summary.counts;
  const tiles = [
    { key: 'completed', label: t('reports.counts.completed'), value: String(c.completed), color: colors.success },
    { key: 'notCompleted', label: t('reports.notCompleted'), value: String(notCompleted(c)), color: colors.text },
    { key: 'overdue', label: t('reports.counts.overdue'), value: String(c.overdue), color: colors.danger },
    { key: 'partial', label: t('reports.counts.partial'), value: String(c.partial), color: colors.warning },
    { key: 'withProblems', label: t('reports.counts.withProblems'), value: String(c.withProblems), color: colors.danger },
    { key: 'completionPercent', label: t('reports.measures.completionPercent'), value: percentText(t, summary.completionPercent), color: colors.primary },
  ];
  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <View key={tile.key} testID={`tile-${tile.key}`} accessible accessibilityLabel={`${tile.label}: ${tile.value}`} style={styles.tile}>
          <Text style={[styles.value, { color: tile.color }]}>{tile.value}</Text>
          <Text style={styles.label}>{tile.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: 72,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  value: { fontSize: 22, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 13 },
});
```

`apps/mobile/src/features/team/run-row.tsx`:

```tsx
import type { ReportRun } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Badge } from '@/features/tasks/task-row';
import { colors, spacing } from '@/lib/theme';
import { runPerson, statusTone } from './team-format';

/** Spec §7.1: checklist, site, person, due time, status badge and problem count; the clock-suspect flag too (spec §8). */
export function RunRow({ run, timeZone, onPress }: { run: ReportRun; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const person = runPerson(t, run);
  const due = t('mobile.team.due', { time: formatDateTime(run.dueAt, { locale: 'az', timeZone }) });
  const status = t(`scheduling.statuses.${run.status}`);
  const problems = run.problemCount > 0 ? t('mobile.team.problems', { count: run.problemCount }) : null;
  return (
    <Pressable
      accessibilityRole="button"
      // The label replaces the children for a screen reader, so it carries all of them.
      accessibilityLabel={[run.checklist.name, run.site.name, person, due, status, problems].filter(Boolean).join('. ')}
      testID={`run-${run.occurrenceId}`}
      onPress={onPress}
      style={styles.card}
    >
      <Text style={styles.title}>{run.checklist.name}</Text>
      <Text style={styles.muted}>{run.site.name}</Text>
      <Text style={styles.muted}>{person}</Text>
      <Text style={styles.muted}>{due}</Text>
      <View style={styles.badges}>
        <Badge text={status} tone={statusTone(run.status)} />
        {problems ? <Badge text={problems} tone={run.criticalCount > 0 ? 'danger' : 'warning'} /> : null}
        {run.criticalCount > 0 ? <Badge text={t('mobile.team.critical', { count: run.criticalCount })} tone="danger" /> : null}
        {run.late ? <Badge text={t('executions.flags.late')} tone="warning" /> : null}
        {run.clockSuspect ? <Badge text={t('executions.flags.clockSuspect')} tone="warning" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
```

`apps/mobile/src/features/team/employee-picker.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import type { EmployeeChoice } from './team-rules';

/** Spec §7.1: one employee of the period, or everyone. The choice is the screen's, and survives a period change (decision 6). */
export function EmployeePicker({ choices, selected, onChange }: { choices: EmployeeChoice[]; selected: EmployeeChoice | null; onChange: (c: EmployeeChoice | null) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = `${t('reports.filters.employee')}: ${selected?.name ?? t('reports.filters.allEmployees')}`;
  const pick = (c: EmployeeChoice | null) => {
    setOpen(false);
    onChange(c);
  };
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={styles.button}>
        <Text style={styles.buttonText}>{label} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>{t('reports.filters.employee')}</Text>
            <ScrollView contentContainerStyle={styles.options}>
              <Option label={t('reports.filters.allEmployees')} selected={selected === null} onPress={() => pick(null)} />
              {choices.map((c) => (
                <Option
                  key={c.userId}
                  label={c.active ? c.name : `${c.name} (${t('reports.inactive')})`}
                  selected={selected?.userId === c.userId}
                  onPress={() => pick(c)}
                />
              ))}
            </ScrollView>
            <PrimaryButton variant="outline" title={t('common.close')} onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected ? styles.optionOn : null]}>
      <Text style={[styles.optionText, selected ? styles.optionTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontSize: 15 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { maxHeight: '80%', backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  options: { gap: spacing.sm },
  option: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  optionOn: { borderColor: colors.primary },
  optionText: { color: colors.text, fontSize: 15 },
  optionTextOn: { color: colors.primary, fontWeight: '600' },
});
```

- [ ] **Step 4: Write the screen**

`apps/mobile/src/features/team/team-screen.tsx`:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Choice } from '@/features/execution/parts';
import { useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useNow, useSyncStatus } from '@/offline/hooks';
import { CountTiles } from './count-tiles';
import { EmployeePicker } from './employee-picker';
import { useRefreshMeOnForbidden, useTeamEmployees, useTeamRuns, useTeamSummary } from './queries';
import { RunRow } from './run-row';
import { TeamOffline } from './team-offline';
import { CHIP_BUCKETS, type EmployeeChoice, employeeChoices, TEAM_CHIPS, TEAM_PERIODS, type TeamChip, type TeamPeriod, teamPeriod } from './team-rules';

/** Spec §7.1: the manager's Team tab. Online only and react-query only: nothing is written to the phone's database. */
export function TeamScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const now = useNow();
  const [preset, setPreset] = useState<TeamPeriod>('today');
  const [chip, setChip] = useState<TeamChip>('all');
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const me = s.status === 'authenticated' ? s.me : null;
  const viewerId = me?.user.id ?? '';
  const timeZone = me?.tenant.timezone ?? services.timeZone;
  // Decision 2: the tenant's day, recomputed on every tick, so "Bu gün" turns over at the tenant's midnight.
  const period = teamPeriod(preset, now, timeZone);
  const filters = { from: period.from, to: period.to, userId: employee?.userId ?? null };
  const live = online && me !== null;
  const summary = useTeamSummary(viewerId, filters, live);
  const employees = useTeamEmployees(viewerId, period.from, period.to, live);
  const runs = useTeamRuns(viewerId, filters, CHIP_BUCKETS[chip], live);
  useRefreshMeOnForbidden([summary.error, employees.error, runs.error]);

  if (!me) return null;
  if (!online) {
    // Decision 8: what was loaded is not shown offline; only the spec's message is.
    return (
      <SafeAreaView style={styles.safe}>
        <Text accessibilityRole="header" style={[styles.title, styles.pad]}>
          {t('mobile.team.title')}
        </Text>
        <TeamOffline />
      </SafeAreaView>
    );
  }

  const error = summary.error ?? employees.error ?? runs.error;
  // Decision 18: only what failed is asked again.
  const retry = () => {
    if (summary.isError) void summary.refetch();
    if (employees.isError) void employees.refetch();
    if (runs.isError) void runs.refetch();
  };
  const rows = runs.data?.pages.flatMap((p) => p.items) ?? [];
  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('mobile.team.title')}
      </Text>
      <View style={styles.chips}>
        {TEAM_PERIODS.map((p) => (
          <Choice key={p} role="radio" label={t(`mobile.team.periods.${p}`)} selected={preset === p} onPress={() => setPreset(p)} />
        ))}
      </View>
      {summary.data ? <CountTiles summary={summary.data} /> : summary.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      <View style={styles.chips}>
        {TEAM_CHIPS.map((c) => (
          <Choice key={c} role="radio" label={t(`reports.buckets.${c}`)} selected={chip === c} onPress={() => setChip(c)} />
        ))}
      </View>
      <EmployeePicker choices={employees.data ? employeeChoices(employees.data) : []} selected={employee} onChange={setEmployee} />
      {error ? (
        <View style={styles.error}>
          <FormError message={mobileErrorText(t, error)} />
          <PrimaryButton variant="outline" title={t('common.retry')} onPress={retry} />
        </View>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        testID="team-runs"
        data={rows}
        keyExtractor={(r) => r.occurrenceId}
        renderItem={({ item }) => (
          <RunRow run={item} timeZone={timeZone} onPress={() => router.push({ pathname: '/team/run/[id]', params: { id: item.occurrenceId } })} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={runs.isPending ? <ActivityIndicator color={colors.primary} /> : runs.isError ? null : <Text style={styles.muted}>{t('reports.empty')}</Text>}
        ListFooterComponent={runs.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { gap: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm },
  muted: { color: colors.muted },
});
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. Only this file's tests are new. If `typecheck` complains about `'/team/run/[id]'`, a stale `.expo/types` folder is present: delete `apps/mobile/.expo/types` (see Global Constraints, typed routes).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/team/team-screen.tsx apps/mobile/src/features/team/team-screen.test.tsx apps/mobile/src/features/team/count-tiles.tsx apps/mobile/src/features/team/run-row.tsx apps/mobile/src/features/team/employee-picker.tsx apps/mobile/src/features/team/team-offline.tsx
git commit -m "feat(mobile): Team screen with period chips, count tiles, status and employee filters, run rows and offline state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Team list paging: infinite scroll, pull-to-refresh, races and refocus

**Files:**
- Modify: `apps/mobile/src/features/team/team-screen.tsx`
- Test: `apps/mobile/src/features/team/team-list.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`uniqueRuns`), Task 3 (`teamKeys.list`, `TEAM_STALE_MS`, `useTeamRuns`), Task 4 (`TeamScreen`, testID `team-runs`, `run-<occurrenceId>`).
- Produces:
  - `TeamScreen` gains these behaviours, with no new exports:
    - `onEndReached` → `fetchNextPage({ cancelRefetch: false })`, only while `hasNextPage && !isFetching && !isFetchNextPageError`;
    - `refreshing` and `onRefresh` refetch the summary, the employees and the runs;
    - rows go through `uniqueRuns`;
    - a refocus after the first refetches the stale `teamKeys.list(viewerId)` queries;
    - after a failed next page, retry asks for that page again.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/team-list.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { act, fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { CHECKLIST, OCC, OCC2, OCC3, OCC4 } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TEAM_STALE_MS } from './queries';
import { TeamScreen } from './team-screen';
import { counts, employeeRow, reportRun, reportSummary, RUN_CURSOR, runPage, teamMe } from './testing/fixtures';
import { gate, renderTeam } from './testing/render';

const mockFocus = { set: (_focused: boolean) => undefined as void };
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  // The screen is focused while rendered, until mockFocus.set(false) blurs it.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const react = jest.requireActual<typeof import('react')>('react');
    const [focused, setFocused] = react.useState(true);
    mockFocus.set = setFocused;
    react.useEffect(() => (focused ? effect() : undefined), [effect, focused]);
  },
}));
const mockSummary = jest.fn();
const mockEmployees = jest.fn();
const mockRuns = jest.fn();
const mockMe = teamMe();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: jest.fn(async () => undefined) },
  api: {
    reports: {
      summary: (...a: unknown[]) => mockSummary(...a),
      employees: (...a: unknown[]) => mockEmployees(...a),
      runs: (...a: unknown[]) => mockRuns(...a),
    },
  },
}));

const run = (occurrenceId: string, name = 'Açılış yoxlaması') => reportRun({ occurrenceId, checklist: { id: CHECKLIST, name } });
const rowIds = () => screen.queryAllByTestId(/^run-/).map((e) => (e.props.testID as string).slice('run-'.length));
const cursorCalls = () => mockRuns.mock.calls.filter(([q]) => (q as { cursor?: string }).cursor).length;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function opened() {
  const t = await createTestServices({ online: true });
  await renderTeam(t.services, <TeamScreen />);
  await screen.findByTestId(`run-${OCC}`);
  return t;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus.set = () => undefined;
  mockSummary.mockResolvedValue(reportSummary({ counts: counts({ due: 3, completed: 1 }), completionPercent: 33.3 }));
  mockEmployees.mockResolvedValue([employeeRow()]);
  mockRuns.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? runPage([run(OCC3)]) : runPage([run(OCC), run(OCC2)], RUN_CURSOR)));
});
afterEach(() => jest.restoreAllMocks());

describe('Team run list', () => {
  it('loads the next page at the end of the list and stops at the last page', async () => {
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    expect(await screen.findByTestId(`run-${OCC3}`)).toBeTruthy();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await settle();
    expect(mockRuns.mock.calls.map(([q]) => (q as { cursor?: string }).cursor ?? null)).toEqual([null, RUN_CURSOR]);
    expect(rowIds()).toEqual([OCC, OCC2, OCC3]);
  });

  it('asks for a page once when the end is reached twice while it loads', async () => {
    const next = gate();
    mockRuns.mockImplementation(async (q: { cursor?: string }) => {
      if (!q.cursor) return runPage([run(OCC), run(OCC2)], RUN_CURSOR);
      await next.opened;
      return runPage([run(OCC3)]);
    });
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    expect(cursorCalls()).toBe(1);
    await act(async () => next.open());
    expect(await screen.findByTestId(`run-${OCC3}`)).toBeTruthy();
    expect(cursorCalls()).toBe(1);
  });

  it('pull to refresh reloads tiles, people and runs, and drops a next page that was loading', async () => {
    const next = gate();
    let first = [run(OCC), run(OCC2)];
    mockRuns.mockImplementation(async (q: { cursor?: string }) => {
      if (!q.cursor) return runPage(first, RUN_CURSOR);
      await next.opened;
      return runPage([run(OCC3, 'Köhnə səhifə')]);
    });
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await eventually(async () => expect(cursorCalls()).toBe(1));
    first = [run(OCC4), run(OCC)];
    await fireEvent(screen.getByTestId('team-runs'), 'refresh');
    await eventually(async () => expect(rowIds()).toEqual([OCC4, OCC]));
    expect(mockSummary).toHaveBeenCalledTimes(2);
    expect(mockEmployees).toHaveBeenCalledTimes(2);
    await act(async () => next.open());
    await settle();
    expect(rowIds()).toEqual([OCC4, OCC]);
    expect(screen.queryByText('Köhnə səhifə')).toBeNull();
  });

  it('shows a run once when it comes on two pages', async () => {
    mockRuns.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? runPage([run(OCC2), run(OCC3)]) : runPage([run(OCC), run(OCC2)], RUN_CURSOR)));
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await screen.findByTestId(`run-${OCC3}`);
    expect(rowIds()).toEqual([OCC, OCC2, OCC3]);
  });

  it('keeps the rows when a next page fails, does not ask again by itself, and retries that page', async () => {
    let fail = true;
    mockRuns.mockImplementation(async (q: { cursor?: string }) => {
      if (!q.cursor) return runPage([run(OCC), run(OCC2)], RUN_CURSOR);
      if (fail) {
        fail = false;
        throw ApiError.network();
      }
      return runPage([run(OCC3)]);
    });
    await opened();
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeTruthy();
    expect(rowIds()).toEqual([OCC, OCC2]);
    await fireEvent(screen.getByTestId('team-runs'), 'endReached');
    await settle();
    expect(cursorCalls()).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByTestId(`run-${OCC3}`)).toBeTruthy();
    expect(cursorCalls()).toBe(2);
    expect(mockRuns.mock.calls.filter(([q]) => !(q as { cursor?: string }).cursor)).toHaveLength(1); // the first page was not asked again
  });

  it('reloads stale data when the tab is focused again, and fresh data not', async () => {
    await opened();
    await act(async () => mockFocus.set(false));
    await act(async () => mockFocus.set(true));
    await settle();
    expect(mockSummary).toHaveBeenCalledTimes(1);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + TEAM_STALE_MS + 1_000);
    await act(async () => mockFocus.set(false));
    await act(async () => mockFocus.set(true));
    await eventually(async () => expect(mockSummary).toHaveBeenCalledTimes(2));
    expect(mockEmployees).toHaveBeenCalledTimes(2);
    expect(mockRuns.mock.calls.filter(([q]) => !(q as { cursor?: string }).cursor)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/team-list`
Expected: FAIL. `loads the next page…` finds no `run-<OCC3>`, because the list has no `onEndReached`. The refresh, refocus and failed-page tests fail too.

- [ ] **Step 3: Implement**

Replace `apps/mobile/src/features/team/team-screen.tsx` with:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Choice } from '@/features/execution/parts';
import { useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useNow, useSyncStatus } from '@/offline/hooks';
import { CountTiles } from './count-tiles';
import { EmployeePicker } from './employee-picker';
import { teamKeys, useRefreshMeOnForbidden, useTeamEmployees, useTeamRuns, useTeamSummary } from './queries';
import { RunRow } from './run-row';
import { TeamOffline } from './team-offline';
import {
  CHIP_BUCKETS,
  type EmployeeChoice,
  employeeChoices,
  TEAM_CHIPS,
  TEAM_PERIODS,
  type TeamChip,
  type TeamPeriod,
  teamPeriod,
  uniqueRuns,
} from './team-rules';

/** Spec §7.1: the manager's Team tab. Online only and react-query only: nothing is written to the phone's database. */
export function TeamScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const now = useNow();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<TeamPeriod>('today');
  const [chip, setChip] = useState<TeamChip>('all');
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const me = s.status === 'authenticated' ? s.me : null;
  const viewerId = me?.user.id ?? '';
  const timeZone = me?.tenant.timezone ?? services.timeZone;
  // Decision 2: the tenant's day, recomputed on every tick, so "Bu gün" turns over at the tenant's midnight.
  const period = teamPeriod(preset, now, timeZone);
  const filters = { from: period.from, to: period.to, userId: employee?.userId ?? null };
  const live = online && me !== null;
  const summary = useTeamSummary(viewerId, filters, live);
  const employees = useTeamEmployees(viewerId, period.from, period.to, live);
  const runs = useTeamRuns(viewerId, filters, CHIP_BUCKETS[chip], live);
  useRefreshMeOnForbidden([summary.error, employees.error, runs.error]);

  // Decision 7: Tabs keep this screen mounted; coming back to it reloads what has gone stale (not on the first focus).
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      if (live) void queryClient.refetchQueries({ queryKey: teamKeys.list(viewerId), type: 'active', stale: true });
    }, [live, queryClient, viewerId]),
  );

  if (!me) return null;
  if (!online) {
    // Decision 8: what was loaded is not shown offline; only the spec's message is.
    return (
      <SafeAreaView style={styles.safe}>
        <Text accessibilityRole="header" style={[styles.title, styles.pad]}>
          {t('mobile.team.title')}
        </Text>
        <TeamOffline />
      </SafeAreaView>
    );
  }

  const error = summary.error ?? employees.error ?? runs.error;
  // Decision 18: only what failed is asked again; a failed next page keeps the rows and asks for that same page.
  const retry = () => {
    if (summary.isError) void summary.refetch();
    if (employees.isError) void employees.refetch();
    if (runs.isError) void (runs.isFetchNextPageError ? runs.fetchNextPage({ cancelRefetch: false }) : runs.refetch());
  };
  // Decision 16: refetch() cancels a next page still loading, so a stale page is never appended to the fresh first one.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([summary.refetch(), employees.refetch(), runs.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };
  // Decision 16: one page at a time, never during a refresh, and never again by itself after a failed page.
  const loadMore = () => {
    if (runs.hasNextPage && !runs.isFetching && !runs.isFetchNextPageError) void runs.fetchNextPage({ cancelRefetch: false });
  };
  const rows = runs.data ? uniqueRuns(runs.data.pages) : [];
  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('mobile.team.title')}
      </Text>
      <View style={styles.chips}>
        {TEAM_PERIODS.map((p) => (
          <Choice key={p} role="radio" label={t(`mobile.team.periods.${p}`)} selected={preset === p} onPress={() => setPreset(p)} />
        ))}
      </View>
      {summary.data ? <CountTiles summary={summary.data} /> : summary.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      <View style={styles.chips}>
        {TEAM_CHIPS.map((c) => (
          <Choice key={c} role="radio" label={t(`reports.buckets.${c}`)} selected={chip === c} onPress={() => setChip(c)} />
        ))}
      </View>
      <EmployeePicker choices={employees.data ? employeeChoices(employees.data) : []} selected={employee} onChange={setEmployee} />
      {error ? (
        <View style={styles.error}>
          <FormError message={mobileErrorText(t, error)} />
          <PrimaryButton variant="outline" title={t('common.retry')} onPress={retry} />
        </View>
      ) : null}
    </View>
  );
  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        testID="team-runs"
        data={rows}
        keyExtractor={(r) => r.occurrenceId}
        renderItem={({ item }) => (
          <RunRow run={item} timeZone={timeZone} onPress={() => router.push({ pathname: '/team/run/[id]', params: { id: item.occurrenceId } })} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={runs.isPending ? <ActivityIndicator color={colors.primary} /> : runs.isError ? null : <Text style={styles.muted}>{t('reports.empty')}</Text>}
        ListFooterComponent={runs.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : null}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { gap: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm },
  muted: { color: colors.muted },
});
```

- [ ] **Step 4: Run the Team tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS, both `team-screen.test.tsx` (Task 4) and `team-list.test.tsx`, with no open handles.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/team/team-screen.tsx apps/mobile/src/features/team/team-list.test.tsx
git commit -m "feat(mobile): Team list infinite scroll, pull-to-refresh and refocus reload without paging races" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: A read-only answer display pulled out of the execution components

**Files:**
- Modify: `apps/mobile/src/features/execution/parts.tsx`, `apps/mobile/src/features/execution/item-field.tsx`
- Create: `apps/mobile/src/features/execution/answer-view.tsx`
- Test: `apps/mobile/src/features/execution/answer-view.test.tsx`
- Unchanged and run: `apps/mobile/src/features/execution/execution-screen.test.tsx`, `apps/mobile/src/features/execution/finish-screen.test.tsx`

**Interfaces:**
- Consumes: existing `Choice` (`parts.tsx`), `fromAnswerDatetime` (`datetime-format.ts`), `RemoteMediaStrip` and `type RemoteMedia` (`features/tasks/remote-media.tsx`), `Badge` (`features/tasks/task-row.tsx`), `visibleItems` and `walkItems` from contracts, and the types `Answer`, `Answers`, `ChecklistContent`, `ExecutionMediaDto`, `ExecutionProblem`, `Item`, `MediaKind`, `MediaUrl`. Task 1 fixtures (`executionDetail`, `PHOTO`, `PROBLEM`, `PROBLEM2`, `PROBLEM_PHOTO`, `UNREGISTERED_PHOTO`).
- Produces:
  - `parts.tsx`:
    - `choiceOptions(item: Item, t: TFunction): { id: string; label: string }[] | null`;
    - `Options(p: { options: readonly { id: string; label: string }[]; selected: string[]; multi: boolean; disabled: boolean; onChange(ids: string[]): void })`, moved here unchanged from `item-field.tsx`.
  - `answer-view.tsx`:
    - `remoteMedia(ids: readonly string[], media: readonly ExecutionMediaDto[], kind: MediaKind): RemoteMedia[]`;
    - `answerText(item: Item, a: Answer | undefined): string | null`;
    - `ReadOnlyAnswers(p: { content: ChecklistContent; answers: Answers; media: readonly ExecutionMediaDto[]; problems: readonly ExecutionProblem[]; load(id: string): Promise<MediaUrl> })`, which renders one card per visible item with testID `answer-<itemId>`;
    - `ReadOnlyProblems(p: { content; problems; media; load })`, which renders one card per problem with testID `problem-<problemId>`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/execution/answer-view.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { executionDetail, PHOTO, PROBLEM, PROBLEM2, PROBLEM_PHOTO, UNREGISTERED_PHOTO } from '@/features/team/testing/fixtures';
import { checklist, type Checklist } from '@/offline/testing/fixtures';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ReadOnlyAnswers, ReadOnlyProblems } from './answer-view';

jest.mock('./capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockUrl = jest.fn(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));

async function show(c: Checklist = checklist(), over: Parameters<typeof executionDetail>[1] = {}) {
  const t = await createTestServices({ online: true });
  const d = executionDetail(c, over);
  await renderWithServices(
    t.services,
    <>
      <ReadOnlyAnswers content={d.content} answers={d.answers} media={d.media} problems={d.problems} load={mockUrl} />
      <ReadOnlyProblems content={d.content} problems={d.problems} media={d.media} load={mockUrl} />
    </>,
  );
  return c;
}

beforeEach(() => mockUrl.mockClear());

describe('read-only answers', () => {
  it('shows each section’s visible items with the answers as the worker left them', async () => {
    const c = await show();
    expect(screen.getByText('Zal')).toBeTruthy();
    expect(screen.getByText('Vitrin')).toBeTruthy();
    const problem = within(screen.getByTestId(`answer-${c.problem.id}`));
    expect(problem.getByRole('radio', { name: 'Bəli' }).props.accessibilityState).toEqual({ selected: true, disabled: true });
    expect(problem.getByRole('radio', { name: 'Xeyr' }).props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(problem.getByText('Problem qeyd olunub')).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.comment.id}`)).getByText('Kompressor səs salır')).toBeTruthy();
    const temp = within(screen.getByTestId(`answer-${c.temp.id}`));
    expect(temp.getByText('10 °C')).toBeTruthy();
    expect(temp.getByText('Qeyd: Kondisioner xarabdır')).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.photo.id}`)).getByText('Cavab verilməyib')).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.note.id}`)).getByText('Cavab verilməyib')).toBeTruthy();
  });

  it('can change nothing: no input fields, no capture or ⚑ buttons, every choice disabled', async () => {
    await show();
    expect(screen.queryByDisplayValue('Kompressor səs salır')).toBeNull();
    expect(screen.queryByDisplayValue('10')).toBeNull();
    expect(screen.queryByRole('button', { name: /Problem qeyd et/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Kamera|Qalereya/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'İndi' })).toBeNull();
    for (const radio of screen.getAllByRole('radio')) expect(radio.props.accessibilityState.disabled).toBe(true);
  });

  it('leaves out an answer to a follow-up that the final answer hides', async () => {
    const c = checklist();
    await show(c, { answers: { [c.problem.id]: { optionIds: [c.no.id] }, [c.comment.id]: { text: 'Köhnə cavab' } }, problems: [] });
    expect(screen.queryByTestId(`answer-${c.comment.id}`)).toBeNull();
    expect(screen.queryByText('Köhnə cavab')).toBeNull();
  });

  it('draws evidence through presigned URLs and marks a medium the server does not have yet', async () => {
    const c = checklist();
    await show(c, { answers: { [c.problem.id]: { optionIds: [c.yes.id], photos: [PHOTO] }, [c.photo.id]: { photos: [UNREGISTERED_PHOTO] } }, problems: [] });
    expect(await within(screen.getByTestId(`answer-${c.problem.id}`)).findByTestId(`remote-${PHOTO}`)).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.photo.id}`)).getByTestId(`pending-${UNREGISTERED_PHOTO}`)).toBeTruthy();
    expect(mockUrl).toHaveBeenCalledWith(PHOTO);
    expect(mockUrl).not.toHaveBeenCalledWith(UNREGISTERED_PHOTO);
  });

  it('lists the problems with their item, severity, source, resolution, note and media', async () => {
    await show();
    expect(screen.getByText('Problemlər')).toBeTruthy();
    const critical = within(screen.getByTestId(`problem-${PROBLEM}`));
    for (const text of ['Soyuducuda problem varmı?', 'Kritik', 'Qayda üzrə', 'Tapşırıq yoxdur']) expect(critical.getByText(text)).toBeTruthy();
    expect(await critical.findByTestId(`remote-${PHOTO}`)).toBeTruthy();
    const manual = within(screen.getByTestId(`problem-${PROBLEM2}`));
    for (const text of ['Temperatur', 'Adi', 'Əl ilə qeyd', 'Açıq', 'Termometr sınıb']) expect(manual.getByText(text)).toBeTruthy();
    expect(manual.getByTestId(`pending-${PROBLEM_PHOTO}`)).toBeTruthy();
  });

  it('says when the run has no answers, and lists no problems section without problems', async () => {
    await show(checklist(), { answers: {}, problems: [] });
    expect(screen.getByText('Bu icrada cavab yoxdur.')).toBeTruthy();
    expect(screen.queryByText('Problemlər')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution/answer-view`
Expected: FAIL with `Cannot find module './answer-view'`.

- [ ] **Step 3: Move `Options` into `parts.tsx` and add `choiceOptions`**

In `apps/mobile/src/features/execution/parts.tsx`, replace the first line (`import type { MediaKind, MediaSource } from '@taskop/contracts';`) with:

```ts
import type { Item, MediaKind, MediaSource } from '@taskop/contracts';
import type { TFunction } from 'i18next';
```

Then add, directly after the `Choice` function:

```tsx
/**
 * A choice item's options with their labels: yes/no and confirm/deny are fixed keys put into words, single and multi
 * choice carry their own labels. Null for every other item type. Shared by the worker's field and the read-only display.
 */
export function choiceOptions(item: Item, t: TFunction): { id: string; label: string }[] | null {
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny':
      return (item.options as readonly { id: string; key: string }[]).map((o) => ({ id: o.id, label: t(`checklists.builder.fixedOptions.${o.key}`) }));
    case 'single_choice':
    case 'multi_choice':
      return item.options.map((o) => ({ id: o.id, label: o.label }));
    default:
      return null;
  }
}

export function Options(p: { options: readonly { id: string; label: string }[]; selected: string[]; multi: boolean; disabled: boolean; onChange: (ids: string[]) => void }) {
  return (
    <View style={styles.options}>
      {p.options.map((o) => {
        const on = p.selected.includes(o.id);
        return (
          <Choice
            key={o.id}
            label={o.label}
            selected={on}
            role={p.multi ? 'checkbox' : 'radio'}
            disabled={p.disabled}
            onPress={() => p.onChange(p.multi ? (on ? p.selected.filter((x) => x !== o.id) : [...p.selected, o.id]) : [o.id])}
          />
        );
      })}
    </View>
  );
}
```

and add as the first entry of `parts.tsx`'s `StyleSheet.create({ … })`:

```ts
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
```

- [ ] **Step 4: Make `item-field.tsx` use them (no behaviour change)**

In `apps/mobile/src/features/execution/item-field.tsx`:

1. Replace `import { Chip, Choice, EvidenceRow } from './parts';` with:

```ts
import { Chip, choiceOptions, EvidenceRow, Options } from './parts';
```

2. Delete the whole `function Options(p: { … }) { … }` (it now lives in `parts.tsx`, unchanged).

3. In `AnswerInput`, replace the two cases

```tsx
    case 'yes_no':
    case 'confirm_deny': {
      const options = (item.options as readonly { id: string; key: string }[]).map((o) => ({ id: o.id, label: t(`checklists.builder.fixedOptions.${o.key}`) }));
      return <Options options={options} selected={answer?.optionIds ?? []} multi={false} disabled={p.readOnly} onChange={(optionIds) => p.onPatch({ optionIds })} />;
    }
    case 'single_choice':
    case 'multi_choice':
      return <Options options={item.options} selected={answer?.optionIds ?? []} multi={item.type === 'multi_choice'} disabled={p.readOnly} onChange={(optionIds) => p.onPatch({ optionIds })} />;
```

with:

```tsx
    case 'yes_no':
    case 'confirm_deny':
    case 'single_choice':
    case 'multi_choice':
      return (
        <Options
          options={choiceOptions(item, t) ?? []}
          selected={answer?.optionIds ?? []}
          multi={item.type === 'multi_choice'}
          disabled={p.readOnly}
          onChange={(optionIds) => p.onPatch({ optionIds })}
        />
      );
```

4. Delete the `options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },` entry from `item-field.tsx`'s `StyleSheet.create`. Nothing in that file uses it any more.

- [ ] **Step 5: Check that the worker flow did not change**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution src/features/home src/features/sync && pnpm --filter @taskop/mobile typecheck`
Expected: every existing test passes, including `execution-screen.test.tsx` and `finish-screen.test.tsx`, which this task does not edit. `answer-view.test.tsx` still fails (Step 6 writes it).

- [ ] **Step 6: Write the read-only display**

`apps/mobile/src/features/execution/answer-view.tsx`:

```tsx
import {
  type Answer,
  type Answers,
  type ChecklistContent,
  type ExecutionMediaDto,
  type ExecutionProblem,
  type Item,
  type MediaKind,
  type MediaUrl,
  visibleItems,
  walkItems,
} from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { type RemoteMedia, RemoteMediaStrip } from '@/features/tasks/remote-media';
import { Badge } from '@/features/tasks/task-row';
import { colors, spacing } from '@/lib/theme';
import { fromAnswerDatetime } from './datetime-format';
import { choiceOptions, Options } from './parts';

type LoadUrl = (mediaId: string) => Promise<MediaUrl>;

/** Server media by id (decision 13): an id the server has not registered yet is drawn as not uploaded. */
export function remoteMedia(ids: readonly string[], media: readonly ExecutionMediaDto[], kind: MediaKind): RemoteMedia[] {
  const byId = new Map(media.map((m) => [m.id, m]));
  return ids.map((id) => {
    const m = byId.get(id);
    return m ? { id, kind: m.kind, status: m.status } : { id, kind, status: 'pending' };
  });
}

/**
 * A non-choice answer as text, as the worker's field shows it (decision 12): a number with its unit, the text, the date
 * through `fromAnswerDatetime`. Null when unanswered. Photo and video items have none: their media are the answer.
 */
export function answerText(item: Item, a: Answer | undefined): string | null {
  if (!a) return null;
  switch (item.type) {
    case 'number':
      return typeof a.number === 'number' ? (item.unit ? `${a.number} ${item.unit}` : String(a.number)) : null;
    case 'text':
    case 'comment':
      return a.text?.trim() ? a.text : null;
    case 'datetime':
      return a.datetime ? fromAnswerDatetime(item.mode, a.datetime) : null;
    default:
      return null;
  }
}

/** SP7 spec §7.2: an execution's answers, read-only, in the pinned version's layout. Hidden follow-ups are left out. */
export function ReadOnlyAnswers(p: { content: ChecklistContent; answers: Answers; media: readonly ExecutionMediaDto[]; problems: readonly ExecutionProblem[]; load: LoadUrl }) {
  const { t } = useTranslation();
  if (Object.keys(p.answers).length === 0) return <Text style={styles.muted}>{t('executions.noAnswers')}</Text>;
  const visible = visibleItems(p.content, p.answers);
  const flagged = new Set(p.problems.map((x) => x.itemId));
  return (
    <View style={styles.list}>
      {p.content.sections.map((section) => {
        const rows = visible.filter((v) => v.sectionId === section.id);
        if (rows.length === 0) return null;
        return (
          <View key={section.id} style={styles.list}>
            <Text style={styles.section}>{section.title}</Text>
            {rows.map(({ item, depth }) => (
              <View key={item.id} style={{ marginLeft: depth * spacing.md }}>
                <ReadOnlyItem item={item} answer={p.answers[item.id]} media={p.media} flagged={flagged.has(item.id)} load={p.load} />
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function ReadOnlyItem({ item, answer, media, flagged, load }: { item: Item; answer: Answer | undefined; media: readonly ExecutionMediaDto[]; flagged: boolean; load: LoadUrl }) {
  const { t } = useTranslation();
  const options = choiceOptions(item, t);
  const text = answerText(item, answer);
  const evidence = [...remoteMedia(answer?.photos ?? [], media, 'photo'), ...remoteMedia(answer?.videos ?? [], media, 'video')];
  const answered = (options !== null && (answer?.optionIds?.length ?? 0) > 0) || text !== null || evidence.length > 0;
  const note = answer?.note?.trim();
  return (
    <View testID={`answer-${item.id}`} style={styles.card}>
      <Text style={styles.label}>{item.label}</Text>
      {options ? <Options options={options} selected={answer?.optionIds ?? []} multi={item.type === 'multi_choice'} disabled onChange={() => undefined} /> : null}
      {text !== null ? <Text style={styles.value}>{text}</Text> : null}
      {!answered ? <Text style={styles.muted}>{t('executions.notAnswered')}</Text> : null}
      <RemoteMediaStrip items={evidence} load={load} />
      {note ? <Text style={styles.muted}>{t('executions.note', { note })}</Text> : null}
      {flagged ? <Text style={styles.problem}>{t('mobile.execution.problemFlagged')}</Text> : null}
    </View>
  );
}

/** SP7 spec §7.2: the problems after the answers, each with its item, severity, source, resolution, note and media. */
export function ReadOnlyProblems(p: { content: ChecklistContent; problems: readonly ExecutionProblem[]; media: readonly ExecutionMediaDto[]; load: LoadUrl }) {
  const { t } = useTranslation();
  if (p.problems.length === 0) return null;
  const labels = new Map<string, string>();
  walkItems(p.content, (item) => labels.set(item.id, item.label));
  return (
    <View style={styles.list}>
      <Text style={styles.section}>{t('reports.tabs.problems')}</Text>
      {p.problems.map((x) => (
        <View key={x.id} testID={`problem-${x.id}`} style={[styles.card, x.severity === 'critical' ? styles.critical : null]}>
          <Text style={styles.label}>{labels.get(x.itemId) ?? t('executions.problemsPage.unknownItem')}</Text>
          <View style={styles.badges}>
            <Badge text={t(`executions.severities.${x.severity}`)} tone={x.severity === 'critical' ? 'danger' : 'warning'} />
            <Badge text={t(`executions.problemSources.${x.source}`)} />
            <Badge text={t(`tasks.resolutions.${x.resolution}`)} tone={x.resolution === 'resolved' ? 'success' : 'neutral'} />
          </View>
          {x.note ? <Text style={styles.value}>{x.note}</Text> : null}
          <RemoteMediaStrip items={remoteMedia(x.mediaIds, p.media, 'photo')} load={p.load} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  section: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  critical: { borderColor: colors.danger },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  value: { fontSize: 16, color: colors.text },
  muted: { color: colors.muted },
  problem: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
```

- [ ] **Step 7: Run every execution test, the new one included**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution src/features/tasks && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. `answer-view.test.tsx` passes. The worker's `execution-screen.test.tsx` and `finish-screen.test.tsx` pass unedited. `git diff --stat -- apps/mobile/src/features/execution/*.test.tsx` lists only `answer-view.test.tsx`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/features/execution/parts.tsx apps/mobile/src/features/execution/item-field.tsx apps/mobile/src/features/execution/answer-view.tsx apps/mobile/src/features/execution/answer-view.test.tsx
git commit -m "feat(mobile): read-only answer and problem display sharing the worker's option chips" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The read-only run screen

**Files:**
- Create: `apps/mobile/src/features/team/run-screen.tsx`
- Test: `apps/mobile/src/features/team/run-screen.test.tsx`

**Interfaces:**
- Consumes:
  - Task 2: `formatLocalDay`, `percentText`, `receiptDiffers`, `statusTone`, `cancelReasonText`;
  - Task 3: `useTeamOccurrence`, `useTeamExecution`, `useRefreshMeOnForbidden`;
  - Task 4: `TeamOffline`;
  - Task 6: `ReadOnlyAnswers`, `ReadOnlyProblems`;
  - existing: `Screen`, `ScreenHeader`, `Badge`, `FormError` and `mobileErrorText`, `PrimaryButton`, `api.media.url`, `formatDateTime`.
- Produces: `TeamRunScreen({ occurrenceId: string })`. Each header value is a `Field` whose accessibility label is `<label>: <value>`, or `<label>: <value>. <receipt>` when a receipt time is shown.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/run-screen.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { formatDateTime } from '@taskop/i18n';
import { fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { checklist, OCC, T } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TeamRunScreen } from './run-screen';
import {
  EXECUTION,
  executionDetail,
  executionSummary,
  missedOccurrence,
  occurrenceDetail,
  PHOTO,
  PROBLEM,
  RUN_T,
  teamMe,
} from './testing/fixtures';
import { renderTeam } from './testing/render';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockOccurrence = jest.fn();
const mockExecution = jest.fn();
const mockUrl = jest.fn();
const mockRefreshMe = jest.fn();
const mockMe = teamMe();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: () => mockRefreshMe() },
  api: {
    occurrences: { get: (...a: unknown[]) => mockOccurrence(...a) },
    executions: { get: (...a: unknown[]) => mockExecution(...a) },
    media: { url: (...a: unknown[]) => mockUrl(...a) },
  },
}));

const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone: 'Asia/Baku' });
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function open(o: { online?: boolean } = {}) {
  const t = await createTestServices({ online: o.online ?? true });
  await renderTeam(t.services, <TeamRunScreen occurrenceId={OCC} />);
  return t;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));
  mockRefreshMe.mockResolvedValue(undefined);
});

describe('Team run screen', () => {
  it('shows an executed run: header, device and server times, score, flags, answers and problems', async () => {
    const c = checklist();
    mockOccurrence.mockResolvedValue(occurrenceDetail());
    mockExecution.mockResolvedValue(executionDetail(c));
    await open();
    expect(await screen.findByText('Açılış yoxlaması')).toBeTruthy();
    expect(screen.getByText('Bakı filialı 1')).toBeTruthy();
    expect(screen.getByLabelText('Tarix: 02.11.2026')).toBeTruthy();
    for (const badge of ['Tamamlanıb', 'Gecikib', 'Telefon saatı şübhəlidir']) expect(screen.getByText(badge)).toBeTruthy();
    expect(screen.getByLabelText('İcraçı: Aynur Quliyeva')).toBeTruthy();
    // The start reached the server at once: no receipt line. The completion synced hours later: both times.
    expect(screen.getByLabelText(`Başlayıb: ${at(T.open)}`)).toBeTruthy();
    expect(screen.getByLabelText(`Tamamlayıb: ${at(RUN_T.completed)}. Serverə çatıb: ${at(RUN_T.received)}`)).toBeTruthy();
    expect(screen.getByLabelText('Bal: 50%')).toBeTruthy();
    expect(await screen.findByTestId(`answer-${c.problem.id}`)).toBeTruthy();
    expect(screen.getByText('Cavablar')).toBeTruthy();
    expect(screen.getByTestId(`problem-${PROBLEM}`)).toBeTruthy();
    expect(mockOccurrence).toHaveBeenCalledWith(OCC);
    expect(mockExecution).toHaveBeenCalledWith(EXECUTION);
    await eventually(async () => expect(mockUrl).toHaveBeenCalledWith(PHOTO));
  });

  it('shows an unexecuted run with its assignees, and says it has not been done', async () => {
    mockOccurrence.mockResolvedValue(missedOccurrence());
    await open();
    expect(await screen.findByText('Hələ icra edilməyib')).toBeTruthy();
    for (const text of ['İcraçılar', 'Aynur Quliyeva', 'Kamran Əliyev', 'Buraxılıb']) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByLabelText(/^İcraçı:/)).toBeNull();
    await settle();
    expect(mockExecution).not.toHaveBeenCalled();
  });

  it('marks an unexecuted run nobody was assigned to', async () => {
    mockOccurrence.mockResolvedValue(missedOccurrence({ status: 'overdue', assignees: [], assigneeIds: [], unassigned: true }));
    await open();
    expect(await screen.findByText('Təyin edilməyib')).toBeTruthy();
    expect(screen.getByText('Gecikib')).toBeTruthy();
  });

  it('gives the reason of a cancelled run', async () => {
    mockOccurrence.mockResolvedValue(missedOccurrence({ status: 'cancelled', cancelReason: 'assignment_edited' }));
    await open();
    expect(await screen.findByLabelText('Ləğv səbəbi: Təyinat dəyişdirildi')).toBeTruthy();
    expect(screen.getByText('Ləğv edilib')).toBeTruthy();
  });

  it('says the score is not calculated when scoring is off', async () => {
    mockOccurrence.mockResolvedValue(occurrenceDetail({ execution: executionSummary({ scorePercent: null }) }));
    mockExecution.mockResolvedValue(executionDetail(checklist(), { scorePercent: null, score: null }));
    await open();
    expect(await screen.findByLabelText('Bal: Bal hesablanmır')).toBeTruthy();
  });

  it('shows no score or completion while the run is still being done', async () => {
    mockOccurrence.mockResolvedValue(
      occurrenceDetail({ status: 'in_progress', execution: executionSummary({ state: 'active', completedAt: null, completedReceivedAt: null, scorePercent: null, late: false, clockSuspect: false }) }),
    );
    mockExecution.mockResolvedValue(executionDetail(checklist(), { state: 'active', completedAt: null, completedReceivedAt: null }));
    await open();
    expect(await screen.findByText('Davam edir')).toBeTruthy();
    expect(screen.getByLabelText(`Başlayıb: ${at(T.open)}`)).toBeTruthy();
    expect(screen.queryByLabelText(/^Tamamlayıb:/)).toBeNull();
    expect(screen.queryByLabelText(/^Bal:/)).toBeNull();
  });

  it('offline it asks for a connection and loads nothing', async () => {
    await open({ online: false });
    expect(await screen.findByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    await settle();
    expect(mockOccurrence).not.toHaveBeenCalled();
  });

  it('says why a run cannot be opened, and tries again', async () => {
    mockOccurrence.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND')).mockResolvedValue(missedOccurrence());
    await open();
    expect(await screen.findByText('Məlumat tapılmadı.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('Hələ icra edilməyib')).toBeTruthy();
  });

  it('keeps the header when the answers fail to load, and retries them', async () => {
    const c = checklist();
    mockOccurrence.mockResolvedValue(occurrenceDetail());
    mockExecution.mockRejectedValueOnce(ApiError.network()).mockResolvedValue(executionDetail(c));
    await open();
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeTruthy();
    expect(screen.getByLabelText('İcraçı: Aynur Quliyeva')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByTestId(`answer-${c.problem.id}`)).toBeTruthy();
  });

  it('refreshes the profile when the server says 403', async () => {
    mockOccurrence.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN'));
    await open();
    expect(await screen.findByText('Bu əməliyyat üçün icazəniz yoxdur.')).toBeTruthy();
    await eventually(async () => expect(mockRefreshMe).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/run-screen`
Expected: FAIL with `Cannot find module './run-screen'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/features/team/run-screen.tsx`:

```tsx
import type { ExecutionSummary, OccurrenceDetail } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { ReadOnlyAnswers, ReadOnlyProblems } from '@/features/execution/answer-view';
import { ScreenHeader } from '@/features/tasks/screen-header';
import { Badge } from '@/features/tasks/task-row';
import { api, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';
import { useRefreshMeOnForbidden, useTeamExecution, useTeamOccurrence } from './queries';
import { cancelReasonText, formatLocalDay, percentText, receiptDiffers, statusTone } from './team-format';
import { TeamOffline } from './team-offline';

/** Spec §7.2: media are signed through GET /media/:id/url (Part 1 Task 7 lets reports.view do it). */
const loadMedia = (id: string) => api.media.url(id);

/**
 * Spec §7.2: one run, read-only, online only. The header comes from GET /occurrences/:id. The answers and problems come
 * from GET /executions/:id, requested only when the run has an execution (decision 10).
 */
export function TeamRunScreen({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const me = s.status === 'authenticated' ? s.me : null;
  const viewerId = me?.user.id ?? '';
  const timeZone = me?.tenant.timezone ?? services.timeZone;
  const live = online && me !== null;
  const occurrence = useTeamOccurrence(viewerId, occurrenceId, live);
  const execution = occurrence.data?.execution ?? null;
  const detail = useTeamExecution(viewerId, execution?.id ?? null, live);
  useRefreshMeOnForbidden([occurrence.error, detail.error]);

  if (!me) return null;
  const o = occurrence.data;
  if (!online) {
    return (
      <Screen>
        <ScreenHeader title={o?.checklistName ?? t('mobile.team.run.title')} />
        <TeamOffline />
      </Screen>
    );
  }
  if (!o) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.team.run.title')} />
        {occurrence.error ? <Failed error={occurrence.error} onRetry={() => void occurrence.refetch()} /> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }
  return (
    <Screen>
      <ScreenHeader title={o.checklistName} />
      <Text style={styles.muted}>{o.siteName}</Text>
      <Field label={t('reports.columns.date')} value={formatLocalDay(o.localDate)} />
      <View style={styles.badges}>
        <Badge text={t(`scheduling.statuses.${o.status}`)} tone={statusTone(o.status)} />
        {execution?.late ? <Badge text={t('executions.flags.late')} tone="warning" /> : null}
        {execution?.clockSuspect ? <Badge text={t('executions.flags.clockSuspect')} tone="warning" /> : null}
      </View>
      {execution ? <ExecutionTimes execution={execution} timeZone={timeZone} /> : <NotExecuted occurrence={o} />}
      {execution ? (
        detail.data ? (
          <>
            <Text style={styles.section}>{t('mobile.team.run.answers')}</Text>
            <ReadOnlyAnswers content={detail.data.content} answers={detail.data.answers} media={detail.data.media} problems={detail.data.problems} load={loadMedia} />
            <ReadOnlyProblems content={detail.data.content} problems={detail.data.problems} media={detail.data.media} load={loadMedia} />
          </>
        ) : detail.error ? (
          <Failed error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )
      ) : null}
    </Screen>
  );
}

/** A label and its value; the receipt line under it when there is one. Read out as one. */
function Field({ label, value, note = null }: { label: string; value: string; note?: string | null }) {
  return (
    <View accessible accessibilityLabel={note ? `${label}: ${value}. ${note}` : `${label}: ${value}`} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {note ? <Text style={styles.muted}>{note}</Text> : null}
    </View>
  );
}

/** Executor, device times with the server receipt when it differs (decision 11), and the score once closed (decision 14). */
function ExecutionTimes({ execution: e, timeZone }: { execution: ExecutionSummary; timeZone: string }) {
  const { t } = useTranslation();
  const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone });
  const receipt = (deviceAt: string, receivedAt: string | null) =>
    receivedAt !== null && receiptDiffers(deviceAt, receivedAt) ? t('executions.receivedAt', { time: at(receivedAt) }) : null;
  return (
    <View style={styles.block}>
      <Field label={t('executions.executor')} value={e.executor.fullName} />
      <Field label={t('executions.startedAt')} value={at(e.startedAt)} note={receipt(e.startedAt, e.startedReceivedAt)} />
      {e.completedAt ? <Field label={t('executions.completedAt')} value={at(e.completedAt)} note={receipt(e.completedAt, e.completedReceivedAt)} /> : null}
      {e.state !== 'active' ? <Field label={t('executions.score')} value={e.scorePercent === null ? t('executions.noScore') : percentText(t, e.scorePercent)} /> : null}
    </View>
  );
}

/** Spec §7.2: an unexecuted run shows who it was for and that it has not been done; a cancelled one, why (decision 15). */
function NotExecuted({ occurrence: o }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{t('reports.columns.assignees')}</Text>
      {o.assignees.length > 0 ? (
        o.assignees.map((a) => (
          <Text key={a.id} style={styles.value}>
            {a.fullName}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>{t('reports.employees.unassigned')}</Text>
      )}
      {o.status === 'cancelled' && o.cancelReason ? <Field label={t('mobile.team.run.cancelReason')} value={cancelReasonText(t, o.cancelReason)} /> : null}
      <Text style={styles.notice}>{t('mobile.team.run.notExecuted')}</Text>
    </View>
  );
}

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <FormError message={mobileErrorText(t, error)} />
      <PrimaryButton variant="outline" title={t('common.retry')} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  field: { gap: 2 },
  label: { fontWeight: '600', color: colors.text },
  value: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  notice: { color: colors.text, fontSize: 16, fontWeight: '600', marginTop: spacing.sm },
  section: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team src/features/execution && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/team/run-screen.tsx apps/mobile/src/features/team/run-screen.test.tsx
git commit -m "feat(mobile): read-only Team run screen with device and server times, answers and problems" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Team tab, its routes and the deep-link guard

**Files:**
- Create: `apps/mobile/src/features/team/team-gate.tsx`, `apps/mobile/app/(app)/team/index.tsx`, `apps/mobile/app/(app)/team/run/[id].tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/features/team/team-routes.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`canSeeTeam`), Task 4/5 (`TeamScreen`), Task 7 (`TeamRunScreen`), Task 1 (`az.mobile.tabs.team`). Existing: `Tabs`, `Redirect` and `useLocalSearchParams` from `expo-router`, and `HIDDEN` in the layout.
- Produces:
  - `TeamGate({ children })`: it renders nothing while signed out, `<Redirect href="/" />` without access, and its children otherwise;
  - the routes `/team` (the default export `TeamRoute`) and `/team/run/[id]` (the default export `TeamRunRoute`, which keys the screen by `id`);
  - the `Tabs.Screen` entries `team/index` (visible only when `canSeeTeam(me)`) and `team/run/[id]` (`HIDDEN`).

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/team-routes.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import '@/lib/i18n';
import { OCC, OCC2 } from '@/offline/testing/fixtures';
import AppLayout from '../../../app/(app)/_layout';
import TeamRoute from '../../../app/(app)/team/index';
import TeamRunRoute from '../../../app/(app)/team/run/[id]';
import { teamMe } from './testing/fixtures';

const mockScreens: { name: string; options?: { href?: null; title?: string } }[] = [];
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  const Tabs = ({ children }: { children: ReactNode }) => children;
  Tabs.Screen = (p: { name: string; options?: { href?: null; title?: string } }) => {
    mockScreens.push(p);
    return null;
  };
  return { Tabs, Redirect: ({ href }: { href: string }) => <MockText>{`redirect ${href}`}</MockText>, useLocalSearchParams: () => mockParams };
});
let mockSession: { status: string; offline?: boolean; me?: ReturnType<typeof teamMe> } = { status: 'authenticated', offline: false, me: teamMe() };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/offline/offline-provider', () => ({ OfflineProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/notifications/notifications-bridge', () => ({ NotificationsBridge: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/features/team/team-screen', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { TeamScreen: () => <MockText>team screen</MockText> };
});
jest.mock('@/features/team/run-screen', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { TeamRunScreen: ({ occurrenceId }: { occurrenceId: string }) => <MockText>{`run ${occurrenceId}`}</MockText> };
});

const signedIn = (me: ReturnType<typeof teamMe>) => (mockSession = { status: 'authenticated', offline: false, me });
const teamTab = () => mockScreens.find((s) => s.name === 'team/index');

beforeEach(() => {
  mockScreens.length = 0;
  mockParams = {};
  signedIn(teamMe());
});

describe('Team tab (spec §7.1)', () => {
  it('is a tab for a manager with reports.view and a wider scope, between Tapşırıqlar and Profil', async () => {
    await render(<AppLayout />);
    expect(mockScreens.slice(0, 4).map((s) => s.name)).toEqual(['index', 'tasks', 'team/index', 'profile']);
    expect(teamTab()?.options).toMatchObject({ title: 'Komanda' });
    expect(teamTab()?.options).not.toHaveProperty('href');
    expect(mockScreens.find((s) => s.name === 'team/run/[id]')?.options).toMatchObject({ href: null });
  });

  it('is hidden without reports.view, and for an own-scope role that has it', async () => {
    for (const me of [teamMe({ permissions: ['assignments.view'] }), teamMe({ dataScope: 'own' }), teamMe({ permissions: [], dataScope: 'own' })]) {
      mockScreens.length = 0;
      signedIn(me);
      const view = await render(<AppLayout />);
      expect(teamTab()?.options).toMatchObject({ href: null });
      await view.unmount();
    }
  });
});

describe('Team routes', () => {
  it('open the Team screen, and a run keyed by its occurrence', async () => {
    await render(<TeamRoute />);
    expect(screen.getByText('team screen')).toBeTruthy();
    mockParams = { id: OCC };
    const view = await render(<TeamRunRoute />);
    expect(screen.getByText(`run ${OCC}`)).toBeTruthy();
    mockParams = { id: OCC2 };
    await view.rerender(<TeamRunRoute />);
    expect(screen.getByText(`run ${OCC2}`)).toBeTruthy();
  });

  it('send a deep link without access Home', async () => {
    signedIn(teamMe({ permissions: [], dataScope: 'own' }));
    await render(<TeamRoute />);
    expect(screen.getByText('redirect /')).toBeTruthy();
    expect(screen.queryByText('team screen')).toBeNull();
    mockParams = { id: OCC };
    await render(<TeamRunRoute />);
    // `screen` is the latest render: the run route redirects too.
    expect(screen.getByText('redirect /')).toBeTruthy();
    expect(screen.queryByText(`run ${OCC}`)).toBeNull();
  });

  it('render nothing while signed out', async () => {
    mockSession = { status: 'anonymous' };
    const view = await render(<TeamRoute />);
    expect(view.toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/team-routes`
Expected: FAIL with `Cannot find module '../../../app/(app)/team/index'`.

- [ ] **Step 3: Write the gate and the routes**

`apps/mobile/src/features/team/team-gate.tsx`:

```tsx
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { canSeeTeam } from './team-rules';

/**
 * Decision 1: the Team routes check access themselves, because a hidden tab is still reachable by URL (a deep link, a
 * typed route). Without access the viewer lands on Home. A profile refresh that removes access redirects an open screen.
 */
export function TeamGate({ children }: { children: ReactNode }) {
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  if (!canSeeTeam(s.me)) return <Redirect href="/" />;
  return <>{children}</>;
}
```

`apps/mobile/app/(app)/team/index.tsx`:

```tsx
import { TeamGate } from '@/features/team/team-gate';
import { TeamScreen } from '@/features/team/team-screen';

export default function TeamRoute() {
  return (
    <TeamGate>
      <TeamScreen />
    </TeamGate>
  );
}
```

`apps/mobile/app/(app)/team/run/[id].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { TeamRunScreen } from '@/features/team/run-screen';
import { TeamGate } from '@/features/team/team-gate';

/** `id` is the OCCURRENCE id (decision 10). */
export default function TeamRunRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new key per run, so nothing from one run's screen stays on the next.
  return (
    <TeamGate>
      <TeamRunScreen key={id} occurrenceId={id} />
    </TeamGate>
  );
}
```

- [ ] **Step 4: Add the tab to the layout**

Replace `apps/mobile/app/(app)/_layout.tsx` with:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { canSeeTeam } from '@/features/team/team-rules';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { NotificationsBridge } from '@/notifications/notifications-bridge';
import { OfflineProvider } from '@/offline/offline-provider';

/** Screens reached from inside the app, not from the tab bar. */
const HIDDEN = { href: null, tabBarStyle: { display: 'none' } } as const;

export default function AppLayout() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  // SP7 spec §7.1: only for reports.view with a scope wider than own. The routes check it again (TeamGate).
  const team = canSeeTeam(s.me);
  return (
    <OfflineProvider userId={s.me.user.id} timeZone={s.me.tenant.timezone}>
      <NotificationsBridge />
      <Tabs backBehavior="history" screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
        <Tabs.Screen name="index" options={{ title: t('mobile.tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="tasks" options={{ title: t('mobile.tabs.tasks'), tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" color={color} size={size} /> }} />
        <Tabs.Screen
          name="team/index"
          options={{
            title: t('mobile.tabs.team'),
            tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} />,
            ...(team ? {} : { href: null }),
          }}
        />
        <Tabs.Screen name="profile" options={{ title: t('mobile.tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="change-secret" options={{ href: null }} />
        <Tabs.Screen name="sync" options={HIDDEN} />
        <Tabs.Screen name="execution/[id]/index" options={HIDDEN} />
        <Tabs.Screen name="execution/[id]/finish" options={HIDDEN} />
        <Tabs.Screen name="task/[id]" options={HIDDEN} />
        <Tabs.Screen name="task/new" options={HIDDEN} />
        <Tabs.Screen name="review/[id]" options={HIDDEN} />
        <Tabs.Screen name="notifications" options={HIDDEN} />
        <Tabs.Screen name="team/run/[id]" options={HIDDEN} />
      </Tabs>
    </OfflineProvider>
  );
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team src/features/tasks/routes && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/team/team-gate.tsx apps/mobile/src/features/team/team-routes.test.tsx "apps/mobile/app/(app)/team" "apps/mobile/app/(app)/_layout.tsx"
git commit -m "feat(mobile): Komanda tab for report viewers, with guarded Team routes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification and the manual device checklist

**Files:**
- None created. Findings go into the pull request description. A real defect found here becomes a fix in the task that owns the file, with its own test and commit.

**Interfaces:**
- Consumes: everything above. Also:
  - a running API with **all of Part 1** merged: Tasks 6–15, and Task 16 for the `perf` tenant;
  - its seed: `pnpm db:seed` creates the demo tenant `demo` with manager Leyla `manager@demo.taskop.az` / `DemoPassword123` (Manager, `site_subtree`), owner `owner@demo.taskop.az` / `DemoPassword123`, and workers `elvin` and `nigar` with PIN `482915`. It also creates yesterday's partial "Səhər təmizliyi" run by elvin with a rule problem.
  - Optional: `pnpm --filter @taskop/api db:seed-report-volume` creates the `perf` tenant with the `site_subtree` manager `perf-manager@taskop.test` / `PerfPassword123`.
  - The web app from Part 3 is optional, for comparing numbers. Without it, compare with `curl` on `/api/v1/reports/summary`.
- Produces: verified development builds on the iOS simulator and on one real phone. The real phone is needed for airplane mode. No push credentials are needed for this part.

- [ ] **Step 1: Run every automated check**

```bash
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
pnpm --filter @taskop/i18n test
pnpm --filter @taskop/mobile test
pnpm --filter @taskop/mobile typecheck
pnpm --filter @taskop/mobile lint
pnpm --filter @taskop/mobile exec expo install --check
pnpm --filter @taskop/mobile exec expo config --type prebuild > /dev/null
grep -rln "api\.reports\." apps/mobile/src apps/mobile/app | grep -v '\.test\.tsx\?$'
grep -rn "\.db\b\|\.store\.\|\.tasks\." apps/mobile/src/features/team
git log --format=%s -- apps/mobile/src/features/execution/execution-screen.test.tsx apps/mobile/src/features/execution/finish-screen.test.tsx | head -3
```

Expected:
- All suites pass with none skipped, and Jest reports no open handles.
- `expo install --check` reports up-to-date dependencies. This part adds none.
- The first `grep` prints exactly `apps/mobile/src/features/team/queries.ts`.
- The second `grep` prints nothing: no team code touches the phone's database or stores (spec §7.1, "Nothing is written to SQLite").
- `git log` shows no commit from this plan: the worker's execution tests were not edited (spec §9).

- [ ] **Step 2: Start the stack for phones on the LAN**

```bash
docker compose up -d                       # or `docker compose -p foundation start` where the demo DB lives in that project
ipconfig getifaddr en0                     # e.g. 192.168.1.20
# apps/api/.env:    S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333, JOBS_ENABLED=true (occurrences come from the cron)
# apps/mobile/.env: EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
pnpm db:setup && pnpm db:seed              # applies 0013_reports and 0014_reports_permissions
pnpm --filter @taskop/api db:seed-report-volume   # optional: the perf tenant for item 8
pnpm --filter @taskop/api dev
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
```

Expected: the app installs on the simulator and on the phone. A profile cached before the migration lacks `reports.view` until the app refreshes it, so kill and reopen the app once after `db:setup`.

- [ ] **Step 3: Run the manual device checklist (spec §7, §9)**

Tick each item in the PR description, with the phone model and OS version.

1. **Workers never see the tab.**
   - Sign in as `elvin` (org code `demo`, PIN `482915`). Expected: the tabs Əsas, Tapşırıqlar and Profil, with no Komanda.
   - On the simulator, run `xcrun simctl openurl booted taskop://team`. Expected: the app stays on Əsas.
   - Run `xcrun simctl openurl booted taskop://team/run/<any occurrence id>`. Expected: Əsas.
2. **The manager's tab and today's tiles.**
   - Log out and sign in as Leyla on the Rəhbər tab. Expected: a Komanda tab between Tapşırıqlar and Profil, opening on "Bu gün".
   - Expected: six tiles: Tamamlanıb, Tamamlanmayıb, Gecikib, Yarımçıq, Problemli, Tamamlanma faizi.
   - The numbers match the web dashboard for "Bu gün", or `curl -H "Authorization: Bearer <token>" "http://192.168.1.20:3000/api/v1/reports/summary?from=<today>&to=<today>"`. "Tamamlanmayıb" = due − completed.
3. **Periods.**
   - Tap "7 gün". Expected: the tiles change, and yesterday's partial "Səhər təmizliyi" run is in the list, its badge "Yarımçıq" and "Problem: 1".
   - Tap "30 gün", then "Bu gün" again.
   - Expected: with nothing due, "Tamamlanma faizi" shows "—".
4. **Status chips.**
   - Let elvin's run of today pass its due time unstarted. Expected: "Gecikmiş" lists it with a red "Gecikib" badge.
   - Expected: "Problemli" lists yesterday's run, "Buraxılmış" lists missed runs, and "Hamısı" lists everything, cancelled runs included.
   - The tiles do not change when the chip changes.
5. **Employee picker.**
   - Tap "Əməkdaş: Bütün əməkdaşlar". Expected: elvin and nigar are offered, and "Təyin edilməyib" is never offered.
   - Pick elvin. Expected: the tiles and the list narrow to elvin.
   - Switch to "30 gün". Expected: the button still says elvin.
   - Choose "Bütün əməkdaşlar". Expected: everyone's runs are back.
   - On the web, deactivate nigar. Pull to refresh. Expected: nigar is listed last as "(Deaktiv)" while she has runs in the period. Reactivate her afterwards.
6. **Read-only executed run, device versus server time.**
   - On the worker phone, sign in as elvin. Turn on airplane mode, start today's run and complete it with a photo and a "Bəli" problem. Wait 2 minutes, then turn airplane mode off and let it sync.
   - On Leyla's Komanda tab, pull to refresh and open the run.
   - Expected: checklist, site, date (DD.MM.YYYY) and the status badge, plus İcraçı "Elvin …".
   - Expected: "Başlayıb" and "Tamamlayıb" with the device times, and "Serverə çatıb: …" under the one that synced over a minute later. "Bal", and "Gecikib" and "Telefon saatı şübhəlidir" when set.
   - Expected: the answers with the option chips greyed and unchangeable, the photo loading, and under "Problemlər" the problem with its severity, note and photo.
   - Expected: nothing on the screen can be edited, and back returns to the list where it was.
7. **Read-only unexecuted run.** Open an overdue or missed run. Expected: the header, "İcraçılar" with the assignees (or "Təyin edilməyib"), and "Hələ icra edilməyib". No answers are requested.
8. **Paging on a big tenant.**
   - Sign in as `perf-manager@taskop.test` (org `perf`), choose "30 gün" and "Hamısı", and scroll fast to the bottom several times.
   - Expected: rows keep coming 50 at a time with a spinner at the bottom, no row appears twice, and scrolling stops at the end.
   - Pull to refresh at the top. Expected: the list restarts at the first page.
9. **Offline.**
   - With Leyla on the Komanda tab, turn on airplane mode. Expected: only "Komandanı görmək üçün internetə qoşulun" and "Yenidən cəhd et", and no old numbers.
   - Go back online, open a run, then turn airplane mode on again. Expected: the run screen shows the same message, and no answers.
   - Turn airplane mode off. Expected: the tab loads by itself within a few seconds.
   - The Sync screen shows nothing pending from the Team tab.
10. **Role changed while the app is open.**
    - On the web, create a custom role with `reports.view` and the `site_subtree` scope, and give it to a second staff user. Sign in as that user on the phone and open Komanda.
    - On the web, remove `reports.view` from the role. On the phone, pull to refresh.
    - Expected: "Bu əməliyyat üçün icazəniz yoxdur." briefly, then the Komanda tab disappears and the app shows Əsas.
11. **Another manager on the same phone.** Log out Leyla and sign in as `owner@demo.taskop.az`. Open Komanda. Expected: the owner's numbers (scope `all`). Leyla's tiles never appear, not even for a moment.
12. **The tenant's day, not the phone's.**
    - In iOS Settings → General → Date & Time, turn off "Set Automatically" and pick New York.
    - At a Baku time between 00:00 and 08:00 (still the previous day in New York), open Komanda. Expected: "Bu gün" shows the Baku day's numbers, the same as the web dashboard.
    - Restore the setting.
13. **The worker flow is unchanged.** Sign in as elvin and start and complete a checklist. Expected: options, numbers, notes, dates with "İndi", photos, ⚑ problems and the finish screen behave exactly as before this part.

- [ ] **Step 4: Record and finish**

Add the checklist results to the PR description. For each failed item, open a fix in the owning task's files, with a regression test where Jest can express it, and commit it as `fix(mobile): …`. Do not commit device-only notes or credentials.

---

## Self-review

**Spec §7, §8 and §9 (mobile) coverage**

| Spec | Where |
|---|---|
| §7.1 tab only with `reports.view` and scope ≠ `own`; workers never see it | Task 2 (`canSeeTeam`), Task 8 (layout `href: null`, `TeamGate`, tests) |
| §7.1 period chips Bu gün / 7 gün / 30 gün | Task 1 (strings), Task 2 (`teamPeriod` on the tenant's today), Task 4 (chips) |
| §7.1 tiles: completed, not completed (due − completed), overdue, partial, with problems, completion % (FR-16.03) | Task 4 (`CountTiles`, `notCompleted`) |
| §7.1 status chips → `/reports/runs` buckets | Task 2 (`CHIP_BUCKETS`), Task 4 (`maps each status chip…`) |
| §7.1 employee picker from the period's `/reports/employees` rows | Task 2 (`employeeChoices`, Unassigned excluded), Task 4 (`EmployeePicker`) |
| §7.1 list: infinite scroll, pull-to-refresh; row = checklist, site, person, due time, status badge, problem count | Task 4 (`RunRow`), Task 5 (paging, refresh) |
| §7.1 data: react-query only, nothing in SQLite | Task 3 (`queries.ts`), Task 9 Step 1 (greps) |
| §7.1 offline: message + retry, caches nothing | Task 4 (`TeamOffline`, offline tests), Task 7 (offline test) |
| §7.2 header: checklist, site, date, status; executor; device times, server receipt when it differs; score; late and clock-suspect flags | Task 7 (`ExecutionTimes`, `Field`), Task 2 (`receiptDiffers`) |
| §7.2 body: answers in read-only mode, then problems with notes and media | Task 6 (`ReadOnlyAnswers`, `ReadOnlyProblems`), Task 7 |
| §7.2 media through `GET /media/:id/url` | Task 7 (`loadMedia`), Task 6 (`RemoteMediaStrip`) |
| §7.2 unexecuted runs: header, assignees, "Hələ icra edilməyib" | Task 7 (`NotExecuted`) |
| §7.2 a read-only display pulled out; the worker flow does not change | Task 6 (Steps 3–5, 7), Task 9 Step 1 (`git log`) |
| §8 deactivated users kept and marked; empty period "—"; scoring off; clock-suspect visible | Task 2, Task 4 (`(Deaktiv)`, `—`), Task 7 (`Bal hesablanmır`), Task 4 (clock-suspect badge) |
| §5.5 / §9 errors: `REPORT_TIMEOUT` etc. via `az.errors` | Task 4 (`shows a report timeout…`), Task 7 (`NOT_FOUND`, `NETWORK`, `FORBIDDEN`) |
| §9 mobile: visibility by permission and scope | Task 2 (`canSeeTeam`), Task 8 (`is a tab…`, `is hidden…`, `send a deep link…`) |
| §9 mobile: chip → bucket mapping | Task 2 (`status chips`), Task 4 (`maps each status chip…`) |
| §9 mobile: employee filter | Task 4 (`filters by an employee…`, `keeps the chosen employee…`) |
| §9 mobile: offline state | Task 4 (two tests), Task 7 (`offline it asks…`) |
| §9 mobile: read-only screen for executed and unexecuted runs | Task 7 (`shows an executed run…`, `shows an unexecuted run…`) |
| §9 mobile: worker execution screen unchanged (its tests pass) | Task 6 Steps 5 and 7, Task 9 Step 1 |

**Placeholder scan.** There is no "TBD", "TODO", "add validation" or "similar to Task N". Every edit to an existing file names the exact text it replaces or the anchor it follows (`mobile.ts` tabs line and `notifications` block; `parts.tsx` first import line and the `Choice` function; `item-field.tsx` import, `Options`, the two `AnswerInput` cases and the `options` style). `team-screen.tsx` and `_layout.tsx` are given in full. `<token>`, `<today>` and `<any occurrence id>` in Task 9 are values the user reads off their own running stack.

**Type consistency.** These names are the same in every task that uses them:
- `canSeeTeam`, `TEAM_PERIODS`, `TeamPeriod`, `teamPeriod`, `TEAM_CHIPS`, `TeamChip`, `CHIP_BUCKETS`, `notCompleted`, `EmployeeChoice`, `employeeChoices`, `uniqueRuns` (Task 2, used in Tasks 4, 5, 8);
- `RECEIPT_TOLERANCE_MS`, `receiptDiffers`, `percentText`, `StatusTone`, `statusTone`, `runPerson`, `formatLocalDay`, `cancelReasonText` (Task 2, used in Tasks 4, 7);
- `TEAM_STALE_MS`, `TeamFilters`, `teamKeys`, `filterQuery`, `useTeamSummary`, `useTeamEmployees`, `useTeamRuns`, `useTeamOccurrence`, `useTeamExecution`, `useRefreshMeOnForbidden` (Task 3, used in Tasks 4, 5, 7);
- `TeamScreen`, `CountTiles`, `RunRow`, `EmployeePicker`, `TeamOffline` (Task 4); `choiceOptions`, `Options`, `remoteMedia`, `answerText`, `ReadOnlyAnswers`, `ReadOnlyProblems` (Task 6); `TeamRunScreen` (Task 7); `TeamGate` (Task 8);
- the fixtures, `testQueryClient`, `TeamProviders`, `renderTeam` and `gate` (Task 1, used in Tasks 2–8);
- testIDs `team-runs`, `run-<occurrenceId>`, `tile-<key>`, `answer-<itemId>` and `problem-<problemId>`.

**Names used from Part 1's "Interfaces for Parts 2 and 3".**
- Contracts:
  - `resolvePeriod`, `Period`, `PeriodPreset`, `PERIOD_PRESETS`, `RUN_COUNT_KEYS`, `RunCounts`;
  - `RUN_BUCKETS`, `RunBucket`;
  - `ReportFiltersQuery`, `ReportSummary`, `reportSummarySchema`, `EmployeeReportRow`, `employeeReportRowSchema`, `ReportRun`, `reportRunPageSchema`;
  - the permission key `reports.view`.
- i18n:
  - `az.reports.{notCompleted, noValue, empty, inactive}`;
  - `az.reports.buckets.*`, `az.reports.counts.*`, `az.reports.measures.completionPercent`;
  - `az.reports.filters.{employee, allEmployees}`, `az.reports.employees.unassigned`;
  - `az.reports.columns.{date, assignees}`, `az.reports.tabs.problems`;
  - `az.errors.REPORT_TIMEOUT`.
- API client: `api.reports.summary`, `api.reports.employees`, `api.reports.runs`.
- Server behaviour relied on:
  - the scope and empty-not-403 filters;
  - pages of 50 with `nextCursor`;
  - the employees ordering with the Unassigned row last;
  - `GET /occurrences/:id`, `GET /executions/:id` and `GET /media/:id/url` with `reports.view` (Part 1 Spec decision 1).
- Existing repo names: `api.occurrences.get`, `api.executions.get`, `api.media.url`, `session.refreshMe`, `useSession`, `useOffline`, `useSyncStatus`, `useNow`, `syncNow`, `RemoteMediaStrip`, `Badge`, `Choice`, `ScreenHeader`, `Screen`, `FormError`, `mobileErrorText`, `PrimaryButton`, `fromAnswerDatetime`, `visibleItems`, `walkItems`, `localDateOf`, `CANCEL_REASON_CODES`, `HIDDEN`.

**Review Focus check.** Five uncovered input classes are listed, each with its pinning tests in the owning tasks:
- the tenant's day versus the phone's, and midnight (Tasks 2, 4);
- paging races (Task 5);
- the shared phone (Tasks 3, 4);
- a role change or a slow server (Tasks 3, 4, 8);
- the chosen employee missing from the new period (Tasks 2, 4).

**Not needed from the shared interfaces.** The plan uses no endpoint, field or string beyond Part 1's section and the existing run-detail endpoints that Part 1 Spec decision 1 widens. Part 1's `completed` and `in_progress` buckets, `reports.export` and the export download are not used on the phone (spec §2 non-goals: no export from mobile).
