# Taskop Audit and Corrections — Part 3: Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web app the full audit and correction experience of sub-project 8 (spec §8.3):
- an `/audits` queue (Waiting, In progress, Finished) for `audits.perform` holders;
- an audit screen at `/audits/:id` with verdicts per item, keyboard review, the Finish dialog, the paused state and the PDF report;
- the run dialog's new **Audit** and **Corrections** tabs, and **Correct answers**, **Send back** and **Withdraw** in its execution tab;
- the checklist's "Requires audit" switch and report addresses;
- the Audit column and filter in the reports runs table, cleared problems on the problems page, and the `audit.finished` result filter and deep links in notifications.

It ends with the two spec §10 Playwright flows on a disposable Postgres.

**Architecture:**
- **Two new feature folders**, built like `features/reports/` and `features/tasks/`:
  - `apps/web/src/features/audits/`: pure helpers in `labels.ts` (URL model, range check, item order, variants), React Query hooks and keys in `queries.ts`, then the page, the screen, the dialogs and the run dialog's Audit tab.
  - `apps/web/src/features/corrections/`: `labels.ts` (answer text, the timeline, the time-zone conversions, the correction payload), `queries.ts`, the values-only `AnswerEditor`, the Correct, Send back and Withdraw flows, the rework banner and the Corrections tab.
  - The existing `features/audit/` (the audit-log viewer) is not touched.
- **Every rule comes from Part 1's `audit-logic.ts`.** The web never re-derives a transition: `canCorrect`, `canSendBack`, `canWithdrawSendBack`, `canStartAudit`, `missingVerdicts` and `changedItemIds` decide what is shown and what is sent, so the buttons match what the API accepts.
- **One shared refresh after any change to a run.** `refreshRunViews(qc)` (Task 2, `features/executions/queries.ts`) invalidates `['occurrences']`, `['executions']`, `['corrections']`, `['audits']`, `['problems']` and `['reports']`. Corrections, send-back, withdraw, start, finish and cancel all call it, so the run dialog, the schedule, the queues, the problems list and the reports never show a stale state.
- **The run dialog stays the one place for a run.** `OccurrenceDialog` gains two tabs, and the execution tab gains an edit mode. `/schedule`, `/reports` and notification deep links all open the same dialog, so they get the new tabs for free.
- **Files and polling.** The PDF comes from `api.audits.downloadReport` and is saved with SP7's `saveFile`. While a finished audit's report is `pending`, `useAuditDetail` asks `GET /audits/:id` again every 3 s, for at most 60 s per window (Part 1 "Errors to handle in the UI").

**Tech Stack:** React 19.2.3 (`useEffectEvent` for the keyboard listener), TanStack Router 1 + Query 5, shadcn/ui on `radix-ui` (`Tabs`, `Dialog`, `Switch`, `Checkbox`, `Alert`, `Badge`, `Button`, `Table`, `Textarea`, `Input`), i18next, lucide-react, sonner, zod 4 (e-mail check), Vitest 5 + Testing Library + user-event, Playwright. **No new packages.**

**Spec:** `docs/superpowers/specs/2026-10-15-audit-corrections-design.md`. This plan implements §8.3, the web lines of §9 and §10, and the two e2e scenarios of §10. **Interface source:** `docs/superpowers/plans/2026-10-15-audit-corrections-1-api.md`, section *Interfaces for Parts 2 and 3*, and its *Spec decisions*. This plan imports only the names listed there or already in the repo; *Gaps against Part 1* lists the one gap and the two access limits that remain.

**This plan is Part 3 of 3.**
- **Before starting:** Part 1 **Tasks 1–4** must be merged into the feature branch:
  - `audit-logic.ts`, `corrections.ts`, `audits.ts` and the changes to the existing contracts;
  - the `az.audits`, `az.corrections`, `az.nav.audits` and `az.errors.*` keys;
  - the `api.audits.*`, `api.corrections.*` and `api.executions.resubmit` methods, and `ApiError.auditId` / `.itemIds`.
- **Tasks 1–14** need nothing else. They test against a mocked `@/lib/session`.
- **Task 15 (Playwright)** needs Part 1 **Tasks 5–17** merged:
  - the migrations and the permission backfill;
  - corrections, recalculation, send-back, withdraw, rework, resubmit and `/me/sync`;
  - the audits module, the report job with mail attachments, the notifications;
  - the reports and problems changes.

  Part 1 Task 18 (the scope test suite) is not needed.
- Part 2 (`apps/mobile`) is independent of this part. Both parts append to `packages/i18n/src/i18n.test.ts`; Part 2 adds `az.mobile` keys, this part `az.audits.web` and `az.corrections.web`. The appends do not touch the same lines.

## Global Constraints

- The product name is **Taskop**. Azerbaijani (`az`) is the only locale. Every visible string is an i18n key.
- **New web strings** go only under `az.audits.web.*` (`packages/i18n/src/az/audits-web.ts`) and `az.corrections.web.*` (`packages/i18n/src/az/corrections-web.ts`), exactly as written in Task 1. Part 1's keys (`az.audits.*`, `az.corrections.*`, `az.nav.audits`, `az.errors.*`, `az.notifications.*`, `az.scheduling.statuses.correction_required`, `az.executions.states.rework`) are reused and never renamed.
- **Tests never hard-code a Part 1 string.** They read it from `az` (`import { az } from '@taskop/i18n'`), or format it with `i18n.t` from `@/lib/i18n`. Strings this part adds, and strings already in the repo, are written out.
- **Which runs** (Part 1 Global Constraints): correct and send back only when `canCorrect` / `canSendBack` allow it (`completed` or `audit_pending`, state `completed`). Withdraw only when `canWithdrawSendBack` allows it. Start an audit only when `canStartAudit(run, false)` allows it and the run has no audit, or only a cancelled one. Never show an action the rule refuses.
- **Limits** come from `AUDIT_LIMITS`:
  - checklist report e-mails ≤ 10 (`reportEmails`); finish extras ≤ 20 minus the checklist's addresses (`recipients`);
  - verdict comment ≤ 1000, final comment ≤ 4000, correction reason 1–1000, rework comment 1–1000, cancel reason 1–500;
  - queue range ≤ 366 days (`queueMaxDays`).
- **Time zones:** due dates and `datetime` answers are read and written on the **tenant's** clock (`me.tenant.timezone`), through `tzOffsetMinutes` and `zonedTimeToUtc`. Never the browser's.
- **Keyboard on the audit screen:** ↑/↓ move between items; A approves; R rejects. Keys are ignored while focus is in an input, a textarea, a select, a contenteditable or a dialog, or when Ctrl, Alt or Meta is held.
- **Report polling:** every **3 s** (`REPORT_POLL_MS`) while `reportStatus = 'pending'`, for at most **60 s** (`REPORT_POLL_LIMIT_MS`) per window.
- **Menu:** "Auditlər" (`nav.audits`, icon `ShieldCheck`, `/audits`) for holders of **`audits.perform`**, after "Tapşırıqlar". As with every page, the route itself is not guarded; the API answers `403`.
- **Tests** mock `@/lib/session` exactly as the existing feature tests do. UUIDs that pass a URL validator are valid UUIDs. No test depends on the machine's time zone.
- **Commits** use `git add <explicit paths>` (never `-A`). Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the second `-m`).

## Gaps against Part 1

Part 1's final *Interfaces for Parts 2 and 3* settles what the first draft of this plan had to assume:
- **Fixtures.** Part 1 Task 2 adds the new defaulted fields to the web fixtures (`executions/fixtures.ts`, `executions/answers-view.test.tsx`, `executions/problems-page.test.tsx`, `tasks/fixtures.ts`, `reports/fixtures.ts`, `checklists/checklist-detail-page.test.tsx`, `checklists/checklists-page.test.tsx`, `notifications/fixtures.ts`). Task 1 Step 6 only checks this, and adds a field only where one is still missing.
- **`Score`** is exported from `@taskop/contracts`.
- **Media still uploading at finish** is `422 MEDIA_NOT_FOUND_IN_STORAGE` (Part 1 decision 29); there is no `MEDIA_PENDING` code.
- **Notification targets** of the three new types are `targetKind: 'occurrence'`, with the occurrence id and its local date (pinned in Part 1 Task 16).
- **The report's file name** is `auditReportFileName(checklistName, occurrence localDate)` in `Content-Disposition` (pinned in Part 1 Task 15).
- **i18n files:** `az.audits` and `az.corrections` are the default exports of `packages/i18n/src/az/audits.ts` and `corrections.ts`, and Part 3's keys go under a `web` key of each.

What remains:

1. **Auditor picker options.** No endpoint lists the tenant's auditors, so the `/audits` auditor filter lists active staff from `GET /users` (`users.view`; Auditor, Manager, Admin and Owner hold it). It is hidden without that key, and a shared link with `auditorId` still filters.
2. **The run dialog needs `assignments.view` or `reports.view`.** `GET /occurrences/:id` accepts nothing else. A custom role holding only `audits.perform` or `executions.correct` can use `/audits` and `/audits/:id`, which read everything from `AuditDetail` (its `execution.occurrence` carries the run) and never call `GET /occurrences/:id`. But that role cannot open the run dialog, so "İcraya bax", Correct answers, Send back, Withdraw and the Corrections tab are out of its reach. The system roles are unaffected: Manager and Auditor hold `assignments.view`. This plan does not work around it; the link to the run is shown only with `assignments.view`.
3. **No web UI for platform admins' runs.** Part 1 gives platform admins audit and correction routes under `/platform/tenants/:tenantId/…` (Part 1 decision 24). But the web's platform workspace has only checklists and templates (`platformTenantChildren` in `router.tsx`): no schedule, run dialog or audit pages. So this plan adds no platform audit or correction UI. The one platform-visible change is the checklist's Audit section (Task 11), which goes through `ws.checklists.update`; Part 1 accepts the two fields on the platform route too.

## Spec decisions this plan makes

1. **Folders.** The new folders are `features/audits/` and `features/corrections/`. The existing `features/audit/` is the audit-log viewer and keeps its name.
2. **The `/audits` URL.** The URL holds the queue and every filter: `queue`, `siteId`, `checklistId`, `auditorId`, `result`, `from` and `to`, each validated.
   - Editing a filter replaces the history entry; switching a tab pushes one. So Back from an audit returns to the same tab and filters.
   - `auditorId` counts only outside Waiting, and `result` only on Finished (`queueFilters`).
   - A range needs both dates, `to ≥ from`, and at most 366 days (inclusive). A range the API would refuse is explained, and no request is sent.
   - The site filter covers the site's subtree (Part 1), so the picker lists sites as an indented tree.
3. **Picker sources.**
   - Sites come from `GET /sites` (`sites.view`) and checklists from SP7's `useReportChecklistOptions` (`checklists.view`).
   - Auditors come from `GET /users?kind=staff&status=active` (`users.view`, Gap 1).
   - A picker whose key is missing is hidden.
4. **Waiting rows** have a "Start audit" button. `AUDIT_EXISTS` opens `ApiError.auditId` instead (another auditor was faster). In-progress and finished rows link the checklist name to `/audits/:id`. An in-progress row whose run was sent back shows "Düzəliş tələb olunur".
5. **Items reviewed.** The left column lists `visibleItems(content, answers)` ∩ `auditableItemIds`, by section, in checklist order, follow-ups indented (Part 1 decision 1).
6. **Verdicts.**
   - A or the Approve button sends `{ verdict: 'approved', comment }`. The comment is optional.
   - R or the Reject button needs a comment. Without one, the comment box is focused and Part 1's `audits.issues.commentRequired` is shown; nothing is sent.
   - After a verdict is sent, the next item is selected **at once**, so a run of A presses walks the list.
   - "Qiyməti sil" clears a verdict.
   - A verdict on an item the current answers hide (a correction hid it meanwhile) is refused with `fields.itemId = 'audits.issues.notAuditable'`. The screen shows that text and reloads the audit, which drops the item from the list.
7. **Finish.**
   - "Finish" is offered while the audit is in progress and not paused. While paused, the button is disabled and the banner explains why.
   - With items still unreviewed, a click does not open the dialog: it highlights those items, selects the first, and says how many are missing. This is the client's copy of `AUDIT_INCOMPLETE`.
   - The server's own `AUDIT_INCOMPLETE` (for example, a correction revealed an item since) does the same with `ApiError.itemIds`.
   - The dialog has the result (a radio pair, no default), the final comment, the checklist's addresses (read only) and extra addresses.
   - `AUDIT_PAUSED`, and `MEDIA_NOT_FOUND_IN_STORAGE` (a photo or video the answers reference is still uploading, Part 1 decision 29), keep the dialog open with their message.
8. **Cancel audit** is on the screen too. The endpoint exists, and `audits.perform` covers it (spec §5). It asks for a reason. The screen stays, and then shows the cancelled audit read-only.
9. **Report polling** (Global Constraints). A new 60 s window opens on "Yenidən yoxla", after a resend or retry, and when a download answers `REPORT_NOT_READY`. After the window the page says the report is not ready yet and offers "Yenidən yoxla".
   - **Retry** is offered on a `failed` report and calls `sendReport(id)` without a body.
   - **Resend** on a `ready` report opens a dialog with the stored recipients pre-filled (1–20).
   - Download is open to `reports.view` holders; Retry and Resend need `audits.perform`.
   - Sending to other addresses does not change the stored `reportRecipients` (Part 1), so the panel keeps listing the stored ones.
   - Retry and Resend appear only on a finished audit; the API refuses `sendReport` on an unfinished one with `409 REPORT_NOT_READY`.
10. **Read-only audits.** A `reports.view` holder without `audits.perform` sees the same screen with no verdict buttons, no comment box, no Finish and no Cancel. The keyboard only moves the selection.
11. **Correct answers** is an edit mode that replaces the answers list in the execution tab.
    - It shows the items visible for the edited answers, so a changed choice can reveal a follow-up.
    - Each item has the values-only `AnswerEditor`: choices, number, text, comment, date/time on the tenant's clock, and the note. Photos and videos are fixed (spec §1), and the manual problem is never edited (Part 1 decision 2).
    - "Save" first runs `requirements()` and shows what is missing per item. Only then does the reason dialog open.
    - The request carries the `answersRev` the edit started from, and one change per `changedItemIds(before, draft)` item; `answer` is the draft without `problem`, or `null` when nothing is left.
    - `ANSWERS_CONFLICT` reloads the run and restarts the edit from the new answers with a notice. `REQUIREMENTS_UNMET` shows the server's `missing` per item.
    - Any other refusal stays in the reason dialog with its `az.errors` message. That includes `MEDIA_NOT_CORRECTABLE` with `fields['changes.<i>.answer.photos']`, which this editor cannot cause, because it sends the item's media unchanged.
