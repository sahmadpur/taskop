# Sub-project 7 (reports) — follow-ups

These are open items from the per-task reviews and the final whole-branch review of SP7. Items marked ⚑ need a decision or must be done before deployment.

## Before deployment

- ⚑ **PDF export cost at the row cap.**
  - A 10,000-row PDF section takes about 3.6 s of synchronous CPU and about 565 MB of heap. Excel takes 0.37 s for the same rows.
  - `full` PDF can hold five such sections, which risks an out-of-memory restart of the single API process on the 6 GB Hetzner box.
  - Options:
    - (a) A lower cap for PDF only, e.g. 2,000 rows per section plus a total cap for `full`. Excel and CSV keep 10,000. `REPORT_TOO_LARGE` already carries `limit`.
    - (b) Build PDFs in a `worker_thread` with `resourceLimits`.
  - Either way, update spec §5.4, which currently says 10,000 per section.
- ⚑ **Seed scripts in production.** `db:seed` and `db:seed-report-volume` create owners with known passwords and have no `NODE_ENV=production` guard. The deployment plan should exclude them or add a shared guard.
- ⚑ **Device checklist.** `docs/superpowers/sp7-device-checklist.md` has not been run yet. The user runs it.

## Behaviour

- **"Overdue right now" on the dashboard** asks only for runs dated today. A multi-day run that has been overdue since an earlier day is counted in the Gecikib tile but not listed. Consider `from = today − 30`.
- **One snapshot per request.** Report requests run in READ COMMITTED, but spec §8 says each request reads one snapshot. Multi-statement endpoints (problems and tasks counts plus items, the export count-first check, `full`) can disagree under concurrent writes. Either change the spec text, or open report transactions as `REPEATABLE READ READ ONLY`.
- **"Tapşırığı aç" on the Problems tab** shows whenever the problem has a task. A viewer without `tasks.view`, or whose scope doesn't cover the task, gets a 404 drawer. Gate the link on `useCan('tasks.view')`.
- **The web site picker** lists every tenant site (`GET /sites` is not scope-filtered). Picking an out-of-scope site gives an empty report. This is UX only.
- **Gap 1.** A custom role with only `reports.view` gets no site or checklist picker. A shared URL with `siteId` or `checklistId` still filters, but the bar doesn't show it. A `GET /reports/options` endpoint would fix both.
- **Export header names.** In a `site_subtree` export, the header may print "Əməkdaş: —" for an assignee who is not attached to the viewer's sites, while the rows name them. This is the safe side.
- **Mobile employee picker copy.** The text "bu dövrdə icrası yoxdur" also shows while the list is loading or has failed.
- **Mobile `answerText`** shows datetime answers in the phone's zone, the same as the worker's own field.
- **Dashboard flashes on change.** Tiles and attention lists flash "Yüklənir…" when the query key changes (midnight, a filter change). `placeholderData: keepPreviousData` would fix it.

## Robustness

- **Problems export media lookup.** The problems export with `limit: null` puts every media id into one `inArray`. A large export could pass Postgres' 65,535 bind-parameter limit. Chunk the ids or use `= any($1::uuid[])`.
- **Excel sheet names.** `sheetName` de-duplication is case-sensitive and doesn't strip leading or trailing apostrophes. That is safe today, because the titles are fixed.
- **Future index migrations on `occurrences`** should use `CREATE INDEX CONCURRENTLY` once tenants have data.
- **Unused limit constant.** `REPORT_LIMITS.statementTimeoutMs` is unused. Config hard-codes `15_000`.

## Code health

- **Duplicated helpers:**
  - `isoOf` duplicates `iso` in task-rows.
  - The count helper `n()` is written twice in report-queries.
  - `receiptDiffers`, `runPeople`/`runPerson`, `percentText` and `formatLocalDay` exist in both web and mobile.
- **No SQL cross-check for attribution.** `attributeRun` has no SQL cross-check, unlike `classifyRun`.
- **Expo patches.** `expo`, `expo-crypto`, `expo-router` and `jest-expo` are one patch behind (`expo install --check`). This predates SP7.
- **Leftover act() warning.** `apps/mobile/src/components/commit-input.test.tsx` still prints one act() warning. It predates SP7.

## Test coverage gaps worth closing

- The trend chart tests assert only the hidden table, not the rendered SVG.
- The e2e export isn't tied to the overdue bucket. Add `waitForRequest` on `bucket=overdue`.
- `readableSites` has no positive control for a `subordinates` viewer.
- The late-flag badge on the web runs tab isn't really asserted, because it has the same text as the overdue status.
- There are no paging-reset or severity-in-URL page-level tests.
- In the device checklist, item 2 says "as described below", but the token how-to is above.