12. **Send back.** One checkbox per visible item, a required comment per checked item, and an optional due date (`datetime-local` on the tenant's clock, never in the past). Withdraw asks for confirmation.
13. **Rework banner.** While a request is open (`detail.rework`), every reader of the run sees the round, who sent it back and when, the due date, and the flagged items with their comments. A corrected run shows "Düzəliş edilib" beside its state.
    - `requestedBy` is `null` when a platform admin sent the run back; the banner and the timeline then say "Taskop dəstəyi", the existing `scheduling.schedule.actorPlatform` wording.
14. **Run dialog tabs:** Ümumi, İcra, Audit, Düzəlişlər, in that order. `/schedule?tab=` accepts the two new values.
    - The Audit tab shows the audit's status, result, score and paused state, with a link to the audit for `audits.perform` or `reports.view` holders. Otherwise it shows "Start audit" when the rules allow it.
    - `ExecutionDetail.audit` is the non-cancelled audit, else the latest cancelled one. A cancelled one counts as no audit.
    - The Corrections tab shows the original and current scores, a two-column diff of the changed items, and a timeline of send-backs, resubmits, withdrawals and corrected items, oldest first.
15. **Checklist settings** live in an "Audit" section on the checklist detail page, saved with `PATCH /checklists/:id { requiresAudit, auditReportEmails }`. The name/description dialog is unchanged.
    - The same section works in the platform admin's tenant workspace, because it goes through `ws.checklists.update`, and Part 1 accepts the fields on `/platform/tenants/:tenantId/checklists/:id` too.
    - A refused list shows the server's field key: `fields.auditReportEmails` (`audits.issues.tooManyEmails`) or `fields['auditReportEmails.<i>']` (`errors.validation.email`).
16. **Reports.**
    - `/reports?tab=runs&auditState=…` filters the runs table, and the URL keeps it.
    - The "Bu cədvəl" export of the runs table sends it too; other tables and the full report do not.
    - The Audit column shows the run's audit state; "Düzəliş edilib" sits beside a corrected score.
17. **Problems.** "Aradan qaldırılanları göstər" is a checkbox in page state that sends `includeCleared=true`. Cleared rows are muted and say "Düzəlişlə aradan qaldırılıb". In the run's answers, a cleared problem is muted with the same badge and no longer colours the item.
18. **Notifications.**
    - The rules table gains an "Audit nəticəsi" column with a select for `audit.finished` only, and a dash elsewhere.
    - `resultFilter` travels in every rule body: the draft value for `audit.finished`, `null` for the rest.
    - The new `audit` group appears through `NOTIFICATION_GROUPS`.
    - Deep links: `run.correction_required` opens İcra, `run.resubmitted` Düzəlişlər, `audit.finished` Audit. Part 1 gives these rows `targetKind: 'occurrence'`.
    - A refused filter (`fields.resultFilter = 'notifications.issues.resultFilterNotApplicable'`) shows under its row like the other field errors.
19. **E2E** (Task 15).
    - The signed-up owner holds every permission, so the owner acts as both auditor and manager.
    - The worker's phone is the API, as in the earlier specs. It uploads a real JPEG taken with `page.screenshot`, so finish is never refused for pending media and the PDF embeds a photo.
    - The CI e2e job gains SeaweedFS (for the PDF) and Mailpit (for the e-mail). Scenario 1 also checks the e-mail arrived with one attachment.

## Review Focus

These are the five failure modes most likely to bite users that no spec test names. Each line gives the task whose test pins it.

1. **Two managers correct the same run.** The second one's save answers `409 ANSWERS_CONFLICT`. The page must reload the run, show the newer answers in the editor, say why, and save nothing silently. Pinned in Task 9 (`reloads the run and starts over when another manager corrected it first`).
2. **Shortcut keys typed as text.** An auditor types "Ağac" or "rəng" in a comment box, or in the Finish dialog. A and R must not record verdicts then, and R with an empty comment must never reject. Pinned in Task 4 (`ignores A and R while typing a comment`, `asks for a comment before R rejects, then rejects with it`).
3. **A slow or failed report.** The PDF takes longer than a minute, or the job gave up. Polling must stop after 60 s with a way to check again; a download answering `REPORT_NOT_READY` must fall back to waiting; a failed report must offer Retry. Pinned in Task 5 (`stops asking after 60 s and asks again on request`, `waits again when the download says the report is not ready`, `retries a failed report`).
4. **Finishing with items still unreviewed,** including items a correction revealed after the auditor last looked. The page must point at them instead of failing with a generic error. Pinned in Task 5 (`highlights the items without a verdict instead of finishing`, `highlights the items the server still misses`).
5. **Report addresses typed or pasted by hand:** a pasted list, capitals, a duplicate, a typo, the 11th address. The input must never hold an address the API would refuse. Pinned in Task 3 (`refuses an invalid address, a duplicate and one over the limit, and keeps the text to fix`, `adds a pasted list, lower-cased`).

---

## File Structure

```
packages/i18n/src/
  az/audits-web.ts                (new) az.audits.web: page, screen, finish, cancel, report, emails, settings, resultFilter
  az/corrections-web.ts           (new) az.corrections.web: edit, sendBack, withdraw, rework, timeline, diff, score, media, showCleared
  az/audits.ts, az/corrections.ts (Part 1) + `web`
  i18n.test.ts                    + audit and correction web translations
apps/web/src/
  components/
    email-list-input.tsx          (new) EmailListInput, addEmails, splitEmails
    email-list-input.test.tsx
  features/audits/
    labels.ts                     DEFAULT_QUEUE, REPORT_POLL_MS, REPORT_POLL_LIMIT_MS, resultVariant, runAuditStateVariant, verdictVariant,
                                  AuditsSearch, auditsSearch, QueueRangeIssue, RANGE_ISSUE_KEYS, queueRangeIssue, AuditQueueFilters,
                                  queueFilters, auditItems, verdictMap, stepItem, actorName, upsertVerdict
    labels.test.ts
    queries.ts                    auditKeys, useAuditQueue, useAuditorOptions, useAuditDetail, startOrOpenAudit, useStartAudit (Task 6)
    queries.test.ts
    fixtures.ts                   AUDIT_IDS, AUDITOR, auditDto, auditFixture, verdict, queueRow, apiError (tests only)
    audit-screen.tsx              AuditRoute, AuditScreen (/audits/$auditId)
    audit-screen.test.tsx
    item-list.tsx                 ItemList
    item-panel.tsx                ItemPanel
    audit-actions.tsx             AuditActions, FinishDialog, CancelAuditDialog
    audit-actions.test.tsx
    report-panel.tsx              ReportPanel, ResendDialog
    report-panel.test.tsx
    audits-page.tsx               AuditsPage (/audits)
    audits-page.test.tsx
    run-audit-tab.tsx             RunAuditTab (run dialog)
    run-audit-tab.test.tsx
  features/corrections/
    labels.ts                     answerSummary, TimelineEntry, correctionTimeline, isoToLocalInput, localInputToIso, pruneAnswer,
                                  correctionAnswer, correctionChanges
    labels.test.ts
    queries.ts                    correctionKeys, useCorrections
    fixtures.ts                   MANAGER, reworkRequest, correction, noCorrections (tests only)
    corrections-tab.tsx           CorrectionsTab (run dialog)
    corrections-tab.test.tsx
    answer-editor.tsx             AnswerEditor
    answer-editor.test.tsx
    correct-answers.tsx           CorrectAnswers, ReasonDialog
    correct-answers.test.tsx
    run-actions.tsx               RunActions (Correct, Send back, Withdraw)
    send-back-dialog.tsx          SendBackDialog
    send-back-dialog.test.tsx
    rework-banner.tsx             ReworkBanner
  features/checklists/
    audit-settings.tsx            (new) AuditSettings
    checklist-detail-page.tsx     + the Audit section
    checklist-detail-page.test.tsx
  features/executions/
    queries.ts                    + refreshRunViews
    labels.ts                     executionStateVariant: rework
    labels.test.ts
    execution-tab.tsx             + RunActions, CorrectAnswers, ReworkBanner, "Düzəliş edilib"
    execution-tab.test.tsx        session mock gains useCan
    answers-view.tsx              cleared problems muted, not counted
    answers-view.test.tsx
    problems-page.tsx             + "Aradan qaldırılanları göstər"
    problems-page.test.tsx
    fixtures.ts                   + the new ExecutionDetail / ExecutionProblem fields (Task 1)
  features/scheduling/
    occurrence-dialog.tsx         OCCURRENCE_TABS, + Audit and Düzəlişlər tabs
    occurrence-dialog.test.tsx    (new)
    routes.tsx                    scheduleSearch accepts the new tabs
    labels.ts                     occurrenceVariant: correction_required
    labels.test.ts
    schedule-page.test.tsx        scheduleSearch expectations
  features/reports/
    search.ts, search.test.ts     + auditState
    queries.ts                    useReportRuns(filters, bucket, auditState)
    labels.ts, labels.test.ts     exportQuery + auditState
    runs-tab.tsx, runs-tab.test.tsx   Audit column, corrected marker, audit-state select
    export-menu.tsx, export-menu.test.tsx   + auditState
    reports-page.tsx, reports-page.test.tsx  wires auditState
    fixtures.ts                   + auditState, corrected (Task 1)
  features/notifications/
    rules-form.ts, rules-form.test.ts   + resultFilter
    rules-tab.tsx, rules-tab.test.tsx   + "Audit nəticəsi" column
    labels.ts, labels.test.ts     deep links for the three new types
    fixtures.ts                   + resultFilter (Task 1)
  features/tasks/fixtures.ts      + clearedAt (Task 1)
  layouts/app-shell.tsx, app-shell.test.tsx   + Auditlər
  router.tsx                      /audits (validateSearch: auditsSearch), /audits/$auditId
apps/web/e2e/
  audits.spec.ts                  (new) the two spec §10 flows
.github/workflows/ci.yml          e2e job: SeaweedFS and Mailpit
```

---

### Task 1: Web strings, and the web fixtures on the new contract shapes

**Files:**
- Create: `packages/i18n/src/az/audits-web.ts`, `packages/i18n/src/az/corrections-web.ts`
- Modify: `packages/i18n/src/az/audits.ts`, `packages/i18n/src/az/corrections.ts` (Part 1 Task 3's files, `export default { … } as const`: one import and one `web` key each)
- Test: `packages/i18n/src/i18n.test.ts`
- Check only (Part 1 Task 2 already updated them; Step 6 adds a field only if one is missing): `apps/web/src/features/executions/fixtures.ts`, `apps/web/src/features/executions/answers-view.test.tsx`, `apps/web/src/features/executions/problems-page.test.tsx`, `apps/web/src/features/tasks/fixtures.ts`, `apps/web/src/features/reports/fixtures.ts`, `apps/web/src/features/checklists/checklist-detail-page.test.tsx`, `apps/web/src/features/checklists/checklists-page.test.tsx`, `apps/web/src/features/notifications/fixtures.ts`

**Interfaces:**
- Consumes: Part 1 Task 3's `az.audits` and `az.corrections`. Part 1 Task 2's new fields:
  - `ExecutionDetail.{reworkRound, rework, corrected, audit}`;
  - `ExecutionProblem.clearedAt` and `ProblemDto.clearedAt`;
  - `ReportRun.{auditState, corrected}`;
  - `ChecklistDetail.{requiresAudit, auditReportEmails}`;
  - `NotificationRuleDto.resultFilter`, and `DefaultRule.resultFilter`.
- Produces (used by Tasks 2–15): every key below, exactly as written. The shared fixtures (`executionFixture().detail()`, `problemDto()`, `reportRun()`, `ruleDto()`) build the new shapes with neutral values: no rework, not corrected, no audit, not cleared, no audit state, no result filter.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('audit and correction web translations', () => {
  it('nests the web strings under az.audits.web and az.corrections.web, beside Part 1 keys', () => {
    expect(az.audits.web.page.columns.executor).toBe('İcraçı');
    expect(az.audits.web.page.empty.waiting).toBe('Audit gözləyən icra yoxdur.');
    expect(az.audits.web.page.range.incomplete).toBe('Başlanğıc və son tarixi birlikdə seçin.');
    expect(az.audits.web.screen.items).toBe('Bəndlər');
    expect(az.audits.web.screen.keyboard).toBe('Klaviatura: ↑/↓ — bənd seçimi, A — təsdiqlə, R — rədd et');
    expect(az.audits.web.screen.missing).toBe('{{count}} bənd hələ qiymətləndirilməyib.');
    expect(az.audits.web.finish.title).toBe('Auditi bitir');
    expect(az.audits.web.cancel.title).toBe('Auditi ləğv et');
    expect(az.audits.web.report.preparing).toBe('Hesabat hazırlanır…');
    expect(az.audits.web.report.checkAgain).toBe('Yenidən yoxla');
    expect(az.audits.web.emails.remove).toBe('Sil: {{email}}');
    expect(az.audits.web.emails.tooMany).toBe('Ən çox {{max}} ünvan əlavə etmək olar.');
    expect(az.audits.web.settings.title).toBe('Audit');
    expect(az.audits.web.resultFilter).toBe('Audit nəticəsi');
    expect(az.corrections.web.edit.save).toBe('Düzəlişləri yadda saxla');
    expect(az.corrections.web.edit.reasonTitle).toBe('Düzəlişin səbəbi');
    expect(az.corrections.web.sendBack.title).toBe('İcranı düzəlişə qaytar');
    expect(az.corrections.web.sendBack.comment).toBe('{{item}} — şərh');
    expect(az.corrections.web.withdraw.title).toBe('Geri qaytarmanı ləğv et');
    expect(az.corrections.web.timeline.sentBack).toBe('{{name}} icranı düzəlişə qaytardı');
    expect(az.corrections.web.score.original).toBe('İlkin bal: {{value}}');
    expect(az.corrections.web.showCleared).toBe('Aradan qaldırılanları göstər');
    // Part 1's keys are untouched.
    expect(az.audits.paused).toBe('İcraçıya düzəlişə qaytarılıb — yenidən təqdim gözlənilir');
    expect(az.corrections.original).toBe('İlkin');
    expect(az.corrections.emptyAnswer).toBe('Cavab yoxdur');
    expect(az.nav.audits).toBe('Auditlər');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/i18n test`
Expected: FAIL: `Cannot read properties of undefined (reading 'page')` (`az.audits.web` is `undefined`).

- [ ] **Step 3: Add the audit web strings**

`packages/i18n/src/az/audits-web.ts`:

```ts
/** Web-only strings of the audit pages (SP8 Part 3). Part 1's az.audits keys are reused, never repeated here. */
export default {
  page: {
    filters: {
      site: 'Obyekt',
      allSites: 'Bütün obyektlər',
      checklist: 'Yoxlama vərəqəsi',
      allChecklists: 'Bütün yoxlama vərəqələri',
      auditor: 'Auditor',
      allAuditors: 'Bütün auditorlar',
      result: 'Nəticə',
      allResults: 'Bütün nəticələr',
      from: 'Başlanğıc tarixi',
      to: 'Son tarix',
    },
    range: {
      incomplete: 'Başlanğıc və son tarixi birlikdə seçin.',
      inverted: 'Son tarix başlanğıc tarixindən əvvəl ola bilməz.',
    },
    columns: {
      date: 'Tarix',
      checklist: 'Yoxlama vərəqəsi',
      site: 'Obyekt',
      executor: 'İcraçı',
      completedAt: 'Tamamlanıb',
      auditor: 'Auditor',
      startedAt: 'Başlanıb',
      finishedAt: 'Bitib',
      result: 'Nəticə',
      score: 'Audit balı',
      status: 'Status',
    },
    empty: {
      waiting: 'Audit gözləyən icra yoxdur.',
      in_progress: 'Davam edən audit yoxdur.',
      finished: 'Bitmiş audit yoxdur.',
    },
    more: 'Daha çox göstər',
  },
  screen: {
    openRun: 'İcraya bax',
    items: 'Bəndlər',
    answer: 'Cavab',
    media: 'Foto və videolar',
    problems: 'Problemlər',
    correctedBy: '{{name}} düzəldib · {{reason}}',
    keyboard: 'Klaviatura: ↑/↓ — bənd seçimi, A — təsdiqlə, R — rədd et',
    readOnly: 'Bu audit yalnız baxış üçündür.',
    missing: '{{count}} bənd hələ qiymətləndirilməyib.',
    noItems: 'Bu icrada qiymətləndiriləcək bənd yoxdur.',
    executor: 'İcraçı: {{name}}',
    verdictBy: '{{verdict}} · {{name}}',
  },
  finish: {
    title: 'Auditi bitir',
    checklistEmails: 'Yoxlama vərəqəsinin ünvanları',
    noChecklistEmails: 'Yoxlama vərəqəsində ünvan yoxdur.',
    submit: 'Auditi bitir',
    done: 'Audit bitdi',
  },
  cancel: {
    title: 'Auditi ləğv et',
    description: 'Audit dayandırılacaq və nəticəsiz qalacaq.',
    submit: 'Auditi ləğv et',
    done: 'Audit ləğv edildi',
  },
  report: {
    title: 'Audit hesabatı',
    preparing: 'Hesabat hazırlanır…',
    slow: 'Hesabat hələ hazır deyil. Bir az sonra yenidən yoxlayın.',
    checkAgain: 'Yenidən yoxla',
    failed: 'Hesabat yaradıla bilmədi.',
    noRecipients: 'Hesabat heç kimə göndərilməyib.',
    resendTitle: 'Hesabatı yenidən göndər',
    send: 'Göndər',
    sent: 'Hesabat göndərilir',
  },
  emails: {
    placeholder: 'ad@nümunə.az',
    add: 'Əlavə et',
    remove: 'Sil: {{email}}',
    none: 'Ünvan yoxdur',
    invalid: 'E-poçt ünvanı düzgün deyil.',
    duplicate: 'Bu ünvan artıq siyahıdadır.',
    tooMany: 'Ən çox {{max}} ünvan əlavə etmək olar.',
  },
  settings: {
    title: 'Audit',
    requiresAuditHint: 'Bu vərəqənin tamamlanan icraları avtomatik audit növbəsinə düşür.',
    emailsHint: 'Audit bitəndə PDF hesabat bu ünvanlara göndərilir (ən çox 10).',
  },
  resultFilter: 'Audit nəticəsi',
} as const;
```

- [ ] **Step 4: Add the correction web strings**

`packages/i18n/src/az/corrections-web.ts`:

```ts
/** Web-only strings of corrections, send-back and the corrections timeline (SP8 Part 3). Part 1's keys are reused. */
export default {
  edit: {
    banner: 'Düzəliş rejimi: dəyişdirmək istədiyiniz cavabları redaktə edin. Foto və videolar dəyişdirilmir.',
    save: 'Düzəlişləri yadda saxla',
    discard: 'İmtina et',
    changed: '{{count}} bənd dəyişdirilib',
    noChanges: 'Hələ heç nə dəyişdirilməyib.',
    clear: 'Cavabı sil',
    note: '{{item}} — qeyd',
    mediaLocked: 'Foto və videolar düzəliş zamanı dəyişdirilmir.',
    requirements: 'Bu düzəlişlə tələb olunan sahələr boş qalır.',
    conflict: 'İcra bu vaxt başqa yerdə dəyişdirilib. Ən son cavablar yükləndi — düzəlişləri yenidən edin.',
    saved: 'Düzəlişlər yadda saxlanıldı',
    reasonTitle: 'Düzəlişin səbəbi',
    reasonHint: 'Səbəb düzəlişlər tarixçəsində və audit hesabatında görünəcək.',
  },
  sendBack: {
    title: 'İcranı düzəlişə qaytar',
    hint: 'İcraçı yalnız seçilmiş bəndləri telefonda düzəldə biləcək.',
    selected: '{{count}} bənd seçilib',
    noItems: 'Ən azı bir bənd seçin.',
    commentRequired: 'Hər seçilmiş bənd üçün şərh yazın.',
    comment: '{{item}} — şərh',
    dueHint: 'İstəyə bağlıdır. Son tarix keçəndə avtomatik heç nə baş vermir.',
    done: 'İcra icraçıya qaytarıldı',
  },
  withdraw: {
    title: 'Geri qaytarmanı ləğv et',
    description: 'İcra əvvəlki statusuna qayıdacaq. İcraçının artıq göndərdiyi cavablar qalacaq.',
    done: 'Geri qaytarma ləğv edildi',
  },
  rework: {
    requestedBy: '{{name}} · {{time}}',
    flagged: 'Düzəliş tələb olunan bəndlər',
  },
  timeline: {
    title: 'Tarixçə',
    sentBack: '{{name}} icranı düzəlişə qaytardı',
    resubmitted: 'İcraçı düzəlişləri təqdim etdi',
    withdrawn: '{{name}} geri qaytarmanı ləğv etdi',
    reason: 'Səbəb: {{reason}}',
    comment: 'Şərh: {{comment}}',
  },
  diff: {
    title: 'İlkin və cari cavablar',
    item: 'Bənd',
    capturedAt: 'İlkin nəticə {{time}} tarixində saxlanılıb',
  },
  score: {
    original: 'İlkin bal: {{value}}',
    current: 'Cari bal: {{value}}',
  },
  media: '{{photos}} foto, {{videos}} video',
  showCleared: 'Aradan qaldırılanları göstər',
} as const;
```

- [ ] **Step 5: Hang them under Part 1's namespaces**

Part 1 defines `az.audits` as the default export of `packages/i18n/src/az/audits.ts` and `az.corrections` as that of `packages/i18n/src/az/corrections.ts`, both already registered in `az/index.ts`. Its *Interfaces* reserve a `web` key in each for this part.

In `packages/i18n/src/az/audits.ts`, add as the first line:

```ts
import web from './audits-web.js';
```

and, as the last key of the exported object (just before the closing `} as const;`):

```ts
  web,
```

In `packages/i18n/src/az/corrections.ts`, add as the first line:

```ts
import web from './corrections-web.js';
```

and, as the last key of the exported object (just before the closing `} as const;`):

```ts
  web,
```

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS. The build makes the keys visible to `apps/web`.

- [ ] **Step 6: Check that the web fixtures have the new contract shapes**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/web typecheck`

Expected: PASS, because Part 1 Task 2 already added the defaulted fields to the web fixtures; then go on to Step 7. Only if the typecheck names one of the files below, add the missing field it names, exactly as shown, and leave the fields that are already there alone:

`apps/web/src/features/executions/fixtures.ts`: in `executionFixture()`, give each of the three `problems` entries `clearedAt: null` after `createdAt: CREATED`, so the list reads:

```ts
  const problems: ExecutionProblem[] = [
    { id: 'pr1', itemId: problem.id, source: 'rule', severity: 'critical', note: null, mediaIds: [], resolution: 'none', taskId: null, createdAt: CREATED, clearedAt: null },
    { id: 'pr2', itemId: temp.id, source: 'rule', severity: 'normal', note: 'isti', mediaIds: [], resolution: 'none', taskId: null, createdAt: CREATED, clearedAt: null },
    { id: 'pr3', itemId: temp.id, source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: ['pm1'], resolution: 'none', taskId: null, createdAt: CREATED, clearedAt: null },
  ];
```

and in its `detail()` builder, after `problems,` add:

```ts
    reworkRound: 0,
    rework: null,
    corrected: false,
    audit: null,
```

`apps/web/src/features/executions/answers-view.test.tsx`: in the test `shows a manual problem's media that are also the item's evidence only once`, add `clearedAt: null` after `createdAt: '2026-11-02T04:20:00.000Z'` in the inline problem.

`apps/web/src/features/executions/problems-page.test.tsx`: in the `problem()` builder, change `executionState: 'completed', ...over,` to `executionState: 'completed', clearedAt: null, ...over,`.

`apps/web/src/features/tasks/fixtures.ts`: in `problemDto()`, after `executionState: 'completed',` add `clearedAt: null,`.

`apps/web/src/features/reports/fixtures.ts`: in `reportRun()`, after `clockSuspect: false,` add:

```ts
  auditState: null,
  corrected: false,
```

`apps/web/src/features/checklists/checklist-detail-page.test.tsx`: in `detail()`, after `source: { kind: 'global', id: ID },` add:

```ts
  requiresAudit: false,
  auditReportEmails: [],
```

`apps/web/src/features/notifications/fixtures.ts`: in `ruleDto()`, after `leadMinutes: d.leadMinutes,` add `resultFilter: d.resultFilter,`.

Run: `pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web test`
Expected: PASS. No test changes behaviour: every new field has its neutral value.

The `reworkRequest()` builder that Tasks 7 and 10 use is this part's own (`features/corrections/fixtures.ts`, Task 7). It includes Part 1's `answersBefore` and allows `requestedBy: null`.

- [ ] **Step 7: Commit**

```bash
git add packages/i18n/src/az/audits-web.ts packages/i18n/src/az/corrections-web.ts packages/i18n/src/az/audits.ts packages/i18n/src/az/corrections.ts packages/i18n/src/i18n.test.ts
# Only the fixture files Step 6 had to change, if any:
git add apps/web/src/features/executions/fixtures.ts apps/web/src/features/executions/answers-view.test.tsx apps/web/src/features/executions/problems-page.test.tsx apps/web/src/features/tasks/fixtures.ts apps/web/src/features/reports/fixtures.ts apps/web/src/features/checklists/checklist-detail-page.test.tsx apps/web/src/features/notifications/fixtures.ts
git commit -m "feat(i18n): add the web strings for audits and corrections, and align the web fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Audit helpers, queries and test fixtures; the badges of the new states; `refreshRunViews`

**Files:**
- Create: `apps/web/src/features/audits/labels.ts`, `apps/web/src/features/audits/queries.ts`, `apps/web/src/features/audits/fixtures.ts`
- Modify: `apps/web/src/features/executions/queries.ts`, `apps/web/src/features/executions/labels.ts`, `apps/web/src/features/scheduling/labels.ts`
- Test: `apps/web/src/features/audits/labels.test.ts`, `apps/web/src/features/audits/queries.test.ts`, `apps/web/src/features/executions/labels.test.ts`, `apps/web/src/features/scheduling/labels.test.ts`

**Interfaces:**
- Consumes:
  - Part 1 (`@taskop/contracts`): `AUDIT_LIMITS`, `AUDIT_QUEUES`, `AUDIT_RESULTS`, types `AuditActor`, `AuditDetail`, `AuditDto`, `AuditItemVerdict`, `AuditQueue`, `AuditQueueQuery`, `AuditQueueRow`, `AuditResult`, `AuditVerdict`, `RunAuditState`.
  - Part 1 (`@taskop/api-client`): `api.audits.{list, get, start}`, `ApiError.auditId`.
  - Existing: `visibleItems`, `type VisibleItem`, `dayNumber`, `idSchema`, `localDateSchema`; `Variant` (`features/scheduling/labels`); `executionFixture`, `occurrenceDto` (`features/executions/fixtures`).
- Produces:
  - `features/audits/labels.ts`:
    - constants: `DEFAULT_QUEUE: AuditQueue = 'waiting'`, `REPORT_POLL_MS = 3_000`, `REPORT_POLL_LIMIT_MS = 60_000`;
    - badge variants: `resultVariant(r: AuditResult): Variant`, `runAuditStateVariant(s: RunAuditState): Variant`, `verdictVariant(v: AuditVerdict | null): Variant`;
    - the URL model: `interface AuditsSearch { queue?; siteId?; checklistId?; auditorId?; result?; from?; to? }` and `auditsSearch(s: Record<string, unknown>): AuditsSearch`;
    - the range check: `type QueueRangeIssue = 'incomplete' | 'inverted' | 'tooLong'`, `RANGE_ISSUE_KEYS: Record<QueueRangeIssue, string>`, `queueRangeIssue(from?: string, to?: string): QueueRangeIssue | null`;
    - the query: `type AuditQueueFilters = Omit<AuditQueueQuery, 'cursor' | 'limit'>`, `queueFilters(s: AuditsSearch): AuditQueueFilters`;
    - items and verdicts: `auditItems(content, answers, auditableIds: readonly string[]): VisibleItem[]`, `verdictMap(verdicts): Map<string, AuditVerdict>`, `stepItem(order: readonly string[], current: string | null, step: 1 | -1): string | null`, `actorName(t, a: { kind: 'user' | 'platform'; name: string | null } | null): string`, `upsertVerdict(list, v): AuditItemVerdict[]`.
  - `features/audits/queries.ts`:
    - `auditKeys` (`all`, `queue(f)`, `detail(id)`);
    - `useAuditQueue(filters: AuditQueueFilters, enabled: boolean)` (infinite);
    - `useAuditorOptions(enabled: boolean)`;
    - `useAuditDetail(id: string): { query; timedOut: boolean; restartPolling: () => void }`;
    - `startOrOpenAudit(executionId: string): Promise<string>`.
  - `features/audits/fixtures.ts` (tests only):
    - `AUDIT_IDS`, `AUDITOR`, `auditDto(over?)`;
    - `auditFixture()`: `executionFixture()` plus `auditableItemIds` and `detail(over?)`, an in-progress `AuditDetail`;
    - `verdict(itemId, v, comment?)`, `queueRow(over?)`;
    - `apiError(status, code, extra?)`, for `ApiError` with `auditId`, `itemIds`, `missing` or `fields`.
  - `features/executions/queries.ts`: `refreshRunViews(qc: QueryClient): Promise<void>`.
  - Badges: `occurrenceVariant('correction_required') = 'destructive'`, `executionStateVariant('rework') = 'secondary'`.

- [ ] **Step 1: Add the test fixtures**

`apps/web/src/features/audits/fixtures.ts`:

```ts
import { ApiError, type ClientErrorCode } from '@taskop/api-client';
import { type AuditDetail, type AuditDto, type AuditItemVerdict, type AuditQueueRow, type AuditVerdict, visibleItems } from '@taskop/contracts';
import { executionFixture, occurrenceDto } from '@/features/executions/fixtures';

/** Test data shared by the audit tests. Not imported by application code. */

/** Valid UUIDs: the /audits URL validator checks ids. */
const uuid = (n: number) => `0192f1e2-7c3a-7b4d-8e5f-${n.toString(16).padStart(12, '0')}`;
export const AUDIT_IDS = {
  audit: uuid(0x501),
  audit2: uuid(0x502),
  execution: uuid(0x503),
  occurrence: uuid(0x504),
  site: uuid(0x505),
  checklist: uuid(0x506),
  auditor: uuid(0x507),
  executor: uuid(0x508),
} as const;

export const AUDITOR = { kind: 'user' as const, id: AUDIT_IDS.auditor, name: 'Rəşad Kazımov' };

/** In progress since 14:00 Baku, no verdicts, no report yet. */
export const auditDto = (over: Partial<AuditDto> = {}): AuditDto => ({
  id: AUDIT_IDS.audit,
  executionId: 'x1',
  occurrenceId: 'o1',
  status: 'in_progress',
  paused: false,
  auditor: AUDITOR,
  startedAt: '2026-11-02T10:00:00.000Z',
  finishedAt: null,
  cancelledAt: null,
  cancelReason: null,
  result: null,
  score: null,
  comment: null,
  reportStatus: 'none',
  reportRecipients: [],
  reportSentAt: null,
  verdicts: [],
  ...over,
});

/**
 * The execution fixture under audit: six auditable items, in order "Problem varmı?", "Təsvir edin" (follow-up),
 * "Temperatur", "Ümumi görünüş" (section Zal), "Video", "Qeyd" (section Son). The run waits for audit; the
 * checklist sends its report to rehber@acme.az.
 */
export function auditFixture() {
  const f = executionFixture();
  const auditableItemIds = visibleItems(f.content, f.answers).map((v) => v.item.id);
  const detail = (over: Partial<AuditDetail> = {}): AuditDetail => ({
    ...auditDto(),
    execution: f.detail({ occurrence: occurrenceDto({ status: 'audit_pending' }) }),
    corrections: { original: null, corrections: [], reworkRequests: [], diff: [] },
    auditableItemIds,
    checklistReportEmails: ['rehber@acme.az'],
    requiresAudit: true,
    ...over,
  });
  return { ...f, auditableItemIds, detail };
}

export const verdict = (itemId: string, v: AuditVerdict, comment: string | null = null): AuditItemVerdict => ({
  itemId,
  verdict: v,
  comment,
  updatedBy: { id: 'me1', fullName: 'Leyla Quliyeva' },
  updatedAt: '2026-11-02T10:05:00.000Z',
});

/** A run waiting for audit: completed 09:00 Baku by Nigar at Anbar №1. */
export const queueRow = (over: Partial<AuditQueueRow> = {}): AuditQueueRow => ({
  occurrenceId: AUDIT_IDS.occurrence,
  executionId: AUDIT_IDS.execution,
  auditId: null,
  checklist: { id: AUDIT_IDS.checklist, name: 'Açılış yoxlaması' },
  site: { id: AUDIT_IDS.site, name: 'Anbar №1' },
  executor: { id: AUDIT_IDS.executor, fullName: 'Nigar Səfərli' },
  localDate: '2026-11-02',
  completedAt: '2026-11-02T05:00:00.000Z',
  status: 'audit_pending',
  auditState: 'waiting',
  auditor: null,
  result: null,
  percent: null,
  startedAt: null,
  finishedAt: null,
  ...over,
});

/** An API error with the extra body fields Part 1 reads into ApiError (auditId, itemIds, missing, fields). */
export const apiError = (status: number, code: ClientErrorCode, extra: Partial<Pick<ApiError, 'auditId' | 'itemIds' | 'missing' | 'fields'>> = {}): ApiError =>
  Object.assign(new ApiError(status, code, `errors.${code}`), extra);
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/features/audits/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { executionFixture } from '@/features/executions/fixtures';
import { IDS } from '@/features/reports/fixtures';
import i18n from '@/lib/i18n';
import { verdict } from './fixtures';
import {
  actorName,
  auditItems,
  auditsSearch,
  queueFilters,
  queueRangeIssue,
  resultVariant,
  runAuditStateVariant,
  stepItem,
  upsertVerdict,
  verdictMap,
  verdictVariant,
} from './labels';

const t = i18n.t.bind(i18n);

describe('audit badges', () => {
  it('colours results, run audit states and verdicts', () => {
    expect(resultVariant('passed')).toBe('default');
    expect(resultVariant('failed')).toBe('destructive');
    expect(runAuditStateVariant('waiting')).toBe('outline');
    expect(runAuditStateVariant('in_progress')).toBe('secondary');
    expect(runAuditStateVariant('passed')).toBe('default');
    expect(runAuditStateVariant('failed')).toBe('destructive');
    expect(verdictVariant('approved')).toBe('default');
    expect(verdictVariant('rejected')).toBe('destructive');
    expect(verdictVariant(null)).toBe('outline');
  });
});

describe('auditsSearch', () => {
  it('keeps every valid parameter of a shared /audits URL', () => {
    const s = { queue: 'finished', siteId: IDS.zoneA, checklistId: IDS.checklist, auditorId: IDS.aynur, result: 'failed', from: '2026-10-01', to: '2026-10-31' };
    expect(auditsSearch(s)).toEqual(s);
  });

  it('drops what a hand-edited link gets wrong', () => {
    expect(auditsSearch({ queue: 'done', siteId: 'site-1', checklistId: 7, auditorId: '', result: 'ok', from: '2026-02-30', to: 'tomorrow' })).toEqual({});
  });
});

describe('queueRangeIssue', () => {
  it('needs both dates, in order, at most 366 days apart counting both ends', () => {
    expect(queueRangeIssue()).toBeNull();
    expect(queueRangeIssue('2026-10-01')).toBe('incomplete');
    expect(queueRangeIssue(undefined, '2026-10-01')).toBe('incomplete');
    expect(queueRangeIssue('2026-10-31', '2026-10-01')).toBe('inverted');
    expect(queueRangeIssue('2026-10-01', '2026-10-01')).toBeNull();
    expect(queueRangeIssue('2025-11-01', '2026-11-01')).toBeNull();
    expect(queueRangeIssue('2025-10-31', '2026-11-01')).toBe('tooLong');
  });
});

describe('queueFilters', () => {
  it('asks only for what the open queue has: no auditor while waiting, a result only when finished', () => {
    const s = { siteId: IDS.zoneA, checklistId: IDS.checklist, auditorId: IDS.aynur, result: 'failed' as const, from: '2026-10-01', to: '2026-10-31' };
    expect(queueFilters(s)).toEqual({ queue: 'waiting', siteId: IDS.zoneA, checklistId: IDS.checklist, from: '2026-10-01', to: '2026-10-31' });
    expect(queueFilters({ ...s, queue: 'in_progress' })).toEqual({
      queue: 'in_progress',
      siteId: IDS.zoneA,
      checklistId: IDS.checklist,
      auditorId: IDS.aynur,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(queueFilters({ ...s, queue: 'finished' })).toEqual({
      queue: 'finished',
      siteId: IDS.zoneA,
      checklistId: IDS.checklist,
      auditorId: IDS.aynur,
      result: 'failed',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    // Half a range is never sent.
    expect(queueFilters({ queue: 'finished', from: '2026-10-01' })).toEqual({ queue: 'finished' });
  });
});

describe('audit items', () => {
  it('lists the auditable items in checklist order and steps through them without leaving the list', () => {
    const f = executionFixture();
    const ids = auditItems(f.content, f.answers, [f.note.id, f.problem.id, f.temp.id]).map((v) => v.item.id);
    expect(ids).toEqual([f.problem.id, f.temp.id, f.note.id]);
    expect(stepItem(ids, null, 1)).toBe(f.problem.id);
    expect(stepItem(ids, f.problem.id, 1)).toBe(f.temp.id);
    expect(stepItem(ids, f.note.id, 1)).toBe(f.note.id);
    expect(stepItem(ids, f.problem.id, -1)).toBe(f.problem.id);
    expect(stepItem(ids, 'gone', -1)).toBe(f.problem.id);
    expect(stepItem([], null, 1)).toBeNull();
  });

  it('maps and replaces verdicts by item', () => {
    const list = [verdict('i1', 'approved'), verdict('i2', 'rejected', 'Qırıq')];
    expect([...verdictMap(list)]).toEqual([
      ['i1', 'approved'],
      ['i2', 'rejected'],
    ]);
    expect(upsertVerdict(list, verdict('i1', 'rejected', 'Çirkli'))).toEqual([list[1], verdict('i1', 'rejected', 'Çirkli')]);
  });

  it('names people, and Taskop support for a platform admin', () => {
    expect(actorName(t, { kind: 'user', name: 'Rəşad Kazımov' })).toBe('Rəşad Kazımov');
    expect(actorName(t, { kind: 'platform', name: null })).toBe('Taskop dəstəyi');
    expect(actorName(t, null)).toBe('—');
  });
});
```

`apps/web/src/features/audits/queries.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { apiError, AUDIT_IDS, auditDto } from './fixtures';
import { startOrOpenAudit } from './queries';

const mocks = vi.hoisted(() => ({ api: { audits: { start: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

describe('startOrOpenAudit', () => {
  it('returns the new audit, or the one another auditor started first', async () => {
    mocks.api.audits.start.mockResolvedValueOnce(auditDto({ id: AUDIT_IDS.audit }));
    expect(await startOrOpenAudit(AUDIT_IDS.execution)).toBe(AUDIT_IDS.audit);
    expect(mocks.api.audits.start).toHaveBeenCalledWith(AUDIT_IDS.execution);
    mocks.api.audits.start.mockRejectedValueOnce(apiError(409, 'AUDIT_EXISTS', { auditId: AUDIT_IDS.audit2 }));
    expect(await startOrOpenAudit(AUDIT_IDS.execution)).toBe(AUDIT_IDS.audit2);
  });

  it('passes every other refusal on', async () => {
    mocks.api.audits.start.mockRejectedValueOnce(apiError(409, 'EXECUTION_LOCKED'));
    await expect(startOrOpenAudit(AUDIT_IDS.execution)).rejects.toMatchObject({ code: 'EXECUTION_LOCKED' });
  });
});
```

In `apps/web/src/features/scheduling/labels.test.ts`, add inside the test that checks `occurrenceVariant` (after `expect(occurrenceVariant('completed')).toBe('default');`):

```ts
    expect(occurrenceVariant('correction_required')).toBe('destructive');
    expect(occurrenceVariant('audit_pending')).toBe('default');
```

In `apps/web/src/features/executions/labels.test.ts`, after `expect(executionStateVariant('rejected')).toBe('outline');` add:

```ts
    expect(executionStateVariant('rework')).toBe('secondary');
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/audits features/scheduling/labels features/executions/labels`
Expected: FAIL: `Failed to resolve import "./labels"` and `"./queries"` in `features/audits`; `occurrenceVariant('correction_required')` is `'default'`; `executionStateVariant('rework')` is `'outline'`.

- [ ] **Step 4: Implement the helpers**

`apps/web/src/features/audits/labels.ts`:

```ts
import {
  AUDIT_LIMITS,
  AUDIT_QUEUES,
  AUDIT_RESULTS,
  type Answers,
  type AuditItemVerdict,
  type AuditQueue,
  type AuditQueueQuery,
  type AuditResult,
  type AuditVerdict,
  type ChecklistContent,
  dayNumber,
  idSchema,
  localDateSchema,
  type RunAuditState,
  type VisibleItem,
  visibleItems,
} from '@taskop/contracts';
import type { TFunction } from 'i18next';
import type { Variant } from '@/features/scheduling/labels';

export const DEFAULT_QUEUE: AuditQueue = 'waiting';
/** Part 1 "Errors to handle in the UI": while the report is built, GET /audits/:id every 3 s, for at most 60 s. */
export const REPORT_POLL_MS = 3_000;
export const REPORT_POLL_LIMIT_MS = 60_000;

export const resultVariant = (r: AuditResult): Variant => (r === 'passed' ? 'default' : 'destructive');

export const runAuditStateVariant = (s: RunAuditState): Variant =>
  s === 'passed' ? 'default' : s === 'failed' ? 'destructive' : s === 'in_progress' ? 'secondary' : 'outline';

export const verdictVariant = (v: AuditVerdict | null): Variant => (v === 'approved' ? 'default' : v === 'rejected' ? 'destructive' : 'outline');

/** `/audits`: the open queue and its filters (decision 2). Absent means Waiting, everything in scope. */
export interface AuditsSearch {
  queue?: AuditQueue;
  siteId?: string;
  checklistId?: string;
  auditorId?: string;
  result?: AuditResult;
  /** Run completion date range, both ends inclusive, tenant dates. */
  from?: string;
  to?: string;
}

const isId = (v: unknown): v is string => idSchema.safeParse(v).success;
const isDate = (v: unknown): v is string => localDateSchema.safeParse(v).success;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** `validateSearch` of `/audits`: anything invalid is dropped here, so it is never sent to the API. */
export function auditsSearch(s: Record<string, unknown>): AuditsSearch {
  return {
    ...(isOneOf(AUDIT_QUEUES, s.queue) ? { queue: s.queue } : {}),
    ...(isId(s.siteId) ? { siteId: s.siteId } : {}),
    ...(isId(s.checklistId) ? { checklistId: s.checklistId } : {}),
    ...(isId(s.auditorId) ? { auditorId: s.auditorId } : {}),
    ...(isOneOf(AUDIT_RESULTS, s.result) ? { result: s.result } : {}),
    ...(isDate(s.from) ? { from: s.from } : {}),
    ...(isDate(s.to) ? { to: s.to } : {}),
  };
}

export type QueueRangeIssue = 'incomplete' | 'inverted' | 'tooLong';
export const RANGE_ISSUE_KEYS: Record<QueueRangeIssue, string> = {
  incomplete: 'audits.web.page.range.incomplete',
  inverted: 'audits.web.page.range.inverted',
  tooLong: 'audits.issues.rangeTooLong',
};

/** The API's refine on the queue (Part 1): both dates or none, `to ≥ from`, at most 366 days counting both ends. */
export function queueRangeIssue(from?: string, to?: string): QueueRangeIssue | null {
  if (!from && !to) return null;
  if (!from || !to) return 'incomplete';
  const days = dayNumber(to) - dayNumber(from) + 1;
  if (days < 1) return 'inverted';
  if (days > AUDIT_LIMITS.queueMaxDays) return 'tooLong';
  return null;
}

export type AuditQueueFilters = Omit<AuditQueueQuery, 'cursor' | 'limit'>;

/** GET /audits for a search. A waiting run has no auditor yet, and only a finished audit has a result. */
export function queueFilters(s: AuditsSearch): AuditQueueFilters {
  const queue = s.queue ?? DEFAULT_QUEUE;
  return {
    queue,
    ...(s.siteId ? { siteId: s.siteId } : {}),
    ...(s.checklistId ? { checklistId: s.checklistId } : {}),
    ...(queue !== 'waiting' && s.auditorId ? { auditorId: s.auditorId } : {}),
    ...(queue === 'finished' && s.result ? { result: s.result } : {}),
    ...(s.from && s.to ? { from: s.from, to: s.to } : {}),
  };
}

/** The items under review, in checklist order: visible for the current answers and auditable (decision 5). */
export function auditItems(content: ChecklistContent, answers: Answers, auditableIds: readonly string[]): VisibleItem[] {
  const ids = new Set(auditableIds);
  return visibleItems(content, answers).filter((v) => ids.has(v.item.id));
}

export const verdictMap = (verdicts: readonly AuditItemVerdict[]): Map<string, AuditVerdict> => new Map(verdicts.map((v) => [v.itemId, v.verdict]));

/** The neighbour of `current` in `order`, staying at the ends; the first item when nothing (or a vanished item) is selected. */
export function stepItem(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const i = current === null ? -1 : order.indexOf(current);
  if (i === -1) return order[0]!;
  return order[Math.min(order.length - 1, Math.max(0, i + step))]!;
}

/** An auditor or a correction's actor: the person, or Taskop support for a platform admin. */
export const actorName = (t: TFunction, a: { kind: 'user' | 'platform'; name: string | null } | null): string =>
  a === null ? '—' : a.kind === 'platform' ? t('scheduling.schedule.actorPlatform') : (a.name ?? '—');

export const upsertVerdict = (list: readonly AuditItemVerdict[], v: AuditItemVerdict): AuditItemVerdict[] => [...list.filter((x) => x.itemId !== v.itemId), v];
```

- [ ] **Step 5: Implement the queries**

`apps/web/src/features/audits/queries.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import type { AuditDetail } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/session';
import { type AuditQueueFilters, REPORT_POLL_LIMIT_MS, REPORT_POLL_MS } from './labels';

export const auditKeys = {
  /** Every audit query: invalidated by refreshRunViews. */
  all: ['audits'] as const,
  queue: (f: AuditQueueFilters) => ['audits', 'queue', f] as const,
  detail: (id: string) => ['audits', 'detail', id] as const,
};

/** Pages of 50 in the API's order for the queue (Part 1 decision 13); "Daha çox göstər" passes nextCursor back. */
export const useAuditQueue = (filters: AuditQueueFilters, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: auditKeys.queue(filters),
    queryFn: ({ pageParam }) => api.audits.list({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

/** The auditor filter's options: active staff (Gap 1). Needs users.view. */
export const useAuditorOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ['users', 'auditor-options'],
    queryFn: async () => (await api.users.list({ kind: 'staff', status: 'active', limit: 200 })).items,
    enabled,
    staleTime: 5 * 60_000,
  });

const reportPending = (a: AuditDetail | undefined): boolean => a?.status === 'finished' && a.reportStatus === 'pending';

/**
 * GET /audits/:id. While a finished audit's report is being built it is asked again every 3 s, for at most 60 s; then
 * `timedOut` is true until `restartPolling()` opens a new window (decision 9).
 */
export function useAuditDetail(id: string) {
  const [round, setRound] = useState(0);
  const [expiredRound, setExpiredRound] = useState<number | null>(null);
  const allowPoll = expiredRound !== round;
  const query = useQuery({
    queryKey: auditKeys.detail(id),
    queryFn: () => api.audits.get(id),
    refetchInterval: (q) => (allowPoll && reportPending(q.state.data) ? REPORT_POLL_MS : false),
  });
  const pending = reportPending(query.data);
  useEffect(() => {
    if (!pending || !allowPoll) return;
    const timer = setTimeout(() => setExpiredRound(round), REPORT_POLL_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [pending, allowPoll, round]);
  return { query, timedOut: pending && !allowPoll, restartPolling: () => setRound((r) => r + 1) };
}

/** POST /executions/:id/audits; when another auditor was first (AUDIT_EXISTS) their audit is opened (decision 4). */
export async function startOrOpenAudit(executionId: string): Promise<string> {
  try {
    return (await api.audits.start(executionId)).id;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'AUDIT_EXISTS' && e.auditId) return e.auditId;
    throw e;
  }
}
```

In `apps/web/src/features/executions/queries.ts`, change the first import line to bring in `QueryClient`:

```ts
import { type QueryClient, type QueryKey, useInfiniteQuery, useQuery } from '@tanstack/react-query';
```

and append:

```ts
/**
 * After a correction, a send-back, a withdrawal or an audit change (SP8): every view that shows a run's state, answers,
 * audit, problems or report numbers asks again.
 */
export async function refreshRunViews(qc: QueryClient): Promise<void> {
  await Promise.all(['occurrences', 'executions', 'corrections', 'audits', 'problems', 'reports'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
```

- [ ] **Step 6: Give the new states their badges**

In `apps/web/src/features/scheduling/labels.ts`, replace the first line of `occurrenceVariant`'s body:

```ts
  s === 'overdue' || s === 'missed' || s === 'partial'
```

with:

```ts
  s === 'overdue' || s === 'missed' || s === 'partial' || s === 'correction_required'
```

In `apps/web/src/features/executions/labels.ts`, replace `executionStateVariant` with:

```ts
export const executionStateVariant = (s: ExecutionState): Variant =>
  s === 'completed' ? 'default' : s === 'active' || s === 'rework' ? 'secondary' : s === 'partial' ? 'destructive' : 'outline';
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/audits features/scheduling/labels features/executions/labels && pnpm --filter @taskop/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/audits/labels.ts apps/web/src/features/audits/labels.test.ts apps/web/src/features/audits/queries.ts apps/web/src/features/audits/queries.test.ts apps/web/src/features/audits/fixtures.ts apps/web/src/features/executions/queries.ts apps/web/src/features/executions/labels.ts apps/web/src/features/executions/labels.test.ts apps/web/src/features/scheduling/labels.ts apps/web/src/features/scheduling/labels.test.ts
git commit -m "feat(web): add the audit helpers, queries and fixtures, and badges for the new run states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The e-mail list input

**Files:**
- Create: `apps/web/src/components/email-list-input.tsx`
- Test: `apps/web/src/components/email-list-input.test.tsx`

**Interfaces:**
- Consumes: Task 1's `audits.web.emails.*`; `z.email()` (`zod`, already a web dependency).
- Produces (used by Tasks 5 and 11):
  - `splitEmails(raw: string): string[]`;
  - `type EmailListIssue = 'invalid' | 'duplicate' | 'tooMany'`;
  - `addEmails(current: readonly string[], raw: string, max: number): { ok: true; next: string[] } | { ok: false; issue: EmailListIssue }`;
  - `EmailListInput({ id, label, hint?, value: readonly string[], onChange: (next: string[]) => void, max: number, disabled? })`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/email-list-input.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { addEmails, EmailListInput, splitEmails } from './email-list-input';

function Harness({ initial = [], max = 3, disabled = false, onList = () => undefined }: { initial?: string[]; max?: number; disabled?: boolean; onList?: (l: string[]) => void }) {
  const [list, setList] = useState<string[]>(initial);
  return (
    <EmailListInput
      id="emails"
      label="Ünvanlar"
      hint="Ən çox 3"
      value={list}
      max={max}
      disabled={disabled}
      onChange={(next) => {
        setList(next);
        onList(next);
      }}
    />
  );
}

describe('addEmails', () => {
  it('splits on commas, semicolons, spaces and new lines and lower-cases', () => {
    expect(splitEmails(' A@acme.az, b@ACME.az;c@acme.az\nd@acme.az  ')).toEqual(['a@acme.az', 'b@acme.az', 'c@acme.az', 'd@acme.az']);
    expect(addEmails(['a@acme.az'], 'B@acme.az', 3)).toEqual({ ok: true, next: ['a@acme.az', 'b@acme.az'] });
  });

  it('adds all or nothing', () => {
    expect(addEmails([], 'a@acme.az, yanlış', 3)).toEqual({ ok: false, issue: 'invalid' });
    expect(addEmails(['a@acme.az'], 'b@acme.az A@acme.az', 3)).toEqual({ ok: false, issue: 'duplicate' });
    expect(addEmails(['a@acme.az', 'b@acme.az'], 'c@acme.az d@acme.az', 3)).toEqual({ ok: false, issue: 'tooMany' });
  });
});

describe('EmailListInput', () => {
  it('adds an address on Enter and on a comma, lower-cased, and removes one', async () => {
    const onList = vi.fn();
    render(<Harness onList={onList} />);
    const input = screen.getByLabelText('Ünvanlar');
    await userEvent.type(input, 'Rehber@Acme.az{Enter}');
    expect(screen.getByText('rehber@acme.az')).toBeInTheDocument();
    expect(input).toHaveValue('');
    await userEvent.type(input, 'audit@acme.az,');
    expect(screen.getByText('audit@acme.az')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sil: rehber@acme.az' }));
    expect(screen.queryByText('rehber@acme.az')).not.toBeInTheDocument();
    expect(onList).toHaveBeenLastCalledWith(['audit@acme.az']);
  });

  it('adds a pasted list, lower-cased', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Ünvanlar'));
    await userEvent.paste('a@acme.az; B@acme.az\nc@acme.az');
    await userEvent.keyboard('{Enter}');
    for (const e of ['a@acme.az', 'b@acme.az', 'c@acme.az']) expect(screen.getByText(e)).toBeInTheDocument();
  });

  it('refuses an invalid address, a duplicate and one over the limit, and keeps the text to fix', async () => {
    render(<Harness initial={['a@acme.az']} max={2} />);
    const input = screen.getByLabelText('Ünvanlar');
    await userEvent.type(input, 'yanlış{Enter}');
    expect(screen.getByText('E-poçt ünvanı düzgün deyil.')).toBeInTheDocument();
    expect(input).toHaveValue('yanlış');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    expect(screen.queryByText('E-poçt ünvanı düzgün deyil.')).not.toBeInTheDocument();
    await userEvent.type(input, 'A@acme.az{Enter}');
    expect(screen.getByText('Bu ünvan artıq siyahıdadır.')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, 'b@acme.az{Enter}c@acme.az{Enter}');
    expect(screen.getByText('Ən çox 2 ünvan əlavə etmək olar.')).toBeInTheDocument();
    expect(screen.queryByText('c@acme.az', { selector: 'li' })).not.toBeInTheDocument();
  });

  it('adds what is typed when the field loses focus', async () => {
    const onList = vi.fn();
    render(<Harness onList={onList} />);
    await userEvent.type(screen.getByLabelText('Ünvanlar'), 'x@acme.az');
    await userEvent.tab();
    expect(onList).toHaveBeenLastCalledWith(['x@acme.az']);
  });

  it('only lists the addresses when disabled', () => {
    render(<Harness initial={['a@acme.az']} disabled />);
    expect(screen.getByText('a@acme.az')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- components/email-list-input`
Expected: FAIL: `Failed to resolve import "./email-list-input"`.

- [ ] **Step 3: Implement**

`apps/web/src/components/email-list-input.tsx`:

```tsx
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const emailSchema = z.email();

/** Typed or pasted text as addresses: commas, semicolons, spaces and new lines separate them; lower-cased like the API. */
export const splitEmails = (raw: string): string[] =>
  raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export type EmailListIssue = 'invalid' | 'duplicate' | 'tooMany';

/** The list after adding `raw`, or why nothing was added: all or nothing, so half a paste never slips in. */
export function addEmails(current: readonly string[], raw: string, max: number): { ok: true; next: string[] } | { ok: false; issue: EmailListIssue } {
  const next = [...current];
  for (const e of splitEmails(raw)) {
    if (!emailSchema.safeParse(e).success) return { ok: false, issue: 'invalid' };
    if (next.includes(e)) return { ok: false, issue: 'duplicate' };
    if (next.length >= max) return { ok: false, issue: 'tooMany' };
    next.push(e);
  }
  return { ok: true, next };
}

/**
 * A tag input for e-mail addresses (spec §8.3: the checklist's report list, the auditor's extra addresses). Enter, a
 * comma, the button or leaving the field adds what is typed; a refused entry stays in the field with the reason.
 */
export function EmailListInput(props: {
  id: string;
  label: string;
  hint?: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  max: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [issue, setIssue] = useState<EmailListIssue | null>(null);
  const hintId = `${props.id}-hint`;
  const errorId = `${props.id}-error`;

  const commit = () => {
    if (!text.trim()) return;
    const r = addEmails(props.value, text, props.max);
    if (!r.ok) {
      setIssue(r.issue);
      return;
    }
    setIssue(null);
    setText('');
    props.onChange(r.next);
  };

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {props.value.map((e) => (
            <li key={e} className="bg-secondary flex items-center gap-1 rounded-md px-2 py-0.5 text-sm">
              {e}
              {!props.disabled && (
                <button
                  type="button"
                  aria-label={t('audits.web.emails.remove', { email: e })}
                  className="hover:text-destructive"
                  onClick={() => props.onChange(props.value.filter((x) => x !== e))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.disabled ? (
        props.value.length === 0 && <p className="text-muted-foreground text-sm">{t('audits.web.emails.none')}</p>
      ) : (
        <div className="flex gap-2">
          {/* type="text": an email input would trim and reject a pasted list before it is split. */}
          <Input
            id={props.id}
            type="text"
            inputMode="email"
            autoComplete="off"
            value={text}
            placeholder={t('audits.web.emails.placeholder')}
            aria-invalid={issue !== null}
            aria-describedby={[props.hint ? hintId : null, issue ? errorId : null].filter(Boolean).join(' ') || undefined}
            onChange={(e) => {
              setText(e.target.value);
              setIssue(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={commit}
          />
          <Button type="button" variant="outline" onClick={commit}>
            {t('audits.web.emails.add')}
          </Button>
        </div>
      )}
      {props.hint && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {props.hint}
        </p>
      )}
      {issue && (
        <p id={errorId} className="text-destructive text-sm">
          {t(`audits.web.emails.${issue}`, { max: props.max })}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and check it passes**

Run: `pnpm --filter @taskop/web test -- components/email-list-input`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/email-list-input.tsx apps/web/src/components/email-list-input.test.tsx
git commit -m "feat(web): add an e-mail list input for report addresses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The audit screen: items by section, the item panel, verdicts, keyboard, paused and read-only

**Files:**
- Create: `apps/web/src/features/audits/audit-screen.tsx`, `apps/web/src/features/audits/item-list.tsx`, `apps/web/src/features/audits/item-panel.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/features/audits/audit-screen.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.audits.{get, setVerdict, clearVerdict}`, `missingVerdicts`, `AUDIT_LIMITS`, types `AuditDetail`, `AuditItemVerdict`, `AuditVerdict`, `Correction`; the `audits.issues.notAuditable` field key; `az.audits.{progress, paused, statuses, results, verdicts, score, actions.{approve, reject, clearVerdict}, fields.comment, issues.commentRequired}`, `az.corrections.{original, current}`.
  - Task 2: `auditItems`, `verdictMap`, `stepItem`, `upsertVerdict`, `actorName`, `resultVariant`, `verdictVariant`, `auditKeys`, `useAuditDetail`, the fixtures.
  - Existing: `answerValue`, `severityVariant`, `formatPercent` (`features/executions/labels`); `MediaStrip`, `MediaLightbox` (`features/executions/media`); `formatLocalDate` (`features/scheduling/labels`); `PageHeader`, `errorText`, `useFormatDateTime`.
- Produces:
  - `AuditRoute()` (the `/audits/$auditId` component) and `AuditScreen({ id }: { id: string })`.
  - Inside `audit-screen.tsx`, `AuditView({ audit }: { audit: AuditDetail })`, which Task 5 extends. It holds:
    - `selected` (item id), `highlight: ReadonlySet<string>`, `drafts` (comment per item), `needComment`;
    - the verdict mutations;
    - the document keyboard listener.
  - `ItemList({ content, items, verdicts, selected, highlight, onSelect })`: a `navigation` named "Bəndlər". Each item is a button named by its label, with `aria-current="true"` when selected, `data-verdict` (`approved` | `rejected` | `none`) and `data-missing`.
  - `ItemPanel({ audit, item, verdict, comment, onComment, commentRef, needComment, editable, onDecide, onClear })`: a `region` named by the item's label.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/audits/audit-screen.test.tsx`:

```tsx
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meWith } from '@/features/reports/fixtures';
import i18n from '@/lib/i18n';
import { renderWithRouter } from '@/test/router';
import { AuditScreen } from './audit-screen';
import { Toaster } from '@/components/ui/sonner';
import { apiError, AUDIT_IDS, auditFixture, verdict } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { audits: { get: vi.fn(), setVerdict: vi.fn(), clearVerdict: vi.fn() }, media: { url: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const AUDITOR_PERMS = ['audits.perform', 'assignments.view'];
const LABELS = ['Problem varmı?', 'Təsvir edin', 'Temperatur', 'Ümumi görünüş', 'Video', 'Qeyd'];

const renderScreen = () => renderWithRouter(<AuditScreen id={AUDIT_IDS.audit} />, `/audits/${AUDIT_IDS.audit}`);
const items = () => screen.getByRole('navigation', { name: 'Bəndlər' });
const itemButton = (label: string) => within(items()).getByRole('button', { name: label });
const progressText = (reviewed: number, total = 6) => i18n.t('audits.progress', { reviewed, total });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(AUDITOR_PERMS);
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
  mocks.api.audits.setVerdict.mockImplementation(async (_id: string, itemId: string, body: { verdict: 'approved' | 'rejected'; comment?: string | null }) =>
    verdict(itemId, body.verdict, body.comment ?? null),
  );
});

describe('AuditScreen', () => {
  it('lists the auditable items by section with their verdicts and progress, and opens the first one', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.problem.id, 'approved'), verdict(f.temp.id, 'rejected', 'Termometr yoxlanmayıb')] }));
    renderScreen();
    expect(await screen.findByRole('heading', { level: 1, name: 'Açılış' })).toBeInTheDocument();
    expect(within(items()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(LABELS);
    expect(within(items()).getByRole('region', { name: 'Zal' })).toBeInTheDocument();
    expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'approved');
    expect(itemButton('Temperatur')).toHaveTextContent(az.audits.verdicts.rejected);
    expect(itemButton('Qeyd')).toHaveTextContent(az.audits.verdicts.unreviewed);
    expect(itemButton('Təsvir edin')).toHaveStyle({ paddingLeft: '24px' });
    expect(screen.getByText(progressText(2))).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByText(az.audits.paused)).not.toBeInTheDocument();
    // The first item is open with its answer and its problem.
    expect(itemButton('Problem varmı?')).toHaveAttribute('aria-current', 'true');
    const panel = screen.getByRole('region', { name: 'Problem varmı?' });
    expect(panel).toHaveTextContent('Bəli');
    expect(within(panel).getByText('Kritik')).toBeInTheDocument();
    expect(within(panel).getByText('Qayda üzrə')).toBeInTheDocument();
    expect(screen.getByText('Klaviatura: ↑/↓ — bənd seçimi, A — təsdiqlə, R — rədd et')).toBeInTheDocument();
  });

  it('shows the selected item with its note, problems, evidence and earlier verdict comment', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.temp.id, 'rejected', 'Termometr yoxlanmayıb')] }));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Temperatur' }));
    const temp = screen.getByRole('region', { name: 'Temperatur' });
    for (const text of ['10 °C', 'Qeyd: isti', 'Kondisioner xarabdır', 'Əl ilə qeyd', 'Adi']) expect(temp).toHaveTextContent(text);
    expect(within(temp).getByLabelText(az.audits.fields.comment)).toHaveValue('Termometr yoxlanmayıb');
    await userEvent.click(itemButton('Ümumi görünüş'));
    const photo = screen.getByRole('region', { name: 'Ümumi görünüş' });
    expect(within(photo).getAllByRole('button', { name: 'Bax: Foto' })).toHaveLength(1);
    expect(within(photo).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
  });

  it('approves with the button and moves on to the next item', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.approve }));
    expect(mocks.api.audits.setVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id, { verdict: 'approved', comment: null });
    expect(itemButton('Təsvir edin')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'approved'));
    expect(screen.getByText(progressText(1))).toBeInTheDocument();
  });

  it('asks for a comment before R rejects, then rejects with it', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.keyboard('r');
    expect(mocks.api.audits.setVerdict).not.toHaveBeenCalled();
    expect(screen.getByText(az.audits.issues.commentRequired)).toBeInTheDocument();
    const comment = screen.getByLabelText(az.audits.fields.comment);
    expect(comment).toHaveFocus();
    await userEvent.type(comment, 'Su axır, təmir lazımdır');
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.reject }));
    expect(mocks.api.audits.setVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id, { verdict: 'rejected', comment: 'Su axır, təmir lazımdır' });
    await waitFor(() => expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'rejected'));
  });

  it('moves with the arrow keys and approves with A', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(itemButton('Temperatur')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{ArrowUp}');
    expect(itemButton('Təsvir edin')).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('aa');
    expect(mocks.api.audits.setVerdict.mock.calls.map(([, itemId]) => itemId)).toEqual([f.comment.id, f.temp.id]);
    expect(itemButton('Ümumi görünüş')).toHaveAttribute('aria-current', 'true');
  });

  it('ignores A and R while typing a comment', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    const comment = screen.getByLabelText(az.audits.fields.comment);
    await userEvent.type(comment, 'Ağac rəngi');
    expect(comment).toHaveValue('Ağac rəngi');
    expect(mocks.api.audits.setVerdict).not.toHaveBeenCalled();
    expect(itemButton('Problem varmı?')).toHaveAttribute('aria-current', 'true');
  });

  it('clears a verdict', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.problem.id, 'approved')] }));
    mocks.api.audits.clearVerdict.mockResolvedValue(undefined);
    renderScreen();
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.clearVerdict }));
    expect(mocks.api.audits.clearVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id);
    await waitFor(() => expect(itemButton('Problem varmı?')).toHaveAttribute('data-verdict', 'none'));
  });

  it('shows a corrected answer and, on request, the original one with who corrected it', async () => {
    const f = auditFixture();
    const corrected = { ...f.answers, [f.temp.id]: { number: 5, note: 'isti', problem: f.answers[f.temp.id]!.problem } };
    mocks.api.audits.get.mockResolvedValue(
      f.detail({
        execution: { ...f.detail().execution, answers: corrected, corrected: true },
        corrections: {
          original: { answers: f.answers, score: null, capturedAt: '2026-11-02T08:00:00.000Z' },
          corrections: [
            {
              id: 'c1',
              itemId: f.temp.id,
              kind: 'manual',
              round: 0,
              before: { number: 10, note: 'isti' },
              after: { number: 5, note: 'isti' },
              reason: 'Termometr səhv oxunub',
              actor: { kind: 'user', name: 'Leyla Quliyeva' },
              at: '2026-11-02T08:00:00.000Z',
            },
          ],
          reworkRequests: [],
          diff: [{ itemId: f.temp.id, original: { number: 10, note: 'isti' }, current: { number: 5, note: 'isti' } }],
        },
      }),
    );
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Temperatur' }));
    const panel = screen.getByRole('region', { name: 'Temperatur' });
    expect(panel).toHaveTextContent('5 °C');
    expect(panel).toHaveTextContent('Leyla Quliyeva düzəldib · Termometr səhv oxunub');
    const toggle = within(panel).getByRole('button', { name: az.corrections.original });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(panel).toHaveTextContent('10 °C');
    expect(panel).not.toHaveTextContent('5 °C');
    // Items that were not corrected have no toggle.
    await userEvent.click(itemButton('Qeyd'));
    expect(within(screen.getByRole('region', { name: 'Qeyd' })).queryByRole('button', { name: az.corrections.original })).not.toBeInTheDocument();
  });

  it('says the audit is paused while the run is with the worker, and still takes verdicts', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail({ paused: true }));
    renderScreen();
    expect(await screen.findByText(az.audits.paused)).toBeInTheDocument();
    await userEvent.keyboard('a');
    expect(mocks.api.audits.setVerdict).toHaveBeenCalledWith(AUDIT_IDS.audit, f.problem.id, { verdict: 'approved', comment: null });
  });

  it('is read-only for a report viewer: no verdict buttons, no comment box, and A does nothing', async () => {
    const f = auditFixture();
    mocks.me.current = meWith(['reports.view']);
    mocks.api.audits.get.mockResolvedValue(f.detail({ verdicts: [verdict(f.problem.id, 'rejected', 'Su axır')] }));
    renderScreen();
    const panel = await screen.findByRole('region', { name: 'Problem varmı?' });
    expect(screen.getByText('Bu audit yalnız baxış üçündür.')).toBeInTheDocument();
    expect(within(panel).getByText('Su axır')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.approve })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(az.audits.fields.comment)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'İcraya bax' })).not.toBeInTheDocument();
    await userEvent.keyboard('a{ArrowDown}');
    expect(mocks.api.audits.setVerdict).not.toHaveBeenCalled();
    expect(itemButton('Təsvir edin')).toHaveAttribute('aria-current', 'true');
  });

  it('says why a verdict on an item a correction just hid was refused, and reloads the audit', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    mocks.api.audits.setVerdict.mockRejectedValue(apiError(400, 'VALIDATION_FAILED', { fields: { itemId: 'audits.issues.notAuditable' } }));
    renderWithRouter(
      <>
        <AuditScreen id={AUDIT_IDS.audit} />
        <Toaster />
      </>,
      `/audits/${AUDIT_IDS.audit}`,
    );
    await screen.findByRole('region', { name: 'Problem varmı?' });
    await userEvent.keyboard('a');
    expect(await screen.findByText(az.audits.issues.notAuditable)).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.audits.get).toHaveBeenCalledTimes(2));
  });

  it('links to the run for schedule viewers', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(f.detail());
    renderScreen();
    expect(await screen.findByRole('link', { name: 'İcraya bax' })).toHaveAttribute('href', '/schedule?date=2026-11-02&occurrence=o1&tab=execution');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/audits/audit-screen`
Expected: FAIL: `Failed to resolve import "./audit-screen"`.

- [ ] **Step 3: Implement the item list**

`apps/web/src/features/audits/item-list.tsx`:

```tsx
import type { AuditVerdict, ChecklistContent, VisibleItem } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { verdictVariant } from './labels';

/** The left column (spec §8.3): the items under review by section, follow-ups indented, each with its verdict chip. */
export function ItemList(props: {
  content: ChecklistContent;
  items: readonly VisibleItem[];
  verdicts: ReadonlyMap<string, AuditVerdict>;
  selected: string | null;
  highlight: ReadonlySet<string>;
  onSelect: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('audits.web.screen.items')} className="grid content-start gap-3">
      {props.content.sections.map((s) => {
        const rows = props.items.filter((v) => v.sectionId === s.id);
        if (rows.length === 0) return null;
        return (
          <section key={s.id} aria-label={s.title} className="grid gap-1">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">{s.title}</h3>
            <ol className="grid gap-1">
              {rows.map((v) => {
                const verdict = props.verdicts.get(v.item.id) ?? null;
                const current = props.selected === v.item.id;
                const missing = props.highlight.has(v.item.id);
                return (
                  <li key={v.item.id}>
                    <button
                      type="button"
                      aria-label={v.item.label}
                      aria-describedby={`verdict-${v.item.id}`}
                      aria-current={current ? 'true' : undefined}
                      data-verdict={verdict ?? 'none'}
                      data-missing={missing ? 'true' : undefined}
                      onClick={() => props.onSelect(v.item.id)}
                      style={{ paddingLeft: 8 + v.depth * 16 }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-md border py-1.5 pr-2 text-left text-sm',
                        current && 'border-primary bg-accent',
                        missing && 'border-destructive',
                      )}
                    >
                      <span className="truncate">{v.item.label}</span>
                      {/* The chip describes the button, so a screen reader hears the item and then its verdict. */}
                      <Badge id={`verdict-${v.item.id}`} variant={verdictVariant(verdict)}>
                        {verdict ? t(`audits.verdicts.${verdict}`) : t('audits.verdicts.unreviewed')}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Implement the item panel**

`apps/web/src/features/audits/item-panel.tsx`:

```tsx
import { AUDIT_LIMITS, type AuditDetail, type AuditItemVerdict, type AuditVerdict, type ExecutionMediaDto, type Item } from '@taskop/contracts';
import { type RefObject, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { answerValue, severityVariant } from '@/features/executions/labels';
import { MediaLightbox, MediaStrip } from '@/features/executions/media';
import { useFormatDateTime } from '@/lib/format';
import { actorName } from './labels';

/**
 * The right panel (spec §8.3): the question, the answer (with an "İlkin" toggle when the item was corrected), its
 * photos and videos in the existing viewer, its active problems, and the verdict with its comment.
 */
export function ItemPanel(props: {
  audit: AuditDetail;
  item: Item;
  verdict: AuditItemVerdict | null;
  comment: string;
  onComment: (text: string) => void;
  commentRef: RefObject<HTMLTextAreaElement | null>;
  needComment: boolean;
  editable: boolean;
  onDecide: (verdict: AuditVerdict) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const [showOriginal, setShowOriginal] = useState(false);
  const [open, setOpen] = useState<ExecutionMediaDto | null>(null);
  const e = props.audit.execution;
  const media = useMemo(() => new Map(e.media.map((m) => [m.id, m])), [e.media]);
  const { item } = props;
  const diff = props.audit.corrections.diff.find((d) => d.itemId === item.id) ?? null;
  const lastCorrection = props.audit.corrections.corrections.findLast((c) => c.itemId === item.id) ?? null;
  const answer = diff && showOriginal ? (diff.original ?? undefined) : e.answers[item.id];
  const value = answerValue(t, item, answer, formatDateTime);
  const evidence = [...(answer?.photos ?? []), ...(answer?.videos ?? [])];
  const note = answer?.note?.trim();
  const problems = e.problems.filter((p) => p.itemId === item.id && p.clearedAt === null);
  const titleId = `audit-item-${item.id}`;

  return (
    <section aria-labelledby={titleId} className="grid content-start gap-4 rounded-lg border p-4">
      <header className="grid gap-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {item.label}
        </h2>
        {item.helpText && <p className="text-muted-foreground text-sm">{item.helpText}</p>}
      </header>

      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{diff ? t(showOriginal ? 'corrections.original' : 'corrections.current') : t('audits.web.screen.answer')}</h3>
          {diff && (
            <Button size="sm" variant="outline" aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
              {t('corrections.original')}
            </Button>
          )}
        </div>
        {value !== null ? <p>{value}</p> : evidence.length === 0 && <p className="text-muted-foreground">{t('executions.notAnswered')}</p>}
        {note && <p className="text-muted-foreground text-sm">{t('executions.note', { note })}</p>}
        {lastCorrection && (
          <p className="text-muted-foreground text-xs">{t('audits.web.screen.correctedBy', { name: actorName(t, lastCorrection.actor), reason: lastCorrection.reason })}</p>
        )}
      </div>

      {evidence.length > 0 && (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('audits.web.screen.media')}</h3>
          <MediaStrip ids={evidence} media={media} onOpen={setOpen} />
        </div>
      )}

      {problems.length > 0 && (
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('audits.web.screen.problems')}</h3>
          {problems.map((p) => (
            <div key={p.id} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                <span className="text-muted-foreground text-xs">{t(`executions.problemSources.${p.source}`)}</span>
              </div>
              {p.note && <p className="text-sm whitespace-pre-line">{p.note}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 border-t pt-3">
        {props.verdict && (
          <p className="text-sm">
            {props.verdict.updatedBy
              ? t('audits.web.screen.verdictBy', { verdict: t(`audits.verdicts.${props.verdict.verdict}`), name: props.verdict.updatedBy.fullName })
              : t(`audits.verdicts.${props.verdict.verdict}`)}
          </p>
        )}
        {props.editable ? (
          <>
            <Label htmlFor="verdict-comment">{t('audits.fields.comment')}</Label>
            <Textarea
              id="verdict-comment"
              ref={props.commentRef}
              value={props.comment}
              maxLength={AUDIT_LIMITS.verdictComment}
              aria-invalid={props.needComment}
              onChange={(ev) => props.onComment(ev.target.value)}
            />
            {props.needComment && <p className="text-destructive text-sm">{t('audits.issues.commentRequired')}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => props.onDecide('approved')}>{t('audits.actions.approve')}</Button>
              <Button variant="destructive" onClick={() => props.onDecide('rejected')}>
                {t('audits.actions.reject')}
              </Button>
              {props.verdict && (
                <Button variant="ghost" onClick={props.onClear}>
                  {t('audits.actions.clearVerdict')}
                </Button>
              )}
            </div>
          </>
        ) : (
          props.verdict?.comment && <p className="text-sm whitespace-pre-line">{props.verdict.comment}</p>
        )}
      </div>
      {open && <MediaLightbox media={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
```

- [ ] **Step 5: Implement the screen**

`apps/web/src/features/audits/audit-screen.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { type AuditDetail, type AuditVerdict, missingVerdicts } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { formatPercent } from '@/features/executions/labels';
import { formatLocalDate } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { api, useCan, useMe } from '@/lib/session';
import { ItemList } from './item-list';
import { ItemPanel } from './item-panel';
import { auditItems, resultVariant, stepItem, upsertVerdict, verdictMap } from './labels';
import { auditKeys, useAuditDetail } from './queries';

/** `/audits/$auditId`. A new id remounts the screen, so selection and drafts never leak between audits. */
export function AuditRoute() {
  const { auditId } = useParams({ strict: false }) as { auditId?: string };
  return <AuditScreen key={auditId} id={auditId!} />;
}

export function AuditScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const { query } = useAuditDetail(id);
  if (query.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (query.isError) return <p className="text-destructive">{errorText(t, query.error)}</p>;
  return <AuditView audit={query.data} />;
}

/** Keys typed into a field or a dialog are text, not shortcuts (Global Constraints). */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null;

function AuditView({ audit }: { audit: AuditDetail }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const qc = useQueryClient();
  const canPerform = useCan('audits.perform');
  const canOpenRun = useCan('assignments.view');
  const e = audit.execution;
  const items = useMemo(() => auditItems(e.content, e.answers, audit.auditableItemIds), [e.content, e.answers, audit.auditableItemIds]);
  const order = useMemo(() => items.map((v) => v.item.id), [items]);
  const verdicts = useMemo(() => verdictMap(audit.verdicts), [audit.verdicts]);
  const [selected, setSelected] = useState<string | null>(order[0] ?? null);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [needComment, setNeedComment] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const editable = canPerform && audit.status === 'in_progress';
  const missing = missingVerdicts(verdicts, audit.auditableItemIds);
  const total = audit.auditableItemIds.length;
  const reviewed = total - missing.length;
  const current = items.find((v) => v.item.id === selected) ?? items[0] ?? null;
  const commentOf = (itemId: string) => drafts[itemId] ?? audit.verdicts.find((v) => v.itemId === itemId)?.comment ?? '';

  const store = (update: (a: AuditDetail) => AuditDetail) => qc.setQueryData<AuditDetail>(auditKeys.detail(audit.id), (a) => (a ? update(a) : a));
  /** Decision 6: a correction may have hidden the item meanwhile (`fields.itemId = 'audits.issues.notAuditable'`). */
  const onVerdictError = (err: unknown) => {
    toast.error(err instanceof ApiError && err.fields?.itemId ? t(err.fields.itemId) : errorText(t, err));
    void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
  };
  const save = useMutation({
    mutationFn: (v: { itemId: string; verdict: AuditVerdict; comment: string | null }) => api.audits.setVerdict(audit.id, v.itemId, { verdict: v.verdict, comment: v.comment }),
    onSuccess: (v) => {
      store((a) => ({ ...a, verdicts: upsertVerdict(a.verdicts, v) }));
      setHighlight((h) => {
        if (!h.has(v.itemId)) return h;
        const next = new Set(h);
        next.delete(v.itemId);
        return next;
      });
    },
    onError: onVerdictError,
  });
  const clear = useMutation({
    mutationFn: (itemId: string) => api.audits.clearVerdict(audit.id, itemId),
    onSuccess: (_void, itemId) => store((a) => ({ ...a, verdicts: a.verdicts.filter((v) => v.itemId !== itemId) })),
    onError: onVerdictError,
  });

  /** Decision 6: a rejection needs a comment; a sent verdict moves on to the next item at once. */
  const decide = (verdict: AuditVerdict) => {
    if (!current || !editable) return;
    const itemId = current.item.id;
    const comment = commentOf(itemId).trim();
    if (verdict === 'rejected' && !comment) {
      setNeedComment(itemId);
      commentRef.current?.focus();
      return;
    }
    setNeedComment(null);
    save.mutate({ itemId, verdict, comment: comment || null });
    setSelected(stepItem(order, itemId, 1));
  };

  const onKey = useEffectEvent((ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setSelected((s) => stepItem(order, s, ev.key === 'ArrowDown' ? 1 : -1));
    } else if (ev.key === 'a' || ev.key === 'A') {
      decide('approved');
    } else if (ev.key === 'r' || ev.key === 'R') {
      decide('rejected');
    }
  });
  useEffect(() => {
    const listener = (ev: KeyboardEvent) => onKey(ev);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const o = e.occurrence;
  return (
    <div className="grid gap-4">
      <PageHeader
        title={o.checklistName}
        actions={
          canOpenRun && (
            <Link to="/schedule" search={{ date: o.localDate, occurrence: o.id, tab: 'execution' }} className={buttonVariants({ variant: 'outline' })}>
              {t('audits.web.screen.openRun')}
            </Link>
          )
        }
      />
      <div className="text-muted-foreground -mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span>{[o.siteName, formatLocalDate(o.localDate, tenant.locale), t('audits.web.screen.executor', { name: e.executor.fullName })].join(' · ')}</span>
        <Badge variant="secondary">{t(`audits.statuses.${audit.status}`)}</Badge>
        {audit.result && <Badge variant={resultVariant(audit.result)}>{t(`audits.results.${audit.result}`)}</Badge>}
        {audit.score?.percent != null && (
          <span>
            {t('audits.score')}: {t('executions.percent', { value: formatPercent(audit.score.percent, tenant.locale) })}
          </span>
        )}
      </div>
      {audit.paused && (
        <Alert>
          <AlertDescription>{t('audits.paused')}</AlertDescription>
        </Alert>
      )}
      {!canPerform && <p className="text-muted-foreground text-sm">{t('audits.web.screen.readOnly')}</p>}
      <div className="grid gap-1">
        <p id="audit-progress" className="text-sm">
          {t('audits.progress', { reviewed, total })}
        </p>
        <div role="progressbar" aria-labelledby="audit-progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed} className="bg-muted h-2 rounded-full">
          <div className="bg-primary h-2 rounded-full" style={{ width: `${total ? (reviewed / total) * 100 : 0}%` }} />
        </div>
      </div>
      {editable && <p className="text-muted-foreground text-xs">{t('audits.web.screen.keyboard')}</p>}
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t('audits.web.screen.noItems')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
          <ItemList content={e.content} items={items} verdicts={verdicts} selected={current?.item.id ?? null} highlight={highlight} onSelect={setSelected} />
          {current && (
            <ItemPanel
              key={current.item.id}
              audit={audit}
              item={current.item}
              verdict={audit.verdicts.find((v) => v.itemId === current.item.id) ?? null}
              comment={commentOf(current.item.id)}
              onComment={(text) => setDrafts((d) => ({ ...d, [current.item.id]: text }))}
              commentRef={commentRef}
              needComment={needComment === current.item.id}
              editable={editable}
              onDecide={decide}
              onClear={() => clear.mutate(current.item.id)}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Register the route**

In `apps/web/src/router.tsx`, add after the `ProblemsPage` import:

```ts
import { AuditRoute } from '@/features/audits/audit-screen';
```

after the `tasksRoute` definition:

```ts
const auditScreenRoute = createRoute({ getParentRoute: () => appLayout, path: '/audits/$auditId', component: AuditRoute });
```

and in `appLayout.addChildren([...])`, after `tasksRoute,`:

```ts
    auditScreenRoute,
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/audits/audit-screen && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. `react-hooks` accepts the `useEffectEvent` handler with an empty dependency list.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/audits/audit-screen.tsx apps/web/src/features/audits/item-list.tsx apps/web/src/features/audits/item-panel.tsx apps/web/src/features/audits/audit-screen.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): add the audit screen with per-item verdicts and keyboard review" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Finishing and cancelling an audit; the report panel with polling, download, resend and retry

**Files:**
- Create: `apps/web/src/features/audits/audit-actions.tsx`, `apps/web/src/features/audits/report-panel.tsx`
- Modify: `apps/web/src/features/audits/audit-screen.tsx`
- Test: `apps/web/src/features/audits/audit-actions.test.tsx`, `apps/web/src/features/audits/report-panel.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.audits.{finish, cancel, sendReport, downloadReport}`; `ApiError.itemIds`; `AUDIT_LIMITS`, `AUDIT_RESULTS`, types `AuditResult`, `FinishAuditInput`; `az.errors.MEDIA_NOT_FOUND_IN_STORAGE`.
  - Part 1 strings: `az.audits.{actions.{finish, cancel, downloadReport, resendReport, retryReport}, fields.{result, comment, extraEmails, cancelReason, recipients, sentAt}, results, reportStatuses}`; `az.errors.AUDIT_PAUSED`.
  - Task 2: `useAuditDetail` (`timedOut`, `restartPolling`), `auditKeys`, `REPORT_POLL_MS`, `REPORT_POLL_LIMIT_MS`; `refreshRunViews`. Task 3: `EmailListInput`.
  - Existing: `saveFile` (`features/reports/download`).
- Produces:
  - `AuditActions({ audit, missing: readonly string[], onIncomplete: (itemIds: readonly string[]) => void })`. It renders Cancel and Finish for `audits.perform` holders while the audit is in progress, and owns `FinishDialog` and `CancelAuditDialog`.
  - `ReportPanel({ audit, timedOut, onRestart })`: a `region` named "Audit hesabatı". It owns `ResendDialog`.
  - `AuditView({ audit, report: { timedOut: boolean; restart: () => void } })`, with `showMissing(ids)` and the missing-items alert.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/audits/audit-actions.test.tsx`:

```tsx
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meWith } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AuditScreen } from './audit-screen';
import { apiError, AUDIT_IDS, auditFixture, verdict } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    audits: { get: vi.fn(), setVerdict: vi.fn(), clearVerdict: vi.fn(), finish: vi.fn(), cancel: vi.fn(), sendReport: vi.fn(), downloadReport: vi.fn() },
    media: { url: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const renderScreen = () => renderWithRouter(<AuditScreen id={AUDIT_IDS.audit} />, `/audits/${AUDIT_IDS.audit}`);
const itemButton = (label: string) => within(screen.getByRole('navigation', { name: 'Bəndlər' })).getByRole('button', { name: label });
const finishButton = () => screen.getByRole('button', { name: az.audits.actions.finish });

/** Every auditable item reviewed; "Temperatur" rejected. */
function allReviewed() {
  const f = auditFixture();
  const verdicts = f.auditableItemIds.map((id) => (id === f.temp.id ? verdict(id, 'rejected', 'Normadan yüksək') : verdict(id, 'approved')));
  return { f, detail: f.detail({ verdicts }) };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(['audits.perform']);
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('finishing an audit', () => {
  it('highlights the items without a verdict instead of finishing', async () => {
    const f = auditFixture();
    mocks.api.audits.get.mockResolvedValue(
      f.detail({ verdicts: [f.problem.id, f.comment.id, f.temp.id, f.photo.id].map((id) => verdict(id, 'approved')) }),
    );
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('2 bənd hələ qiymətləndirilməyib.')).toBeInTheDocument();
    expect(itemButton('Video')).toHaveAttribute('data-missing', 'true');
    expect(itemButton('Qeyd')).toHaveAttribute('data-missing', 'true');
    expect(itemButton('Temperatur')).not.toHaveAttribute('data-missing');
    expect(itemButton('Video')).toHaveAttribute('aria-current', 'true');
    expect(mocks.api.audits.finish).not.toHaveBeenCalled();
  });

  it('finishes with the result, the comment and extra addresses', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, status: 'finished', result: 'failed', reportStatus: 'pending' });
    mocks.api.audits.finish.mockResolvedValue({ ...detail, status: 'finished' });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    expect(within(dialog).getByText('rehber@acme.az')).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Auditi bitir' });
    expect(submit).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.failed }));
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.comment), 'Temperatur normadan yüksəkdir');
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.extraEmails), 'Audit@Acme.az{Enter}');
    await userEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.api.audits.finish).toHaveBeenCalledWith(AUDIT_IDS.audit, { result: 'failed', comment: 'Temperatur normadan yüksəkdir', extraEmails: ['audit@acme.az'] });
    // Finished: read-only, with the result and no more actions.
    expect(await screen.findByText(az.audits.statuses.finished)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.finish })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.approve })).not.toBeInTheDocument();
  });

  it('highlights the items the server still misses', async () => {
    const { f, detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    mocks.api.audits.finish.mockRejectedValue(apiError(422, 'AUDIT_INCOMPLETE', { itemIds: [f.note.id] }));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('1 bənd hələ qiymətləndirilməyib.')).toBeInTheDocument();
    expect(itemButton('Qeyd')).toHaveAttribute('data-missing', 'true');
    expect(itemButton('Qeyd')).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the dialog open with the reason when the run was sent back meanwhile', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    mocks.api.audits.finish.mockRejectedValue(apiError(409, 'AUDIT_PAUSED'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    expect(await within(dialog).findByText(az.errors.AUDIT_PAUSED)).toBeInTheDocument();
  });

  it('keeps the dialog open while a photo or video is still uploading', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue(detail);
    // Part 1 decision 29: the spec's "media pending" refusal.
    mocks.api.audits.finish.mockRejectedValue(apiError(422, 'MEDIA_NOT_FOUND_IN_STORAGE'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.finish }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi bitir' });
    await userEvent.click(within(dialog).getByRole('radio', { name: az.audits.results.passed }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auditi bitir' }));
    expect(await within(dialog).findByText(az.errors.MEDIA_NOT_FOUND_IN_STORAGE)).toBeInTheDocument();
  });

  it('does not offer finishing while the run is with the worker', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValue({ ...detail, paused: true });
    renderScreen();
    expect(await screen.findByText(az.audits.paused)).toBeInTheDocument();
    expect(finishButton()).toBeDisabled();
  });

  it('cancels the audit with a reason', async () => {
    const { detail } = allReviewed();
    mocks.api.audits.get.mockResolvedValueOnce(detail).mockResolvedValue({ ...detail, status: 'cancelled', cancelReason: 'Səhv icra seçilib' });
    mocks.api.audits.cancel.mockResolvedValue({ ...detail, status: 'cancelled' });
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: az.audits.actions.cancel }));
    const dialog = await screen.findByRole('dialog', { name: 'Auditi ləğv et' });
    const submit = within(dialog).getByRole('button', { name: 'Auditi ləğv et' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.cancelReason), 'Səhv icra seçilib');
    await userEvent.click(submit);
    await waitFor(() => expect(mocks.api.audits.cancel).toHaveBeenCalledWith(AUDIT_IDS.audit, { reason: 'Səhv icra seçilib' }));
    expect(await screen.findByText(az.audits.statuses.cancelled)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.cancel })).not.toBeInTheDocument();
  });

  it('offers neither finish nor cancel to a report viewer', async () => {
    mocks.me.current = meWith(['reports.view']);
    mocks.api.audits.get.mockResolvedValue(allReviewed().detail);
    renderScreen();
    await screen.findByRole('navigation', { name: 'Bəndlər' });
    expect(screen.queryByRole('button', { name: az.audits.actions.finish })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.cancel })).not.toBeInTheDocument();
  });
});
```

`apps/web/src/features/audits/report-panel.test.tsx`:

```tsx
import type { AuditDetail } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meWith } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AuditScreen } from './audit-screen';
import { apiError, AUDIT_IDS, auditFixture, verdict } from './fixtures';
import { REPORT_POLL_LIMIT_MS, REPORT_POLL_MS } from './labels';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { audits: { get: vi.fn(), sendReport: vi.fn(), downloadReport: vi.fn() }, media: { url: vi.fn() } },
  saveFile: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));
vi.mock('@/features/reports/download', () => ({ saveFile: mocks.saveFile }));

const FILE = { blob: new Blob(['%PDF-1.7']), filename: 'taskop-audit-acilis-2026-11-02.pdf' };

/** A failed audit finished at 15:00 Baku, its report in `reportStatus`. */
function finished(over: Partial<AuditDetail> = {}): AuditDetail {
  const f = auditFixture();
  return f.detail({
    status: 'finished',
    result: 'failed',
    score: { approved: 5, rejected: 1, reviewed: 6, percent: 83.3 },
    finishedAt: '2026-11-02T11:00:00.000Z',
    comment: 'Temperatur normadan yüksəkdir',
    verdicts: f.auditableItemIds.map((id) => verdict(id, id === f.temp.id ? 'rejected' : 'approved', id === f.temp.id ? 'Yüksək' : null)),
    reportStatus: 'ready',
    reportRecipients: ['rehber@acme.az'],
    reportSentAt: '2026-11-02T11:01:00.000Z',
    ...over,
  });
}

const renderScreen = () => renderWithRouter(<AuditScreen id={AUDIT_IDS.audit} />, `/audits/${AUDIT_IDS.audit}`);
const report = () => screen.getByRole('region', { name: 'Audit hesabatı' });
const download = () => within(report()).getByRole('button', { name: az.audits.actions.downloadReport });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith(['audits.perform']);
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
  mocks.api.audits.downloadReport.mockResolvedValue(FILE);
});
afterEach(() => vi.useRealTimers());

describe('the audit report', () => {
  it('shows the result, the recipients and the send time, and downloads the PDF', async () => {
    mocks.api.audits.get.mockResolvedValue(finished());
    renderScreen();
    expect(await screen.findByText(az.audits.results.failed)).toBeInTheDocument();
    expect(screen.getByText(`${az.audits.score}: 83,3%`)).toBeInTheDocument();
    expect(report()).toHaveTextContent(az.audits.reportStatuses.ready);
    expect(report()).toHaveTextContent('rehber@acme.az');
    expect(report()).toHaveTextContent('15:01');
    await userEvent.click(download());
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledWith(FILE));
    expect(mocks.api.audits.downloadReport).toHaveBeenCalledWith(AUDIT_IDS.audit);
  });

  it('asks again every 3 s while the report is built, then offers the PDF', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.api.audits.get.mockResolvedValueOnce(finished({ reportStatus: 'pending', reportSentAt: null })).mockResolvedValue(finished());
    renderScreen();
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
    expect(download()).toBeDisabled();
    await act(() => vi.advanceTimersByTimeAsync(REPORT_POLL_MS));
    await waitFor(() => expect(download()).toBeEnabled());
    expect(screen.queryByText('Hesabat hazırlanır…')).not.toBeInTheDocument();
    expect(mocks.api.audits.get).toHaveBeenCalledTimes(2);
  });

  it('stops asking after 60 s and asks again on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.api.audits.get.mockResolvedValue(finished({ reportStatus: 'pending', reportSentAt: null }));
    renderScreen();
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(REPORT_POLL_LIMIT_MS + REPORT_POLL_MS));
    expect(await screen.findByText('Hesabat hələ hazır deyil. Bir az sonra yenidən yoxlayın.')).toBeInTheDocument();
    const calls = mocks.api.audits.get.mock.calls.length;
    expect(calls).toBeGreaterThan(10);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mocks.api.audits.get).toHaveBeenCalledTimes(calls);
    await user.click(screen.getByRole('button', { name: 'Yenidən yoxla' }));
    await waitFor(() => expect(mocks.api.audits.get.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
  });

  it('waits again when the download says the report is not ready', async () => {
    mocks.api.audits.get.mockResolvedValueOnce(finished()).mockResolvedValue(finished({ reportStatus: 'pending' }));
    mocks.api.audits.downloadReport.mockRejectedValue(apiError(409, 'REPORT_NOT_READY'));
    renderScreen();
    await screen.findByRole('region', { name: 'Audit hesabatı' });
    await userEvent.click(download());
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it('retries a failed report', async () => {
    mocks.api.audits.get.mockResolvedValueOnce(finished({ reportStatus: 'failed', reportSentAt: null })).mockResolvedValue(finished({ reportStatus: 'pending' }));
    mocks.api.audits.sendReport.mockResolvedValue(finished({ reportStatus: 'pending' }));
    renderScreen();
    expect(await screen.findByText('Hesabat yaradıla bilmədi.')).toBeInTheDocument();
    expect(download()).toBeDisabled();
    await userEvent.click(within(report()).getByRole('button', { name: az.audits.actions.retryReport }));
    expect(mocks.api.audits.sendReport).toHaveBeenCalledWith(AUDIT_IDS.audit);
    expect(await screen.findByText('Hesabat hazırlanır…')).toBeInTheDocument();
  });

  it('sends the report again to the addresses chosen', async () => {
    mocks.api.audits.get.mockResolvedValue(finished());
    mocks.api.audits.sendReport.mockResolvedValue(finished());
    renderScreen();
    await screen.findByRole('region', { name: 'Audit hesabatı' });
    await userEvent.click(within(report()).getByRole('button', { name: az.audits.actions.resendReport }));
    const dialog = await screen.findByRole('dialog', { name: 'Hesabatı yenidən göndər' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sil: rehber@acme.az' }));
    expect(within(dialog).getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(az.audits.fields.recipients), 'direktor@acme.az{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Göndər' }));
    expect(mocks.api.audits.sendReport).toHaveBeenCalledWith(AUDIT_IDS.audit, { emails: ['direktor@acme.az'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Sending elsewhere does not change the stored recipients (Part 1).
    expect(report()).toHaveTextContent('rehber@acme.az');
  });

  it('lets a report viewer download, but not send or retry', async () => {
    mocks.me.current = meWith(['reports.view']);
    mocks.api.audits.get.mockResolvedValue(finished());
    renderScreen();
    await screen.findByRole('region', { name: 'Audit hesabatı' });
    expect(download()).toBeEnabled();
    expect(within(report()).queryByRole('button', { name: az.audits.actions.resendReport })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/audits/audit-actions features/audits/report-panel`
Expected: FAIL: no button named `az.audits.actions.finish`, and no region named "Audit hesabatı".

- [ ] **Step 3: Implement the finish and cancel dialogs**

`apps/web/src/features/audits/audit-actions.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, AUDIT_RESULTS, type AuditDetail, type AuditResult, type FinishAuditInput } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmailListInput } from '@/components/email-list-input';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { auditKeys } from './queries';

/**
 * Cancel and Finish for an audit in progress (decisions 7 and 8). With unreviewed items Finish points at them instead
 * of opening the dialog; while the run is with the worker it is disabled and the paused banner says why.
 */
export function AuditActions({ audit, missing, onIncomplete }: { audit: AuditDetail; missing: readonly string[]; onIncomplete: (itemIds: readonly string[]) => void }) {
  const { t } = useTranslation();
  const canPerform = useCan('audits.perform');
  const [dialog, setDialog] = useState<null | 'finish' | 'cancel'>(null);
  if (!canPerform || audit.status !== 'in_progress') return null;
  return (
    <>
      <Button variant="outline" onClick={() => setDialog('cancel')}>
        {t('audits.actions.cancel')}
      </Button>
      <Button disabled={audit.paused} onClick={() => (missing.length > 0 ? onIncomplete(missing) : setDialog('finish'))}>
        {t('audits.actions.finish')}
      </Button>
      {dialog === 'finish' && <FinishDialog audit={audit} onClose={() => setDialog(null)} onIncomplete={onIncomplete} />}
      {dialog === 'cancel' && <CancelAuditDialog audit={audit} onClose={() => setDialog(null)} />}
    </>
  );
}

function FinishDialog({ audit, onClose, onIncomplete }: { audit: AuditDetail; onClose: () => void; onIncomplete: (itemIds: readonly string[]) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [result, setResult] = useState<AuditResult | null>(null);
  const [comment, setComment] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const finish = useMutation({
    mutationFn: (body: FinishAuditInput) => api.audits.finish(audit.id, body),
    onSuccess: async () => {
      toast.success(t('audits.web.finish.done'));
      onClose();
      await refreshRunViews(qc);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'AUDIT_INCOMPLETE') {
        onClose();
        onIncomplete(e.itemIds ?? []);
        void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
        return;
      }
      setError(errorText(t, e));
    },
  });
  const reviewed = audit.verdicts.filter((v) => audit.auditableItemIds.includes(v.itemId)).length;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('audits.web.finish.title')}</DialogTitle>
          <DialogDescription>{t('audits.progress', { reviewed, total: audit.auditableItemIds.length })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('audits.fields.result')}</legend>
            {AUDIT_RESULTS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="radio" name="audit-result" value={r} checked={result === r} onChange={() => setResult(r)} />
                {t(`audits.results.${r}`)}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="finish-comment">{t('audits.fields.comment')}</Label>
            <Textarea id="finish-comment" maxLength={AUDIT_LIMITS.finalComment} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-medium">{t('audits.web.finish.checklistEmails')}</p>
            {audit.checklistReportEmails.length > 0 ? (
              <ul className="text-sm">
                {audit.checklistReportEmails.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">{t('audits.web.finish.noChecklistEmails')}</p>
            )}
          </div>
          <EmailListInput
            id="finish-extra-emails"
            label={t('audits.fields.extraEmails')}
            value={extra}
            onChange={setExtra}
            max={Math.max(0, AUDIT_LIMITS.recipients - audit.checklistReportEmails.length)}
          />
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={result === null || finish.isPending} onClick={() => result && finish.mutate({ result, comment: comment.trim() || null, extraEmails: extra })}>
            {t('audits.web.finish.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelAuditDialog({ audit, onClose }: { audit: AuditDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.audits.cancel(audit.id, { reason: reason.trim() }),
    onSuccess: async () => {
      toast.success(t('audits.web.cancel.done'));
      onClose();
      await refreshRunViews(qc);
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('audits.web.cancel.title')}</DialogTitle>
          <DialogDescription>{t('audits.web.cancel.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-audit-reason">{t('audits.fields.cancelReason')}</Label>
          <Textarea id="cancel-audit-reason" maxLength={AUDIT_LIMITS.cancelReason} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <FormError message={cancel.error ? errorText(t, cancel.error) : null} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
            {t('audits.web.cancel.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement the report panel**

`apps/web/src/features/audits/report-panel.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type AuditDetail } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmailListInput } from '@/components/email-list-input';
import { FormError } from '@/components/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { saveFile } from '@/features/reports/download';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { api, useCan } from '@/lib/session';
import { auditKeys } from './queries';

/**
 * A finished audit's PDF (spec §7.2, §8.3): its status, who it went to, the download, and Retry (failed) or Resend
 * (ready) for audits.perform holders. `timedOut`: the 60 s polling window ran out while the report was pending.
 */
export function ReportPanel({ audit, timedOut, onRestart }: { audit: AuditDetail; timedOut: boolean; onRestart: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canPerform = useCan('audits.perform');
  const formatDateTime = useFormatDateTime();
  const [resending, setResending] = useState(false);
  /** A new polling window, and the audit asked again now. */
  const refresh = () => {
    onRestart();
    void qc.invalidateQueries({ queryKey: auditKeys.detail(audit.id) });
  };
  const download = useMutation({
    mutationFn: () => api.audits.downloadReport(audit.id),
    onSuccess: (file) => saveFile(file),
    onError: (e) => (e instanceof ApiError && e.code === 'REPORT_NOT_READY' ? refresh() : toast.error(errorText(t, e))),
  });
  const retry = useMutation({
    mutationFn: () => api.audits.sendReport(audit.id),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(t, e)),
  });
  const s = audit.reportStatus;

  return (
    <section aria-labelledby="audit-report-title" className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="audit-report-title" className="font-semibold">
          {t('audits.web.report.title')}
        </h2>
        <Badge variant={s === 'failed' ? 'destructive' : s === 'ready' ? 'default' : 'secondary'}>{t(`audits.reportStatuses.${s}`)}</Badge>
      </div>
      {s === 'pending' && !timedOut && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('audits.web.report.preparing')}
        </p>
      )}
      {s === 'pending' && timedOut && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-muted-foreground text-sm">
            {t('audits.web.report.slow')}
          </p>
          <Button size="sm" variant="outline" onClick={refresh}>
            {t('audits.web.report.checkAgain')}
          </Button>
        </div>
      )}
      {s === 'failed' && <p className="text-destructive text-sm">{t('audits.web.report.failed')}</p>}
      <dl className="grid gap-1 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">{t('audits.fields.recipients')}</dt>
          <dd>{audit.reportRecipients.length > 0 ? audit.reportRecipients.join(', ') : t('audits.web.report.noRecipients')}</dd>
        </div>
        {audit.reportSentAt && (
          <div>
            <dt className="text-muted-foreground text-xs">{t('audits.fields.sentAt')}</dt>
            <dd>{formatDateTime(audit.reportSentAt)}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button disabled={s !== 'ready' || download.isPending} onClick={() => download.mutate()}>
          <Download className="size-4" aria-hidden />
          {t('audits.actions.downloadReport')}
        </Button>
        {canPerform && s === 'failed' && (
          <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {t('audits.actions.retryReport')}
          </Button>
        )}
        {canPerform && s === 'ready' && (
          <Button variant="outline" onClick={() => setResending(true)}>
            {t('audits.actions.resendReport')}
          </Button>
        )}
      </div>
      {resending && <ResendDialog audit={audit} onClose={() => setResending(false)} onSent={refresh} />}
    </section>
  );
}

function ResendDialog({ audit, onClose, onSent }: { audit: AuditDetail; onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState<string[]>(audit.reportRecipients);
  const send = useMutation({
    mutationFn: () => api.audits.sendReport(audit.id, { emails }),
    onSuccess: () => {
      toast.success(t('audits.web.report.sent'));
      onSent();
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('audits.web.report.resendTitle')}</DialogTitle>
        </DialogHeader>
        <EmailListInput id="resend-emails" label={t('audits.fields.recipients')} value={emails} onChange={setEmails} max={AUDIT_LIMITS.recipients} />
        <FormError message={send.error ? errorText(t, send.error) : null} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={emails.length === 0 || send.isPending} onClick={() => send.mutate()}>
            {t('audits.web.report.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Put them on the screen**

In `apps/web/src/features/audits/audit-screen.tsx`, add the imports:

```ts
import { AuditActions } from './audit-actions';
import { ReportPanel } from './report-panel';
```

Replace `AuditScreen` with:

```tsx
export function AuditScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const { query, timedOut, restartPolling } = useAuditDetail(id);
  if (query.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (query.isError) return <p className="text-destructive">{errorText(t, query.error)}</p>;
  return <AuditView audit={query.data} report={{ timedOut, restart: restartPolling }} />;
}
```

Change the signature of `AuditView` to:

```tsx
function AuditView({ audit, report }: { audit: AuditDetail; report: { timedOut: boolean; restart: () => void } }) {
```

After the `commentOf` line in `AuditView`, add:

```tsx
  /** Decision 7: point at the items still without a verdict (the client's check, or AUDIT_INCOMPLETE's itemIds). */
  const showMissing = (ids: readonly string[]) => {
    setHighlight(new Set(ids));
    if (ids[0]) setSelected(ids[0]);
  };
```

Replace the `actions` prop of `PageHeader` with:

```tsx
        actions={
          <>
            {canOpenRun && (
              <Link to="/schedule" search={{ date: o.localDate, occurrence: o.id, tab: 'execution' }} className={buttonVariants({ variant: 'outline' })}>
                {t('audits.web.screen.openRun')}
              </Link>
            )}
            <AuditActions audit={audit} missing={missing} onIncomplete={showMissing} />
          </>
        }
```

Right after the `{audit.paused && (…)}` block, add:

```tsx
      {highlight.size > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{t('audits.web.screen.missing', { count: highlight.size })}</AlertDescription>
        </Alert>
      )}
      {audit.status === 'finished' && <ReportPanel audit={audit} timedOut={report.timedOut} onRestart={report.restart} />}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/audits && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS, the Task 4 tests included.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/audits/audit-actions.tsx apps/web/src/features/audits/report-panel.tsx apps/web/src/features/audits/audit-screen.tsx apps/web/src/features/audits/audit-actions.test.tsx apps/web/src/features/audits/report-panel.test.tsx
git commit -m "feat(web): finish and cancel audits, and download, resend or retry the audit report" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `/audits` page: menu entry, queues, filters, the paged table and "Start audit"

**Files:**
- Create: `apps/web/src/features/audits/audits-page.tsx`
- Modify: `apps/web/src/features/audits/queries.ts` (+ `useStartAudit`), `apps/web/src/router.tsx`, `apps/web/src/layouts/app-shell.tsx`
- Test: `apps/web/src/features/audits/audits-page.test.tsx`, `apps/web/src/layouts/app-shell.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.audits.{list, start}`, `AUDIT_QUEUES`, `AUDIT_RESULTS`, `type AuditQueue`, `type AuditQueueRow`.
  - Part 1 strings: `az.audits.{title, queues, results, statuses, actions.start}`, `az.nav.audits`, `az.scheduling.statuses.correction_required`.
  - Task 2: `auditsSearch`, `AuditsSearch`, `DEFAULT_QUEUE`, `queueFilters`, `queueRangeIssue`, `RANGE_ISSUE_KEYS`, `resultVariant`, `actorName`, `useAuditQueue`, `useAuditorOptions`, `startOrOpenAudit`, `auditKeys`; `refreshRunViews`.
  - Existing: `cleanSearch` (`features/reports/search`), `useReportChecklistOptions` (`features/reports/queries`), `useSites` (`features/sites/queries`), `indentedName` (`features/sites/tree`), `formatLocalDate` (`features/scheduling/labels`), `formatPercent` (`features/executions/labels`).
- Produces:
  - `AuditsPage()` (`/audits`, `validateSearch: auditsSearch`).
  - `useStartAudit()`: a mutation of `executionId` that opens `/audits/$auditId`. Task 7 uses it.
  - The menu item "Auditlər" for `audits.perform`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/audits/audits-page.test.tsx`:

```tsx
import { az } from '@taskop/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKLISTS, IDS, meWith, page, SITES } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AuditsPage } from './audits-page';
import { apiError, AUDIT_IDS, AUDITOR, auditDto, queueRow } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { audits: { list: vi.fn(), start: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() }, users: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const AUDITOR_PERMS = ['audits.perform', 'sites.view', 'checklists.view', 'users.view'];
const inProgress = queueRow({ auditId: AUDIT_IDS.audit, auditState: 'in_progress', auditor: AUDITOR, startedAt: '2026-11-02T10:00:00.000Z' });
const finishedRow = queueRow({
  auditId: AUDIT_IDS.audit2,
  status: 'audited',
  auditState: 'failed',
  auditor: AUDITOR,
  result: 'failed',
  percent: 83.3,
  startedAt: '2026-11-02T10:00:00.000Z',
  finishedAt: '2026-11-02T11:00:00.000Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.current = meWith(AUDITOR_PERMS);
  mocks.api.audits.list.mockImplementation(async (q: { queue: string }) =>
    page(q.queue === 'waiting' ? [queueRow()] : q.queue === 'in_progress' ? [inProgress] : [finishedRow]),
  );
  mocks.api.sites.list.mockResolvedValue(SITES);
  mocks.api.checklists.list.mockResolvedValue({ items: CHECKLISTS, nextCursor: null });
  mocks.api.users.list.mockResolvedValue({ items: [{ id: AUDIT_IDS.auditor, fullName: 'Rəşad Kazımov' }], nextCursor: null });
});

describe('AuditsPage', () => {
  it('opens on Waiting and lists the runs that wait for an audit', async () => {
    renderWithRouter(<AuditsPage />, '/audits');
    expect(await screen.findByRole('heading', { name: az.audits.title })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([az.audits.queues.waiting, az.audits.queues.in_progress, az.audits.queues.finished]);
    expect(screen.getByRole('tab', { name: az.audits.queues.waiting })).toHaveAttribute('aria-selected', 'true');
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.audits.list).toHaveBeenCalledWith({ queue: 'waiting' });
    expect(within(rows[0]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Tarix', 'Yoxlama vərəqəsi', 'Obyekt', 'İcraçı', 'Tamamlanıb', 'Əməliyyatlar']);
    for (const text of ['Açılış yoxlaması', 'Anbar №1', 'Nigar Səfərli', '09:00']) expect(rows[1]).toHaveTextContent(text);
    // A waiting run has no auditor and no result yet: those filters are not offered.
    expect(screen.queryByLabelText('Auditor')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nəticə')).not.toBeInTheDocument();
  });

  it('starts an audit from a waiting row and opens it', async () => {
    mocks.api.audits.start.mockResolvedValue(auditDto({ id: AUDIT_IDS.audit }));
    const router = renderWithRouter(<AuditsPage />, '/audits');
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: az.audits.actions.start }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/audits/${AUDIT_IDS.audit}`));
    expect(mocks.api.audits.start).toHaveBeenCalledWith(AUDIT_IDS.execution);
  });

  it('opens the existing audit when another auditor started it first', async () => {
    mocks.api.audits.start.mockRejectedValue(apiError(409, 'AUDIT_EXISTS', { auditId: AUDIT_IDS.audit2 }));
    const router = renderWithRouter(<AuditsPage />, '/audits');
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: az.audits.actions.start }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/audits/${AUDIT_IDS.audit2}`));
  });

  it('shows the auditor and the paused state in progress, and links a row to its audit', async () => {
    mocks.api.audits.list.mockResolvedValue(page([inProgress, queueRow({ ...inProgress, occurrenceId: IDS.run2, status: 'correction_required' })]));
    renderWithRouter(<AuditsPage />, '/audits?queue=in_progress');
    const rows = await screen.findAllByRole('row');
    expect(mocks.api.audits.list).toHaveBeenCalledWith({ queue: 'in_progress' });
    for (const text of ['Rəşad Kazımov', '14:00', az.audits.statuses.in_progress]) expect(rows[1]).toHaveTextContent(text);
    expect(rows[2]).toHaveTextContent(az.scheduling.statuses.correction_required);
    expect(within(rows[1]!).getByRole('link', { name: 'Açılış yoxlaması' })).toHaveAttribute('href', `/audits/${AUDIT_IDS.audit}`);
  });

  it('switches to Finished and sends every filter it has', async () => {
    const router = renderWithRouter(<AuditsPage />, '/audits');
    await screen.findAllByRole('row');
    await userEvent.click(screen.getByRole('tab', { name: az.audits.queues.finished }));
    await waitFor(() => expect(router.state.location.search).toEqual({ queue: 'finished' }));
    const rows = await screen.findAllByRole('row');
    for (const text of ['Rəşad Kazımov', '15:00', az.audits.results.failed, '83,3%']) expect(rows[1]).toHaveTextContent(text);
    await screen.findByRole('option', { name: 'Rəşad Kazımov' });
    await userEvent.selectOptions(screen.getByLabelText('Nəticə'), 'failed');
    await userEvent.selectOptions(screen.getByLabelText('Auditor'), AUDIT_IDS.auditor);
    await screen.findByRole('option', { name: /Zona A1/ });
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), IDS.zoneA);
    await userEvent.selectOptions(screen.getByLabelText('Yoxlama vərəqəsi'), IDS.checklist);
    await waitFor(() =>
      expect(mocks.api.audits.list).toHaveBeenLastCalledWith({ queue: 'finished', result: 'failed', auditorId: AUDIT_IDS.auditor, siteId: IDS.zoneA, checklistId: IDS.checklist }),
    );
    expect(router.state.location.search).toEqual({ queue: 'finished', result: 'failed', auditorId: AUDIT_IDS.auditor, siteId: IDS.zoneA, checklistId: IDS.checklist });
  });

  it('asks for both dates, refuses an inverted range, and sends a valid one', async () => {
    renderWithRouter(<AuditsPage />, '/audits');
    await screen.findAllByRole('row');
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-10-31' } });
    expect(await screen.findByText('Başlanğıc və son tarixi birlikdə seçin.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Son tarix'), { target: { value: '2026-10-01' } });
    expect(await screen.findByText('Son tarix başlanğıc tarixindən əvvəl ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.audits.list).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Son tarix'), { target: { value: '2026-11-04' } });
    await waitFor(() => expect(mocks.api.audits.list).toHaveBeenLastCalledWith({ queue: 'waiting', from: '2026-10-31', to: '2026-11-04' }));
  });

  it('loads the next page with the cursor', async () => {
    mocks.api.audits.list.mockResolvedValueOnce(page([queueRow()], IDS.run)).mockResolvedValueOnce(page([queueRow({ occurrenceId: IDS.run2, executionId: IDS.execution })]));
    renderWithRouter(<AuditsPage />, '/audits');
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(mocks.api.audits.list).toHaveBeenLastCalledWith({ queue: 'waiting', cursor: IDS.run });
  });

  it('says so when a queue is empty, and hides pickers the user cannot fill', async () => {
    mocks.me.current = meWith(['audits.perform']);
    mocks.api.audits.list.mockResolvedValue(page([]));
    renderWithRouter(<AuditsPage />, '/audits');
    expect(await screen.findByText('Audit gözləyən icra yoxdur.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Obyekt')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Yoxlama vərəqəsi')).not.toBeInTheDocument();
    expect(mocks.api.sites.list).not.toHaveBeenCalled();
  });
});
```

In `apps/web/src/layouts/app-shell.test.tsx`, add to the first test (`shows only the menu items the user may open`), after the `Hesabatlar` line:

```ts
    expect(screen.queryByRole('link', { name: 'Auditlər' })).not.toBeInTheDocument();
```

and add this test after `shows Hesabatlar to holders of reports.view`:

```tsx
  it('shows Auditlər to holders of audits.perform', async () => {
    state.current = { status: 'authenticated', me: me(['audits.perform']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Auditlər' })).toHaveAttribute('href', '/audits');
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/audits/audits-page layouts/app-shell`
Expected: FAIL: `Failed to resolve import "./audits-page"`, and no "Auditlər" link.

- [ ] **Step 3: Add `useStartAudit`**

In `apps/web/src/features/audits/queries.ts`, extend the imports:

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { refreshRunViews } from '@/features/executions/queries';
```

(the first line replaces the existing `@tanstack/react-query` import) and append:

```ts
/** Start (or join) the audit of a run and open it; the run's status changes, so every view of it refreshes. */
export function useStartAudit() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: startOrOpenAudit,
    onSuccess: async (auditId) => {
      void refreshRunViews(qc);
      await navigate({ to: '/audits/$auditId', params: { auditId } });
    },
  });
}
```

- [ ] **Step 4: Implement the page**

`apps/web/src/features/audits/audits-page.tsx`:

```tsx
import { AUDIT_QUEUES, AUDIT_RESULTS, type AuditQueue, type AuditQueueRow } from '@taskop/contracts';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatPercent } from '@/features/executions/labels';
import { useReportChecklistOptions } from '@/features/reports/queries';
import { cleanSearch } from '@/features/reports/search';
import { formatLocalDate } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { indentedName } from '@/features/sites/tree';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { actorName, type AuditsSearch, auditsSearch, DEFAULT_QUEUE, queueFilters, queueRangeIssue, RANGE_ISSUE_KEYS, resultVariant } from './labels';
import { useAuditorOptions, useAuditQueue, useStartAudit } from './queries';

type Column = 'date' | 'checklist' | 'site' | 'executor' | 'completedAt' | 'auditor' | 'startedAt' | 'status' | 'finishedAt' | 'result' | 'score';
const COLUMNS: Record<AuditQueue, readonly Column[]> = {
  waiting: ['date', 'checklist', 'site', 'executor', 'completedAt'],
  in_progress: ['date', 'checklist', 'site', 'executor', 'auditor', 'startedAt', 'status'],
  finished: ['date', 'checklist', 'site', 'executor', 'auditor', 'finishedAt', 'result', 'score'],
};

/**
 * `/audits` (spec §8.3): Waiting, In progress and Finished, with site, checklist, auditor, result and date filters, all in
 * the URL (decision 2). A waiting row starts its audit; the others open theirs.
 */
export function AuditsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canSites = useCan('sites.view');
  const canChecklists = useCan('checklists.view');
  const canUsers = useCan('users.view');
  const search = auditsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const queue = search.queue ?? DEFAULT_QUEUE;
  const issue = queueRangeIssue(search.from, search.to);
  const rows = useAuditQueue(queueFilters(search), issue === null);
  const sites = useSites(canSites);
  const checklists = useReportChecklistOptions(canChecklists);
  const auditors = useAuditorOptions(canUsers && queue !== 'waiting');
  const items = rows.data?.pages.flatMap((p) => p.items) ?? [];
  // Filter edits replace the history entry; tab switches push one (decision 2).
  const go = (next: AuditsSearch, replace = true) => void navigate({ to: '/audits', search: cleanSearch(next), replace });
  const set = (key: 'siteId' | 'checklistId' | 'auditorId' | 'result' | 'from' | 'to', value: string) => go({ ...search, [key]: value || undefined });

  return (
    <div className="grid gap-4">
      <PageHeader title={t('audits.title')} />
      <div className="flex flex-wrap items-end gap-3">
        {canSites && (
          <NativeSelect aria-label={t('audits.web.page.filters.site')} value={search.siteId ?? ''} onChange={(e) => set('siteId', e.target.value)} className="w-52">
            <option value="">{t('audits.web.page.filters.allSites')}</option>
            {(sites.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {indentedName(s)}
              </option>
            ))}
          </NativeSelect>
        )}
        {canChecklists && (
          <NativeSelect aria-label={t('audits.web.page.filters.checklist')} value={search.checklistId ?? ''} onChange={(e) => set('checklistId', e.target.value)} className="w-56">
            <option value="">{t('audits.web.page.filters.allChecklists')}</option>
            {(checklists.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        )}
        {canUsers && queue !== 'waiting' && (
          <NativeSelect aria-label={t('audits.web.page.filters.auditor')} value={search.auditorId ?? ''} onChange={(e) => set('auditorId', e.target.value)} className="w-52">
            <option value="">{t('audits.web.page.filters.allAuditors')}</option>
            {(auditors.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </NativeSelect>
        )}
        {queue === 'finished' && (
          <NativeSelect aria-label={t('audits.web.page.filters.result')} value={search.result ?? ''} onChange={(e) => set('result', e.target.value)} className="w-44">
            <option value="">{t('audits.web.page.filters.allResults')}</option>
            {AUDIT_RESULTS.map((r) => (
              <option key={r} value={r}>
                {t(`audits.results.${r}`)}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="grid gap-1">
          <Label htmlFor="audits-from">{t('audits.web.page.filters.from')}</Label>
          <Input id="audits-from" type="date" className="w-44" value={search.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="audits-to">{t('audits.web.page.filters.to')}</Label>
          <Input id="audits-to" type="date" className="w-44" value={search.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>
      {issue && <p className="text-destructive text-sm">{t(RANGE_ISSUE_KEYS[issue])}</p>}
      <Tabs value={queue} onValueChange={(v) => go({ ...search, queue: v as AuditQueue }, false)}>
        <TabsList>
          {AUDIT_QUEUES.map((q) => (
            <TabsTrigger key={q} value={q}>
              {t(`audits.queues.${q}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {AUDIT_QUEUES.map((q) => (
          <TabsContent key={q} value={q} className="grid gap-4 pt-2">
            {!issue && rows.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
            {!issue && rows.isError && <p className="text-destructive">{errorText(t, rows.error)}</p>}
            {!issue && rows.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t(`audits.web.page.empty.${q}`)}</p>}
            {!issue && items.length > 0 && <QueueTable queue={q} items={items} />}
            {!issue && rows.hasNextPage && (
              <Button variant="outline" className="w-fit" disabled={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>
                {t('audits.web.page.more')}
              </Button>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function QueueTable({ queue, items }: { queue: AuditQueue; items: AuditQueueRow[] }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const formatDateTime = useFormatDateTime();
  const start = useStartAudit();
  const when = (iso: string | null) => (iso ? formatDateTime(iso) : '—');

  const cell = (r: AuditQueueRow, c: Column) => {
    switch (c) {
      case 'date':
        return formatLocalDate(r.localDate, tenant.locale);
      case 'checklist':
        return r.auditId ? (
          <Link to="/audits/$auditId" params={{ auditId: r.auditId }} className="font-medium underline-offset-4 hover:underline">
            {r.checklist.name}
          </Link>
        ) : (
          r.checklist.name
        );
      case 'site':
        return r.site.name;
      case 'executor':
        return r.executor.fullName;
      case 'completedAt':
        return when(r.completedAt);
      case 'auditor':
        return actorName(t, r.auditor);
      case 'startedAt':
        return when(r.startedAt);
      case 'finishedAt':
        return when(r.finishedAt);
      case 'status':
        // An audit whose run went back to the worker is paused (spec §3.3).
        return r.status === 'correction_required' ? (
          <Badge variant="destructive">{t('scheduling.statuses.correction_required')}</Badge>
        ) : (
          <Badge variant="secondary">{t('audits.statuses.in_progress')}</Badge>
        );
      case 'result':
        return r.result ? <Badge variant={resultVariant(r.result)}>{t(`audits.results.${r.result}`)}</Badge> : '—';
      case 'score':
        return r.percent === null ? '—' : t('executions.percent', { value: formatPercent(r.percent, tenant.locale) });
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {COLUMNS[queue].map((c) => (
            <TableHead key={c}>{t(`audits.web.page.columns.${c}`)}</TableHead>
          ))}
          {queue === 'waiting' && <TableHead>{t('common.actions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((r) => (
          <TableRow key={r.occurrenceId}>
            {COLUMNS[queue].map((c) => (
              <TableCell key={c} className={c === 'score' ? 'tabular-nums' : undefined}>
                {cell(r, c)}
              </TableCell>
            ))}
            {queue === 'waiting' && (
              <TableCell>
                <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(r.executionId, { onError: (e) => toast.error(errorText(t, e)) })}>
                  {t('audits.actions.start')}
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Register the page and the menu item**

In `apps/web/src/router.tsx`, add after the `AuditRoute` import:

```ts
import { AuditsPage } from '@/features/audits/audits-page';
import { auditsSearch } from '@/features/audits/labels';
```

after the `auditScreenRoute` definition:

```ts
const auditsRoute = createRoute({ getParentRoute: () => appLayout, path: '/audits', component: AuditsPage, validateSearch: auditsSearch });
```

and in `appLayout.addChildren([...])`, before `auditScreenRoute,`:

```ts
    auditsRoute,
```

In `apps/web/src/layouts/app-shell.tsx`:
- add `ShieldCheck` to the `lucide-react` import (alphabetically after `Shield`);
- add `| '/audits'` to the `NavItem['to']` union, after `'/tasks'`;
- in `NAV_ITEMS`, after the `/tasks` entry, add:

```ts
  { to: '/audits', labelKey: 'nav.audits', icon: ShieldCheck, permission: 'audits.perform' },
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/audits layouts/app-shell && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/audits/audits-page.tsx apps/web/src/features/audits/audits-page.test.tsx apps/web/src/features/audits/queries.ts apps/web/src/router.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/layouts/app-shell.test.tsx
git commit -m "feat(web): add the audit queue page with filters and Start audit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The run dialog's Audit and Corrections tabs

**Files:**
- Create: `apps/web/src/features/audits/run-audit-tab.tsx`, `apps/web/src/features/corrections/labels.ts`, `apps/web/src/features/corrections/queries.ts`, `apps/web/src/features/corrections/fixtures.ts`, `apps/web/src/features/corrections/corrections-tab.tsx`
- Modify: `apps/web/src/features/scheduling/occurrence-dialog.tsx`, `apps/web/src/features/scheduling/routes.tsx`, `apps/web/src/features/scheduling/schedule-page.test.tsx`
- Test: `apps/web/src/features/audits/run-audit-tab.test.tsx`, `apps/web/src/features/corrections/labels.test.ts`, `apps/web/src/features/corrections/corrections-tab.test.tsx`, `apps/web/src/features/scheduling/occurrence-dialog.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.corrections.history`, `canStartAudit`, types `AuditBrief`, `Correction`, `ExecutionCorrections`, `ReworkRequest` (`requestedBy: UserRef | null`, `answersBefore`), `Score`.
  - Existing: `scheduling.schedule.actorPlatform` ("Taskop dəstəyi") for a platform admin.
  - Part 1 strings: `az.audits.{audit, noAudit, paused, score, statuses, results, actions.{start, open}}`, `az.corrections.{title, original, current, kinds, round, dueAt, noCorrections, emptyAnswer}`.
  - Task 2: `useStartAudit` (Task 6), `resultVariant`, `actorName`, `auditDto`, `AUDIT_IDS`.
  - Existing: `useExecution` (`features/executions/queries`), `answerValue`, `formatPercent` (`features/executions/labels`), `walkItems`, `executionFixture`, `occurrenceDetail`, `summary` (`features/executions/fixtures`).
- Produces:
  - `features/scheduling/occurrence-dialog.tsx`: `OCCURRENCE_TABS = ['overview', 'execution', 'audit', 'corrections'] as const` and `type OccurrenceTab = (typeof OCCURRENCE_TABS)[number]`. `scheduleSearch` keeps any of them.
  - `RunAuditTab({ occurrence }: { occurrence: OccurrenceDetail })`.
  - `CorrectionsTab({ occurrence }: { occurrence: OccurrenceDetail })`.
  - `features/corrections/labels.ts`:
    - `answerSummary(t, item: Item, a: Answer | null | undefined, formatDateTime): string`;
    - `type TimelineEntry` and `correctionTimeline(c: ExecutionCorrections): TimelineEntry[]`;
    - `scoreText(t, score: Score | null, locale: string): string`.
  - `features/corrections/queries.ts`: `correctionKeys.history(executionId)` and `useCorrections(executionId: string)`.
  - `features/corrections/fixtures.ts` (tests only): `MANAGER`, `reworkRequest(over?)`, `correction(over)`, `noCorrections()`.

- [ ] **Step 1: Add the correction fixtures**

`apps/web/src/features/corrections/fixtures.ts`:

```ts
import type { Correction, ExecutionCorrections, ReworkRequest } from '@taskop/contracts';

/** Test data shared by the correction tests. Not imported by application code. */
export const MANAGER = { id: 'mgr', fullName: 'Leyla Quliyeva' };

/** Round 1, sent back at 14:00 Baku by Leyla, still open, no due date. `requestedBy: null` = a platform admin. */
export const reworkRequest = (over: Partial<ReworkRequest> = {}): ReworkRequest => ({
  id: 'rw1',
  round: 1,
  items: [],
  dueAt: null,
  requestedBy: MANAGER,
  requestedAt: '2026-11-02T10:00:00.000Z',
  resubmittedAt: null,
  withdrawnAt: null,
  withdrawnBy: null,
  answersBefore: {},
  ...over,
});

/** A manager's correction at 13:00 Baku. */
export const correction = (over: Partial<Correction> & Pick<Correction, 'itemId'>): Correction => ({
  id: 'c1',
  kind: 'manual',
  round: 0,
  before: null,
  after: null,
  reason: 'Səhv daxil edilib',
  actor: { kind: 'user', name: MANAGER.fullName },
  at: '2026-11-02T09:00:00.000Z',
  ...over,
});

export const noCorrections = (): ExecutionCorrections => ({ original: null, corrections: [], reworkRequests: [], diff: [] });
```

- [ ] **Step 2: Write the failing tests**

`apps/web/src/features/corrections/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { executionFixture } from '@/features/executions/fixtures';
import i18n from '@/lib/i18n';
import { correction, noCorrections, reworkRequest } from './fixtures';
import { answerSummary, correctionTimeline, scoreText } from './labels';

const t = i18n.t.bind(i18n);
const fmt = (iso: string) => `@${iso}`;

describe('answerSummary', () => {
  it('writes the value, else the media counts, else "Cavab yoxdur", then the note', () => {
    const f = executionFixture();
    expect(answerSummary(t, f.temp, { number: 10, note: 'isti' }, fmt)).toBe('10 °C · Qeyd: isti');
    expect(answerSummary(t, f.problem, { optionIds: [f.no.id] }, fmt)).toBe('Xeyr');
    expect(answerSummary(t, f.photo, { photos: ['m1', 'm2'] }, fmt)).toBe('2 foto, 0 video');
    expect(answerSummary(t, f.note, null, fmt)).toBe('Cavab yoxdur');
    expect(answerSummary(t, f.note, { note: 'Sonra baxılacaq' }, fmt)).toBe('Cavab yoxdur · Qeyd: Sonra baxılacaq');
  });
});

describe('scoreText', () => {
  it('shows a percentage or says there is no score', () => {
    expect(scoreText(t, { earned: 7, possible: 8, percent: 87.5, problems: [] }, 'az')).toBe('87,5%');
    expect(scoreText(t, null, 'az')).toBe('Bal hesablanmır');
  });
});

describe('correctionTimeline', () => {
  it('puts send-backs, resubmits, withdrawals and corrections in time order, a resubmit before its changes', () => {
    const sent = reworkRequest({ requestedAt: '2026-11-02T10:00:00.000Z', resubmittedAt: '2026-11-02T12:00:00.000Z' });
    const withdrawn = reworkRequest({ id: 'rw2', round: 2, requestedAt: '2026-11-02T13:00:00.000Z', withdrawnAt: '2026-11-02T14:00:00.000Z', withdrawnBy: { id: 'mgr', fullName: 'Leyla Quliyeva' } });
    const manual = correction({ id: 'c1', itemId: 'i1', at: '2026-11-02T09:00:00.000Z' });
    const rework = correction({ id: 'c2', itemId: 'i2', kind: 'rework', round: 1, at: '2026-11-02T12:00:00.000Z' });
    const timeline = correctionTimeline({ ...noCorrections(), corrections: [manual, rework], reworkRequests: [sent, withdrawn] });
    expect(timeline.map((e) => `${e.kind}@${e.at.slice(11, 16)}`)).toEqual([
      'correction@09:00',
      'sentBack@10:00',
      'resubmitted@12:00',
      'correction@12:00',
      'sentBack@13:00',
      'withdrawn@14:00',
    ]);
    expect(correctionTimeline(noCorrections())).toEqual([]);
  });
});
```

`apps/web/src/features/corrections/corrections-tab.test.tsx`:

```tsx
import { az } from '@taskop/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { renderWithProviders } from '@/test/render';
import { CorrectionsTab } from './corrections-tab';
import { correction, noCorrections, reworkRequest } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { executions: { get: vi.fn() }, corrections: { history: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('CorrectionsTab', () => {
  it('says so when the run was never corrected or sent back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail());
    mocks.api.corrections.history.mockResolvedValue(noCorrections());
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText(az.corrections.noCorrections)).toBeInTheDocument();
    expect(mocks.api.corrections.history).toHaveBeenCalledWith('x1');
  });

  it('says so when the run was never started', () => {
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ status: 'pending' })} />);
    expect(screen.getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
    expect(mocks.api.corrections.history).not.toHaveBeenCalled();
  });

  it('compares the original with the current answers and lists every change, oldest first', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(
      f.detail({
        answers: { ...f.answers, [f.temp.id]: { number: 5, note: 'isti' }, [f.note.id]: { text: 'Hamısı yoxlanıldı' } },
        score: { earned: 2, possible: 2, percent: 100, problems: [] },
        corrected: true,
      }),
    );
    mocks.api.corrections.history.mockResolvedValue({
      original: { answers: f.answers, score: { earned: 0, possible: 2, percent: 0, problems: [] }, capturedAt: '2026-11-02T09:00:00.000Z' },
      corrections: [
        correction({ id: 'c1', itemId: f.temp.id, before: { number: 10, note: 'isti' }, after: { number: 5, note: 'isti' }, reason: 'Termometr səhv oxunub' }),
        correction({
          id: 'c2',
          itemId: f.note.id,
          kind: 'rework',
          round: 1,
          after: { text: 'Hamısı yoxlanıldı' },
          reason: 'Qeyd yazın',
          actor: { kind: 'user', name: 'Aysel Məmmədova' },
          at: '2026-11-02T12:00:00.000Z',
        }),
      ],
      reworkRequests: [reworkRequest({ items: [{ itemId: f.note.id, comment: 'Qeyd yazın' }], dueAt: '2026-11-02T14:00:00.000Z', resubmittedAt: '2026-11-02T12:00:00.000Z' })],
      diff: [
        { itemId: f.temp.id, original: { number: 10, note: 'isti' }, current: { number: 5, note: 'isti' } },
        { itemId: f.note.id, original: null, current: { text: 'Hamısı yoxlanıldı' } },
      ],
    });
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText('İlkin bal: 0% · Cari bal: 100%')).toBeInTheDocument();

    const diff = screen.getByRole('table');
    const [head, temp, note] = within(diff).getAllByRole('row');
    expect(within(head!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Bənd', az.corrections.original, az.corrections.current]);
    expect(within(temp!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Temperatur', '10 °C · Qeyd: isti', '5 °C · Qeyd: isti']);
    expect(within(note!).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Qeyd', 'Cavab yoxdur', 'Hamısı yoxlanıldı']);

    // The timeline's own entries, not the flagged items listed inside a send-back.
    const list = screen.getByRole('list', { name: 'Tarixçə' });
    const timeline = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(timeline.map((li) => li.dataset.kind)).toEqual(['correction', 'sentBack', 'resubmitted', 'correction']);
    expect(timeline[0]).toHaveTextContent(az.corrections.kinds.manual);
    expect(timeline[0]).toHaveTextContent('Leyla Quliyeva');
    expect(timeline[0]).toHaveTextContent('Temperatur: 10 °C · Qeyd: isti → 5 °C · Qeyd: isti');
    expect(timeline[0]).toHaveTextContent('Səbəb: Termometr səhv oxunub');
    expect(timeline[1]).toHaveTextContent('Leyla Quliyeva icranı düzəlişə qaytardı');
    expect(timeline[1]).toHaveTextContent('Qeyd — Qeyd yazın');
    expect(timeline[1]).toHaveTextContent('18:00');
    expect(timeline[2]).toHaveTextContent('İcraçı düzəlişləri təqdim etdi');
    expect(timeline[3]).toHaveTextContent(az.corrections.kinds.rework);
    expect(timeline[3]).toHaveTextContent('Şərh: Qeyd yazın');
  });

  it('names Taskop support when a platform admin sent the run back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail());
    mocks.api.corrections.history.mockResolvedValue({
      ...noCorrections(),
      reworkRequests: [reworkRequest({ requestedBy: null, items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] })],
    });
    renderWithProviders(<CorrectionsTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText(/Taskop dəstəyi icranı düzəlişə qaytardı/)).toBeInTheDocument();
    expect(screen.getByText(/Raund 1/)).toBeInTheDocument();
  });
});
```

`apps/web/src/features/audits/run-audit-tab.test.tsx`:

```tsx
import type { AuditBrief, OccurrenceStatus } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { meWith } from '@/features/reports/fixtures';
import { renderWithRouter } from '@/test/router';
import { AUDIT_IDS, auditDto } from './fixtures';
import { RunAuditTab } from './run-audit-tab';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { executions: { get: vi.fn() }, audits: { start: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const brief = (over: Partial<AuditBrief> = {}): AuditBrief => ({ id: AUDIT_IDS.audit, status: 'in_progress', result: null, percent: null, paused: false, ...over });
const renderTab = (status: OccurrenceStatus = 'completed') => renderWithRouter(<RunAuditTab occurrence={occurrenceDetail({ status, execution: summary() })} />);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.current = meWith(['audits.perform']);
});

describe('RunAuditTab', () => {
  it('starts an audit on a completed run and opens it', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: null }));
    mocks.api.audits.start.mockResolvedValue(auditDto());
    const router = renderTab();
    expect(await screen.findByText(az.audits.noAudit)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: az.audits.actions.start }));
    expect(mocks.api.audits.start).toHaveBeenCalledWith('x1');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/audits/${AUDIT_IDS.audit}`));
  });

  it('offers a new audit when the last one was cancelled', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief({ status: 'cancelled' }) }));
    renderTab('audit_pending');
    expect(await screen.findByRole('button', { name: az.audits.actions.start })).toBeInTheDocument();
  });

  it('shows a running audit, paused while the run is with the worker, and links to it', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief({ paused: true }) }));
    renderTab('correction_required');
    expect(await screen.findByText(az.audits.statuses.in_progress)).toBeInTheDocument();
    expect(screen.getByText(az.audits.paused)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: az.audits.actions.open })).toHaveAttribute('href', `/audits/${AUDIT_IDS.audit}`);
    expect(screen.queryByRole('button', { name: az.audits.actions.start })).not.toBeInTheDocument();
  });

  it('shows the result of a finished audit to a report viewer, who cannot start one', async () => {
    mocks.me.current = meWith(['reports.view']);
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief({ status: 'finished', result: 'failed', percent: 83.3 }) }));
    renderTab('audited');
    expect(await screen.findByText(az.audits.results.failed)).toBeInTheDocument();
    expect(screen.getByText(`${az.audits.score}: 83,3%`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: az.audits.actions.open })).toBeInTheDocument();
  });

  it('offers no audit on a partial run, and nothing to someone without audit or report access', async () => {
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ state: 'partial', audit: null }));
    renderTab('partial');
    expect(await screen.findByText(az.audits.noAudit)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.audits.actions.start })).not.toBeInTheDocument();
  });

  it('hides the audit link without audits.perform or reports.view', async () => {
    mocks.me.current = meWith(['assignments.view']);
    mocks.api.executions.get.mockResolvedValue(executionFixture().detail({ audit: brief() }));
    renderTab('audit_pending');
    expect(await screen.findByText(az.audits.statuses.in_progress)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: az.audits.actions.open })).not.toBeInTheDocument();
  });

  it('says so when the run was never started', () => {
    renderWithRouter(<RunAuditTab occurrence={occurrenceDetail({ status: 'pending' })} />);
    expect(screen.getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
  });
});
```

`apps/web/src/features/scheduling/occurrence-dialog.test.tsx`:

```tsx
import { az } from '@taskop/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { renderWithRouter } from '@/test/router';
import { OccurrenceDialog } from './occurrence-dialog';

const mocks = vi.hoisted(() => ({ api: { occurrences: { get: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => false, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.occurrences.get.mockResolvedValue(occurrenceDetail({ status: 'pending' }));
});

describe('OccurrenceDialog', () => {
  it('has the overview, execution, audit and corrections tabs and opens the one asked for', async () => {
    renderWithRouter(<OccurrenceDialog id="o1" onClose={vi.fn()} initialTab="corrections" />);
    const dialog = await screen.findByRole('dialog', { name: 'Açılış' });
    expect(within(dialog).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Ümumi', 'İcra', az.audits.audit, az.corrections.title]);
    expect(within(dialog).getByRole('tab', { name: az.corrections.title })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
  });
});
```

In `apps/web/src/features/scheduling/schedule-page.test.tsx`, replace:

```ts
    expect(scheduleSearch({ date: '2.11.2026', occurrence: 5, tab: 'audit' })).toEqual({});
```

with:

```ts
    expect(scheduleSearch({ date: '2.11.2026', occurrence: 5, tab: 'history' })).toEqual({});
    expect(scheduleSearch({ occurrence: 'o1', tab: 'audit' })).toEqual({ occurrence: 'o1', tab: 'audit' });
    expect(scheduleSearch({ occurrence: 'o1', tab: 'corrections' })).toEqual({ occurrence: 'o1', tab: 'corrections' });
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/corrections features/audits/run-audit-tab features/scheduling`
Expected: FAIL: `Failed to resolve import "./labels"`, `"./corrections-tab"` and `"./run-audit-tab"`; the dialog has two tabs; `scheduleSearch` drops `tab: 'audit'`.

- [ ] **Step 4: Implement the correction helpers and queries**

`apps/web/src/features/corrections/labels.ts`:

```ts
import type { Answer, Correction, ExecutionCorrections, Item, ReworkRequest, Score } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { answerValue, formatPercent } from '@/features/executions/labels';

/** One answer as a line for the diff and the timeline: the value, else the media counts, else "Cavab yoxdur"; then the note. */
export function answerSummary(t: TFunction, item: Item, a: Answer | null | undefined, formatDateTime: (iso: string) => string): string {
  const value = answerValue(t, item, a ?? undefined, formatDateTime);
  const photos = a?.photos?.length ?? 0;
  const videos = a?.videos?.length ?? 0;
  const main = value ?? (photos || videos ? t('corrections.web.media', { photos, videos }) : t('corrections.emptyAnswer'));
  const note = a?.note?.trim();
  return note ? `${main} · ${t('executions.note', { note })}` : main;
}

/** A run score (`executions.score`, or the original snapshot's) as text. */
export const scoreText = (t: TFunction, score: Score | null, locale: string): string =>
  score?.percent == null ? t('executions.noScore') : t('executions.percent', { value: formatPercent(score.percent, locale) });

export type TimelineEntry =
  | { kind: 'sentBack' | 'resubmitted' | 'withdrawn'; at: string; request: ReworkRequest }
  | { kind: 'correction'; at: string; correction: Correction };

/**
 * Every send-back, resubmit, withdrawal and changed item, oldest first (spec §8.3). On a tie the request events come
 * first, so a resubmit is listed before the changes it brought.
 */
export function correctionTimeline(c: ExecutionCorrections): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const r of c.reworkRequests) {
    entries.push({ kind: 'sentBack', at: r.requestedAt, request: r });
    if (r.resubmittedAt) entries.push({ kind: 'resubmitted', at: r.resubmittedAt, request: r });
    if (r.withdrawnAt) entries.push({ kind: 'withdrawn', at: r.withdrawnAt, request: r });
  }
  for (const x of c.corrections) entries.push({ kind: 'correction', at: x.at, correction: x });
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.i - b.i)
    .map(({ entry }) => entry);
}
```

`apps/web/src/features/corrections/queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

export const correctionKeys = {
  /** Invalidated with ['corrections'] by refreshRunViews. */
  history: (executionId: string) => ['corrections', executionId] as const,
};

/** GET /executions/:id/corrections: the original snapshot, the changes, the rework rounds and the diff. */
export const useCorrections = (executionId: string) => useQuery({ queryKey: correctionKeys.history(executionId), queryFn: () => api.corrections.history(executionId) });
```

- [ ] **Step 5: Implement the Corrections tab**

`apps/web/src/features/corrections/corrections-tab.tsx`:

```tsx
import { type Item, type OccurrenceDetail, walkItems } from '@taskop/contracts';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { actorName } from '@/features/audits/labels';
import { useExecution } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { answerSummary, correctionTimeline, scoreText, type TimelineEntry } from './labels';
import { useCorrections } from './queries';

/** The run dialog's "Düzəlişlər" tab (spec §8.3, NFR-07.05): original against current, then what happened when. */
export function CorrectionsTab({ occurrence }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  if (!occurrence.execution) return <p className="text-muted-foreground">{t('executions.notStarted')}</p>;
  return <RunCorrections executionId={occurrence.execution.id} />;
}

function RunCorrections({ executionId }: { executionId: string }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const formatDateTime = useFormatDateTime();
  const detail = useExecution(executionId);
  const history = useCorrections(executionId);
  const items = useMemo(() => {
    const map = new Map<string, Item>();
    if (detail.data) walkItems(detail.data.content, (item) => map.set(item.id, item));
    return map;
  }, [detail.data]);

  if (detail.isError || history.isError) return <p className="text-destructive">{errorText(t, detail.error ?? history.error)}</p>;
  if (!detail.data || !history.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  const c = history.data;
  const timeline = correctionTimeline(c);
  if (!c.original && timeline.length === 0) return <p className="text-muted-foreground">{t('corrections.noCorrections')}</p>;
  const label = (itemId: string) => items.get(itemId)?.label ?? t('executions.problemsPage.unknownItem');
  const summaryOf = (itemId: string, a: Parameters<typeof answerSummary>[2]) => {
    const item = items.get(itemId);
    return item ? answerSummary(t, item, a, formatDateTime) : '—';
  };

  return (
    <div className="grid gap-5">
      {c.original && (
        <p className="text-sm">
          {t('corrections.web.score.original', { value: scoreText(t, c.original.score, tenant.locale) })} ·{' '}
          {t('corrections.web.score.current', { value: scoreText(t, detail.data.score, tenant.locale) })}
        </p>
      )}
      {c.diff.length > 0 && (
        <section aria-labelledby="corrections-diff" className="grid gap-2">
          <h3 id="corrections-diff" className="font-medium">
            {t('corrections.web.diff.title')}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('corrections.web.diff.item')}</TableHead>
                <TableHead>{t('corrections.original')}</TableHead>
                <TableHead>{t('corrections.current')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.diff.map((d) => (
                <TableRow key={d.itemId}>
                  <TableCell className="font-medium">{label(d.itemId)}</TableCell>
                  <TableCell>{summaryOf(d.itemId, d.original)}</TableCell>
                  <TableCell>{summaryOf(d.itemId, d.current)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {c.original && <p className="text-muted-foreground text-xs">{t('corrections.web.diff.capturedAt', { time: formatDateTime(c.original.capturedAt) })}</p>}
        </section>
      )}
      {timeline.length > 0 && (
        <section className="grid gap-2">
          <h3 id="corrections-timeline" className="font-medium">
            {t('corrections.web.timeline.title')}
          </h3>
          <ol aria-labelledby="corrections-timeline" className="grid gap-2">
            {timeline.map((entry, i) => (
              <TimelineRow key={i} entry={entry} label={label} summaryOf={summaryOf} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function TimelineRow({
  entry,
  label,
  summaryOf,
}: {
  entry: TimelineEntry;
  label: (itemId: string) => string;
  summaryOf: (itemId: string, a: Parameters<typeof answerSummary>[2]) => string;
}) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const when = <span className="text-muted-foreground">{formatDateTime(entry.at)}</span>;

  if (entry.kind === 'correction') {
    const x = entry.correction;
    return (
      <li data-kind={entry.kind} className="grid gap-0.5 rounded-md border p-2 text-sm">
        <p>
          {when} · {t(`corrections.kinds.${x.kind}`)} · {actorName(t, x.actor)}
        </p>
        <p>{`${label(x.itemId)}: ${summaryOf(x.itemId, x.before)} → ${summaryOf(x.itemId, x.after)}`}</p>
        <p className="text-muted-foreground">
          {x.kind === 'manual' ? t('corrections.web.timeline.reason', { reason: x.reason }) : t('corrections.web.timeline.comment', { comment: x.reason })}
        </p>
      </li>
    );
  }

  const r = entry.request;
  const round = t('corrections.round', { round: r.round });
  return (
    <li data-kind={entry.kind} className="grid gap-0.5 rounded-md border p-2 text-sm">
      <p>
        {when} ·{' '}
        {entry.kind === 'sentBack'
          ? t('corrections.web.timeline.sentBack', { name: r.requestedBy?.fullName ?? t('scheduling.schedule.actorPlatform') })
          : entry.kind === 'resubmitted'
            ? t('corrections.web.timeline.resubmitted')
            : t('corrections.web.timeline.withdrawn', { name: r.withdrawnBy?.fullName ?? '—' })}{' '}
        · {round}
      </p>
      {entry.kind === 'sentBack' && (
        <>
          {r.dueAt && <p className="text-muted-foreground">{t('corrections.dueAt', { date: formatDateTime(r.dueAt) })}</p>}
          <ul className="list-disc pl-5">
            {r.items.map((i) => (
              <li key={i.itemId}>{`${label(i.itemId)} — ${i.comment}`}</li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}
```

Each timeline entry carries `data-kind`, so tests can tell the entry types apart without reading their text.

- [ ] **Step 6: Implement the Audit tab**

`apps/web/src/features/audits/run-audit-tab.tsx`:

```tsx
import { canStartAudit, type OccurrenceDetail } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatPercent } from '@/features/executions/labels';
import { useExecution } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { useCan, useMe } from '@/lib/session';
import { cn } from '@/lib/utils';
import { resultVariant } from './labels';
import { useStartAudit } from './queries';

/** The run dialog's "Audit" tab (spec §8.3): the run's audit and a link to it, or "Start audit" when the rules allow. */
export function RunAuditTab({ occurrence }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  if (!occurrence.execution) return <p className="text-muted-foreground">{t('executions.notStarted')}</p>;
  return <RunAudit occurrence={occurrence} executionId={occurrence.execution.id} />;
}

function RunAudit({ occurrence, executionId }: { occurrence: OccurrenceDetail; executionId: string }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const canPerform = useCan('audits.perform');
  const canView = useCan('reports.view');
  const detail = useExecution(executionId);
  const start = useStartAudit();
  if (detail.isError) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  if (!detail.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  const d = detail.data;
  // A cancelled audit no longer counts (Part 1 "What the UI may offer").
  const audit = d.audit && d.audit.status !== 'cancelled' ? d.audit : null;

  if (!audit) {
    const startable = canPerform && canStartAudit({ status: occurrence.status, executionState: d.state }, false);
    return (
      <div className="grid gap-3">
        <p className="text-muted-foreground">{t('audits.noAudit')}</p>
        {startable && (
          <Button className="w-fit" disabled={start.isPending} onClick={() => start.mutate(executionId, { onError: (e) => toast.error(errorText(t, e)) })}>
            {t('audits.actions.start')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t(`audits.statuses.${audit.status}`)}</Badge>
        {audit.result && <Badge variant={resultVariant(audit.result)}>{t(`audits.results.${audit.result}`)}</Badge>}
        {audit.percent !== null && (
          <span className="text-sm">
            {t('audits.score')}: {t('executions.percent', { value: formatPercent(audit.percent, tenant.locale) })}
          </span>
        )}
      </div>
      {audit.paused && (
        <Alert>
          <AlertDescription>{t('audits.paused')}</AlertDescription>
        </Alert>
      )}
      {(canPerform || canView) && (
        <Link to="/audits/$auditId" params={{ auditId: audit.id }} className={cn(buttonVariants({ variant: 'outline' }), 'w-fit')}>
          {t('audits.actions.open')}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Add the tabs to the run dialog and the schedule URL**

In `apps/web/src/features/scheduling/occurrence-dialog.tsx`:
- add the imports:

```ts
import { RunAuditTab } from '@/features/audits/run-audit-tab';
import { CorrectionsTab } from '@/features/corrections/corrections-tab';
```

- replace `export type OccurrenceTab = 'overview' | 'execution';` with:

```ts
/** The run dialog's tabs, in order (decision 14). */
export const OCCURRENCE_TABS = ['overview', 'execution', 'audit', 'corrections'] as const;
export type OccurrenceTab = (typeof OCCURRENCE_TABS)[number];
```

- after `<TabsTrigger value="execution">{t('executions.tabs.execution')}</TabsTrigger>`, add:

```tsx
              <TabsTrigger value="audit">{t('audits.audit')}</TabsTrigger>
              <TabsTrigger value="corrections">{t('corrections.title')}</TabsTrigger>
```

- after the closing `</TabsContent>` of the `execution` tab, add:

```tsx
            <TabsContent value="audit">
              <RunAuditTab occurrence={o} />
            </TabsContent>
            <TabsContent value="corrections">
              <CorrectionsTab occurrence={o} />
            </TabsContent>
```

In `apps/web/src/features/scheduling/routes.tsx`, change the import `import type { OccurrenceTab } from './occurrence-dialog';` to:

```ts
import { OCCURRENCE_TABS, type OccurrenceTab } from './occurrence-dialog';
```

and in `scheduleSearch` replace the `tab` line:

```ts
  ...(s.tab === 'overview' || s.tab === 'execution' ? { tab: s.tab } : {}),
```

with:

```ts
  ...((OCCURRENCE_TABS as readonly unknown[]).includes(s.tab) ? { tab: s.tab as OccurrenceTab } : {}),
```

Also update its doc comment's example to `/schedule?date=YYYY-MM-DD&occurrence=<id>&tab=execution|audit|corrections`.

- [ ] **Step 8: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/corrections features/audits features/scheduling features/reports && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. The report drawers' tests still find "İcra" selected; the new tabs mount only when opened.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/features/audits/run-audit-tab.tsx apps/web/src/features/audits/run-audit-tab.test.tsx apps/web/src/features/corrections/labels.ts apps/web/src/features/corrections/labels.test.ts apps/web/src/features/corrections/queries.ts apps/web/src/features/corrections/fixtures.ts apps/web/src/features/corrections/corrections-tab.tsx apps/web/src/features/corrections/corrections-tab.test.tsx apps/web/src/features/scheduling/occurrence-dialog.tsx apps/web/src/features/scheduling/occurrence-dialog.test.tsx apps/web/src/features/scheduling/routes.tsx apps/web/src/features/scheduling/schedule-page.test.tsx
git commit -m "feat(web): add the Audit and Corrections tabs to the run dialog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Values-only answer editors

**Files:**
- Create: `apps/web/src/features/corrections/answer-editor.tsx`
- Modify: `apps/web/src/features/corrections/labels.ts`
- Test: `apps/web/src/features/corrections/answer-editor.test.tsx`, `apps/web/src/features/corrections/labels.test.ts`

**Interfaces:**
- Consumes:
  - Existing: `tzOffsetMinutes`, `zonedTimeToUtc`, `EXECUTION_LIMITS`, types `Answer`, `Answers`, `Item`, `newItem`, `DateTimeItem`, `MultiChoiceItem`, `NumberItem`; `optionLabel` (`features/checklists/labels`).
  - Part 1: `changedItemIds`, `type CorrectAnswersInput`.
- Produces (used by Tasks 9 and 10):
  - in `features/corrections/labels.ts`:
    - `isoToLocalInput(iso: string, tz: string): string` gives `YYYY-MM-DDTHH:mm` on the tenant's clock, or `''`;
    - `localInputToIso(value: string, tz: string): string | null`;
    - `pruneAnswer(a: Answer): Answer | undefined` drops `undefined`, `''` and `[]` fields, and gives `undefined` when nothing is left;
    - `correctionAnswer(a: Answer | undefined): CorrectionChange['answer']` is the answer without `problem`, or `null`;
    - `type CorrectionChange = CorrectAnswersInput['changes'][number]`;
    - `correctionChanges(before: Answers, after: Answers): CorrectionChange[]`.
  - `AnswerEditor({ item, answer, onChange: (next: Answer | undefined) => void })`. Its controls:
    - choices are a `radiogroup` (or a `group` for multi-choice) named by the item's label;
    - number, text and comment are a `spinbutton` or `textbox` named by the label;
    - date/time is an input named by the label;
    - the note is a `textbox` named "<label> — qeyd";
    - "Cavabı sil" clears the value and keeps the note;
    - photo and video items only say they cannot be changed.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/features/corrections/labels.test.ts`. First, add `correctionAnswer, correctionChanges, isoToLocalInput, localInputToIso, pruneAnswer,` to its `./labels` import. Then add:

```ts
describe('tenant clock for date-time answers', () => {
  it('shows an instant on the tenant clock and reads a typed one back', () => {
    expect(isoToLocalInput('2026-11-02T05:30:00.000Z', 'Asia/Baku')).toBe('2026-11-02T09:30');
    expect(isoToLocalInput('2026-11-02T22:15:00.000Z', 'Asia/Baku')).toBe('2026-11-03T02:15');
    expect(isoToLocalInput('not a date', 'Asia/Baku')).toBe('');
    expect(localInputToIso('2026-11-02T09:30', 'Asia/Baku')).toBe('2026-11-02T05:30:00.000Z');
    expect(localInputToIso('2026-11-02', 'Asia/Baku')).toBeNull();
    expect(localInputToIso('', 'Asia/Baku')).toBeNull();
  });
});

describe('the correction payload', () => {
  it('drops empty fields and an empty answer', () => {
    expect(pruneAnswer({ optionIds: [], text: '', number: 4, note: undefined })).toEqual({ number: 4 });
    expect(pruneAnswer({ optionIds: [], text: '' })).toBeUndefined();
  });

  it('sends each changed item once, without the manual problem, and null for a cleared answer', () => {
    const problem = { severity: 'critical' as const, note: 'Kondisioner xarabdır', mediaIds: [] };
    const before = { a: { number: 10, note: 'isti', problem }, b: { text: 'Su axır' }, c: { optionIds: ['o1'] } };
    const after = { a: { number: 5, note: 'isti', problem }, b: undefined, c: { optionIds: ['o1'] } };
    expect(correctionAnswer(after.a)).toEqual({ number: 5, note: 'isti' });
    expect(correctionAnswer({ problem })).toBeNull();
    expect(correctionAnswer(undefined)).toBeNull();
    expect(correctionChanges(before, after)).toEqual([
      { itemId: 'a', answer: { number: 5, note: 'isti' } },
      { itemId: 'b', answer: null },
    ]);
  });
});
```

`apps/web/src/features/corrections/answer-editor.test.tsx`:

```tsx
import { type Answer, type DateTimeItem, type Item, type MultiChoiceItem, newItem } from '@taskop/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { executionFixture } from '@/features/executions/fixtures';
import { AnswerEditor } from './answer-editor';

vi.mock('@/lib/session', () => ({ useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

function Harness({ item, initial, onAnswer = () => undefined }: { item: Item; initial?: Answer; onAnswer?: (a: Answer | undefined) => void }) {
  const [answer, setAnswer] = useState<Answer | undefined>(initial);
  return (
    <AnswerEditor
      item={item}
      answer={answer}
      onChange={(next) => {
        setAnswer(next);
        onAnswer(next);
      }}
    />
  );
}

describe('AnswerEditor', () => {
  it('changes a yes/no answer and keeps the note and the manual problem untouched', async () => {
    const f = executionFixture();
    const onAnswer = vi.fn();
    const problem = { severity: 'critical' as const, note: 'Sızma', mediaIds: [] };
    render(<Harness item={f.problem} initial={{ optionIds: [f.yes.id], note: 'Sınıq', problem }} onAnswer={onAnswer} />);
    const group = screen.getByRole('radiogroup', { name: 'Problem varmı?' });
    expect(screen.getByRole('radio', { name: 'Bəli' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Xeyr' }));
    expect(group).toBeInTheDocument();
    expect(onAnswer).toHaveBeenLastCalledWith({ optionIds: [f.no.id], note: 'Sınıq', problem });
  });

  it('ticks and unticks a multi-choice option', async () => {
    const item = newItem('multi_choice') as MultiChoiceItem;
    item.label = 'Hansı otaqlar?';
    item.options = [
      { id: 'o1', label: 'Zal' },
      { id: 'o2', label: 'Anbar' },
    ];
    const onAnswer = vi.fn();
    render(<Harness item={item} initial={{ optionIds: ['o1'] }} onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Anbar' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ optionIds: ['o1', 'o2'] });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Zal' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ optionIds: ['o2'] });
  });

  it('edits a number with its unit, then clears the value but not the note', async () => {
    const f = executionFixture();
    const onAnswer = vi.fn();
    render(<Harness item={f.temp} initial={{ number: 10, note: 'isti' }} onAnswer={onAnswer} />);
    expect(screen.getByText('°C')).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: 'Temperatur' });
    await userEvent.clear(input);
    await userEvent.type(input, '5');
    expect(onAnswer).toHaveBeenLastCalledWith({ number: 5, note: 'isti' });
    await userEvent.click(screen.getByRole('button', { name: 'Cavabı sil' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ note: 'isti' });
    expect(input).toHaveValue(null);
    expect(screen.queryByRole('button', { name: 'Cavabı sil' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Temperatur — qeyd' }));
    expect(onAnswer).toHaveBeenLastCalledWith(undefined);
  });

  it('reads and writes a date-time answer on the tenant clock, and a date as it is', () => {
    const at = newItem('datetime') as DateTimeItem;
    at.label = 'Yoxlama vaxtı';
    const onAnswer = vi.fn();
    render(<Harness item={at} initial={{ datetime: '2026-11-02T05:30:00.000Z' }} onAnswer={onAnswer} />);
    const input = screen.getByLabelText('Yoxlama vaxtı');
    expect(input).toHaveValue('2026-11-02T09:30');
    fireEvent.change(input, { target: { value: '2026-11-02T18:45' } });
    expect(onAnswer).toHaveBeenLastCalledWith({ datetime: '2026-11-02T14:45:00.000Z' });

    const day = newItem('datetime') as DateTimeItem;
    day.label = 'Tarix';
    day.mode = 'date';
    const onDay = vi.fn();
    render(<Harness item={day} initial={{ datetime: '2026-11-02' }} onAnswer={onDay} />);
    fireEvent.change(screen.getByLabelText('Tarix'), { target: { value: '2026-11-03' } });
    expect(onDay).toHaveBeenLastCalledWith({ datetime: '2026-11-03' });
  });

  it('offers no value editor for photo and video items, only the note', async () => {
    const f = executionFixture();
    const onAnswer = vi.fn();
    render(<Harness item={f.photo} initial={{ photos: ['m1'] }} onAnswer={onAnswer} />);
    expect(screen.getByText('Foto və videolar düzəliş zamanı dəyişdirilmir.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cavabı sil' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Ümumi görünüş — qeyd' }), 'Bulanıq');
    expect(onAnswer).toHaveBeenLastCalledWith({ photos: ['m1'], note: 'Bulanıq' });
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/corrections`
Expected: FAIL: `isoToLocalInput` (and the other new helpers) are not exported; `Failed to resolve import "./answer-editor"`.

- [ ] **Step 3: Add the helpers**

In `apps/web/src/features/corrections/labels.ts`, replace the `@taskop/contracts` import with:

```ts
import {
  type Answer,
  type Answers,
  changedItemIds,
  type CorrectAnswersInput,
  type Correction,
  type ExecutionCorrections,
  type Item,
  type ReworkRequest,
  type Score,
  tzOffsetMinutes,
  zonedTimeToUtc,
} from '@taskop/contracts';
```

and append:

```ts
/** An instant as a `datetime-local` value on the tenant's clock (Global Constraints), or '' when unreadable. */
export function isoToLocalInput(iso: string, tz: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + tzOffsetMinutes(tz, ms) * 60_000).toISOString().slice(0, 16);
}

/** A `datetime-local` value read on the tenant's clock, as an ISO instant; null for anything else. */
export function localInputToIso(value: string, tz: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return zonedTimeToUtc(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz).toISOString();
}

/** An answer without its empty fields; undefined when nothing is left (the item is then unanswered). */
export function pruneAnswer(a: Answer): Answer | undefined {
  const kept = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  return Object.keys(kept).length > 0 ? (kept as Answer) : undefined;
}

export type CorrectionChange = CorrectAnswersInput['changes'][number];

/** What a correction sends for one item (Part 1 decision 2): the answer without the manual problem, or null to clear it. */
export function correctionAnswer(a: Answer | undefined): CorrectionChange['answer'] {
  if (!a) return null;
  const { problem: _problem, ...values } = a;
  return pruneAnswer(values) ?? null;
}

/** One change per item whose answer differs (Part 1's `changedItemIds`), in its order. */
export const correctionChanges = (before: Answers, after: Answers): CorrectionChange[] =>
  changedItemIds(before, after).map((itemId) => ({ itemId, answer: correctionAnswer(after[itemId]) }));
```

- [ ] **Step 4: Implement the editor**

`apps/web/src/features/corrections/answer-editor.tsx`:

```tsx
import { type Answer, EXECUTION_LIMITS, type Item } from '@taskop/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { optionLabel } from '@/features/checklists/labels';
import { useMe } from '@/lib/session';
import { isoToLocalInput, localInputToIso, pruneAnswer } from './labels';

const VALUE_FIELDS = ['optionIds', 'number', 'text', 'datetime'] as const;

/**
 * One item's values-only editor for a manager's correction (spec §1): choices, number, text, comment, date/time and the
 * note. Photos and videos stay as captured and the manual problem passes through untouched (decision 11).
 */
export function AnswerEditor({ item, answer, onChange }: { item: Item; answer: Answer | undefined; onChange: (next: Answer | undefined) => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const name = useId();
  const patch = (p: Partial<Answer>) => onChange(pruneAnswer({ ...answer, ...p }));
  const media = item.type === 'photo' || item.type === 'video';
  const hasValue = VALUE_FIELDS.some((f) => answer?.[f] !== undefined);

  return (
    <div className="grid gap-2">
      {'options' in item &&
        (item.type === 'multi_choice' ? (
          <div role="group" aria-label={item.label} className="flex flex-wrap gap-3">
            {item.options.map((o, i) => {
              const checked = answer?.optionIds?.includes(o.id) ?? false;
              return (
                <label key={o.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => patch({ optionIds: checked ? (answer?.optionIds ?? []).filter((x) => x !== o.id) : [...(answer?.optionIds ?? []), o.id] })}
                  />
                  {optionLabel(t, item, o, i)}
                </label>
              );
            })}
          </div>
        ) : (
          <div role="radiogroup" aria-label={item.label} className="flex flex-wrap gap-3">
            {item.options.map((o, i) => (
              <label key={o.id} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name={name} checked={answer?.optionIds?.[0] === o.id} onChange={() => patch({ optionIds: [o.id] })} />
                {optionLabel(t, item, o, i)}
              </label>
            ))}
          </div>
        ))}
      {item.type === 'number' && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={item.label}
            type="number"
            className="w-40"
            min={item.min ?? undefined}
            max={item.max ?? undefined}
            step={item.decimals > 0 ? 10 ** -item.decimals : 1}
            value={answer?.number ?? ''}
            onChange={(e) => patch({ number: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          {item.unit && <span className="text-sm">{item.unit}</span>}
        </div>
      )}
      {item.type === 'text' && <Input aria-label={item.label} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => patch({ text: e.target.value })} />}
      {item.type === 'comment' && <Textarea aria-label={item.label} maxLength={item.maxLength} value={answer?.text ?? ''} onChange={(e) => patch({ text: e.target.value })} />}
      {item.type === 'datetime' &&
        (item.mode === 'datetime' ? (
          <Input
            aria-label={item.label}
            type="datetime-local"
            className="w-56"
            value={answer?.datetime ? isoToLocalInput(answer.datetime, tenant.timezone) : ''}
            onChange={(e) => patch({ datetime: localInputToIso(e.target.value, tenant.timezone) ?? undefined })}
          />
        ) : (
          <Input aria-label={item.label} type={item.mode} className="w-44" value={answer?.datetime ?? ''} onChange={(e) => patch({ datetime: e.target.value })} />
        ))}
      {media && <p className="text-muted-foreground text-sm">{t('corrections.web.edit.mediaLocked')}</p>}
      {!media && hasValue && (
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => patch({ optionIds: undefined, number: undefined, text: undefined, datetime: undefined })}>
          {t('corrections.web.edit.clear')}
        </Button>
      )}
      <Textarea
        aria-label={t('corrections.web.edit.note', { item: item.label })}
        maxLength={EXECUTION_LIMITS.answerNote}
        value={answer?.note ?? ''}
        onChange={(e) => patch({ note: e.target.value })}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/corrections && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/corrections/answer-editor.tsx apps/web/src/features/corrections/answer-editor.test.tsx apps/web/src/features/corrections/labels.ts apps/web/src/features/corrections/labels.test.ts
git commit -m "feat(web): add values-only answer editors for corrections" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: "Correct answers" in the execution tab

**Files:**
- Create: `apps/web/src/features/corrections/correct-answers.tsx`, `apps/web/src/features/corrections/run-actions.tsx`
- Modify: `apps/web/src/features/executions/execution-tab.tsx`, `apps/web/src/features/executions/execution-tab.test.tsx`
- Test: `apps/web/src/features/corrections/correct-answers.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.corrections.correct`, `canCorrect`, `AUDIT_LIMITS.reason` (1–1000), `ApiError.missing`. Existing: `requirements`, `visibleItems`, `type Missing`.
  - Part 1 strings: `az.corrections.{actions.correct, corrected, fields.reason}`, `az.errors.EXECUTION_LOCKED`.
  - Task 2: `refreshRunViews`, `apiError`. Task 8: `AnswerEditor`, `correctionChanges`.
  - Existing: `checklists.builder.preview.missingKinds.*`, `ConfirmButton`, `FormError`.
- Produces:
  - `CorrectAnswers({ detail, conflict, onConflict, onDone })`: the edit mode, a `region` named by `az.corrections.actions.correct`. `ReasonDialog` is local to it.
  - `RunActions({ status, detail, onCorrect })`: here only "Correct answers"; Task 10 adds Send back and Withdraw.
  - `ExecutionTab`'s counted execution gains the `RunActions` row, the edit mode (keyed by `answersRev`), and the "Düzəliş edilib" badge.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/corrections/correct-answers.test.tsx`:

```tsx
import type { ExecutionDetail, OccurrenceStatus } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/features/audits/fixtures';
import { ExecutionTab } from '@/features/executions/execution-tab';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  api: { executions: { get: vi.fn() }, media: { url: vi.fn() }, corrections: { correct: vi.fn(), sendBack: vi.fn(), withdraw: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
  useCan: (...keys: string[]) => keys.every((k) => mocks.permissions.current.includes(k)),
}));

const CORRECT = az.corrections.actions.correct;
const renderTab = (status: OccurrenceStatus = 'completed', detail?: Partial<ExecutionDetail>) => {
  const f = executionFixture();
  mocks.api.executions.get.mockResolvedValue(f.detail(detail));
  renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status, execution: summary() })} />);
  return f;
};
const editor = () => screen.getByRole('region', { name: CORRECT });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.permissions.current = ['executions.correct'];
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('Correct answers', () => {
  it('is offered to executions.correct holders on a completed or audit-pending run only', async () => {
    renderTab('audit_pending');
    expect(await screen.findByRole('button', { name: CORRECT })).toBeInTheDocument();
  });

  it.each([
    ['audited', 'completed'],
    ['partial', 'partial'],
    ['correction_required', 'rework'],
  ] as const)('is not offered on a %s run', async (status, state) => {
    renderTab(status, { state });
    await screen.findByRole('region', { name: 'Zal' });
    expect(screen.queryByRole('button', { name: CORRECT })).not.toBeInTheDocument();
  });

  it('is not offered without executions.correct', async () => {
    mocks.permissions.current = [];
    renderTab();
    await screen.findByRole('region', { name: 'Zal' });
    expect(screen.queryByRole('button', { name: CORRECT })).not.toBeInTheDocument();
  });

  it('saves the changed items with a reason and the revision it started from', async () => {
    mocks.api.corrections.correct.mockResolvedValue({ executionId: 'x1', answersRev: 5, changedItemIds: [], score: null });
    const f = renderTab();
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    const save = within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' });
    expect(save).toBeDisabled();
    expect(editor()).toHaveTextContent('Hələ heç nə dəyişdirilməyib.');
    const temp = within(editor()).getByRole('spinbutton', { name: 'Temperatur' });
    await userEvent.clear(temp);
    await userEvent.type(temp, '5');
    expect(within(editor()).getByRole('listitem', { name: 'Temperatur' })).toHaveAttribute('data-changed', 'true');
    expect(editor()).toHaveTextContent('1 bənd dəyişdirilib');
    await userEvent.click(save);
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    const confirm = within(dialog).getByRole('button', { name: 'Təsdiqlə' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Termometr səhv oxunub');
    await userEvent.click(confirm);
    expect(mocks.api.corrections.correct).toHaveBeenCalledWith('x1', {
      answersRev: 4,
      changes: [{ itemId: f.temp.id, answer: { number: 5, note: 'isti' } }],
      reason: 'Termometr səhv oxunub',
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: CORRECT })).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.api.executions.get).toHaveBeenCalledTimes(2));
  });

  it('checks the requirements before asking for a reason', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.clear(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }));
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editor()).toHaveTextContent('Bu düzəlişlə tələb olunan sahələr boş qalır.');
    expect(within(editor()).getByRole('listitem', { name: 'Təsvir edin' })).toHaveTextContent('Cavab tələb olunur');
    // A changed choice can reveal or hide a follow-up: "Xeyr" hides the description, so nothing is missing any more.
    await userEvent.click(within(editor()).getByRole('radio', { name: 'Xeyr' }));
    expect(within(editor()).queryByRole('listitem', { name: 'Təsvir edin' })).not.toBeInTheDocument();
    expect(editor()).not.toHaveTextContent('Bu düzəlişlə tələb olunan sahələr boş qalır.');
  });

  it('reloads the run and starts over when another manager corrected it first', async () => {
    const f = executionFixture();
    mocks.api.executions.get
      .mockResolvedValueOnce(f.detail())
      .mockResolvedValue(f.detail({ answersRev: 5, answers: { ...f.answers, [f.temp.id]: { number: 7, note: 'isti' } } }));
    mocks.api.corrections.correct.mockRejectedValue(apiError(409, 'ANSWERS_CONFLICT'));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'completed', execution: summary() })} />);
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    const temp = within(editor()).getByRole('spinbutton', { name: 'Temperatur' });
    await userEvent.clear(temp);
    await userEvent.type(temp, '5');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Termometr səhv oxunub');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    expect(await screen.findByText('İcra bu vaxt başqa yerdə dəyişdirilib. Ən son cavablar yükləndi — düzəlişləri yenidən edin.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(within(editor()).getByRole('spinbutton', { name: 'Temperatur' })).toHaveValue(7));
    expect(editor()).toHaveTextContent('Hələ heç nə dəyişdirilməyib.');
  });

  it('shows what the server still misses', async () => {
    const f = renderTab();
    mocks.api.corrections.correct.mockRejectedValue(apiError(422, 'REQUIREMENTS_UNMET', { missing: [{ itemId: f.note.id, kind: 'answer' }] }));
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.type(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }), ', çox');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Təfərrüat');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(editor()).getByRole('listitem', { name: 'Qeyd' })).toHaveTextContent('Cavab tələb olunur');
  });

  it('keeps the reason dialog open with any other refusal', async () => {
    renderTab();
    mocks.api.corrections.correct.mockRejectedValue(apiError(409, 'EXECUTION_LOCKED'));
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.type(within(editor()).getByRole('textbox', { name: 'Təsvir edin' }), '!');
    await userEvent.click(within(editor()).getByRole('button', { name: 'Düzəlişləri yadda saxla' }));
    const dialog = await screen.findByRole('dialog', { name: 'Düzəlişin səbəbi' });
    await userEvent.type(within(dialog).getByLabelText(az.corrections.fields.reason), 'Səbəb');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Təsdiqlə' }));
    expect(await within(dialog).findByText(az.errors.EXECUTION_LOCKED)).toBeInTheDocument();
  });

  it('leaves the edit without saving', async () => {
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: CORRECT }));
    await userEvent.click(within(editor()).getByRole('button', { name: 'İmtina et' }));
    expect(screen.queryByRole('region', { name: CORRECT })).not.toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Temperatur' })).toHaveTextContent('10 °C');
    expect(mocks.api.corrections.correct).not.toHaveBeenCalled();
  });

  it('marks a corrected run beside its state', async () => {
    renderTab('completed', { corrected: true });
    expect(await screen.findByText(az.corrections.corrected)).toBeInTheDocument();
  });
});
```

In `apps/web/src/features/executions/execution-tab.test.tsx`, replace the mock lines:

```ts
const mocks = vi.hoisted(() => ({ api: { executions: { get: vi.fn() }, media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));
```

with:

```ts
const mocks = vi.hoisted(() => ({ api: { executions: { get: vi.fn() }, media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }), useCan: () => false }));
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/corrections/correct-answers features/executions/execution-tab`
Expected: FAIL: no button named `az.corrections.actions.correct`.

- [ ] **Step 3: Implement the edit mode**

`apps/web/src/features/corrections/correct-answers.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { type Answer, type Answers, AUDIT_LIMITS, type ExecutionDetail, type Missing, requirements, visibleItems } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { cn } from '@/lib/utils';
import { AnswerEditor } from './answer-editor';
import { correctionChanges } from './labels';

/**
 * "Cavabları düzəlt" (spec §8.3, decision 11): the run's visible items with values-only editors, then a reason. The
 * caller keys it by `answersRev`, so a reload after ANSWERS_CONFLICT starts over from the newest answers.
 */
export function CorrectAnswers({ detail, conflict, onConflict, onDone }: { detail: ExecutionDetail; conflict: boolean; onConflict: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Answers>(detail.answers);
  const [checked, setChecked] = useState(false);
  const [serverMissing, setServerMissing] = useState<Missing[] | null>(null);
  const [asking, setAsking] = useState(false);
  const visible = useMemo(() => visibleItems(detail.content, draft), [detail.content, draft]);
  const changes = useMemo(() => correctionChanges(detail.answers, draft), [detail.answers, draft]);
  const clientMissing = useMemo(() => requirements(detail.content, draft), [detail.content, draft]);
  const missing = serverMissing ?? (checked ? clientMissing : []);
  const changed = new Set(changes.map((c) => c.itemId));

  const save = useMutation({
    mutationFn: (reason: string) => api.corrections.correct(detail.id, { answersRev: detail.answersRev, changes, reason }),
    onSuccess: () => {
      toast.success(t('corrections.web.edit.saved'));
      setAsking(false);
      onDone();
      void refreshRunViews(qc);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ANSWERS_CONFLICT') {
        setAsking(false);
        onConflict();
        void qc.invalidateQueries({ queryKey: ['executions', 'detail', detail.id] });
      } else if (e instanceof ApiError && e.code === 'REQUIREMENTS_UNMET') {
        setAsking(false);
        setServerMissing(e.missing ?? []);
      }
    },
  });
  const otherError = save.error && !(save.error instanceof ApiError && ['ANSWERS_CONFLICT', 'REQUIREMENTS_UNMET'].includes(save.error.code)) ? errorText(t, save.error) : null;

  const set = (itemId: string, next: Answer | undefined) => {
    setServerMissing(null);
    setDraft((d) => ({ ...d, [itemId]: next }));
  };
  const trySave = () => {
    setChecked(true);
    setServerMissing(null);
    if (clientMissing.length === 0) setAsking(true);
  };

  return (
    <section aria-label={t('corrections.actions.correct')} className="grid gap-3">
      <Alert>
        <AlertDescription>{t('corrections.web.edit.banner')}</AlertDescription>
      </Alert>
      {conflict && (
        <Alert variant="destructive">
          <AlertDescription>{t('corrections.web.edit.conflict')}</AlertDescription>
        </Alert>
      )}
      {missing.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{t('corrections.web.edit.requirements')}</AlertDescription>
        </Alert>
      )}
      {detail.content.sections.map((s) => {
        const rows = visible.filter((v) => v.sectionId === s.id);
        if (rows.length === 0) return null;
        return (
          <section key={s.id} aria-label={s.title} className="grid gap-2">
            <h4 className="font-semibold">{s.title}</h4>
            <ol className="grid gap-2">
              {rows.map((v) => (
                <li
                  key={v.item.id}
                  aria-label={v.item.label}
                  data-changed={changed.has(v.item.id) ? 'true' : undefined}
                  style={{ marginLeft: v.depth * 16 }}
                  className={cn('grid gap-1.5 rounded-md border p-2', changed.has(v.item.id) && 'border-primary bg-primary/5')}
                >
                  <span className="font-medium">{v.item.label}</span>
                  <AnswerEditor item={v.item} answer={draft[v.item.id]} onChange={(next) => set(v.item.id, next)} />
                  {missing
                    .filter((m) => m.itemId === v.item.id)
                    .map((m) => (
                      <p key={m.kind} className="text-destructive text-xs">
                        {t(`checklists.builder.preview.missingKinds.${m.kind}`)}
                      </p>
                    ))}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-muted-foreground mr-auto text-sm">
          {changes.length > 0 ? t('corrections.web.edit.changed', { count: changes.length }) : t('corrections.web.edit.noChanges')}
        </span>
        <Button variant="outline" onClick={onDone}>
          {t('corrections.web.edit.discard')}
        </Button>
        <Button disabled={changes.length === 0} onClick={trySave}>
          {t('corrections.web.edit.save')}
        </Button>
      </div>
      {asking && <ReasonDialog busy={save.isPending} error={otherError} onSubmit={(reason) => save.mutate(reason)} onClose={() => setAsking(false)} />}
    </section>
  );
}

function ReasonDialog({ busy, error, onSubmit, onClose }: { busy: boolean; error: string | null; onSubmit: (reason: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('corrections.web.edit.reasonTitle')}</DialogTitle>
          <DialogDescription>{t('corrections.web.edit.reasonHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="correction-reason">{t('corrections.fields.reason')}</Label>
          <Textarea id="correction-reason" maxLength={AUDIT_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!reason.trim() || busy} onClick={() => onSubmit(reason.trim())}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement the action row**

`apps/web/src/features/corrections/run-actions.tsx`:

```tsx
import { canCorrect, type ExecutionDetail, type OccurrenceStatus } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session';

/** The run's correction actions for executions.correct holders, only where Part 1's rules allow them. */
export function RunActions({ status, detail, onCorrect }: { status: OccurrenceStatus; detail: ExecutionDetail; onCorrect: () => void }) {
  const { t } = useTranslation();
  const can = useCan('executions.correct');
  if (!can || !canCorrect({ status, executionState: detail.state })) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={onCorrect}>
        {t('corrections.actions.correct')}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Wire them into the execution tab**

In `apps/web/src/features/executions/execution-tab.tsx`:
- change the type import to:

```ts
import type { ExecutionDetail, ExecutionSummary, OccurrenceDetail, OccurrenceStatus } from '@taskop/contracts';
```

- add the imports:

```ts
import { CorrectAnswers } from '@/features/corrections/correct-answers';
import { RunActions } from '@/features/corrections/run-actions';
```

- in `ExecutionTab`, replace `<CountedExecution summary={occurrence.execution} />` with:

```tsx
        <CountedExecution summary={occurrence.execution} status={occurrence.status} />
```

- replace `CountedExecution` with:

```tsx
function CountedExecution({ summary, status }: { summary: ExecutionSummary; status: OccurrenceStatus }) {
  const detail = useExecution(summary.id);
  const [correcting, setCorrecting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const d = detail.data;
  const done = () => {
    setConflict(false);
    setCorrecting(false);
  };
  return (
    <div className="grid gap-4">
      <SummaryView summary={summary} detail={d} />
      {d && !correcting && <RunActions status={status} detail={d} onCorrect={() => setCorrecting(true)} />}
      {d && correcting ? (
        // Keyed by the revision: an ANSWERS_CONFLICT reload starts the edit over from the newest answers.
        <CorrectAnswers key={d.answersRev} detail={d} conflict={conflict} onConflict={() => setConflict(true)} onDone={done} />
      ) : (
        <ExecutionAnswers id={summary.id} />
      )}
    </div>
  );
}
```

- in `SummaryView`, after the `{summary.mediaPending > 0 && (…)}` badge, add:

```tsx
        {detail?.corrected && <Badge variant="outline">{t('corrections.corrected')}</Badge>}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/corrections features/executions features/reports features/scheduling && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. The other suites that open the run drawer mock `useCan`. In the report suites the user lacks `executions.correct`. The schedule suite answers `true`, so a "Correct answers" button appears on its completed run, and no existing assertion counts buttons there.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/corrections/correct-answers.tsx apps/web/src/features/corrections/correct-answers.test.tsx apps/web/src/features/corrections/run-actions.tsx apps/web/src/features/executions/execution-tab.tsx apps/web/src/features/executions/execution-tab.test.tsx
git commit -m "feat(web): correct a completed run's answers with a reason" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Send back, withdraw, and the rework banner

**Files:**
- Create: `apps/web/src/features/corrections/send-back-dialog.tsx`, `apps/web/src/features/corrections/rework-banner.tsx`
- Modify: `apps/web/src/features/corrections/run-actions.tsx` (whole file), `apps/web/src/features/executions/execution-tab.tsx`
- Test: `apps/web/src/features/corrections/send-back-dialog.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `api.corrections.{sendBack, withdraw}`, `canSendBack`, `canWithdrawSendBack`, `AUDIT_LIMITS.reason`, `type SendBackInput`, `ReworkRequest.requestedBy` (`UserRef | null`). Existing: `scheduling.schedule.actorPlatform`.
  - Part 1 strings: `az.corrections.{actions.{sendBack, withdraw}, fields.{items, dueAt}, issues.dueInPast, reworkBanner, round, dueAt}`.
  - Task 2: `refreshRunViews`, `apiError`. Task 7: `reworkRequest`, `MANAGER`. Task 8: `localInputToIso`.
  - Existing: `ConfirmButton`, `FormError`, `walkItems`, `visibleItems`.
- Produces:
  - `SendBackDialog({ detail, onClose })`: a `dialog` named "İcranı düzəlişə qaytar". It has:
    - one `checkbox` per visible item, named by the item's label;
    - a `textbox` named "<label> — şərh" per checked item;
    - the due date input, labelled by `az.corrections.fields.dueAt`.
  - `ReworkBanner({ detail })`, shown while `detail.rework` is open.
  - `RunActions` gains Send back (`canSendBack`) and Withdraw (`canWithdrawSendBack`, after a confirmation).

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/corrections/send-back-dialog.test.tsx`:

```tsx
import type { ExecutionDetail, OccurrenceStatus } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '@/features/audits/fixtures';
import { ExecutionTab } from '@/features/executions/execution-tab';
import { executionFixture, occurrenceDetail, summary } from '@/features/executions/fixtures';
import { renderWithProviders } from '@/test/render';
import { reworkRequest } from './fixtures';

const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  api: { executions: { get: vi.fn() }, media: { url: vi.fn() }, corrections: { correct: vi.fn(), sendBack: vi.fn(), withdraw: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
  useCan: (...keys: string[]) => keys.every((k) => mocks.permissions.current.includes(k)),
}));

const SEND_BACK = az.corrections.actions.sendBack;
const renderTab = (status: OccurrenceStatus = 'completed', detail?: Partial<ExecutionDetail>) => {
  const f = executionFixture();
  mocks.api.executions.get.mockResolvedValue(f.detail(detail));
  renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status, execution: summary() })} />);
  return f;
};
const openDialog = async () => {
  await userEvent.click(await screen.findByRole('button', { name: SEND_BACK }));
  return screen.findByRole('dialog', { name: 'İcranı düzəlişə qaytar' });
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.permissions.current = ['executions.correct'];
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('Send back', () => {
  it('sends the flagged items back with a comment each and a due date on the tenant clock', async () => {
    mocks.api.corrections.sendBack.mockResolvedValue(reworkRequest());
    const f = renderTab();
    const dialog = await openDialog();
    // One checkbox per visible item: the follow-up "Təsvir edin" is visible, because "Problem varmı?" is "Bəli".
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(6);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Temperatur' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Temperatur — şərh' }), 'Termometrlə yenidən ölçün');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Qeyd' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Qeyd — şərh' }), 'Qeydi doldurun');
    expect(dialog).toHaveTextContent('2 bənd seçilib');
    fireEvent.change(within(dialog).getByLabelText(az.corrections.fields.dueAt), { target: { value: '2099-01-01T18:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(mocks.api.corrections.sendBack).toHaveBeenCalledWith('x1', {
      items: [
        { itemId: f.temp.id, comment: 'Termometrlə yenidən ölçün' },
        { itemId: f.note.id, comment: 'Qeydi doldurun' },
      ],
      dueAt: '2099-01-01T14:00:00.000Z',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.api.executions.get).toHaveBeenCalledTimes(2));
  });

  it('asks for at least one item, a comment on each, and a due date that has not passed', async () => {
    renderTab('audit_pending');
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(within(dialog).getByText('Ən azı bir bənd seçin.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Temperatur' }));
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(within(dialog).getByText('Hər seçilmiş bənd üçün şərh yazın.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Temperatur — şərh' }), 'Yenidən ölçün');
    fireEvent.change(within(dialog).getByLabelText(az.corrections.fields.dueAt), { target: { value: '2020-01-01T10:00' } });
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(within(dialog).getByText(az.corrections.issues.dueInPast)).toBeInTheDocument();
    expect(mocks.api.corrections.sendBack).not.toHaveBeenCalled();
    // Unticking an item drops its comment box.
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Temperatur' }));
    expect(within(dialog).queryByRole('textbox', { name: 'Temperatur — şərh' })).not.toBeInTheDocument();
  });

  it('shows the server’s reason for a refused due date', async () => {
    mocks.api.corrections.sendBack.mockRejectedValue(apiError(400, 'VALIDATION_FAILED', { fields: { dueAt: 'corrections.issues.dueInPast' } }));
    renderTab();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Video' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Video — şərh' }), 'Daha yaxından çəkin');
    await userEvent.click(within(dialog).getByRole('button', { name: SEND_BACK }));
    expect(await within(dialog).findByText(az.corrections.issues.dueInPast)).toBeInTheDocument();
  });

  it('shows the open request to every reader, and lets the manager withdraw it', async () => {
    const f = executionFixture();
    const rework = reworkRequest({ items: [{ itemId: f.temp.id, comment: 'Termometrlə yenidən ölçün' }], dueAt: '2026-11-03T14:00:00.000Z' });
    mocks.api.executions.get.mockResolvedValue(f.detail({ state: 'rework', reworkRound: 1, rework }));
    mocks.api.corrections.withdraw.mockResolvedValue({ ...rework, withdrawnAt: '2026-11-02T12:00:00.000Z' });
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'correction_required', execution: summary({ state: 'rework' }) })} />);
    const banner = await screen.findByText((_, el) => el?.getAttribute('data-slot') === 'alert' && el.textContent?.includes(az.corrections.reworkBanner) === true);
    expect(banner).toHaveTextContent('Leyla Quliyeva · ');
    expect(banner).toHaveTextContent('18:00');
    expect(banner).toHaveTextContent('Temperatur — Termometrlə yenidən ölçün');
    expect(screen.queryByRole('button', { name: SEND_BACK })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.corrections.actions.correct })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: az.corrections.actions.withdraw }));
    const confirm = await screen.findByRole('dialog', { name: 'Geri qaytarmanı ləğv et' });
    expect(confirm).toHaveTextContent('İcra əvvəlki statusuna qayıdacaq.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Təsdiqlə' }));
    expect(mocks.api.corrections.withdraw).toHaveBeenCalledWith('x1');
  });

  it('names Taskop support when a platform admin sent the run back', async () => {
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail({ state: 'rework', reworkRound: 1, rework: reworkRequest({ requestedBy: null, items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] }) }));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'correction_required', execution: summary({ state: 'rework' }) })} />);
    expect(await screen.findByText(/^Taskop dəstəyi · /)).toBeInTheDocument();
  });

  it('shows the banner without actions to someone who cannot correct', async () => {
    mocks.permissions.current = [];
    const f = executionFixture();
    mocks.api.executions.get.mockResolvedValue(f.detail({ state: 'rework', reworkRound: 1, rework: reworkRequest({ items: [{ itemId: f.note.id, comment: 'Qeydi doldurun' }] }) }));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'correction_required', execution: summary({ state: 'rework' }) })} />);
    expect(await screen.findByText('Qeyd — Qeydi doldurun')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: az.corrections.actions.withdraw })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/corrections/send-back-dialog`
Expected: FAIL: no button named `az.corrections.actions.sendBack`.

- [ ] **Step 3: Implement the dialog**

`apps/web/src/features/corrections/send-back-dialog.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type ExecutionDetail, type SendBackInput, visibleItems } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api, useMe } from '@/lib/session';
import { localInputToIso } from './labels';

/**
 * "Geri qaytar" (spec §8.3, decision 12): pick the items the worker must fix, a comment for each, and an optional due
 * date on the tenant's clock. Only the picked items reopen on the worker's phone.
 */
export function SendBackDialog({ detail, onClose }: { detail: ExecutionDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const qc = useQueryClient();
  const visible = useMemo(() => visibleItems(detail.content, detail.answers), [detail.content, detail.answers]);
  /** Picked item id → its comment, in the order the items were picked. */
  const [comments, setComments] = useState<Record<string, string>>({});
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const picked = visible.filter((v) => v.item.id in comments);

  const toggle = (itemId: string, on: boolean) =>
    setComments((c) => {
      const next = { ...c };
      if (on) next[itemId] = c[itemId] ?? '';
      else delete next[itemId];
      return next;
    });
  const send = useMutation({
    mutationFn: (body: SendBackInput) => api.corrections.sendBack(detail.id, body),
    onSuccess: () => {
      toast.success(t('corrections.web.sendBack.done'));
      onClose();
      void refreshRunViews(qc);
    },
    onError: (e) => setError(e instanceof ApiError && e.fields?.dueAt ? t(e.fields.dueAt) : errorText(t, e)),
  });
  const submit = () => {
    if (picked.length === 0) return setError(t('corrections.web.sendBack.noItems'));
    if (picked.some((v) => !comments[v.item.id]!.trim())) return setError(t('corrections.web.sendBack.commentRequired'));
    const dueAt = due ? localInputToIso(due, tenant.timezone) : null;
    if (dueAt && Date.parse(dueAt) <= Date.now()) return setError(t('corrections.issues.dueInPast'));
    setError(null);
    send.mutate({ items: picked.map((v) => ({ itemId: v.item.id, comment: comments[v.item.id]!.trim() })), dueAt });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('corrections.web.sendBack.title')}</DialogTitle>
          <DialogDescription>{t('corrections.web.sendBack.hint')}</DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('corrections.fields.items')}</legend>
          <ul className="grid gap-2">
            {visible.map((v) => {
              const id = `send-back-${v.item.id}`;
              const on = v.item.id in comments;
              return (
                <li key={v.item.id} className="grid gap-1.5" style={{ marginLeft: v.depth * 16 }}>
                  <div className="flex items-center gap-2">
                    <Checkbox id={id} checked={on} onCheckedChange={(c) => toggle(v.item.id, c === true)} />
                    <Label htmlFor={id} className="font-normal">
                      {v.item.label}
                    </Label>
                  </div>
                  {on && (
                    <Textarea
                      aria-label={t('corrections.web.sendBack.comment', { item: v.item.label })}
                      maxLength={AUDIT_LIMITS.reason}
                      value={comments[v.item.id]}
                      onChange={(e) => setComments((c) => ({ ...c, [v.item.id]: e.target.value }))}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="text-muted-foreground text-sm">{t('corrections.web.sendBack.selected', { count: picked.length })}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="send-back-due">{t('corrections.fields.dueAt')}</Label>
          <Input id="send-back-due" type="datetime-local" className="w-56" value={due} onChange={(e) => setDue(e.target.value)} />
          <p className="text-muted-foreground text-xs">{t('corrections.web.sendBack.dueHint')}</p>
        </div>
        <FormError message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={send.isPending} onClick={submit}>
            {t('corrections.actions.sendBack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Implement the banner**

`apps/web/src/features/corrections/rework-banner.tsx`:

```tsx
import { type ExecutionDetail, walkItems } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFormatDateTime } from '@/lib/format';

/** While a send-back is open (decision 13): the round, who sent it back and when, the due date and the flagged items. */
export function ReworkBanner({ detail }: { detail: ExecutionDetail }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const r = detail.rework;
  if (!r) return null;
  const labels = new Map<string, string>();
  walkItems(detail.content, (item) => labels.set(item.id, item.label));
  return (
    <Alert>
      <AlertTitle>{`${t('corrections.reworkBanner')} · ${t('corrections.round', { round: r.round })}`}</AlertTitle>
      <AlertDescription className="grid gap-1">
        <p>
          {t('corrections.web.rework.requestedBy', { name: r.requestedBy?.fullName ?? t('scheduling.schedule.actorPlatform'), time: formatDateTime(r.requestedAt) })}
          {r.dueAt ? ` · ${t('corrections.dueAt', { date: formatDateTime(r.dueAt) })}` : ''}
        </p>
        <p className="font-medium">{t('corrections.web.rework.flagged')}</p>
        <ul className="list-disc pl-5">
          {r.items.map((i) => (
            <li key={i.itemId}>{`${labels.get(i.itemId) ?? t('executions.problemsPage.unknownItem')} — ${i.comment}`}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 5: Add Send back and Withdraw to the action row**

Replace `apps/web/src/features/corrections/run-actions.tsx` with:

```tsx
import { canCorrect, canSendBack, canWithdrawSendBack, type ExecutionDetail, type OccurrenceStatus } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { Button } from '@/components/ui/button';
import { refreshRunViews } from '@/features/executions/queries';
import { errorText } from '@/lib/errors';
import { api, useCan } from '@/lib/session';
import { SendBackDialog } from './send-back-dialog';

/** The run's correction actions for executions.correct holders, each only where Part 1's rules allow it. */
export function RunActions({ status, detail, onCorrect }: { status: OccurrenceStatus; detail: ExecutionDetail; onCorrect: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const can = useCan('executions.correct');
  const [sending, setSending] = useState(false);
  const run = { status, executionState: detail.state };
  const correctable = canCorrect(run);
  const returnable = canSendBack(run);
  const withdrawable = canWithdrawSendBack(run);
  if (!can || !(correctable || returnable || withdrawable)) return null;

  const withdraw = async () => {
    try {
      await api.corrections.withdraw(detail.id);
      toast.success(t('corrections.web.withdraw.done'));
      await refreshRunViews(qc);
    } catch (e) {
      toast.error(errorText(t, e));
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {correctable && (
        <Button variant="outline" onClick={onCorrect}>
          {t('corrections.actions.correct')}
        </Button>
      )}
      {returnable && (
        <Button variant="outline" onClick={() => setSending(true)}>
          {t('corrections.actions.sendBack')}
        </Button>
      )}
      {withdrawable && (
        <ConfirmButton
          label={t('corrections.actions.withdraw')}
          title={t('corrections.web.withdraw.title')}
          description={t('corrections.web.withdraw.description')}
          onConfirm={withdraw}
        />
      )}
      {sending && <SendBackDialog detail={detail} onClose={() => setSending(false)} />}
    </div>
  );
}
```

- [ ] **Step 6: Show the banner in the execution tab**

In `apps/web/src/features/executions/execution-tab.tsx`, add the import:

```ts
import { ReworkBanner } from '@/features/corrections/rework-banner';
```

and in `CountedExecution`, right after `<SummaryView summary={summary} detail={d} />`, add:

```tsx
      {d && <ReworkBanner detail={d} />}
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/corrections features/executions && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/corrections/send-back-dialog.tsx apps/web/src/features/corrections/send-back-dialog.test.tsx apps/web/src/features/corrections/rework-banner.tsx apps/web/src/features/corrections/run-actions.tsx apps/web/src/features/executions/execution-tab.tsx
git commit -m "feat(web): send a run back to the worker, withdraw it, and show the open request" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The checklist's audit settings

**Files:**
- Create: `apps/web/src/features/checklists/audit-settings.tsx`
- Modify: `apps/web/src/features/checklists/checklist-detail-page.tsx`
- Test: `apps/web/src/features/checklists/checklist-detail-page.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `ChecklistDetail.{requiresAudit, auditReportEmails}`; `updateChecklistInputSchema`'s `requiresAudit` and `auditReportEmails` (through `ws.checklists.update`); `AUDIT_LIMITS.reportEmails`.
  - Part 1 strings: `az.audits.fields.{requiresAudit, reportEmails}`.
  - Task 3: `EmailListInput`.
- Produces: `AuditSettings({ checklist, editable, onSave })`, a `region` named "Audit" on the checklist detail page. It holds the "Requires audit" `switch` and the report addresses, and saves only when something changed.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/checklists/checklist-detail-page.test.tsx`, add these imports:

```ts
import { ApiError } from '@taskop/api-client';
import { az } from '@taskop/i18n';
```

and append inside `describe('ChecklistDetailPage', …)`:

```tsx
  it('saves the audit requirement and the report addresses', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValueOnce(detail({ auditReportEmails: ['rehber@acme.az'] })).mockResolvedValue(
      detail({ requiresAudit: true, auditReportEmails: ['rehber@acme.az', 'audit@acme.az'] }),
    );
    ws.checklists.update.mockResolvedValue({});
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    const toggle = within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit });
    expect(toggle).not.toBeChecked();
    expect(within(audit).getByText('rehber@acme.az')).toBeInTheDocument();
    const save = within(audit).getByRole('button', { name: 'Yadda saxla' });
    expect(save).toBeDisabled();
    await userEvent.click(toggle);
    await userEvent.type(within(audit).getByLabelText(az.audits.fields.reportEmails), 'Audit@Acme.az{Enter}');
    await userEvent.click(save);
    await waitFor(() => expect(ws.checklists.update).toHaveBeenCalledWith(ID, { requiresAudit: true, auditReportEmails: ['rehber@acme.az', 'audit@acme.az'] }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Audit' })).getByRole('switch', { name: az.audits.fields.requiresAudit })).toBeChecked());
    expect(within(screen.getByRole('region', { name: 'Audit' })).getByRole('button', { name: 'Yadda saxla' })).toBeDisabled();
  });

  it('shows the API’s reason for one refused address', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.update.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { 'auditReportEmails.0': 'errors.validation.email' }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    await userEvent.click(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit }));
    await userEvent.click(within(audit).getByRole('button', { name: 'Yadda saxla' }));
    expect(await within(audit).findByText('Düzgün e-poçt ünvanı daxil edin.')).toBeInTheDocument();
  });

  it('shows the API’s reason for a refused address list', async () => {
    const ws = fakeWorkspace();
    ws.checklists.get.mockResolvedValue(detail());
    ws.checklists.update.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { auditReportEmails: 'audits.issues.tooManyEmails' }),
    );
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    await userEvent.click(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit }));
    await userEvent.click(within(audit).getByRole('button', { name: 'Yadda saxla' }));
    expect(await within(audit).findByText(az.audits.issues.tooManyEmails)).toBeInTheDocument();
  });

  it('shows the audit settings read-only without checklists.manage or on a deactivated checklist', async () => {
    const ws = fakeWorkspace({ can: { manage: false, publish: false, templates: false } });
    ws.checklists.get.mockResolvedValue(detail({ requiresAudit: true, auditReportEmails: ['rehber@acme.az'] }));
    renderInWorkspace(<ChecklistDetailPage checklistId={ID} />, ws);
    const audit = await screen.findByRole('region', { name: 'Audit' });
    expect(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit })).toBeDisabled();
    expect(within(audit).getByRole('switch', { name: az.audits.fields.requiresAudit })).toBeChecked();
    expect(within(audit).getByText('rehber@acme.az')).toBeInTheDocument();
    expect(within(audit).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(audit).queryByRole('button', { name: 'Yadda saxla' })).not.toBeInTheDocument();
  });
```


- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/checklists/checklist-detail-page`
Expected: FAIL: no region named "Audit".

- [ ] **Step 3: Implement the section**

`apps/web/src/features/checklists/audit-settings.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type ChecklistDetail } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmailListInput } from '@/components/email-list-input';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { errorText } from '@/lib/errors';

export interface AuditSettingsValue {
  requiresAudit: boolean;
  auditReportEmails: string[];
}

/**
 * The checklist's audit settings (spec §4.1, §8.3, decision 15): completed runs go to the audit queue, and the finished
 * audit's PDF goes to these addresses. Settings, not versioned content: they apply from the next completed run.
 */
export function AuditSettings({ checklist, editable, onSave }: { checklist: ChecklistDetail; editable: boolean; onSave: (v: AuditSettingsValue) => Promise<void> }) {
  const { t } = useTranslation();
  const [requiresAudit, setRequiresAudit] = useState(checklist.requiresAudit);
  const [emails, setEmails] = useState<string[]>(checklist.auditReportEmails);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = requiresAudit !== checklist.requiresAudit || emails.join('\n') !== checklist.auditReportEmails.join('\n');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave({ requiresAudit, auditReportEmails: emails });
    } catch (e) {
      // Part 1: `fields.auditReportEmails` (too many) or `fields['auditReportEmails.<i>']` (one bad address).
      const key = e instanceof ApiError && e.fields ? Object.entries(e.fields).find(([field]) => field === 'auditReportEmails' || field.startsWith('auditReportEmails.'))?.[1] : undefined;
      setError(key ? t(key) : errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="audit-settings-title" className="grid max-w-xl gap-3 rounded-lg border p-4">
      <h2 id="audit-settings-title" className="text-lg font-semibold">
        {t('audits.web.settings.title')}
      </h2>
      <div className="flex items-start gap-3">
        <Switch id="requires-audit" checked={requiresAudit} disabled={!editable} onCheckedChange={setRequiresAudit} aria-describedby="requires-audit-hint" />
        <div className="grid gap-0.5">
          <Label htmlFor="requires-audit">{t('audits.fields.requiresAudit')}</Label>
          <p id="requires-audit-hint" className="text-muted-foreground text-xs">
            {t('audits.web.settings.requiresAuditHint')}
          </p>
        </div>
      </div>
      <EmailListInput
        id="audit-report-emails"
        label={t('audits.fields.reportEmails')}
        hint={t('audits.web.settings.emailsHint')}
        value={emails}
        onChange={setEmails}
        max={AUDIT_LIMITS.reportEmails}
        disabled={!editable}
      />
      <FormError message={error} />
      {editable && (
        <Button className="w-fit" disabled={!dirty || busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Put it on the checklist page**

In `apps/web/src/features/checklists/checklist-detail-page.tsx`, add the import:

```ts
import { AuditSettings } from './audit-settings';
```

and directly before `<h2 className="text-lg font-semibold">{t('checklists.detail.versions')}</h2>`, add:

```tsx
      {/* Keyed by the stored values, so the section starts from the server's state again after a save. */}
      <AuditSettings
        key={`${c.requiresAudit}|${c.auditReportEmails.join(',')}`}
        checklist={c}
        editable={editable}
        onSave={async (v) => {
          await ws.checklists.update(checklistId, v);
          await refresh();
          toast.success(t('common.saved'));
        }}
      />
```

`editable` is the page's existing `ws.can.manage && active`, so a deactivated checklist shows the settings read-only too.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/checklists && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. The version-history test still finds three table rows; the section has no table.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/checklists/audit-settings.tsx apps/web/src/features/checklists/checklist-detail-page.tsx apps/web/src/features/checklists/checklist-detail-page.test.tsx
git commit -m "feat(web): add the Requires audit switch and report addresses to the checklist page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The reports runs tab: Audit column, corrected marker, audit-state filter and export

**Files:**
- Modify: `apps/web/src/features/reports/search.ts`, `apps/web/src/features/reports/queries.ts`, `apps/web/src/features/reports/labels.ts`, `apps/web/src/features/reports/runs-tab.tsx`, `apps/web/src/features/reports/export-menu.tsx`, `apps/web/src/features/reports/reports-page.tsx`
- Test: `apps/web/src/features/reports/search.test.ts`, `apps/web/src/features/reports/labels.test.ts`, `apps/web/src/features/reports/runs-tab.test.tsx`, `apps/web/src/features/reports/export-menu.test.tsx`, `apps/web/src/features/reports/reports-page.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `RUN_AUDIT_STATES`, `type RunAuditState`; `ReportRun.{auditState, corrected}`; `auditState` on `ReportRunsQuery` and `ReportExportQuery`.
  - Part 1 strings: `az.audits.{audit, runAuditStates}`, `az.corrections.corrected`.
  - Task 2: `runAuditStateVariant`.
- Produces:
  - `ReportsPageSearch.auditState?: RunAuditState`, validated by `reportsPageSearch` and kept by `pageExtras`.
  - `reportKeys.runs(f, bucket, auditState)`.
  - `useReportRuns(filters, bucket, auditState: RunAuditState | null = null)`.
  - `exportQuery(kind, filters, format, { bucket?, severity?, auditState? })`, which sends `auditState` with `runs` only.
  - `ExportMenu({ …, auditState? })`.
  - `RunsTab({ filters, bucket, onBucket, auditState?, onAuditState? })`. Its audit-state select is named by `az.audits.audit`; "Hamısı" means no filter.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/reports/search.test.ts`, add inside `describe('reportsPageSearch', …)`:

```ts
  it('keeps a valid audit state of the runs table and drops an unknown one', () => {
    expect(reportsPageSearch({ tab: 'runs', auditState: 'failed' })).toEqual({ tab: 'runs', auditState: 'failed' });
    expect(reportsPageSearch({ tab: 'runs', auditState: 'rejected' })).toEqual({ tab: 'runs' });
    expect(pageExtras({ tab: 'runs', bucket: 'all', auditState: 'waiting', siteId: SITE })).toEqual({ tab: 'runs', bucket: 'all', auditState: 'waiting' });
  });
```

In `apps/web/src/features/reports/labels.test.ts`, inside the test that checks `exportQuery`, after its last `expect(exportQuery(…))` line add:

```ts
    expect(exportQuery('runs', FILTERS, 'csv', { bucket: 'all', auditState: 'passed' })).toEqual({ ...FILTERS, format: 'csv', bucket: 'all', auditState: 'passed' });
    expect(exportQuery('problems', FILTERS, 'csv', { auditState: 'passed' })).toEqual({ ...FILTERS, format: 'csv' });
    expect(exportQuery('full', FILTERS, 'xlsx', { auditState: 'passed' })).toEqual({ ...FILTERS, format: 'xlsx' });
```

In `apps/web/src/features/reports/runs-tab.test.tsx`, add `import { az } from '@taskop/i18n';` to the imports and these tests inside `describe('RunsTab', …)`:

```tsx
  it('shows each run’s audit state and marks a corrected score', async () => {
    mocks.api.reports.runs.mockResolvedValue(page([completedRun({ auditState: 'failed', corrected: true }), reportRun()]));
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[0]!).getByRole('columnheader', { name: az.audits.audit })).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent(az.audits.runAuditStates.failed);
    expect(rows[1]).toHaveTextContent(`87,5%${az.corrections.corrected}`);
    expect(rows[2]).not.toHaveTextContent(az.corrections.corrected);
    expect(rows[2]).not.toHaveTextContent(az.audits.runAuditStates.failed);
  });

  it('filters by audit state', async () => {
    const onAuditState = vi.fn();
    renderWithRouter(<RunsTab filters={FILTERS} bucket="all" onBucket={vi.fn()} auditState="waiting" onAuditState={onAuditState} />);
    await screen.findAllByRole('row');
    expect(mocks.api.reports.runs).toHaveBeenCalledWith({ ...FILTERS, bucket: 'all', auditState: 'waiting' });
    const select = screen.getByRole('combobox', { name: az.audits.audit });
    expect(select).toHaveValue('waiting');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Hamısı',
      az.audits.runAuditStates.waiting,
      az.audits.runAuditStates.in_progress,
      az.audits.runAuditStates.passed,
      az.audits.runAuditStates.failed,
    ]);
    await userEvent.selectOptions(select, 'failed');
    expect(onAuditState).toHaveBeenLastCalledWith('failed');
    await userEvent.selectOptions(select, '');
    expect(onAuditState).toHaveBeenLastCalledWith(null);
  });
```

In `apps/web/src/features/reports/export-menu.test.tsx`, add inside `describe('ExportMenu', …)`:

```tsx
  it('sends the audit state with the runs table only', async () => {
    renderMenu({ auditState: 'failed' });
    await choose('Bu cədvəl', 'CSV');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('runs', { ...FILTERS, format: 'csv', bucket: 'overdue', auditState: 'failed' });
    await choose('Tam hesabat', 'PDF');
    expect(mocks.api.reports.export).toHaveBeenLastCalledWith('full', { ...FILTERS, format: 'pdf' });
  });
```

In `apps/web/src/features/reports/reports-page.test.tsx`, add `import { az } from '@taskop/i18n';` to the imports and this test inside `describe('ReportsPage', …)`:

```tsx
  it('keeps the runs table’s audit state in the URL', async () => {
    const router = renderWithRouter(<ReportsPage today={TODAY} />, '/reports?tab=runs&auditState=failed');
    await waitFor(() => expect(mocks.api.reports.runs).toHaveBeenCalledWith({ from: TODAY, to: TODAY, bucket: 'all', auditState: 'failed' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: az.audits.audit }), 'waiting');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'runs', auditState: 'waiting' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: az.audits.audit }), '');
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'runs' }));
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/reports`
Expected: FAIL: `auditState` is dropped by `reportsPageSearch` and by `exportQuery`; no Audit column; no audit-state select.

- [ ] **Step 3: Carry the audit state in the URL**

In `apps/web/src/features/reports/search.ts`:
- add `RUN_AUDIT_STATES,` and `type RunAuditState,` to the `@taskop/contracts` import;
- in `ReportsPageSearch`, after `severity?: ProblemSeverity;` add:

```ts
  /** The runs table's audit filter (SP8 spec §8.3). */
  auditState?: RunAuditState;
```

- in `reportsPageSearch`, after the `severity` line add:

```ts
    ...(isOneOf(RUN_AUDIT_STATES, s.auditState) ? { auditState: s.auditState } : {}),
```

- replace `const PAGE_KEYS = ['tab', 'bucket', 'severity'] as const;` with:

```ts
const PAGE_KEYS = ['tab', 'bucket', 'severity', 'auditState'] as const;
```

- replace the `pageExtras` line with:

```ts
export const pageExtras = (s: ReportsPageSearch): Pick<ReportsPageSearch, 'tab' | 'bucket' | 'severity' | 'auditState'> => pick(s, PAGE_KEYS);
```

- [ ] **Step 4: Query and export with it**

In `apps/web/src/features/reports/queries.ts`:
- add `type RunAuditState,` to the `@taskop/contracts` import;
- replace the `runs` key with:

```ts
  runs: (f: ReportFilters, bucket: RunBucket, auditState: RunAuditState | null = null) => ['reports', 'runs', f, bucket, auditState] as const,
```

- replace `useReportRuns` with:

```ts
/** Pages of 50, newest due first; "Daha çox göstər" passes nextCursor back with the same filters. */
export const useReportRuns = (filters: ReportFilters, bucket: RunBucket, auditState: RunAuditState | null = null) =>
  useInfiniteQuery({
    queryKey: reportKeys.runs(filters, bucket, auditState),
    queryFn: ({ pageParam }) => api.reports.runs({ ...filters, bucket, ...(auditState ? { auditState } : {}), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
```

In `apps/web/src/features/reports/labels.ts`:
- add `type RunAuditState,` to the `@taskop/contracts` import;
- replace `exportQuery` with:

```ts
/** The export's query: bucket and audit state go with runs, severity with problems, the full report takes none (SP7 decision 14, SP8 decision 16). */
export function exportQuery(
  kind: ReportExportKind,
  filters: ReportFilters,
  format: ReportFormat,
  extra: { bucket?: RunBucket; severity?: ProblemSeverity; auditState?: RunAuditState },
): ReportExportQuery {
  return {
    ...filters,
    format,
    ...(kind === 'runs' && extra.bucket ? { bucket: extra.bucket } : {}),
    ...(kind === 'runs' && extra.auditState ? { auditState: extra.auditState } : {}),
    ...(kind === 'problems' && extra.severity ? { severity: extra.severity } : {}),
  };
}
```

In `apps/web/src/features/reports/export-menu.tsx`:
- add `type RunAuditState,` to the `@taskop/contracts` import;
- replace the component's signature with:

```tsx
export function ExportMenu({
  kind,
  filters,
  bucket,
  severity,
  auditState,
}: {
  kind: ReportKind;
  filters: ReportFilters | null;
  bucket?: RunBucket;
  severity?: ProblemSeverity;
  auditState?: RunAuditState;
}) {
```

- in `download`, replace `exportQuery(target, filters, format, { bucket, severity })` with `exportQuery(target, filters, format, { bucket, severity, auditState })`.

- [ ] **Step 5: Show the column, the marker and the select**

In `apps/web/src/features/reports/runs-tab.tsx`:
- replace the first import with:

```ts
import { type ReportFilters, RUN_AUDIT_STATES, RUN_BUCKETS, type RunAuditState, type RunBucket } from '@taskop/contracts';
```

- add the imports:

```ts
import { NativeSelect } from '@/components/native-select';
import { runAuditStateVariant } from '@/features/audits/labels';
```

- replace the component's signature and its `useReportRuns` line with:

```tsx
export function RunsTab({
  filters,
  bucket,
  onBucket,
  auditState = null,
  onAuditState,
}: {
  filters: ReportFilters;
  bucket: RunBucket;
  onBucket: (bucket: RunBucket) => void;
  /** SP8: the audit state filter; without `onAuditState` the select is not shown. */
  auditState?: RunAuditState | null;
  onAuditState?: (state: RunAuditState | null) => void;
}) {
```

and

```ts
  const runs = useReportRuns(filters, bucket, auditState);
```

- replace `<ChipGroup … />` (the first child of the outer `div`) with:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipGroup label={t('reports.filters.bucket')} options={RUN_BUCKETS.map((b) => ({ value: b, label: t(`reports.buckets.${b}`) }))} value={bucket} onChange={onBucket} />
        {onAuditState && (
          <NativeSelect
            aria-label={t('audits.audit')}
            value={auditState ?? ''}
            onChange={(e) => onAuditState((e.target.value || null) as RunAuditState | null)}
            className="w-44"
          >
            <option value="">{t('common.all')}</option>
            {RUN_AUDIT_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`audits.runAuditStates.${s}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
```

- in the header row, after `{COLUMNS.map(…)}`, add:

```tsx
              <TableHead>{t('audits.audit')}</TableHead>
```

- in each body row, replace the score cell:

```tsx
                <TableCell className="tabular-nums">{percentText(t, r.score, tenant.locale)}</TableCell>
```

with:

```tsx
                <TableCell className="tabular-nums">
                  <span className="flex flex-wrap items-center gap-1">
                    {percentText(t, r.score, tenant.locale)}
                    {r.corrected && <Badge variant="outline">{t('corrections.corrected')}</Badge>}
                  </span>
                </TableCell>
```

- and after the problem-count cell (the last `TableCell` of the row), add:

```tsx
                <TableCell>{r.auditState ? <Badge variant={runAuditStateVariant(r.auditState)}>{t(`audits.runAuditStates.${r.auditState}`)}</Badge> : t('reports.noValue')}</TableCell>
```

In `apps/web/src/features/reports/reports-page.tsx`:
- pass the audit state to the export menu: replace `severity={tab === 'problems' ? search.severity : undefined}` with:

```tsx
            severity={tab === 'problems' ? search.severity : undefined}
            auditState={tab === 'runs' ? search.auditState : undefined}
```

- in `TabBody`, replace the `runs` case with:

```tsx
    case 'runs':
      return (
        <RunsTab
          filters={filters}
          bucket={search.bucket ?? DEFAULT_BUCKET}
          onBucket={(bucket) => go({ ...search, bucket })}
          auditState={search.auditState ?? null}
          onAuditState={(auditState) => go(cleanSearch({ ...search, auditState: auditState ?? undefined }))}
        />
      );
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/reports && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. The earlier runs tests still see `{ ...FILTERS, bucket }` with no `auditState`, because it is only sent when set.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/reports/search.ts apps/web/src/features/reports/search.test.ts apps/web/src/features/reports/queries.ts apps/web/src/features/reports/labels.ts apps/web/src/features/reports/labels.test.ts apps/web/src/features/reports/runs-tab.tsx apps/web/src/features/reports/runs-tab.test.tsx apps/web/src/features/reports/export-menu.tsx apps/web/src/features/reports/export-menu.test.tsx apps/web/src/features/reports/reports-page.tsx apps/web/src/features/reports/reports-page.test.tsx
git commit -m "feat(web): show and filter the audit state of runs in reports, and export it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Cleared problems: hidden by default on the problems page, muted in the run's answers

**Files:**
- Modify: `apps/web/src/features/executions/problems-page.tsx`, `apps/web/src/features/executions/answers-view.tsx`
- Test: `apps/web/src/features/executions/problems-page.test.tsx`, `apps/web/src/features/executions/answers-view.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `problemListQuerySchema.includeCleared` (a `stringbool`, sent as `'true'`); `ProblemDto.clearedAt`, `ExecutionProblem.clearedAt`. `GET /problems` skips cleared rows unless `includeCleared=true` (Part 1 decision 18).
  - Part 1 strings: `az.corrections.cleared`. Task 1: `corrections.web.showCleared`.
- Produces:
  - The problems page has a "Aradan qaldırılanları göstər" `checkbox`. A cleared row carries `data-cleared="true"` and the "Düzəlişlə aradan qaldırılıb" badge.
  - In `AnswersView`, a cleared problem is shown muted with the same badge (`data-cleared`), and no longer sets the item's `data-problem`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/executions/problems-page.test.tsx`, add `import { az } from '@taskop/i18n';` to the imports and this test inside the first `describe('ProblemsPage', …)`:

```tsx
  it('hides problems a correction cleared unless asked, and marks them', async () => {
    mocks.api.problems.list.mockImplementation(async (q: { includeCleared?: string }) => ({
      items: q.includeCleared === 'true' ? [problem(), problem({ id: 'p2', itemId: 'i2', itemLabel: 'Qapı', clearedAt: '2026-11-03T08:00:00.000Z' })] : [problem()],
      nextCursor: null,
    }));
    renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByRole('link', { name: 'Temperatur' });
    expect(mocks.api.problems.list.mock.calls[0]![0]).not.toHaveProperty('includeCleared');
    expect(screen.queryByRole('link', { name: 'Qapı' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aradan qaldırılanları göstər' }));
    const cleared = (await screen.findByRole('link', { name: 'Qapı' })).closest('tr')!;
    expect(mocks.api.problems.list).toHaveBeenLastCalledWith(expect.objectContaining({ includeCleared: 'true' }));
    expect(cleared).toHaveAttribute('data-cleared', 'true');
    expect(within(cleared).getByText(az.corrections.cleared)).toBeInTheDocument();
    const active = screen.getByRole('link', { name: 'Temperatur' }).closest('tr')!;
    expect(active).not.toHaveAttribute('data-cleared');
  });
```

In `apps/web/src/features/executions/answers-view.test.tsx`, add `import { az } from '@taskop/i18n';` to the imports and this test inside `describe('AnswersView', …)`:

```tsx
  it('shows a problem a correction cleared, muted, without colouring its item', () => {
    const f = executionFixture();
    const problems = f.problems.map((p) => (p.id === 'pr1' ? { ...p, clearedAt: '2026-11-02T09:00:00.000Z' } : p));
    renderWithProviders(<AnswersView content={f.content} answers={f.answers} media={f.media} problems={problems} />);
    const question = screen.getByRole('listitem', { name: 'Problem varmı?' });
    expect(question).not.toHaveAttribute('data-problem');
    expect(within(question).getByText(az.corrections.cleared)).toBeInTheDocument();
    expect(within(question).getByText('Kritik').closest('[data-cleared]')).toHaveAttribute('data-cleared', 'true');
    // The temperature's problems are still active.
    expect(screen.getByRole('listitem', { name: 'Temperatur' })).toHaveAttribute('data-problem', 'critical');
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/executions/problems-page features/executions/answers-view`
Expected: FAIL: no checkbox named "Aradan qaldırılanları göstər"; the item is still `data-problem="critical"`.

- [ ] **Step 3: Implement the problems page toggle**

In `apps/web/src/features/executions/problems-page.tsx`:
- add the import:

```ts
import { Checkbox } from '@/components/ui/checkbox';
```

- after the `creatingFrom` state, add:

```ts
  const [showCleared, setShowCleared] = useState(false);
```

- in `filters`, after `resolution: resolution || undefined,` add:

```ts
    // Part 1 decision 18: cleared problems are skipped unless asked for.
    ...(showCleared ? { includeCleared: 'true' } : {}),
```

- as the last child of the filter row (after the resolution `NativeSelect`), add:

```tsx
        <div className="flex h-9 items-center gap-2">
          <Checkbox id="problems-show-cleared" checked={showCleared} onCheckedChange={(c) => setShowCleared(c === true)} />
          <Label htmlFor="problems-show-cleared" className="font-normal">
            {t('corrections.web.showCleared')}
          </Label>
        </div>
```

- replace `<TableRow key={p.id}>` in the body with:

```tsx
              <TableRow key={p.id} data-cleared={p.clearedAt ? 'true' : undefined} className={p.clearedAt ? 'opacity-60' : undefined}>
```

- replace the severity cell with:

```tsx
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                    {p.clearedAt && <Badge variant="outline">{t('corrections.cleared')}</Badge>}
                  </div>
                </TableCell>
```

- [ ] **Step 4: Mute cleared problems in the answers**

In `apps/web/src/features/executions/answers-view.tsx`, in `AnswerRow`:
- replace the `worst` line with:

```ts
  // A problem a correction cleared stays visible but no longer marks the item (SP8 spec §4.1).
  const active = problems.filter((p) => p.clearedAt === null);
  const worst = active.some((p) => p.severity === 'critical') ? 'critical' : active.length ? 'normal' : undefined;
```

- replace `<div key={p.id} className="grid gap-1">` (the problem wrapper) with:

```tsx
        <div key={p.id} data-cleared={p.clearedAt ? 'true' : undefined} className={cn('grid gap-1', p.clearedAt && 'opacity-60')}>
```

- in that wrapper's badge row, after the source `span`, add:

```tsx
            {p.clearedAt && <Badge variant="outline">{t('corrections.cleared')}</Badge>}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/executions && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/executions/problems-page.tsx apps/web/src/features/executions/problems-page.test.tsx apps/web/src/features/executions/answers-view.tsx apps/web/src/features/executions/answers-view.test.tsx
git commit -m "feat(web): hide cleared problems by default and mark them where they show" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Notification rules: the `audit.finished` result filter; deep links for the three audit notifications

**Files:**
- Modify: `apps/web/src/features/notifications/rules-form.ts`, `apps/web/src/features/notifications/rules-tab.tsx`, `apps/web/src/features/notifications/labels.ts`
- Test: `apps/web/src/features/notifications/rules-form.test.ts`, `apps/web/src/features/notifications/rules-tab.test.tsx`, `apps/web/src/features/notifications/labels.test.ts`

**Interfaces:**
- Consumes:
  - Part 1: `AUDIT_RESULT_FILTERS`, `type AuditResultFilter`; `NOTIFICATION_TYPE_META[type].hasResultFilter`; `DEFAULT_RULES[type].resultFilter`; `NotificationRuleDto.resultFilter`; `UpdateNotificationRuleInput.resultFilter`; the `audit` group in `NOTIFICATION_GROUPS`.
  - Part 1 strings: `az.notifications.{types, groups.audit, resultFilters}`. Task 1: `audits.web.resultFilter`.
  - Task 7: `type OccurrenceTab`. Part 1: inbox rows of the three new types have `targetKind: 'occurrence'`, the occurrence id and its local date.
- Produces:
  - `RuleDraft.resultFilter: AuditResultFilter | null`. `ruleBody` sends the draft's filter (or the type's default) when `hasResultFilter`, else `null`.
  - The rules table's "Audit nəticəsi" column: a select named "<type> — Audit nəticəsi", for `audit.finished` only.
  - `notificationLink` sends `run.correction_required` to tab `execution`, `run.resubmitted` to `corrections` and `audit.finished` to `audit`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/notifications/rules-form.test.ts`:
- replace the `all` constant with:

```ts
const all = { enabled: true, push: true, email: true, notifyAssignees: true, notifyCreator: true, roleIds: ['r1', 'r1', 'r2'], leadMinutes: 60, resultFilter: 'any' } as const;
```

- in the first test, add `resultFilter: null,` after `leadMinutes: null,` in the `problem.critical` expectation, and after `leadMinutes: 30,` in the `checklist.due_soon` expectation. In the `task.overdue` `toMatchObject`, add `resultFilter: null`.
- add these tests:

```ts
  it('sends the result filter of audit.finished only, its default when none was picked', () => {
    expect(ruleBody('audit.finished', { ...all, roleIds: [] })).toMatchObject({ resultFilter: 'any', leadMinutes: null, notifyCreator: false });
    expect(ruleBody('audit.finished', { ...all, roleIds: [], resultFilter: null })).toMatchObject({ resultFilter: 'failed' });
    expect(ruleBody('run.resubmitted', { ...all, roleIds: [] })).toMatchObject({ resultFilter: null, notifyAssignees: false, notifyCreator: true });
  });

  it('counts a changed result filter as a change', () => {
    const a = draftOf(ruleDto('audit.finished'));
    expect(a.resultFilter).toBe('failed');
    expect(sameDraft(a, { ...a, resultFilter: 'any' })).toBe(false);
  });
```

In `apps/web/src/features/notifications/rules-tab.test.tsx`:
- in the first test, change the group loop to `for (const g of ['checklist', 'problem', 'task', 'audit'] as const) {`, and replace `expect(screen.getAllByRole('combobox')).toHaveLength(1);` with:

```ts
    // The lead time of due_soon and the result filter of audit.finished are the only selects.
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByRole('combobox', { name: ctl('audit.finished', 'Audit nəticəsi') })).toHaveValue('failed');
```

- in `saves one row with its full rule and shows the answer`, add `resultFilter: null,` after `leadMinutes: 60,` in the expected body.
- add this test:

```tsx
  it('saves the result filter of the audit-finished rule', async () => {
    mocks.api.notificationRules.update.mockImplementation(answer);
    renderWithProviders(<NotificationRulesTab />);
    const filter = await screen.findByRole('combobox', { name: ctl('audit.finished', 'Audit nəticəsi') });
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual([az.notifications.resultFilters.any, az.notifications.resultFilters.failed]);
    await userEvent.selectOptions(filter, 'any');
    await userEvent.click(screen.getByRole('button', { name: ctl('audit.finished', 'Yadda saxla') }));
    await waitFor(() => expect(mocks.api.notificationRules.update).toHaveBeenCalledWith('audit.finished', expect.objectContaining({ resultFilter: 'any', leadMinutes: null })));
    expect(screen.getByRole('region', { name: az.notifications.groups.audit })).toContainElement(filter);
  });
```

In `apps/web/src/features/notifications/labels.test.ts`, add inside `describe('notificationLink', …)`:

```ts
  it('opens the run on the tab each audit notification is about', () => {
    const at = { targetKind: 'occurrence' as const, targetId: 'o1', targetDate: '2026-11-02' };
    expect(notificationLink(notificationItem({ type: 'run.correction_required', ...at }))).toEqual({ to: '/schedule', search: { date: '2026-11-02', occurrence: 'o1', tab: 'execution' } });
    expect(notificationLink(notificationItem({ type: 'run.resubmitted', ...at }))).toEqual({ to: '/schedule', search: { date: '2026-11-02', occurrence: 'o1', tab: 'corrections' } });
    expect(notificationLink(notificationItem({ type: 'audit.finished', ...at }))).toEqual({ to: '/schedule', search: { date: '2026-11-02', occurrence: 'o1', tab: 'audit' } });
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications`
Expected: FAIL: the rule bodies lack `resultFilter`; there is one combobox; the audit notifications have no `tab`.

- [ ] **Step 3: Carry the result filter in the rule form**

In `apps/web/src/features/notifications/rules-form.ts`:
- add `type AuditResultFilter,` to the `@taskop/contracts` import;
- in `RuleDraft`, after `leadMinutes: LeadMinutes | null;` add:

```ts
  /** audit.finished only (SP8 spec §7.1): notify on every result, or on failed audits only. */
  resultFilter: AuditResultFilter | null;
```

- in `draftOf`, after `leadMinutes: r.leadMinutes,` add `resultFilter: r.resultFilter,`;
- in `ruleBody`, after the `leadMinutes` line add:

```ts
    resultFilter: meta.hasResultFilter ? (d.resultFilter ?? DEFAULT_RULES[type].resultFilter) : null,
```

- in `sameDraft`, after `a.leadMinutes === b.leadMinutes &&` add `a.resultFilter === b.resultFilter &&`.

- [ ] **Step 4: Show it in the rules table**

In `apps/web/src/features/notifications/rules-tab.tsx`:
- add `AUDIT_RESULT_FILTERS,` and `type AuditResultFilter,` to the `@taskop/contracts` import;
- in the header row, after the lead-time `TableHead`, add:

```tsx
                <TableHead>{t('audits.web.resultFilter')}</TableHead>
```

- in `RuleRow`, after the lead-time `TableCell`, add:

```tsx
      <TableCell>
        {meta.hasResultFilter ? (
          <NativeSelect
            aria-label={name(t('audits.web.resultFilter'))}
            value={draft.resultFilter ?? ''}
            onChange={(e) => set('resultFilter', e.target.value as AuditResultFilter)}
            className="w-40"
          >
            {AUDIT_RESULT_FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`notifications.resultFilters.${f}`)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
```

- [ ] **Step 5: Link the audit notifications to their tab**

In `apps/web/src/features/notifications/labels.ts`:
- replace the first import with:

```ts
import { DELIVERY_STATUSES, type DeliveryCounts, isProblemType, type NotificationItem, type NotificationType } from '@taskop/contracts';
import type { OccurrenceTab } from '@/features/scheduling/occurrence-dialog';
```

- before `notificationLink`, add:

```ts
/** SP8: the run dialog tab an audit notification is about (decision 18). Problems open the execution tab. */
const RUN_TABS: Partial<Record<NotificationType, OccurrenceTab>> = {
  'run.correction_required': 'execution',
  'run.resubmitted': 'corrections',
  'audit.finished': 'audit',
};
```

- in `notificationLink`, replace the whole `if (n.targetKind === 'occurrence') { … }` block with:

```ts
  if (n.targetKind === 'occurrence') {
    const tab: OccurrenceTab | undefined = isProblemType(n.type) ? 'execution' : RUN_TABS[n.type];
    return {
      to: '/schedule',
      search: {
        // Without a date the schedule opens the current week; the drawer still opens the occurrence.
        ...(n.targetDate ? { date: n.targetDate } : {}),
        occurrence: n.targetId,
        ...(tab ? { tab } : {}),
      },
    };
  }
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/notifications && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/notifications/rules-form.ts apps/web/src/features/notifications/rules-form.test.ts apps/web/src/features/notifications/rules-tab.tsx apps/web/src/features/notifications/rules-tab.test.tsx apps/web/src/features/notifications/labels.ts apps/web/src/features/notifications/labels.test.ts
git commit -m "feat(web): add the audit result filter to notification rules and deep-link audit notifications" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: End-to-end: the two spec §10 flows, object storage and mail in CI; final checks

**Files:**
- Create: `apps/web/e2e/audits.spec.ts`
- Modify: `.github/workflows/ci.yml` (the `e2e` job)

**Interfaces:**
- Consumes the whole of this part, and Part 1 Tasks 5–17:
  - **Setup, as in the earlier specs:** `POST /auth/signup`, `GET /site-types`, `POST /sites`, `GET /roles`, `POST /users/workers`, `GET /templates`, `POST /checklists`, `GET /checklists/:id/draft`, `POST /checklists/:id/publish`, `POST /assignments`, `GET /checklists/:id`, `GET /occurrences/:id`.
  - **The phone, stood in for by the API:**
    - `POST /auth/login/worker`, `GET /me/sync`;
    - `POST /executions`, `POST /executions/:id/media`, then a presigned `PUT` to SeaweedFS and `POST /media/:id/uploaded`;
    - `PUT /executions/:id/answers`, `POST /executions/:id/complete`;
    - in rework: `GET /me/sync` (`rework`, `reworkRound`), `PUT /executions/:id/answers`, `POST /executions/:id/resubmit`.
  - **Through the web:** `PATCH /checklists/:id`, `GET /audits`, `POST /executions/:id/audits`, `GET /audits/:id`, `PUT /audits/:id/items/:itemId`, `POST /audits/:id/finish`, `GET /audits/:id/report.pdf`, `POST /executions/:id/send-back`, `GET /executions/:id/corrections`.
  - **The report job:** it builds the PDF, stores it in SeaweedFS and mails it through SMTP (Mailpit).
  - **Imports:** `auditReportFileName`, `SyncResponse`, `ChecklistContent`, `Item` and `MediaUploadTicket` from `@taskop/contracts`; `az` from `@taskop/i18n`; `uuidv7`.
- **Environment:**
  - Postgres with `pnpm db:setup && pnpm db:seed` (the global template "Gündəlik təmizlik yoxlaması" must exist).
  - SeaweedFS on `:8333` with the `taskop-media` bucket, and Mailpit on `:1025`/`:8025`. Locally both come from `docker compose up -d`; CI starts them in Step 2.
  - The API's pg-boss workers on (`JOBS_ENABLED=true`, the default).
- **Decision 19:**
  - The owner holds every permission (`ALL_PERMISSIONS`), so the owner is both the auditor and the manager.
  - The photo is a real JPEG, taken with `page.screenshot`, so `finish` is never refused for pending media and the PDF embeds it.

- [ ] **Step 1: Write the end-to-end flows**

`apps/web/e2e/audits.spec.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { auditReportFileName, type ChecklistContent, type Item, type MediaUploadTicket, type SyncResponse } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { uuidv7 } from 'uuidv7';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const BIN = 'Zibil qutuları boşaldılıb?';
const BAD_SMELL = 'Pis qoxu var?';

/** The tenant's local date (new tenants are in Asia/Baku, which has no DST). */
const bakuDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

type Call = <T = unknown>(method: string, url: string, data?: unknown) => Promise<T>;

function apiAs(request: APIRequestContext, accessToken: string): Call {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async <T = unknown>(method: string, url: string, data?: unknown): Promise<T> => {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

interface Tenant {
  suffix: string;
  orgCode: string;
  email: string;
  password: string;
  owner: Call;
  workerSecret: string;
  checklistId: string;
  checklistName: string;
  yesterday: string;
}

/** A tenant with a site, a worker and a published checklist from a Taskop template, assigned once for yesterday. */
async function setupTenant(request: APIRequestContext, checklistName: string): Promise<Tenant> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-aud-${suffix}`;
  const email = `aud-${suffix}@example.az`;
  const password = 'e2e owner password';
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Audit MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
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
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: checklistName, from: { kind: 'global', templateId: template.id } });
  const draft = await owner<{ revision: number }>('GET', `/checklists/${checklist.id}/draft`);
  await owner('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });
  // Open from yesterday 00:00 to tomorrow 00:00 in Baku, so the test never races midnight.
  const yesterday = bakuDate(new Date(Date.now() - 86_400_000));
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 2880, graceMinutes: 0 },
  });
  return { suffix, orgCode, email, password, owner, workerSecret: worker.generatedSecret, checklistId: checklist.id, checklistName, yesterday };
}

async function signIn(page: Page, t: Tenant): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(t.email);
  await page.getByLabel('Şifrə', { exact: true }).fill(t.password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await expect(page.getByRole('heading', { name: 'İdarə paneli' })).toBeVisible();
}

interface Run {
  occurrenceId: string;
  executionId: string;
  phone: Call;
  stamp: () => { deviceTime: string; clientOffsetMs: number };
  item: (label: string) => Item;
}

/**
 * The phone completes the run: one uploaded photo; every yes/no "Bəli" except the bin (a normal rule problem) and
 * "Pis qoxu var?" (where "Xeyr" is the good answer). Ten items are visible.
 */
async function completeRun(request: APIRequestContext, t: Tenant, jpeg: Buffer): Promise<Run> {
  const login = await request.post('/api/v1/auth/login/worker', { data: { orgCode: t.orgCode, username: 'nigar', secret: t.workerSecret, client: 'mobile' } });
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
  const ticket = await phone<MediaUploadTicket>('POST', `/executions/${executionId}/media`, {
    id: photoId,
    itemId: photoItem.id,
    kind: 'photo',
    source: 'camera',
    mime: 'image/jpeg',
    bytes: jpeg.length,
    width: 64,
    height: 48,
    capturedAt: new Date().toISOString(),
    ...stamp(),
  });
  // The presigned PUT, as the phone sends it; Playwright sets Content-Length from the body itself.
  const put = await request.put(ticket.uploadUrl!, { headers: { 'Content-Type': 'image/jpeg' }, data: jpeg });
  expect(put.ok(), `upload: ${await put.text()}`).toBeTruthy();
  await phone('POST', `/media/${photoId}/uploaded`, {});

  const answers: Record<string, Record<string, unknown>> = {};
  for (const i of items) {
    if (i.type === 'yes_no') answers[i.id] = { optionIds: [[BIN, BAD_SMELL].includes(i.label) ? i.options[1].id : i.options[0].id] };
    if (i.type === 'single_choice') answers[i.id] = { optionIds: [i.options[0]!.id] };
  }
  answers[photoItem.id] = { photos: [photoId] };
  await phone('PUT', `/executions/${executionId}/answers`, { rev: 1, answers, ...stamp() });
  const completed = await phone('POST', `/executions/${executionId}/complete`, { rev: 2, answers, completedAt: new Date().toISOString(), ...stamp() });
  expect(completed).toMatchObject({ state: 'completed', score: { percent: 87.5 } });
  return { occurrenceId: occurrence.id, executionId, phone, stamp, item };
}

/** A small real JPEG of the page, for the photo item (decision 19). */
const jpegOf = (page: Page) => page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: 64, height: 48 } });

const progress = (page: Page, reviewed: number, total = 10) =>
  page.getByText(az.audits.progress.replace('{{reviewed}}', String(reviewed)).replace('{{total}}', String(total)), { exact: true });

/** The first item approved with A, the bin rejected with a comment, the other eight approved with A. */
async function reviewAll(page: Page) {
  const items = page.getByRole('navigation', { name: az.audits.web.screen.items });
  await expect(items.getByRole('button')).toHaveCount(10);
  await expect(progress(page, 0)).toBeVisible();
  await expect(items.getByRole('button', { name: 'Döşəmə təmiz və qurudur?' })).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('a');
  await expect(progress(page, 1)).toBeVisible();
  const bin = items.getByRole('button', { name: BIN });
  await expect(bin).toHaveAttribute('aria-current', 'true');
  await page.getByLabel(az.audits.fields.comment).fill('Zibil qutuları dolu idi');
  await page.getByRole('button', { name: az.audits.actions.reject }).click();
  await expect(progress(page, 2)).toBeVisible();
  await expect(bin).toHaveAttribute('data-verdict', 'rejected');
  for (let n = 3; n <= 10; n++) {
    await page.keyboard.press('a');
    await expect(progress(page, n)).toBeVisible();
  }
  return { items, bin };
}

test('a checklist that requires audit: the run waits, the auditor fails it, the PDF downloads and is mailed', async ({ page, request }) => {
  test.setTimeout(180_000);
  const t = await setupTenant(request, 'E2E audit');
  const reportTo = `audit-${t.suffix}@example.az`;
  await signIn(page, t);

  // The checklist requires audit and mails its report to one address (decision 15).
  await page.goto(`/checklists/${t.checklistId}`);
  const settings = page.getByRole('region', { name: az.audits.web.settings.title });
  await settings.getByRole('switch', { name: az.audits.fields.requiresAudit }).click();
  await settings.getByLabel(az.audits.fields.reportEmails).fill(reportTo);
  await settings.getByLabel(az.audits.fields.reportEmails).press('Enter');
  await settings.getByRole('button', { name: 'Yadda saxla' }).click();
  await expect
    .poll(async () => t.owner<{ requiresAudit: boolean; auditReportEmails: string[] }>('GET', `/checklists/${t.checklistId}`))
    .toMatchObject({ requiresAudit: true, auditReportEmails: [reportTo] });

  // The worker completes the run: it goes straight to audit_pending.
  const run = await completeRun(request, t, await jpegOf(page));
  expect(await t.owner('GET', `/occurrences/${run.occurrenceId}`)).toMatchObject({ status: 'audit_pending' });

  // The audit queue: Waiting has the run.
  await page.getByRole('link', { name: az.nav.audits }).click();
  await expect(page.getByRole('tab', { name: az.audits.queues.waiting })).toHaveAttribute('aria-selected', 'true');
  const row = page.getByRole('row').filter({ hasText: 'E2E audit' });
  for (const text of ['Anbar №1', 'Nigar Səfərli']) await expect(row).toContainText(text);
  await row.getByRole('button', { name: az.audits.actions.start }).click();
  await expect(page).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E audit' })).toBeVisible();

  // The photo is in the existing viewer.
  await page.getByRole('navigation', { name: az.audits.web.screen.items }).getByRole('button', { name: 'Ümumi görünüşün fotosu' }).click();
  await expect(page.getByRole('region', { name: 'Ümumi görünüşün fotosu' }).getByRole('button', { name: 'Bax: Foto' })).toBeVisible();
  await page.getByRole('navigation', { name: az.audits.web.screen.items }).getByRole('button', { name: 'Döşəmə təmiz və qurudur?' }).click();

  await reviewAll(page);

  // Finish: failed, with a comment; the checklist's address is listed.
  await page.getByRole('button', { name: az.audits.actions.finish }).click();
  const dialog = page.getByRole('dialog', { name: az.audits.web.finish.title });
  await expect(dialog.getByText(reportTo)).toBeVisible();
  await dialog.getByRole('radio', { name: az.audits.results.failed }).check();
  await dialog.getByLabel(az.audits.fields.comment).fill('Zibil qutuları vaxtında boşaldılmır.');
  await dialog.getByRole('button', { name: az.audits.web.finish.submit }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(az.audits.statuses.finished, { exact: true })).toBeVisible();
  await expect(page.getByText(az.audits.results.failed, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: az.audits.actions.approve })).toHaveCount(0);

  // The PDF: built by the job, then downloaded under the server's name.
  const report = page.getByRole('region', { name: az.audits.web.report.title });
  const download = report.getByRole('button', { name: az.audits.actions.downloadReport });
  await expect(download).toBeEnabled({ timeout: 60_000 });
  const downloading = page.waitForEvent('download');
  await download.click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe(auditReportFileName('E2E audit', t.yesterday));
  expect((await readFile(await file.path())).subarray(0, 4).toString('latin1')).toBe('%PDF');

  // The e-mail, with the PDF attached (spec §7.2).
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${reportTo}"`)}`);
        if (!res.ok()) return null;
        const body = (await res.json()) as { messages: Array<{ Subject: string; Attachments: number }> };
        return body.messages.map((m) => ({ subject: m.Subject.startsWith('Audit hesabatı: E2E audit'), attachments: m.Attachments }));
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toEqual([{ subject: true, attachments: 1 }]);
});

test('a run sent back during its audit: the worker fixes the flagged item, its verdict is reset, the auditor finishes', async ({ page, request }) => {
  test.setTimeout(180_000);
  const t = await setupTenant(request, 'E2E düzəliş');
  await signIn(page, t);
  const run = await completeRun(request, t, await jpegOf(page));
  const bin = run.item(BIN);
  if (bin.type !== 'yes_no') throw new Error('the bin item is a yes/no question');

  // An on-demand audit from the run dialog's Audit tab.
  await page.goto(`/schedule?date=${t.yesterday}&occurrence=${run.occurrenceId}&tab=audit`);
  await page.getByRole('dialog', { name: 'E2E düzəliş' }).getByRole('button', { name: az.audits.actions.start }).click();
  await expect(page).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);
  const auditUrl = page.url();
  const { items } = await reviewAll(page);

  // The manager sends the bin back from the run.
  await page.getByRole('link', { name: az.audits.web.screen.openRun }).click();
  const runDialog = page.getByRole('dialog', { name: 'E2E düzəliş' });
  await expect(runDialog.getByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
  await runDialog.getByRole('button', { name: az.corrections.actions.sendBack }).click();
  const sendBack = page.getByRole('dialog', { name: az.corrections.web.sendBack.title });
  await sendBack.getByRole('checkbox', { name: BIN }).click();
  await sendBack.getByRole('textbox', { name: az.corrections.web.sendBack.comment.replace('{{item}}', BIN) }).fill('Qutuları boşaldın və yenidən göndərin');
  await sendBack.getByRole('button', { name: az.corrections.actions.sendBack }).click();
  await expect(sendBack).toBeHidden();
  await expect(runDialog.getByText(az.corrections.web.rework.flagged)).toBeVisible();

  // The audit is paused while the worker fixes it.
  await page.goto(auditUrl);
  await expect(page.getByText(az.audits.paused)).toBeVisible();
  await expect(page.getByRole('button', { name: az.audits.actions.finish })).toBeDisabled();

  // The worker's phone: only the bin is flagged; it is fixed and resubmitted.
  const sync = await run.phone<SyncResponse>('GET', '/me/sync');
  const reworked = sync.executions.find((x) => x.id === run.executionId)!;
  expect(reworked).toMatchObject({
    state: 'rework',
    reworkRound: 1,
    rework: { round: 1, requestedBy: { fullName: 'Leyla Quliyeva' }, items: [{ itemId: bin.id, comment: 'Qutuları boşaldın və yenidən göndərin' }] },
  });
  // The guard's starting point: the answers at send-back, the bin still "Xeyr".
  expect(reworked.rework!.answersBefore[bin.id]).toEqual({ optionIds: [bin.options[1].id] });
  const fixed = { ...reworked.answers, [bin.id]: { optionIds: [bin.options[0].id] } };
  await run.phone('PUT', `/executions/${run.executionId}/answers`, { rev: reworked.answersRev + 1, answers: fixed, ...run.stamp() });
  expect(await run.phone('POST', `/executions/${run.executionId}/resubmit`, { resubmittedAt: new Date().toISOString(), ...run.stamp() })).toMatchObject({
    state: 'completed',
    status: 'audit_pending',
  });

  // The audit resumes: the changed item's verdict was reset, and its original answer is one click away.
  await page.reload();
  await expect(page.getByText(az.audits.paused)).toHaveCount(0);
  await expect(progress(page, 9)).toBeVisible();
  const binButton = items.getByRole('button', { name: BIN });
  await expect(binButton).toHaveAttribute('data-verdict', 'none');
  await binButton.click();
  const panel = page.getByRole('region', { name: BIN });
  await expect(panel).toContainText('Bəli');
  await panel.getByRole('button', { name: az.corrections.original }).click();
  await expect(panel).toContainText('Xeyr');
  await page.keyboard.press('a');
  await expect(progress(page, 10)).toBeVisible();

  await page.getByRole('button', { name: az.audits.actions.finish }).click();
  const dialog = page.getByRole('dialog', { name: az.audits.web.finish.title });
  await dialog.getByRole('radio', { name: az.audits.results.passed }).check();
  await dialog.getByRole('button', { name: az.audits.web.finish.submit }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(az.audits.statuses.finished, { exact: true })).toBeVisible();
  await expect(page.getByText(az.audits.results.passed, { exact: true })).toBeVisible();

  // The run's Corrections tab: the original and current answer, and the round.
  await page.goto(`/schedule?date=${t.yesterday}&occurrence=${run.occurrenceId}&tab=corrections`);
  const corrections = page.getByRole('dialog', { name: 'E2E düzəliş' });
  const diffRow = corrections.getByRole('row').filter({ hasText: BIN });
  await expect(diffRow).toContainText('Xeyr');
  await expect(diffRow).toContainText('Bəli');
  await expect(corrections.getByText('Leyla Quliyeva icranı düzəlişə qaytardı', { exact: false })).toBeVisible();
  await expect(corrections.getByText(az.corrections.web.timeline.resubmitted, { exact: false })).toBeVisible();
});
```

- [ ] **Step 2: Give the CI e2e job object storage and a mail catcher**

In `.github/workflows/ci.yml`, in the `e2e` job:
- replace the S3 lines of `env` (and their comment) with:

```yaml
      # SeaweedFS and Mailpit run as containers (step below): the audit report is stored there and mailed (SP8).
      S3_ENDPOINT: http://localhost:8333
      S3_PUBLIC_ENDPOINT: http://localhost:8333
      S3_ACCESS_KEY: taskop
      S3_SECRET_KEY: taskop_dev_password
```

- add this step right after `- run: pnpm build`:

```yaml
      - name: Start object storage and the mail catcher
        env:
          AWS_ACCESS_KEY_ID: taskop
          AWS_SECRET_ACCESS_KEY: taskop_dev_password
          AWS_DEFAULT_REGION: us-east-1
        run: |
          docker run -d --name seaweedfs -p 8333:8333 -v "$PWD/docker/seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro" chrislusf/seaweedfs:latest server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/data
          docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit:latest
          for i in $(seq 1 30); do
            aws --endpoint-url http://localhost:8333 s3api head-bucket --bucket taskop-media 2>/dev/null && break
            aws --endpoint-url http://localhost:8333 s3api create-bucket --bucket taskop-media 2>/dev/null && break
            sleep 2
          done
          aws --endpoint-url http://localhost:8333 s3api head-bucket --bucket taskop-media
```

The credentials are the ones `docker/seaweedfs/s3.json` defines for local development. `SMTP_URL: smtp://localhost:1025` is already set for the job, so the API mails into Mailpit.

- [ ] **Step 3: Run the end-to-end tests**

Prerequisites:
- Part 1 Tasks 5–17 merged.
- `docker compose up -d` (Postgres, Mailpit, SeaweedFS and its bucket).
- `apps/api/.env` filled in from `apps/api/.env.example` (the S3, SMTP and `JOBS_*` defaults are right).
- `pnpm db:setup && pnpm db:seed` done, so the migrations include `0015` and `0016`.

```bash
pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client build
pnpm --filter @taskop/api build
pnpm --filter @taskop/web e2e -- audits
```

Expected: PASS for both tests.

If it fails, check these first; do not add sleeps:
- **The upload fails:** SeaweedFS or its bucket is missing. Check `docker compose ps`, and the `seaweedfs-init` log.
- **The download stays disabled for 60 s:** look in the API log for the `audit.report` job. Either pg-boss is off (`JOBS_ENABLED`), or storage refused the PDF.
- **The mail poll ends with `[]`:** the API's `SMTP_URL` does not point at Mailpit.

- [ ] **Step 4: Run every check**

```bash
pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint && pnpm --filter @taskop/web test && pnpm --filter @taskop/web build
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @taskop/web e2e
```

Expected: all green. The earlier e2e specs still pass:
- `executions.spec.ts` opens the run dialog on İcra and finds its answers as before.
- `reports.spec.ts`'s Excel export of the runs table has two more columns, which it does not read.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/audits.spec.ts .github/workflows/ci.yml
git commit -m "test(web): add the audit and send-back end-to-end flows, with storage and mail in CI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec §8.3, and the web lines of §9 and §10:**

| Requirement | Where |
|---|---|
| `/audits` in the sidebar for `audits.perform` | Task 6 (`NAV_ITEMS`, app-shell test) |
| Tabs Waiting / In progress / Finished; filters for site, checklist, auditor, result and dates; paged table | Task 2 (`auditsSearch`, `queueFilters`, `queueRangeIssue`, `useAuditQueue`), Task 6 (`AuditsPage`); decisions 2, 3 |
| A row opens the audit; Waiting rows offer "Start audit"; `AUDIT_EXISTS` opens `ApiError.auditId` | Task 2 (`startOrOpenAudit`), Task 6 (`useStartAudit`, tests); decision 4 |
| Audit screen: items by section with verdict chips and a progress bar | Task 4 (`ItemList`, `AuditView`); decision 5 |
| Item panel: question, answer with the "Original" toggle, media in the existing viewer, the problem, Approve/Reject with a comment | Task 4 (`ItemPanel`); decision 6 |
| Keyboard ↑/↓, A, R | Task 4 (`useEffectEvent` listener, tests); Global Constraints |
| Paused banner | Task 4 (banner), Task 5 (Finish disabled) |
| Finish dialog: result, comment, the checklist's addresses (read-only), extra addresses; `AUDIT_INCOMPLETE` highlights the items | Task 5 (`FinishDialog`, `showMissing`); decision 7 |
| Finished audit read-only, with PDF download, report status and Resend; `REPORT_NOT_READY` polling every 3 s up to 60 s; Retry for a failed report | Task 2 (`useAuditDetail`), Task 5 (`ReportPanel`, `ResendDialog`); decision 9 |
| Read-only for `reports.view` without `audits.perform` | Task 4, Task 5 (viewer tests); decision 10 |
| Run dialog: Audit tab with a summary and a link, or "Start audit" | Task 7 (`RunAuditTab`); decision 14 |
| Run dialog: Corrections tab with a timeline and an original-vs-current diff | Task 7 (`CorrectionsTab`, `correctionTimeline`, `answerSummary`); decision 14 |
| Execution tab: Correct answers (inline values-only edit, reason dialog, `ANSWERS_CONFLICT` reload, `REQUIREMENTS_UNMET`) behind `executions.correct` and the status rules | Task 8 (`AnswerEditor`, `correctionChanges`), Task 9 (`CorrectAnswers`, `RunActions`); decision 11 |
| Execution tab: Send back (item picker, a comment for each, optional due date) and Withdraw | Task 10 (`SendBackDialog`, `RunActions`, `ReworkBanner`); decisions 12, 13 |
| Checklist settings: "Requires audit" switch and the report e-mail tag input | Task 3 (`EmailListInput`), Task 11 (`AuditSettings`); decision 15 |
| Reports runs tab: Audit column, corrected marker, audit-state filter; the export passes it | Task 12; decision 16 |
| Problems page: cleared problems hidden by default, "Show cleared" | Task 13; decision 17 |
| Notification rules: `resultFilter` only for `audit.finished`; the `audit` group; deep links for the three new types | Task 14; decision 18 |
| Due dates and date-time answers on the tenant's clock (§9) | Task 8 (`isoToLocalInput`, `localInputToIso`, tests), Task 10 (due date test) |
| Two managers correcting at once (§9) | Task 9 (`reloads the run and starts over…`) |
| §10 web tests: queue tabs and filters; the audit screen (verdicts, keyboard, paused banner, finish validation); Correct and Send back; Corrections diff; checklist settings; reports column | Tasks 6, 4, 5, 9, 10, 7, 11, 12 |
| §10 e2e 1: the checklist requires audit; a run completed through the API; the auditor reviews and finishes on the web; the PDF downloads | Task 15, first test (plus the e-mail check) |
| §10 e2e 2: a manager sends a run back; the worker resubmits through the API; the audit resumes with the changed verdict reset; the auditor finishes | Task 15, second test |
| Web strings under `az.audits.web.*` / `az.corrections.web.*` | Task 1 |

**Review Focus:** each of the five lines names its test:
- Task 9: the concurrent correction.
- Task 4: shortcut keys typed as text, and R without a comment.
- Task 5: a slow, not-ready or failed report; finishing with unreviewed items.
- Task 3: hand-typed and pasted addresses.

**Placeholder scan:** every step has complete code or an exact command with its expected result. Edits to existing files name the exact text they replace or follow, and show the new text:
- `router.tsx`, `app-shell.tsx`, `occurrence-dialog.tsx`, `routes.tsx`, `execution-tab.tsx`, `answers-view.tsx`, `problems-page.tsx`, `checklist-detail-page.tsx`;
- the reports files and the notifications files;
- the Part 1 i18n files and `ci.yml`.

Task 1 Step 6 is conditional on purpose: it changes the fixtures only if Part 1 has not already done so.

**Type consistency:**
- **Task 2 names, with these exact names in Tasks 4–15:**
  - `AuditsSearch`, `auditsSearch`, `DEFAULT_QUEUE`, `queueFilters`, `AuditQueueFilters`, `queueRangeIssue`, `RANGE_ISSUE_KEYS`;
  - `REPORT_POLL_MS`, `REPORT_POLL_LIMIT_MS`;
  - `resultVariant`, `runAuditStateVariant`, `verdictVariant`;
  - `auditItems`, `verdictMap`, `stepItem`, `actorName`, `upsertVerdict`;
  - `auditKeys`, `useAuditQueue`, `useAuditorOptions`, `useAuditDetail` (returning `{ query, timedOut, restartPolling }`), `startOrOpenAudit`;
  - `refreshRunViews(qc)`;
  - the fixtures `AUDIT_IDS`, `AUDITOR`, `auditDto`, `auditFixture`, `verdict`, `queueRow`, `apiError`.
- **Later tasks:**
  - Task 6: `useStartAudit()`, used in Task 7.
  - Task 3: `EmailListInput`, used in Tasks 5 and 11.
  - Task 7:
    - `OCCURRENCE_TABS` and `OccurrenceTab`, used in `routes.tsx` and Task 14;
    - `correctionTimeline`, `answerSummary`, `scoreText`, `useCorrections`;
    - the fixtures `reworkRequest`, `correction`, `noCorrections`, `MANAGER`.
  - Task 8: `isoToLocalInput`, `localInputToIso`, `pruneAnswer`, `correctionAnswer`, `correctionChanges`, `CorrectionChange`; `AnswerEditor`, used in Task 9.
  - Task 9: `CorrectAnswers`, and `RunActions`, rewritten whole in Task 10 with the same props.
  - Task 12: `useReportRuns(filters, bucket, auditState)`, `reportKeys.runs(f, bucket, auditState)`, and the `auditState` prop on `exportQuery`, `ExportMenu` and `RunsTab`.
- **Signatures that meet across tasks:**
  - `AuditView({ audit })` in Task 4 becomes `AuditView({ audit, report })` in Task 5, which also replaces `AuditScreen`, its only caller.
  - `CountedExecution` gains `status` in Task 9, and Task 9 also changes its only caller, `ExecutionTab`.

**Names used from Part 1's *Interfaces for Parts 2 and 3*:**
- **Constants and pure rules:** `AUDIT_QUEUES`, `AUDIT_RESULTS`, `RUN_AUDIT_STATES`, `AUDIT_LIMITS` (`reportEmails`, `recipients`, `verdictComment`, `finalComment`, `reason`, `cancelReason`, `queueMaxDays`), `canCorrect`, `canSendBack`, `canWithdrawSendBack`, `canStartAudit`, `missingVerdicts`, `changedItemIds`.
- **Types:** `AuditQueue`, `AuditResult`, `AuditVerdict`, `RunAuditState`, `AuditDetail`, `AuditDto`, `AuditBrief`, `AuditItemVerdict`, `AuditQueueRow`, `AuditQueueQuery`, `AuditActor`, `FinishAuditInput`, `ExecutionCorrections`, `Correction`, `ReworkRequest` (with `answersBefore` and a nullable `requestedBy`), `CorrectAnswersInput`, `SendBackInput`, `Score`.
- **Changes to existing contracts:**
  - `ExecutionDetail.{reworkRound, rework, corrected, audit}`, `ExecutionProblem.clearedAt`, `ProblemDto.clearedAt`, `problemListQuerySchema.includeCleared`;
  - `ChecklistDetail.{requiresAudit, auditReportEmails}`, `ReportRun.{auditState, corrected}`, `auditState` on the runs and export queries;
  - `OCCURRENCE_STATUSES` (`correction_required`), `EXECUTION_STATES` (`rework`);
  - `NOTIFICATION_TYPES` (three new), `NOTIFICATION_GROUPS` (`audit`), `NotificationTypeMeta.hasResultFilter`, `AUDIT_RESULT_FILTERS`, `AuditResultFilter`, `DefaultRule.resultFilter`, `resultFilter` on the rule DTO and the update input;
  - `auditReportFileName` (e2e only).
- **The API client:** `api.audits.{list, start, get, setVerdict, clearVerdict, finish, cancel, sendReport, downloadReport}`, `api.corrections.{correct, sendBack, withdraw, history}`, and `ApiError.{auditId, itemIds}` (with the existing `.missing` and `.fields`).
- **Strings:** `az.audits.*` (with `issues.notAuditable`) and `az.corrections.*` as listed there (`round` is "Raund {{round}}"), `az.errors.*` (with the existing `MEDIA_NOT_FOUND_IN_STORAGE`), `az.nav.audits`, `az.notifications.{types, groups.audit, resultFilters, issues.resultFilterNotApplicable}`, `az.scheduling.statuses.correction_required`, `az.executions.states.rework`.
- **Server behaviour:** the permissions, statuses, errors, notification targets, report file name, checklist field keys and ordering in Part 1's *Server behaviour Parts 2 and 3 rely on*; the run dialog's dependence on `GET /occurrences/:id` (Gap 2).

*Gaps against Part 1* lists what is left beyond that section: the auditor picker's source (Gap 1), the run dialog's need for `assignments.view` or `reports.view` (Gap 2), and no platform-admin UI for runs (Gap 3). None needs a change in Part 1.
