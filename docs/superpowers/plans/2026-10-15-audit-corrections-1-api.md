# Taskop Audit and Corrections — Part 1: Contracts & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement sub-project 8 spec §3–§7 on the server side:
- auditors audit completed runs (verdict per item, Passed or Failed, emailed PDF report);
- managers correct a completed run's answers with the original kept;
- managers send a run back to the worker, who fixes the flagged items and resubmits.

This part adds the contracts, i18n strings and `@taskop/api-client` methods those features need, migrations 0015/0016, the corrections flow in the `executions` module, the new `audits` module, the report job, three notification types, and the reports and problems changes.

**Architecture:**
- **Current answers, plus a snapshot, plus a log.**
  - `executions.answers` always holds the current answers, so sync, the run views and reports keep reading one place.
  - The first correction or send-back copies the original answers and score into `executions.original_*`. A trigger keeps those columns from ever changing once set.
  - Every changed item writes one append-only `execution_corrections` row.
  - `recalculate()` recomputes the score and problems after any change. A problem that is no longer derived is *cleared*, never deleted, so tasks made from it (SP5) stay linked.
- **State lives in two existing machines plus one new one.**
  - The occurrence status gains `correction_required`. All moves go through `OccurrenceWriter.recordTransitions`, so status history and `occurrence.status_changed` keep working.
  - The execution state gains `rework`.
  - The new `audits` table has its own `in_progress → finished | cancelled` machine.
  - The pure rules for all three live in `packages/contracts/src/audit-logic.ts`, so the web and the phone show exactly the actions the API will accept.
- **Rework reuses the phone's pipeline.**
  - The existing `PUT /executions/:id/answers` and `POST /executions/:id/media` accept a `rework` execution, limited to the flagged items.
  - A new `POST /executions/:id/resubmit` closes the round.
  - `/me/sync` always carries the user's `rework` executions, whatever their date.
- **The audit report is a pg-boss job.** It builds the PDF with SP7's pdfmake + Noto Sans setup, stores it in SeaweedFS, and mails it as an attachment through `SmtpMailer`, one message per recipient.
- **Module boundary (NFR-15.02).**
  - `audits` depends on `executions`, `scheduling`, `storage`, `mail` and `notifications`; nothing depends on `audits`.
  - `executions` reads only `audits.status`/`id` through a small `AuditLookup`, defined in `executions` and implemented by plain SQL. It needs this to pause audits and reset verdicts.

**Tech Stack:** Node 24, TypeScript 7, NestJS 12, nestjs-zod 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18, pg-boss 12, nodemailer, pdfmake 0.3 (already a dependency since SP7), Vitest 5, Testcontainers (Postgres), supertest. **No new packages.**

**Spec:** `docs/superpowers/specs/2026-10-15-audit-corrections-design.md`

**This plan is Part 1 of 3:**
- Part 1 (this file): contracts, i18n, api-client, migrations, the API, API tests.
- Part 2 (`apps/mobile`): `docs/superpowers/plans/2026-10-15-audit-corrections-2-mobile.md`.
- Part 3 (`apps/web` + e2e): `docs/superpowers/plans/2026-10-15-audit-corrections-3-web.md`.
- Parts 2 and 3 are written against **Interfaces for Parts 2 and 3** below and do not depend on each other.
- **Tasks 1–4 unblock Parts 2 and 3.** They need nothing from the API, and give both apps every type, schema, pure rule, i18n key, permission key, error code and api-client method.
- Task 5 (migrations) and the endpoint tasks must be merged before Parts 2 and 3 run integration or e2e tests against a real API.
- New contract fields are **defaulted** in the schemas (`myExecutionSchema`, `executionDetailSchema`, `problemDtoSchema`, `executionProblemSchema`, `reportRunSchema`, `checklistDetailSchema`, `updateNotificationRuleSchema`), so older payloads still parse. A default still makes the field required in the inferred output type, so Task 2 also adds the new fields, with their default values, to the apps' existing test fixtures and to the API's mappers. The typecheck of the API, the web and the mobile app stays green after every task of this part.

## Global Constraints

- **Naming and locale.** The product name is **Taskop**. Packages are `@taskop/*`. Azerbaijani (`az`) is the only locale; every label, notification, email and PDF string comes from `@taskop/i18n`. The `correction_required` label is exactly **"Düzəliş tələb olunur"** (FR-19.15).
- **Which runs.** Audits, corrections and send-back apply only to runs whose occurrence status is `completed` or `audit_pending` (`CORRECTABLE_STATUSES`) and whose execution state is `completed`. `partial`, `missed`, `cancelled` and `audited` runs are refused. `audited` is refused with **`409 EXECUTION_LOCKED`**; the others with **`409 EXECUTION_NOT_CORRECTABLE`**.
- **Statuses.**
  - `occurrence_status` gains `correction_required`; `execution_state` gains `rework`.
  - `correction_required` joins `COMPLETED_STATUSES` in `report-logic.ts`.
  - `completed_at`, `completed_received_at` and `late` are never rewritten after the first completion.
- **Snapshot.**
  - `executions.original_answers`, `original_score` and `original_captured_at` are written once, in the transaction of the first correction or send-back.
  - A `BEFORE UPDATE` trigger raises if a non-null `original_*` value changes.
  - `execution_corrections` is `INSERT, SELECT` only for `taskop_app`.
- **Limits** (`AUDIT_LIMITS`):
  - checklist report emails ≤ **10**, recipients per send ≤ **20**;
  - verdict comment ≤ **1000** characters, final comment ≤ **4000**;
  - correction reason **1–1000**, rework item comment **1–1000**, cancel reason **1–500**;
  - rework items **1–200**, correction changes **1–200**;
  - report photos ≤ **3** per item and ≤ **40** per report.
- **Report job.** Queue `audit.report`, with the SP6 worker settings the spec names: pg-boss options `retryLimit: 5`, `retryDelay: 15`, `retryDelayMax: 240` (backoff), `localConcurrency: 2`. The job gives up on its 5th failed attempt, as SP6's fan-out does. Storage key `tenants/{tenantId}/audits/{auditId}/report.pdf`. One email per recipient.
- **Report performance** (spec §7.2): 200 items and 40 photos of about 1.5 MB build in **< 10 s** and **< 300 MB** heap growth.
- **Permissions.** Two new keys in two new groups, appended after `reports`, in this order:
  - `executions`: `executions.correct`.
  - `audits`: `audits.perform`.

  Role defaults:
  - Manager gets `executions.correct`; Auditor gets `audits.perform`.
  - Owner and Admin get both through `ALL_PERMISSIONS`; Worker gets neither.
  - `0016` backfills the existing `admin`, `manager` and `auditor` roles and bumps `version`, following `0014_reports_permissions.sql`.
- **Scope.** Every new endpoint finds runs through `SchedulingScope.occurrences(principal)`. Out of scope is `404 NOT_FOUND`, never 403.
- **Migrations.**
  - `0015_audit_corrections.sql` (generated) holds only the two `ALTER TYPE … ADD VALUE` statements.
  - `0016_audit_corrections_tables.sql` is generated from the schema (tables, columns, indexes), then extended by hand with the trigger, grants, RLS policies and the permission backfill. Generating it keeps drizzle-kit's snapshot in step with the schema.
  - Drizzle's migrator applies every pending migration in **one** transaction, and PostgreSQL can't use an enum value in the transaction that added it. So `0016` must never mention `'correction_required'` or `'rework'`: no check constraint, index predicate or backfill may use them.
- **Errors.** Exactly these new codes. Everything else uses existing codes.
  - `EXECUTION_LOCKED` 409, `EXECUTION_NOT_CORRECTABLE` 409, `ANSWERS_CONFLICT` 409
  - `ITEM_NOT_IN_REWORK` 422, `MEDIA_NOT_CORRECTABLE` 422
  - `AUDIT_EXISTS` 409 (body `auditId`), `AUDIT_PAUSED` 409, `AUDIT_INCOMPLETE` 422 (body `itemIds`), `AUDIT_NOT_IN_PROGRESS` 409
  - `REPORT_NOT_READY` 409
  - The spec's `MEDIA_PENDING` on finish isn't a new code: finish answers the existing `422 MEDIA_NOT_FOUND_IN_STORAGE` when a medium that the current answers reference is still `pending` and not purged.
- **Audit log.**
  - Actions: `audit.started`, `audit.finished`, `audit.cancelled`, `audit.report_sent` (entity type `audit`, entity id = audit id).
  - Actions: `execution.corrected`, `execution.sent_back`, `execution.send_back_withdrawn`, `execution.resubmitted` (entity type `execution`, entity id = execution id).
  - `before`/`after` hold only the changed items. Verdict edits are not audit-logged.
- **Notifications.** New rule types `run.correction_required`, `run.resubmitted` and `audit.finished`, in a new group `audit`. `audit.finished` has a `resultFilter` (`any` | `failed`), default `failed`, which applies to the whole rule.

### Spec decisions this plan makes (ambiguities and gaps, resolved)

1. **Auditable items** are the items **visible for the run's current answers** (`visibleItems(content, answers)`). Every item type is answerable, so there are no section headers or info blocks to skip. `finish` needs a verdict on every auditable item. Verdicts on items that are no longer visible are kept but ignored in the score.
2. **What a correction can change.**
   - `correctionAnswerSchema` = `answerSchema` **without `problem`**. The item's manual problem is copied over unchanged, so managers never edit worker-reported problems.
   - `photos`/`videos` in a correction must be a subset of the media the item already references (`MEDIA_NOT_CORRECTABLE`). A manager can unlink evidence, never add it.
   - `answer: null` clears the item's answer, apart from its manual problem.
3. **Corrections keep the run completable.** After the changes are applied, `requirements(content, answers)` must be empty, otherwise `422 REQUIREMENTS_UNMET` with `missing`. This matters when a corrected answer reveals a required conditional item.
4. **Concurrency.**
   - Corrections send the `answersRev` they were based on. The service locks the execution row (`SELECT … FOR UPDATE`) and refuses a mismatch with `409 ANSWERS_CONFLICT`.
   - Send-back and withdraw take the same lock, but carry no rev.
5. **Rework writes.**
   - In `rework` state, `PUT /executions/:id/answers` compares the incoming answers with the open request's `answers_before`. Any difference on an item that isn't flagged (nor revealed or hidden by the flagged change, Spec decision 28) fails `422 ITEM_NOT_IN_REWORK`, with `fields.answers.<itemId>`.
   - `rev` handling is unchanged (the stale check), and the rev continues from the stored `answers_rev`.
   - `POST /executions/:id/media` with an `itemId` that isn't flagged fails `ITEM_NOT_IN_REWORK`. With `itemId: null` (a manual problem medium) it is allowed.
6. **Resubmit.**
   - Refused with `409 EXECUTION_NOT_ACTIVE` unless the state is `rework`.
   - Idempotent: a repeat after success (state `completed`, latest request resubmitted) answers 200 with the current result.
   - After a withdraw, it fails `EXECUTION_NOT_ACTIVE`, and the phone drops its rework copy.
7. **Verdict reset.** On resubmit, verdict rows of the open audit are **deleted** for every item whose answer changed in that round.
8. **Sync.**
   - `/me/sync` returns every execution of the caller in state `rework`, together with its occurrence (`status = correction_required`) and pinned version, **regardless of the usual date windows**.
   - `myExecutionSchema.rework` is the open request.
   - A withdrawn or resubmitted run drops out once it falls outside the normal windows.
9. **The partial sweep** (`occurrence-jobs.ts`) only touches `state = 'active'` executions, so `rework` runs never become `partial`. Task 9 pins this with a test.
10. **When the audit is required.**
    - When `complete()` produces `completed` and the checklist has `requires_audit`, the same transaction appends `completed → audit_pending` with the system actor.
    - `partial` completions never enter audit.
11. **On-demand audit of an `audit_pending` run.** A run already waiting in the queue is started as it is, with no status change. Starting from `completed` moves it to `audit_pending`, with the auditor as actor.
12. **Cancelling an audit.** The run goes back to `completed` unless the checklist has `requires_audit`, in which case it stays `audit_pending`. While the run is `correction_required`, cancel is allowed, and the status stays put until resubmit (resubmit then uses `nextStatusAfterResubmit`).
13. **The audit queue's date filter** is on `occurrences.local_date` (`from`/`to`, ≤ 366 days, optional). The pages:
    - **Waiting:** status `audit_pending` with no non-cancelled audit, `completed_at asc`.
    - **In progress:** `audits.status = 'in_progress'`, `started_at desc`.
    - **Finished:** `finished_at desc`.

    Pages hold 50 rows. Cursors are the last row's occurrence id, compared as a tuple, as in `/reports/runs`.
14. **`AUDIT_EXISTS`** is refused with the existing audit's id in the error body (`error.auditId`), so the clients can open it.
15. **`resultFilter`** is stored as `notification_rules.result_filter text null`. It is `null` for every other type, and the API refuses non-null values on them with `VALIDATION_FAILED`.
16. **Notification audiences.**
    - For `run.correction_required` and `audit.finished`, the `assignees` audience means **the executor**.
    - For `run.resubmitted`, the `creator` audience means **the manager who sent the run back**.
    - Role recipients are filtered by data scope over the occurrence, as in SP6.
17. **Platform admins** can audit, correct and send back inside a tenant. They are recorded in `auditor_platform_admin_id`, `execution_corrections.actor_platform_admin_id` and the audit log's platform actor. They can't receive notifications.
18. **Cleared problems.**
    - `GET /problems` and the report problem queries skip `cleared_at is not null` unless `includeCleared=true` (problems list only).
    - `GET /executions/:id` returns every problem, with `clearedAt`.
19. **Reports.**
    - `reportRunSchema` gains `auditState` (`waiting` | `in_progress` | `passed` | `failed` | `null`) and `corrected` (whether the original snapshot exists).
    - `/reports/runs` and its export accept `auditState`.
    - Run exports gain the two columns `Audit` and `Düzəliş edilib`.
20. **The report email** is plain text with the PDF attached. The subject is `Audit hesabatı: {{checklist}} — {{site}}, {{date}}`.
    - A recipient whose send fails is logged at `warn`, and the job doesn't retry for it.
    - The job retries only when **every** send failed, or when building or storing the PDF failed.
    - After the last retry, `report_status = 'failed'`.
21. **Rework saves don't recalculate.** In `rework` state `PUT /executions/:id/answers` stores the answers, the rev and the progress only. Score and problems are recalculated once, by `resubmit`, where the `rework` correction rows exist for `cleared_by_correction_id` to point at.
22. **Withdrawing returns to `status_before`**, with one exception: when `status_before` is `audit_pending`, the audit was cancelled meanwhile and the checklist doesn't require audit, the run returns to `completed` (it would otherwise wait in the queue with no audit to finish).
23. **Every new table has `tenant_id`**, `audit_item_verdicts` included, so its RLS policy is the usual `tenant_id` policy instead of a join through `audits` (spec §4 asks for `tenant_id` on every new table).
24. **Platform admins** reach the write endpoints through platform-tenant controllers (`/platform/tenants/:tenantId/executions/:id/corrections|send-back|send-back/cancel|audits` and `/platform/tenants/:tenantId/audits/…`), as SP2/SP3 do for checklists and occurrences. `GET /executions/:id/corrections` stays tenant-only; platform admins read the history inside `GET /platform/tenants/:tenantId/audits/:id`.
25. **Direct corrections don't reset verdicts.** Only a resubmit does (Spec decision 7); the audit screen shows the corrected value with its "Original" toggle.
26. **Rejected executions** (lost claims) are never audited, corrected or sent back: those endpoints answer `404 NOT_FOUND` for them, as the run's counted execution is a different row.
27. **The report job keeps a counter**, `audits.report_attempts`, like SP6's `notification_events.attempts`, to know when its last retry failed.
28. **Rework follow-ups.** The rework guard (`reworkViolations(content, answersBefore, answers, flagged)`) locks only unflagged items that are visible both in the answers at send-back and in the new answers. A flagged answer that reveals a required follow-up therefore lets the worker answer it (and its own follow-ups), and a follow-up hidden again may keep a leftover answer; otherwise the run could never be resubmitted. The media guard allows a medium whose `itemId` is flagged or not visible in `answers_before`, so registration order doesn't matter. On resubmit, `rework` correction rows are written for changed items visible before or after (a leftover answer hidden on both sides is skipped), with the comment of the item or of its nearest flagged ancestor as the reason (the first flagged item's comment when none exists). `ReworkRequest.answersBefore` gives the phone the same starting point.
29. **"MEDIA_PENDING" is `MEDIA_NOT_FOUND_IN_STORAGE`.** The spec's finish refusal while media is uploading uses the existing `422 MEDIA_NOT_FOUND_IN_STORAGE` code ("Fayl hələ tam yüklənməyib."), so the error list stays at the ten new codes. It applies to media the current answers reference that are `pending` and not purged.

## Review Focus

These are the five failure modes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **The worker's phone resubmits after the manager withdrew the send-back.** The server answers `409 EXECUTION_NOT_ACTIVE`, writes nothing, and the run keeps the status from before. Pinned in Task 9 (`refuses a resubmit after the send-back was withdrawn`).
2. **A correction clears a rule problem that already has a task.** The problem is cleared, not deleted. The task keeps its `problem_id`, and the report problem counts drop by one. Pinned in Task 6 (`clears a problem with a task instead of deleting it`) and Task 17 (`report problem counts skip cleared problems`).
3. **A correction reveals a hidden required item, or hides an item that had a verdict.** The first is refused with `REQUIREMENTS_UNMET`. In the second, the hidden item's verdict no longer blocks `finish` or counts in the score. Pinned in Task 7 (`refuses a correction that leaves a revealed required item unanswered`), Task 12 (`ignores verdicts on items the current answers hide`) and Task 13 (`finishes when only items the answers hide lack a verdict, and leaves them out of the score`).
4. **One bad recipient address or one SMTP failure.** The other recipients still get the report. `report_status` becomes `ready` and `report_sent_at` is set; only a total failure retries. Pinned in Task 15 (`sends to the remaining recipients when one fails`).
5. **Two managers correct the same run at the same moment.** One wins. The other gets `409 ANSWERS_CONFLICT`, and no correction rows or audit entry are written for it. Pinned in Task 7 (`refuses a stale answersRev without writing anything`).

---

## File Structure

```
packages/contracts/src/
  audit-logic.ts (+ test)                   T1  audit/verdict/report/queue/run-audit/correction enums, CORRECTABLE_STATUSES, AUDIT_LIMITS,
                                                canCorrect/canSendBack/canWithdrawSendBack/canStartAudit/isAuditPaused, nextStatusAfterResubmit,
                                                statusAfterAuditCancel, auditableItemIds, auditScore, missingVerdicts, answersEqual, changedItemIds,
                                                reworkViolations, runAuditState, reportRecipients, auditScoreSchema, auditBriefSchema,
                                                auditReportEmailsSchema
  corrections.ts                            T2  correction/send-back/resubmit inputs and results, ReworkRequest, Correction, ExecutionCorrections
  audits.ts (+ audits.test.ts)              T2  AuditDto, AuditDetail, queue query/row/page, verdict/finish/cancel/send inputs, file name
  occurrences.ts, execution-logic.ts        T2  + correction_required, + rework
  report-logic.ts                           T2  COMPLETED_STATUSES + correction_required
  execution-views.ts                        T2  rework fields, audit brief, clearedAt, includeCleared
  checklists.ts                             T2  requiresAudit, auditReportEmails
  reports.ts                                T2  auditState, corrected, auditState filter
  permissions.ts, errors.ts, audit.ts       T2  two groups and defaults; ten codes + auditId/itemIds; AUDIT_FLOW_AUDIT_ACTIONS
  notifications.ts                          T2  three types, audit group, hasResultFilter, AUDIT_RESULT_FILTERS, resultFilter, isAuditType
  index.ts                                  T2  + audit-logic, corrections, audits
  report-logic.test.ts, reports.test.ts,    T2  list/order assertions updated for the new values
  scheduling-resources.test.ts, notifications.test.ts
packages/i18n/src/
  az/audits.ts, az/corrections.ts           T3  new namespaces (UI, PDF and email texts)
  az/scheduling.ts, az/executions.ts        T2  the two new status labels (needed by the API's report export at once)
  az/errors.ts, az/roles.ts, az/audit.ts,   T3  codes, permission labels, audit-log actions, nav entry, notification labels and templates
  az/nav.ts, az/notifications.ts, az/index.ts
  format.ts                                 T3  interpolate()
  i18n.test.ts                              T3  parity tests
packages/api-client/src/
  errors.ts, client.ts                      T4  ApiError.auditId / itemIds
  endpoints.ts, client.test.ts              T4  createAuditsApi (audits + corrections), executions.resubmit
apps/web/src/…, apps/mobile/src/…           T2  test fixtures gain the new defaulted fields (list in Task 2)
apps/api/
  drizzle/0015_audit_corrections.sql        T5  (generated) the two ADD VALUE statements
  drizzle/0016_audit_corrections_tables.sql T5  (generated + hand-extended) tables, columns, index swap, trigger, grants, RLS, backfill
  src/db/schema.ts                          T5  enums, columns, execution_corrections, execution_rework_requests, audits, audit_item_verdicts,
                                                notification_rules.result_filter
  src/common/app-error.ts, error.filter.ts  T7  details auditId/itemIds; audits./corrections. field keys
  src/common/domain-events.ts               T8, T9, T13  execution.sent_back, execution.resubmitted, audit.finished
  src/scheduling/occurrence-writer.ts       T11 Transition.system (system actor in history)
  src/executions/
    recalculation.ts                        T6  ExecutionRecalculator.recalculate (score, progress, problems after close)
    problem-writer.ts                       T6  rewriteAfterClose (clear instead of delete), partial-index upsert
    run-locks.ts                            T7  lockRun (scope, lock order), assertCorrectable, snapshotColumns
    corrections.service.ts                  T7, T8  correct, sendBack, withdraw
    corrections.controller.ts               T7, T8, T10  tenant + platform variants; GET corrections (tenant)
    rework-requests.ts                      T8  ReworkRequests (open/latest request, DTO mapping)
    audit-lookup.ts                         T9  AuditLookup (open audit, verdict reset, brief)
    rework.service.ts                       T9  resubmit
    executions.service.ts                   T9, T11  rework saves; audit_pending on complete
    media.service.ts, sync.service.ts       T9  rework media guard; rework runs in /me/sync
    executions.controller.ts                T9  POST :id/resubmit
    correction-history.ts                   T10 CorrectionHistory.of(executionId)
    execution-queries.ts, mappers.ts,       T10 detail fields, clearedAt, includeCleared, active problem count, access keys
    problem-rows.ts, problems.service.ts, execution-access.ts
    dto.ts, executions.module.ts            T7–T10
  src/checklists/checklists.service.ts      T11 requiresAudit / auditReportEmails on GET and PATCH
  src/audits/
    audits.module.ts                        T12 imports SchedulingModule, ExecutionsModule
    audits.controller.ts                    T12, T13, T15  tenant + platform variants of /audits and /executions/:id/audits
    audits.service.ts                       T12, T13, T15  start, get, setVerdict, clearVerdict, cancel, finish, report, sendReport
    audit-rows.ts                           T12 row → AuditDto / AuditItemVerdict
    audit-queue.ts                          T13 AuditQueueQuery (keyset pages)
    report/answer-text.ts                   T14 answer → printable text
    report/audit-report-builder.ts (+ test) T14 AuditReportData → pdfmake definition → Buffer; photo selection
    report/audit-report-loader.ts           T15 loads AuditReportData (rows in a tenant transaction, photos outside it)
    report/queues.ts                        T13 AUDIT_QUEUES, AUDIT_REPORT_JOB, AuditReportJobData
    report/audit-report.job.ts              T15 pg-boss worker: build, store, mail, retries, failed
    dto.ts                                  T12–T15
  src/mail/mailer.ts, templates.ts (+ tests) T14 attachments; auditReportMail
  src/storage/s3.service.ts                 T15 putObject, getObject
  src/reports/pdf/pdf-document.ts           T14 renderPdf (shared pdfmake entry)
  src/notifications/
    payloads.ts, notification-events.ts     T16 RunPayload
    notification-targets.ts                 T16 RunTarget
    notification-templates.ts               T16 texts of the three types from @taskop/i18n
    notification-recipients.ts              T16 run audiences
    notification-rules.ts, rules.service.ts T2, T16  resultFilter
    notification-fanout.ts                  T16 result filter, 'filtered' outcome
    notification-listeners.ts               T16 three listeners
  src/reports/report-queries.ts,            T17 cleared problems excluded, auditState/corrected, auditState filter, export columns
  reports.service.ts, report-exporter.ts, export/report-tables.ts
  src/app.module.ts                         T12 AuditsModule
  test/
    audit-fixtures.ts                       T7  auditWorld and helpers
    audit-db.test.ts                        T5
    corrections-recalculate.test.ts         T6
    corrections.test.ts                     T7
    send-back.test.ts                       T8
    rework.test.ts                          T9
    corrections-read.test.ts                T10
    audit-required.test.ts                  T11
    audits.test.ts                          T12
    audits-finish.test.ts, audits-queue.test.ts  T13
    png.ts, audit-report-perf.test.ts       T14 (plus src/audits/report/*.test.ts, src/mail/*.test.ts)
    memory-mailer.ts                        T14 attachments, failing recipients
    memory-storage.ts, app.ts               T15 in-memory S3 override
    audit-report-job.test.ts, storage-objects.test.ts  T15
    audit-notifications.test.ts             T16
    audit-reports.test.ts                   T17
    audit-scope.test.ts                     T18
    roles.test.ts, notification-rules-api.test.ts, reports-runs.test.ts, executions-sync.test.ts, openapi.test.ts  (updated)
```

---

## Interfaces for Parts 2 and 3

Everything below is exported from `@taskop/contracts`, `@taskop/i18n` or `@taskop/api-client` once **Tasks 1–4** of Part 1 are merged. Parts 2 and 3 import these names exactly. All instants are ISO-8601 UTC strings; dates are `YYYY-MM-DD` in the tenant's timezone.

### `@taskop/contracts`

**Pure rules** (`audit-logic.ts`, Task 1):
- Constants, each with a `z.enum` schema named `<singular>Schema` and a type:
  - `AUDIT_STATUSES = ['in_progress', 'finished', 'cancelled']` → `type AuditStatus`
  - `AUDIT_RESULTS = ['passed', 'failed']` → `type AuditResult`
  - `AUDIT_VERDICTS = ['approved', 'rejected']` → `type AuditVerdict`
  - `AUDIT_REPORT_STATUSES = ['none', 'pending', 'ready', 'failed']` → `type AuditReportStatus`
  - `AUDIT_QUEUES = ['waiting', 'in_progress', 'finished']` → `type AuditQueue`
  - `RUN_AUDIT_STATES = ['waiting', 'in_progress', 'passed', 'failed']` → `type RunAuditState`
  - `CORRECTION_KINDS = ['manual', 'rework']` → `type CorrectionKind`
- `CORRECTABLE_STATUSES = ['completed', 'audit_pending'] as const satisfies readonly OccurrenceStatus[]`
- `AUDIT_LIMITS = { reportEmails: 10, recipients: 20, verdictComment: 1000, finalComment: 4000, reason: 1000, cancelReason: 500, reworkItems: 200, changes: 200, photosPerItem: 3, photosPerReport: 40, queuePageSize: 50, queueMaxDays: 366 } as const`
- `interface RunState { status: OccurrenceStatus; executionState: ExecutionState }`
- `canCorrect(run: RunState): boolean`: `status ∈ CORRECTABLE_STATUSES && executionState === 'completed'`.
- `canSendBack(run: RunState): boolean`: the same rule as `canCorrect`.
- `canWithdrawSendBack(run: RunState): boolean`: `status === 'correction_required' && executionState === 'rework'`.
- `canStartAudit(run: RunState, hasOpenAudit: boolean): boolean`: `status ∈ CORRECTABLE_STATUSES && executionState === 'completed' && !hasOpenAudit`.
- `isAuditPaused(status: OccurrenceStatus): boolean`: `status === 'correction_required'`.
- `nextStatusAfterResubmit(requiresAudit: boolean, hasOpenAudit: boolean): 'completed' | 'audit_pending'`.
- `statusAfterAuditCancel(requiresAudit: boolean, current: OccurrenceStatus): OccurrenceStatus`: `correction_required` stays; otherwise `audit_pending` if required, else `completed`.
- `auditableItemIds(content: ChecklistContent, answers: Answers): string[]`: the ids of `visibleItems(content, answers)`, in checklist order.
- `auditScore(verdicts: ReadonlyMap<string, AuditVerdict>, auditableIds: readonly string[]): AuditScore`: counts only the auditable ids. `AuditScore = { approved: number; rejected: number; reviewed: number; percent: number | null }`, where `percent = roundOne(approved / reviewed * 100)` and `null` when `reviewed = 0`.
- `missingVerdicts(verdicts: ReadonlyMap<string, AuditVerdict>, auditableIds: readonly string[]): string[]`
- `answersEqual(a: Answer | undefined, b: Answer | undefined): boolean`: deep equality after normalising. Normalising means:
  - `optionIds` are sorted;
  - empty arrays and empty or whitespace-only strings count as absent;
  - `undefined` fields are dropped;
  - the order of `photos`/`videos` matters.
- `changedItemIds(before: Answers, after: Answers): string[]`: every item id in either map whose answer differs by `answersEqual`, sorted in the order of the item ids in `after`, then `before`.
- `reworkViolations(content: ChecklistContent, before: Answers, after: Answers, flagged: ReadonlySet<string>): string[]`: the changed item ids the worker may not change. Allowed are `flagged` ∪ the items not visible in `visibleItems(content, before)` ∪ the items not visible in `visibleItems(content, after)`, so only unflagged items visible both before and after are locked. Follow-ups a flagged change reveals (and chains of them) may be answered, and a follow-up hidden again may keep or drop a leftover answer (Spec decision 28). The server guard calls it with `before = rework.answersBefore`; the phone should too.
- `runAuditState(status: OccurrenceStatus, audit: { status: AuditStatus; result: AuditResult | null } | null): RunAuditState | null`:
  - `null` for a cancelled or absent audit, unless the status is `audit_pending` (then `waiting`);
  - `in_progress` for an in-progress audit;
  - `passed`/`failed` for a finished one.
- `auditScoreSchema`, `auditBriefSchema` and `auditReportEmailsSchema` (described under `audits.ts` below) are defined in `audit-logic.ts`, so `execution-views.ts`, `checklists.ts` and `audits.ts` can all import them without an import cycle. They are exported from `@taskop/contracts` like everything else.
- `reportRecipients(checklistEmails: readonly string[], extra: readonly string[]): string[]`: lower-cased, de-duplicated, checklist addresses first, at most `AUDIT_LIMITS.recipients`.
- Types exported alongside (Task 1 and Task 2): `AuditScore`, `AuditItemVerdict`, `AuditVerdictInput`, `FinishAuditInput`, `CancelAuditInput`, `SendAuditReportInput` (input types, `z.input`), and `Score = z.infer<typeof scoreSchema>` (new in `execution-logic.ts`; the schemas below use it for run scores).

**Schemas** (`corrections.ts`, Task 2):
- `correctionAnswerSchema = answerSchema.omit({ problem: true })` (strict)
- `correctAnswersInputSchema = { answersRev: int ≥ 1; changes: { itemId: uuid; answer: correctionAnswer | null }[] (1–200, item ids unique); reason: string trim 1–1000 }`, with `type CorrectAnswersInput` (input)
- `correctionResultSchema = { executionId; answersRev: int; changedItemIds: uuid[]; score: Score | null }`, with `type CorrectionResult`
- `reworkItemSchema = { itemId: uuid; comment: string trim 1–1000 }`
- `sendBackInputSchema = { items: reworkItem[] (1–200, unique item ids); dueAt?: iso | null }`, with `type SendBackInput`. A `dueAt` earlier than now is checked by the API (`fields.dueAt = 'corrections.issues.dueInPast'`).
- `reworkRequestSchema = { id; round: int; items: reworkItem[]; dueAt: iso | null; requestedBy: UserRef | null /* null = a platform admin (Taskop support) */; requestedAt: iso; resubmittedAt: iso | null; withdrawnAt: iso | null; withdrawnBy: UserRef | null; answersBefore: Answers /* the answers when the run was sent back: the base of reworkViolations */ }`, with `type ReworkRequest`. Returned the same way by send-back and withdraw, `/me/sync` (`MyExecution.rework`), `ExecutionDetail.rework` and `ExecutionCorrections.reworkRequests`.
- `correctionActorSchema = { kind: 'user' | 'platform'; name: string | null }`
- `correctionSchema = { id; itemId; kind: CorrectionKind; round: int; before: Answer | null; after: Answer | null; reason: string; actor: CorrectionActor; at: iso }`, with `type Correction`
- `answerDiffSchema = { itemId; original: Answer | null; current: Answer | null }`
- `executionCorrectionsSchema = { original: { answers: Answers; score: Score | null; capturedAt: iso } | null; corrections: Correction[] /* oldest first */; reworkRequests: ReworkRequest[] /* round asc */; diff: AnswerDiff[] /* changed items only, checklist order */ }`, with `type ExecutionCorrections`
- `resubmitCommandSchema = { resubmittedAt: iso; deviceTime: iso; clientOffsetMs: int }` (the same timing fields as the other commands), with `type ResubmitCommand` (input)
- `resubmitResultSchema = { executionId; state: ExecutionState; status: OccurrenceStatus; progress: ExecutionProgress; score: Score | null }`, with `type ResubmitResult`
- `CORRECTION_ISSUE_CODES = ['corrections.issues.dueInPast', 'corrections.issues.duplicateItem']`

**Schemas** (`audits.ts`, Task 2):
- `auditScoreSchema` matches `AuditScore`.
- `auditActorSchema = { kind: 'user' | 'platform'; id: uuid | null; name: string | null }`
- `auditItemVerdictSchema = { itemId; verdict: AuditVerdict; comment: string | null; updatedBy: UserRef | null; updatedAt: iso }`
- `auditDtoSchema`, with `type AuditDto`:
  - ids: `{ id; executionId; occurrenceId }`
  - state: `status: AuditStatus; paused: boolean /* run is correction_required */`
  - who and when: `auditor: AuditActor; startedAt: iso; finishedAt: iso | null; cancelledAt: iso | null; cancelReason: string | null`
  - outcome: `result: AuditResult | null; score: AuditScore | null; comment: string | null`
  - report: `reportStatus: AuditReportStatus; reportRecipients: string[]; reportSentAt: iso | null`
  - verdicts: `verdicts: AuditItemVerdict[]`
- `auditDetailSchema = auditDtoSchema.extend({ execution: ExecutionDetail; corrections: ExecutionCorrections; auditableItemIds: uuid[]; checklistReportEmails: string[]; requiresAudit: boolean })`, with `type AuditDetail`
- `auditBriefSchema = { id; status: AuditStatus; result: AuditResult | null; percent: number | null; paused: boolean }`, with `type AuditBrief`
- `auditQueueQuerySchema = cursorQuerySchema.extend({ queue: AuditQueue; siteId?; checklistId?; auditorId?; result?: AuditResult; from?: LocalDate; to?: LocalDate })`, with `type AuditQueueQuery` (input). The refine requires `from` and `to` together; `to ≥ from`; a range ≤ 366 days, else `fields.to = 'audits.issues.rangeTooLong'`.
- `auditQueueRowSchema`, with `type AuditQueueRow`, and `auditQueuePageSchema = pageOf(auditQueueRowSchema)`:
  - run: `{ occurrenceId; executionId; auditId: uuid | null; checklist: { id; name }; site: { id; name }; executor: UserRef; localDate; completedAt: iso; status: OccurrenceStatus }`
  - audit: `{ auditState: RunAuditState | null; auditor: AuditActor | null; result: AuditResult | null; percent: number | null; startedAt: iso | null; finishedAt: iso | null }`
- `auditVerdictInputSchema = { verdict: AuditVerdict; comment?: string trim ≤ 1000 | null }`. The refine requires a comment for `rejected` (`path: ['comment']`, `audits.issues.commentRequired`).
- `finishAuditInputSchema = { result: AuditResult; comment?: string trim ≤ 4000 | null; extraEmails?: email[] ≤ 20 (lower-cased, de-duplicated by transform) }`
- `cancelAuditInputSchema = { reason: string trim 1–500 }`
- `sendAuditReportInputSchema = { emails?: email[] 1–20 }`. Absent means the stored recipients.
- `auditReportEmailsSchema = z.array(z.email()).max(10)`, lower-cased and de-duplicated.
- `AUDIT_ISSUE_CODES = ['audits.issues.commentRequired', 'audits.issues.rangeTooLong', 'audits.issues.tooManyEmails', 'audits.issues.notAuditable']`. `notAuditable` is the API's `fields.itemId` when a verdict names an item that the current answers hide.
- `AUDIT_REPORT_CONTENT_TYPE = 'application/pdf'`
- `auditReportFileName(checklistName: string, localDate: LocalDate): string` returns `taskop-audit-<slug>-<localDate>.pdf`. The slug is lower-case ASCII; Azerbaijani letters are transliterated (ə→e, ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u), and anything else becomes `-`.

**Changes to existing contracts** (Task 2):
- `occurrences.ts`: `OCCURRENCE_STATUSES` gains `'correction_required'` (last).
- `execution-logic.ts`: `EXECUTION_STATES` gains `'rework'` (last).
- `report-logic.ts`: `COMPLETED_STATUSES = ['completed', 'audit_pending', 'audited', 'correction_required']`.
- `execution-views.ts`:
  - `myExecutionSchema` gains `reworkRound: z.number().int().default(0)` and `rework: reworkRequestSchema.nullable().default(null)` (the open request).
  - `executionDetailSchema` gains `reworkRound` (default 0), `rework` (the open request, default null), `corrected: z.boolean().default(false)` and `audit: auditBriefSchema.nullable().default(null)`.
  - `executionProblemSchema` and `problemDtoSchema` gain `clearedAt: isoDateTimeSchema.nullable().default(null)`.
  - `problemListQuerySchema` gains `includeCleared: z.stringbool().optional()`.
- `checklists.ts`:
  - `checklistDetailSchema` gains `requiresAudit: z.boolean().default(false)` and `auditReportEmails: z.array(z.string()).default([])`.
  - `updateChecklistInputSchema` gains `requiresAudit?: boolean` and `auditReportEmails?: auditReportEmailsSchema`.
- `reports.ts`:
  - `reportRunSchema` gains `auditState: runAuditStateSchema.nullable().default(null)` and `corrected: z.boolean().default(false)`.
  - `reportRunsQuerySchema` and `reportExportQuerySchema` gain `auditState?: RunAuditState`.
- `permissions.ts`:
  - `PERMISSION_GROUPS` gains `{ group: 'executions', keys: ['executions.correct'] }` and then `{ group: 'audits', keys: ['audits.perform'] }`, after `reports`.
  - Manager's defaults gain `executions.correct`; Auditor's gain `audits.perform`.
- `errors.ts`:
  - The ten new codes, with the HTTP statuses in Global Constraints.
  - `errorBodySchema.error` gains `auditId?: string` and `itemIds?: string[]`.
- `audit.ts`: `AUDIT_FLOW_AUDIT_ACTIONS = ['audit.started', 'audit.finished', 'audit.cancelled', 'audit.report_sent', 'execution.corrected', 'execution.sent_back', 'execution.send_back_withdrawn', 'execution.resubmitted'] as const`, with `type AuditFlowAuditAction`.
- `notifications.ts`:
  - `NOTIFICATION_TYPES` gains `'run.correction_required'`, `'run.resubmitted'` and `'audit.finished'`, before `'manual'`.
  - `NOTIFICATION_GROUPS` gains `'audit'`.
  - `NotificationTypeMeta` gains `hasResultFilter: boolean` (false for every existing type).
  - New metadata:
    - `run.correction_required`: `{ group: 'audit', audiences: ['assignees'], hasLeadTime: false, hasResultFilter: false }`
    - `run.resubmitted`: `{ group: 'audit', audiences: ['creator'], … }`
    - `audit.finished`: `{ group: 'audit', audiences: ['assignees'], hasResultFilter: true }`
  - `AUDIT_RESULT_FILTERS = ['any', 'failed']`, with `type AuditResultFilter`.
  - `DefaultRule` gains `resultFilter: AuditResultFilter | null`.
  - Defaults:
    - `run.correction_required`: push on, email off, notifyAssignees on.
    - `run.resubmitted`: push off, email off, notifyCreator on.
    - `audit.finished`: push off, email off, notifyAssignees on, roles `['manager']`, `resultFilter: 'failed'`.
    - Every other type: `resultFilter: null`.
  - `notificationRuleDtoSchema` and `updateNotificationRuleSchema` gain `resultFilter: auditResultFilterSchema.nullable()`. In the update schema it is `.default(null)`, so old clients keep working. A non-null value on any type but `audit.finished` is refused with `fields.resultFilter = 'notifications.issues.resultFilterNotApplicable'`, a new entry of `NOTIFICATION_ISSUE_CODES`.
  - `isAuditType(t)` is `t === 'run.correction_required' || t === 'run.resubmitted' || t === 'audit.finished'`.
  - The stored event payload (server-only) is `{ occurrenceId, executionId, round?, auditId? }`. What the apps see is the inbox item and the push data: for these three types `targetKind` is `'occurrence'`, `targetId` is the run's occurrence id and `targetDate` its local date, so the apps deep-link to the run exactly as for `checklist.*` types.

### `@taskop/i18n` (Task 3)

File layout: `az.audits` is the default export of `packages/i18n/src/az/audits.ts` and `az.corrections` the default export of `packages/i18n/src/az/corrections.ts`, each `export default { … } as const` like every other file in `packages/i18n/src/az/`, and both are registered in `az/index.ts` (`export const az = { …, audits, …, corrections, … } as const`). Part 3 adds its web keys under a `web` key of each namespace.

Part 1 owns these keys. Parts 2 and 3 add their own UI-only keys under `az.mobile.*` and under `az.audits.web.*` / `az.corrections.web.*`, and never rename these.

- `az.scheduling.statuses.correction_required` = "Düzəliş tələb olunur"; `az.executions.states.rework` = "Düzəlişdə".
- `az.audits`:
  - `title` ("Auditlər"), `audit` ("Audit"), `score` ("Audit balı"), `paused` ("İcraçıya düzəlişə qaytarılıb — yenidən təqdim gözlənilir"), `progress` ("{{reviewed}} / {{total}} bənd yoxlanılıb"), `noAudit` ("Audit aparılmayıb")
  - `queues.<AuditQueue>`, `results.<AuditResult>`, `verdicts.<AuditVerdict>`, `verdicts.unreviewed`, `statuses.<AuditStatus>`, `reportStatuses.<AuditReportStatus>`, `runAuditStates.<RunAuditState>`
  - `actions.{ start, open, finish, cancel, approve, reject, clearVerdict, downloadReport, resendReport, retryReport }`
  - `fields.{ result, comment, extraEmails, reportEmails, requiresAudit, cancelReason, auditor, startedAt, finishedAt, recipients, sentAt }`
  - `issues.<code without the audits.issues. prefix>`
  - `report.*`: the PDF texts — `title`, `run`, `executor`, `window`, `startedAt`, `completedAt`, `syncedAt`, `auditor`, `finishedAt`, `result`, `auditScore`, `runScore`, `originalScore`, `comment`, `item`, `answer`, `verdict`, `original`, `correctedBy`, `problem`, `videos` ("{{count}} video"), `morePhotos` ("+{{count}} foto"), `generatedAt`, `auditId`, `page`
  - `email.{ subject, body }`, with `{{checklist}}`, `{{site}}`, `{{date}}`, `{{result}}` and `{{auditor}}`
- `az.corrections`:
  - `title` ("Düzəlişlər"), `kinds.<CorrectionKind>` ("Rəhbər düzəlişi", "İcraçı düzəlişi"), `original` ("İlkin"), `current` ("Cari"), `corrected` ("Düzəliş edilib"), `cleared` ("Düzəlişlə aradan qaldırılıb"), `round` ("Raund {{round}}"; a fixed "-ci" suffix would be wrong for 3, 4, 6 …), `reworkBanner` ("Düzəliş tələb olunur"), `dueAt` ("Son tarix: {{date}}"), `noCorrections` ("Düzəliş edilməyib"), `emptyAnswer` ("Cavab yoxdur")
  - `actions.{ correct, sendBack, withdraw, resubmit }`, `fields.{ reason, itemComment, dueAt, items }`
  - `issues.<code without the corrections.issues. prefix>`
- `az.errors.<each new ErrorCode>`.
- `az.roles.groups.{ executions, audits }`, `az.roles.keys.{ executions_correct, audits_perform }`.
- `az.audit.entityTypes.{ audit, execution }`, and `az.audit.actions.<action>` for the eight actions, where the audit-log viewer has an actions map (`az.audit` in `packages/i18n/src/az/audit.ts`).
- `az.nav.audits` ("Auditlər").
- `az.notifications.types.<3 types>`, `az.notifications.groups.audit` ("Audit və düzəlişlər"), `az.notifications.resultFilters.{ any, failed }`, `az.notifications.issues.resultFilterNotApplicable`, and the push/inbox texts `az.notifications.templates.<type>.{ title, body }` for the three new types (`run.correction_required` also has `due`). The existing types keep their texts in the API's `notification-templates.ts`; the new ones are rendered from these keys.

### `@taskop/api-client` (Task 4)

`createTaskopApi(c)` spreads `createAuditsApi(c)`, also exported with `type AuditsApi`; it returns the two namespaces `audits` and `corrections`. `createExecutionsApi` gains `executions.resubmit`.

| Method | HTTP | Returns |
|---|---|---|
| `audits.list(query: AuditQueueQuery)` | `GET /audits` | `Page<AuditQueueRow>` |
| `audits.start(executionId: string)` | `POST /executions/:id/audits` | `AuditDto` |
| `audits.get(id: string)` | `GET /audits/:id` | `AuditDetail` |
| `audits.setVerdict(id: string, itemId: string, body: AuditVerdictInput)` | `PUT /audits/:id/items/:itemId` | `AuditItemVerdict` |
| `audits.clearVerdict(id: string, itemId: string)` | `DELETE /audits/:id/items/:itemId` | `void` |
| `audits.finish(id: string, body: FinishAuditInput)` | `POST /audits/:id/finish` | `AuditDto` |
| `audits.cancel(id: string, body: CancelAuditInput)` | `POST /audits/:id/cancel` | `AuditDto` |
| `audits.sendReport(id: string, body?: SendAuditReportInput)` | `POST /audits/:id/report/send` | `AuditDto` |
| `audits.downloadReport(id: string)` | `GET /audits/:id/report.pdf` | `{ blob: Blob; filename: string }`, via `ApiClient.download`. The filename comes from `Content-Disposition`, else `audit-<id>.pdf`. |
| `corrections.correct(executionId: string, body: CorrectAnswersInput)` | `POST /executions/:id/corrections` | `CorrectionResult` |
| `corrections.sendBack(executionId: string, body: SendBackInput)` | `POST /executions/:id/send-back` | `ReworkRequest` |
| `corrections.withdraw(executionId: string)` | `POST /executions/:id/send-back/cancel` | `ReworkRequest` |
| `corrections.history(executionId: string)` | `GET /executions/:id/corrections` | `ExecutionCorrections` |
| `executions.resubmit(executionId: string, body: ResubmitCommand)` | `POST /executions/:id/resubmit` | `ResubmitResult` |

`ApiError` gains `auditId: string | null` and `itemIds: string[] | null`, read from the error body.

### Server behaviour Parts 2 and 3 rely on

- **Permissions.**
  - `audits.perform` covers every `/audits` route except the two read routes. `GET /audits/:id` and the PDF download also accept `reports.view`, read-only.
  - `executions.correct` covers corrections, send-back and withdraw.
  - `GET /executions/:id` and `GET /executions/:id/corrections` accept `assignments.view`, `reports.view`, `audits.perform` or `executions.correct`, or the caller being the executor.
  - Out of scope is always 404.
- **What the UI may offer.** Show an action only when the matching `audit-logic` rule allows it:
  - correct / send back: `canCorrect` / `canSendBack`;
  - withdraw: `canWithdrawSendBack`;
  - start audit: `canStartAudit` plus `execution.audit == null || execution.audit.status === 'cancelled'`;
  - finish: `audit.status === 'in_progress' && !audit.paused && missingVerdicts(...) is empty`.

  The server enforces the same rules.
- **Statuses after each call:**
  - start: `audit_pending`.
  - finish: `audited` (the run is locked).
  - cancel: per `statusAfterAuditCancel`.
  - send-back: `correction_required` + `rework`.
  - withdraw: back to the status before the send-back + `completed`.
  - resubmit: per `nextStatusAfterResubmit` + `completed`.
  - corrections: no status change.
- **Errors to handle in the UI:**
  - `ANSWERS_CONFLICT` (reload the run, then retry);
  - `EXECUTION_LOCKED`, `EXECUTION_NOT_CORRECTABLE`;
  - `AUDIT_EXISTS` (open `ApiError.auditId`);
  - `AUDIT_PAUSED`;
  - `AUDIT_INCOMPLETE` (highlight `ApiError.itemIds`);
  - `MEDIA_NOT_FOUND_IN_STORAGE` (422) on finish: the spec's "MEDIA_PENDING" (a photo or video the answers reference is still uploading; try again later). There is no `MEDIA_PENDING` code (Spec decision 29);
  - `REPORT_NOT_READY` (show "being prepared"; poll `GET /audits/:id` every 3 s, up to 60 s);
  - `REQUIREMENTS_UNMET` (with `missing`, as on complete);
  - `ITEM_NOT_IN_REWORK`, `MEDIA_NOT_CORRECTABLE`.
- **Rework on the phone.**
  - `/me/sync` returns each `rework` execution with `rework` set and its occurrence with status `correction_required`. The phone edits `rework.items[].itemId` and the items hidden in `rework.answersBefore` or in its new answers (`reworkViolations(content, rework.answersBefore, answers, flagged)`, Spec decision 28).
  - Answers and media go through the existing commands. Resubmitting is `POST /executions/:id/resubmit` with `resubmittedAt` = device time of the tap.
  - A `409 EXECUTION_NOT_ACTIVE` on any rework command means the send-back was withdrawn or already resubmitted. Drop the local rework copy and re-sync.
- **Notifications of the three new types.** Inbox items and push data have `targetKind: 'occurrence'`, `targetId` = the run's occurrence id and `targetDate` = its local date, exactly like `checklist.*` notifications (SP6's `NotificationTarget` shape). Pinned in Task 16.
- **Report file name.** `GET /audits/:id/report.pdf` answers `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="<auditReportFileName(checklistName, occurrence localDate)>"`. Pinned in Task 15.
- **After a withdrawal** every queued rework command of that run is refused `409 EXECUTION_NOT_ACTIVE`: `PUT /executions/:id/answers`, `POST /executions/:id/media` (a new medium) and `POST /executions/:id/resubmit`. Pinned in Task 9.
- **Resubmit result.** `ResubmitResult.status` is the occurrence's new status (`completed` or `audit_pending`); a repeated resubmit answers the same body.
- **Verdicts.** `PUT /audits/:id/items/:itemId` answers the stored verdict (`AuditItemVerdict`, with `updatedBy` and `updatedAt`).
- **Checklist settings.** `GET /checklists/:id` returns `requiresAudit` and `auditReportEmails`, and `PATCH /checklists/:id` accepts them, on `/platform/tenants/:tenantId/checklists/:id` too. A refused list answers `400 VALIDATION_FAILED` with `fields.auditReportEmails = 'audits.issues.tooManyEmails'` (more than 10) or `fields['auditReportEmails.<i>'] = 'errors.validation.email'`. Pinned in Task 11.
- **Report readiness.** `reportStatus` moves `pending → ready` within seconds in normal operation, or `→ failed` after the retries run out. `sendReport` on a `failed` audit rebuilds the report and sends it.
- **Ordering.**
  - Queue pages are as in Spec decision 13.
  - `corrections` are oldest first and `reworkRequests` are in round order.
  - `diff` is in checklist order and lists only the items that differ from the original.

---

### Task 1: Pure audit and correction rules

**Files:**
- Create: `packages/contracts/src/audit-logic.ts`
- Test: `packages/contracts/src/audit-logic.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `visibleItems`, `type Answer`, `type Answers` (`checklist-logic.ts`); `type ChecklistContent` (`checklist-content.ts`); `idSchema` (`common.ts`); `emailSchema` (`credentials.ts`); `type ExecutionState` (`execution-logic.ts`); `type OccurrenceStatus` (`occurrences.ts`); `roundOne` (`report-logic.ts`).
- Produces: everything under **Pure rules** in *Interfaces for Parts 2 and 3*, plus `auditScoreSchema`, `auditBriefSchema`, `type AuditBrief`, `auditReportEmailsSchema` and `reportRecipients`. Later tasks use exactly these names: the API (Tasks 7–13) calls `canCorrect`, `canSendBack`, `canWithdrawSendBack`, `canStartAudit`, `nextStatusAfterResubmit`, `statusAfterAuditCancel`, `auditableItemIds`, `auditScore`, `missingVerdicts`, `changedItemIds`, `reworkViolations`, `runAuditState`, `reportRecipients`.

The current enum lists still lack `correction_required` and `rework` (Task 2 adds them). The rules compare with string literals, and the tests below use only statuses that exist today plus, where needed, a cast that Task 2 makes unnecessary.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/audit-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type Answers,
  answersEqual,
  AUDIT_LIMITS,
  AUDIT_QUEUES,
  AUDIT_REPORT_STATUSES,
  AUDIT_RESULTS,
  AUDIT_STATUSES,
  AUDIT_VERDICTS,
  auditableItemIds,
  auditBriefSchema,
  auditReportEmailsSchema,
  auditScore,
  auditScoreSchema,
  type AuditVerdict,
  blankContent,
  canCorrect,
  canSendBack,
  canStartAudit,
  canWithdrawSendBack,
  changedItemIds,
  type ChecklistContent,
  CORRECTABLE_STATUSES,
  CORRECTION_KINDS,
  isAuditPaused,
  missingVerdicts,
  newItem,
  newRule,
  newSection,
  nextStatusAfterResubmit,
  type OccurrenceStatus,
  reportRecipients,
  reworkViolations,
  RUN_AUDIT_STATES,
  runAuditState,
  statusAfterAuditCancel,
  type YesNoItem,
} from './index.js';

const CORRECTION_REQUIRED = 'correction_required' as OccurrenceStatus;
const REWORK = 'rework' as 'active';

/** A yes/no item with a follow-up on "yes", a number and a text: four items, three visible until "yes". */
function content() {
  const q = newItem('yes_no') as YesNoItem;
  const [yes, no] = q.options;
  const rule = newRule(q);
  rule.when = { kind: 'options', optionIds: [yes.id] };
  const followUp = newItem('text');
  rule.then.followUps.push(followUp);
  q.rules.push(rule);
  const temp = newItem('number');
  const note = newItem('text');
  const c: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [q, temp, note] }] };
  return { c, q, yes, no, followUp, temp, note };
}

describe('audit enums and limits', () => {
  it('lists every value in the agreed order', () => {
    expect(AUDIT_STATUSES).toEqual(['in_progress', 'finished', 'cancelled']);
    expect(AUDIT_RESULTS).toEqual(['passed', 'failed']);
    expect(AUDIT_VERDICTS).toEqual(['approved', 'rejected']);
    expect(AUDIT_REPORT_STATUSES).toEqual(['none', 'pending', 'ready', 'failed']);
    expect(AUDIT_QUEUES).toEqual(['waiting', 'in_progress', 'finished']);
    expect(RUN_AUDIT_STATES).toEqual(['waiting', 'in_progress', 'passed', 'failed']);
    expect(CORRECTION_KINDS).toEqual(['manual', 'rework']);
    expect(CORRECTABLE_STATUSES).toEqual(['completed', 'audit_pending']);
  });

  it('keeps the limits of the spec', () => {
    expect(AUDIT_LIMITS).toEqual({
      reportEmails: 10, recipients: 20, verdictComment: 1000, finalComment: 4000, reason: 1000, cancelReason: 500,
      reworkItems: 200, changes: 200, photosPerItem: 3, photosPerReport: 40, queuePageSize: 50, queueMaxDays: 366,
    });
  });
});

describe('what a run allows (spec §3.1)', () => {
  it('corrects and sends back completed and audit-pending runs whose execution is completed', () => {
    for (const status of ['completed', 'audit_pending'] as const) {
      expect(canCorrect({ status, executionState: 'completed' }), status).toBe(true);
      expect(canSendBack({ status, executionState: 'completed' }), status).toBe(true);
    }
    for (const status of ['partial', 'missed', 'cancelled', 'audited', 'in_progress', CORRECTION_REQUIRED] as OccurrenceStatus[]) {
      expect(canCorrect({ status, executionState: 'completed' }), status).toBe(false);
      expect(canSendBack({ status, executionState: 'completed' }), status).toBe(false);
    }
    expect(canCorrect({ status: 'completed', executionState: 'partial' })).toBe(false);
    expect(canCorrect({ status: 'completed', executionState: REWORK })).toBe(false);
  });

  it('withdraws only an open send-back', () => {
    expect(canWithdrawSendBack({ status: CORRECTION_REQUIRED, executionState: REWORK })).toBe(true);
    expect(canWithdrawSendBack({ status: CORRECTION_REQUIRED, executionState: 'completed' })).toBe(false);
    expect(canWithdrawSendBack({ status: 'completed', executionState: 'completed' })).toBe(false);
  });

  it('starts an audit only on a correctable run without an open audit', () => {
    expect(canStartAudit({ status: 'completed', executionState: 'completed' }, false)).toBe(true);
    expect(canStartAudit({ status: 'audit_pending', executionState: 'completed' }, false)).toBe(true);
    expect(canStartAudit({ status: 'audit_pending', executionState: 'completed' }, true)).toBe(false);
    expect(canStartAudit({ status: 'audited', executionState: 'completed' }, false)).toBe(false);
    expect(canStartAudit({ status: 'partial', executionState: 'partial' }, false)).toBe(false);
  });

  it('pauses an audit while the run is sent back', () => {
    expect(isAuditPaused(CORRECTION_REQUIRED)).toBe(true);
    expect(isAuditPaused('audit_pending')).toBe(false);
  });

  it('picks the status after a resubmit and after a cancelled audit', () => {
    expect(nextStatusAfterResubmit(false, false)).toBe('completed');
    expect(nextStatusAfterResubmit(true, false)).toBe('audit_pending');
    expect(nextStatusAfterResubmit(false, true)).toBe('audit_pending');
    expect(statusAfterAuditCancel(false, 'audit_pending')).toBe('completed');
    expect(statusAfterAuditCancel(true, 'audit_pending')).toBe('audit_pending');
    expect(statusAfterAuditCancel(false, CORRECTION_REQUIRED)).toBe(CORRECTION_REQUIRED);
  });
});

describe('auditable items and the audit score', () => {
  it('lists the items the current answers show, in checklist order', () => {
    const { c, q, yes, no, followUp, temp, note } = content();
    expect(auditableItemIds(c, {})).toEqual([q.id, temp.id, note.id]);
    expect(auditableItemIds(c, { [q.id]: { optionIds: [yes.id] } })).toEqual([q.id, followUp.id, temp.id, note.id]);
    expect(auditableItemIds(c, { [q.id]: { optionIds: [no.id] } })).toEqual([q.id, temp.id, note.id]);
  });

  it('scores approved over reviewed, counting only auditable items', () => {
    const verdicts = new Map<string, AuditVerdict>([['a', 'approved'], ['b', 'rejected'], ['c', 'approved'], ['hidden', 'rejected']]);
    expect(auditScore(verdicts, ['a', 'b', 'c', 'd'])).toEqual({ approved: 2, rejected: 1, reviewed: 3, percent: 66.7 });
    expect(auditScore(new Map(), ['a'])).toEqual({ approved: 0, rejected: 0, reviewed: 0, percent: null });
    expect(missingVerdicts(verdicts, ['a', 'b', 'c', 'd'])).toEqual(['d']);
    expect(missingVerdicts(verdicts, ['a', 'b'])).toEqual([]);
  });

  it('parses the score and the brief', () => {
    expect(auditScoreSchema.parse({ approved: 1, rejected: 0, reviewed: 1, percent: 100 })).toEqual({ approved: 1, rejected: 0, reviewed: 1, percent: 100 });
    const brief = { id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', status: 'finished', result: 'failed', percent: 50, paused: false };
    expect(auditBriefSchema.parse(brief)).toEqual(brief);
  });
});

describe('answer comparison (spec §4.3 diffAnswers)', () => {
  it('ignores option order, empty values and undefined fields', () => {
    expect(answersEqual({ optionIds: ['b', 'a'] }, { optionIds: ['a', 'b'] })).toBe(true);
    expect(answersEqual({ text: '  ' }, undefined)).toBe(true);
    expect(answersEqual({ photos: [] }, {})).toBe(true);
    expect(answersEqual({ number: 5, note: undefined }, { number: 5 })).toBe(true);
    expect(answersEqual({ problem: { severity: 'normal', note: 'x', mediaIds: [] } }, { problem: { note: 'x', severity: 'normal', mediaIds: [] } })).toBe(true);
  });

  it('sees real changes, including photo order and a cleared answer', () => {
    expect(answersEqual({ number: 5 }, { number: 6 })).toBe(false);
    expect(answersEqual({ photos: ['p1', 'p2'] }, { photos: ['p2', 'p1'] })).toBe(false);
    expect(answersEqual({ text: 'a' }, undefined)).toBe(false);
    expect(answersEqual({ text: 'a' }, { text: 'a ' })).toBe(false);
  });

  it('lists changed items in the order of the new answers, then the removed ones', () => {
    const before: Answers = { a: { number: 1 }, b: { text: 'x' }, c: { optionIds: ['o1', 'o2'] } };
    const after: Answers = { c: { optionIds: ['o2', 'o1'] }, b: { text: 'y' }, d: { number: 4 } };
    expect(changedItemIds(before, after)).toEqual(['b', 'd', 'a']);
    expect(changedItemIds(before, before)).toEqual([]);
  });

  it('reports changes outside the flagged items', () => {
    const { c, temp, note } = content();
    const before: Answers = { [temp.id]: { number: 1 }, [note.id]: { text: 'x' } };
    expect(reworkViolations(c, before, { [temp.id]: { number: 9 }, [note.id]: { text: 'x' } }, new Set([temp.id]))).toEqual([]);
    expect(reworkViolations(c, before, { [temp.id]: { number: 9 }, [note.id]: { text: 'y' } }, new Set([temp.id]))).toEqual([note.id]);
    expect(reworkViolations(c, before, { [temp.id]: { number: 1 } }, new Set([temp.id]))).toEqual([note.id]);
  });

  it('lets a flagged change answer the follow-ups it reveals and clear the ones it hides', () => {
    const { c, q, yes, no, followUp, temp } = content();
    const flagged = new Set([q.id]);
    const before: Answers = { [q.id]: { optionIds: [no.id] } };
    // "Yes" reveals the follow-up: answering it is part of the flagged change.
    expect(reworkViolations(c, before, { [q.id]: { optionIds: [yes.id] }, [followUp.id]: { text: 'Su axır' } }, flagged)).toEqual([]);
    // Back to "No" hides it again: clearing its answer is allowed too.
    const shown: Answers = { [q.id]: { optionIds: [yes.id] }, [followUp.id]: { text: 'Su axır' } };
    expect(reworkViolations(c, shown, { [q.id]: { optionIds: [no.id] } }, flagged)).toEqual([]);
    // A follow-up hidden again may keep a leftover answer: hidden before and after, it is never locked.
    expect(reworkViolations(c, before, { [q.id]: { optionIds: [no.id] }, [followUp.id]: { text: 'Su axır' } }, flagged)).toEqual([]);
    // A follow-up visible before and after, and not flagged, stays outside the round.
    expect(reworkViolations(c, shown, { ...shown, [followUp.id]: { text: 'Başqa' } }, new Set([temp.id]))).toEqual([followUp.id]);
  });
});

describe('run audit state (reports runs column)', () => {
  it('derives waiting, in progress, passed and failed', () => {
    expect(runAuditState('audit_pending', null)).toBe('waiting');
    expect(runAuditState('audit_pending', { status: 'cancelled', result: null })).toBe('waiting');
    expect(runAuditState('completed', { status: 'cancelled', result: null })).toBeNull();
    expect(runAuditState('completed', null)).toBeNull();
    expect(runAuditState(CORRECTION_REQUIRED, { status: 'in_progress', result: null })).toBe('in_progress');
    expect(runAuditState('audited', { status: 'finished', result: 'passed' })).toBe('passed');
    expect(runAuditState('audited', { status: 'finished', result: 'failed' })).toBe('failed');
  });
});

describe('report e-mail addresses', () => {
  it('lower-cases, de-duplicates and caps the checklist list at 10', () => {
    expect(auditReportEmailsSchema.parse([' Boss@Acme.az', 'boss@acme.az', 'qa@acme.az'])).toEqual(['boss@acme.az', 'qa@acme.az']);
    expect(auditReportEmailsSchema.safeParse(['not-an-email']).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@acme.az`);
    expect(auditReportEmailsSchema.safeParse(eleven).error?.issues[0]?.message).toBe('audits.issues.tooManyEmails');
  });

  it('merges the checklist list and the extra addresses, checklist first, at most 20', () => {
    expect(reportRecipients(['a@x.az', 'B@x.az'], ['b@x.az', 'C@x.az'])).toEqual(['a@x.az', 'b@x.az', 'c@x.az']);
    const many = Array.from({ length: 30 }, (_, i) => `u${i}@x.az`);
    expect(reportRecipients(many.slice(0, 10), many.slice(10))).toHaveLength(20);
    expect(reportRecipients([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- audit-logic`
Expected: FAIL: `answersEqual` (and every other new name) is not exported from `./index.js`.

- [ ] **Step 3: Write the rules**

`packages/contracts/src/audit-logic.ts`:

```ts
import { z } from 'zod';
import type { ChecklistContent } from './checklist-content.js';
import { type Answer, type Answers, visibleItems } from './checklist-logic.js';
import { idSchema } from './common.js';
import { emailSchema } from './credentials.js';
import type { ExecutionState } from './execution-logic.js';
import type { OccurrenceStatus } from './occurrences.js';
import { roundOne } from './report-logic.js';

/**
 * Sub-project 8 spec §3–§4.3: the audit and correction rules shared by the API, the web and the phone.
 * The API enforces exactly these; the apps use them to show only the actions the API will accept.
 */
export const AUDIT_STATUSES = ['in_progress', 'finished', 'cancelled'] as const;
export const auditStatusSchema = z.enum(AUDIT_STATUSES);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

export const AUDIT_RESULTS = ['passed', 'failed'] as const;
export const auditResultSchema = z.enum(AUDIT_RESULTS);
export type AuditResult = z.infer<typeof auditResultSchema>;

export const AUDIT_VERDICTS = ['approved', 'rejected'] as const;
export const auditVerdictSchema = z.enum(AUDIT_VERDICTS);
export type AuditVerdict = z.infer<typeof auditVerdictSchema>;

export const AUDIT_REPORT_STATUSES = ['none', 'pending', 'ready', 'failed'] as const;
export const auditReportStatusSchema = z.enum(AUDIT_REPORT_STATUSES);
export type AuditReportStatus = z.infer<typeof auditReportStatusSchema>;

/** The tabs of the web audit queue (spec §8.3). */
export const AUDIT_QUEUES = ['waiting', 'in_progress', 'finished'] as const;
export const auditQueueSchema = z.enum(AUDIT_QUEUES);
export type AuditQueue = z.infer<typeof auditQueueSchema>;

/** The reports runs column (spec §8.3): no audit is null. */
export const RUN_AUDIT_STATES = ['waiting', 'in_progress', 'passed', 'failed'] as const;
export const runAuditStateSchema = z.enum(RUN_AUDIT_STATES);
export type RunAuditState = z.infer<typeof runAuditStateSchema>;

/** `manual` = a manager's direct correction; `rework` = the worker's resubmit after a send-back. */
export const CORRECTION_KINDS = ['manual', 'rework'] as const;
export const correctionKindSchema = z.enum(CORRECTION_KINDS);
export type CorrectionKind = z.infer<typeof correctionKindSchema>;

/** The only statuses an audit, a correction or a send-back may start from (spec §1, "Which runs"). */
export const CORRECTABLE_STATUSES = ['completed', 'audit_pending'] as const satisfies readonly OccurrenceStatus[];

export const AUDIT_LIMITS = {
  /** checklists.audit_report_emails. */
  reportEmails: 10,
  /** Checklist addresses plus extra addresses, per send. */
  recipients: 20,
  verdictComment: 1000,
  finalComment: 4000,
  /** A correction's reason and a rework item's comment. */
  reason: 1000,
  cancelReason: 500,
  reworkItems: 200,
  changes: 200,
  photosPerItem: 3,
  photosPerReport: 40,
  queuePageSize: 50,
  queueMaxDays: 366,
} as const;

export interface RunState {
  status: OccurrenceStatus;
  executionState: ExecutionState;
}

const isCorrectable = (s: OccurrenceStatus): boolean => (CORRECTABLE_STATUSES as readonly OccurrenceStatus[]).includes(s);

/** Direct corrections: completed or audit_pending, with a completed execution (not rework, not partial). */
export const canCorrect = (run: RunState): boolean => isCorrectable(run.status) && run.executionState === 'completed';

/** Send-back follows the same rule as a correction. */
export const canSendBack = (run: RunState): boolean => canCorrect(run);

/** Only an open send-back can be withdrawn. */
export const canWithdrawSendBack = (run: RunState): boolean => run.status === 'correction_required' && run.executionState === 'rework';

/** `hasOpenAudit`: a non-cancelled audit exists for the run. */
export const canStartAudit = (run: RunState, hasOpenAudit: boolean): boolean => canCorrect(run) && !hasOpenAudit;

/** While the run is with the worker, its audit can collect verdicts but not finish (spec §3.3). */
export const isAuditPaused = (status: OccurrenceStatus): boolean => status === 'correction_required';

export function nextStatusAfterResubmit(requiresAudit: boolean, hasOpenAudit: boolean): 'completed' | 'audit_pending' {
  return requiresAudit || hasOpenAudit ? 'audit_pending' : 'completed';
}

/** A run sent back keeps its status until the resubmit decides it (Spec decision 12). */
export function statusAfterAuditCancel(requiresAudit: boolean, current: OccurrenceStatus): OccurrenceStatus {
  if (current === 'correction_required') return current;
  return requiresAudit ? 'audit_pending' : 'completed';
}

/** Spec decision 1: the items the current answers show, in checklist order. */
export function auditableItemIds(content: ChecklistContent, answers: Answers): string[] {
  return visibleItems(content, answers).map((v) => v.item.id);
}

export const auditScoreSchema = z.object({
  approved: z.number().int(),
  rejected: z.number().int(),
  reviewed: z.number().int(),
  percent: z.number().nullable(),
});
export type AuditScore = z.infer<typeof auditScoreSchema>;

/** approved ÷ reviewed × 100, one decimal; verdicts on items that are not auditable are ignored. */
export function auditScore(verdicts: ReadonlyMap<string, AuditVerdict>, auditableIds: readonly string[]): AuditScore {
  let approved = 0;
  let rejected = 0;
  for (const id of auditableIds) {
    const v = verdicts.get(id);
    if (v === 'approved') approved++;
    else if (v === 'rejected') rejected++;
  }
  const reviewed = approved + rejected;
  return { approved, rejected, reviewed, percent: reviewed ? roundOne((approved / reviewed) * 100) : null };
}

export function missingVerdicts(verdicts: ReadonlyMap<string, AuditVerdict>, auditableIds: readonly string[]): string[] {
  return auditableIds.filter((id) => !verdicts.has(id));
}

/**
 * The comparable form of a value: option ids sorted; empty arrays, blank strings, null and undefined dropped;
 * object keys sorted. Photo and video order is kept: it is what the worker chose.
 */
function normalise(v: unknown, key?: string): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v.trim() === '' ? undefined : v;
  if (Array.isArray(v)) {
    if (!v.length) return undefined;
    const items = v.map((x) => normalise(x));
    return key === 'optionIds' ? [...(items as string[])].sort() : items;
  }
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const n = normalise((v as Record<string, unknown>)[k], k);
      if (n !== undefined) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return v;
}

export function answersEqual(a: Answer | undefined, b: Answer | undefined): boolean {
  return JSON.stringify(normalise(a) ?? null) === JSON.stringify(normalise(b) ?? null);
}

/** Every item whose answer differs: those in `after` in its key order, then those only in `before`. */
export function changedItemIds(before: Answers, after: Answers): string[] {
  const ids = [...Object.keys(after), ...Object.keys(before).filter((id) => !Object.hasOwn(after, id))];
  return ids.filter((id) => !answersEqual(before[id], after[id]));
}

/**
 * Spec §4.3 reworkGuard (Spec decision 28): the changed items the worker may not change. Only unflagged items visible
 * both before and after are locked; anything hidden on either side may change. So follow-ups a flagged answer reveals
 * (and chains of them) can be answered, and a follow-up hidden again may keep or drop a leftover answer. Otherwise a
 * revealed required follow-up could never be answered and the run could never be resubmitted.
 */
export function reworkViolations(content: ChecklistContent, before: Answers, after: Answers, flagged: ReadonlySet<string>): string[] {
  const shownBefore = new Set(visibleItems(content, before).map((v) => v.item.id));
  const shownAfter = new Set(visibleItems(content, after).map((v) => v.item.id));
  return changedItemIds(before, after).filter((id) => !flagged.has(id) && shownBefore.has(id) && shownAfter.has(id));
}

export function runAuditState(status: OccurrenceStatus, audit: { status: AuditStatus; result: AuditResult | null } | null): RunAuditState | null {
  if (audit?.status === 'in_progress') return 'in_progress';
  if (audit?.status === 'finished') return audit.result === 'failed' ? 'failed' : 'passed';
  return status === 'audit_pending' ? 'waiting' : null;
}

/** The run's latest audit on the run views (`ExecutionDetail.audit`). */
export const auditBriefSchema = z.object({
  id: idSchema,
  status: auditStatusSchema,
  result: auditResultSchema.nullable(),
  percent: z.number().nullable(),
  /** In progress while the run is sent back. */
  paused: z.boolean(),
});
export type AuditBrief = z.infer<typeof auditBriefSchema>;

const dedupe = (list: readonly string[]): string[] => [...new Set(list)];

/** checklists.audit_report_emails: lower-cased, de-duplicated, at most 10. */
export const auditReportEmailsSchema = z
  .array(emailSchema)
  .max(AUDIT_LIMITS.reportEmails, { error: 'audits.issues.tooManyEmails' })
  .transform(dedupe);

/** Spec §7.2: the checklist's addresses, then the extra ones; lower-cased, de-duplicated, at most 20. */
export function reportRecipients(checklistEmails: readonly string[], extra: readonly string[]): string[] {
  return dedupe([...checklistEmails, ...extra].map((e) => e.trim().toLowerCase()).filter(Boolean)).slice(0, AUDIT_LIMITS.recipients);
}
```

In `packages/contracts/src/index.ts`, after `export * from './reports.js';` add:

```ts
export * from './audit-logic.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS. (`audit-logic.ts` imports nothing that imports it back: `report-logic.ts`, `occurrences.ts` and `credentials.ts` don't import it.)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/audit-logic.ts packages/contracts/src/audit-logic.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add the audit and correction rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Correction and audit contracts, and the new values in existing contracts

**Files:**
- Create: `packages/contracts/src/corrections.ts`, `packages/contracts/src/audits.ts`
- Test: `packages/contracts/src/audits.test.ts`
- Modify: `packages/contracts/src/occurrences.ts`, `execution-logic.ts`, `report-logic.ts`, `execution-views.ts`, `checklists.ts`, `reports.ts`, `permissions.ts`, `errors.ts`, `audit.ts`, `notifications.ts`, `index.ts`
- Modify (tests that pin list contents or compare parsed objects): `packages/contracts/src/report-logic.test.ts`, `scheduling-resources.test.ts`, `reports.test.ts`, `notifications.test.ts`, `task-views.test.ts`
- Modify (labels the API indexes by status at once): `packages/i18n/src/az/scheduling.ts`, `packages/i18n/src/az/executions.ts`
- Modify (API mappers return the new defaulted fields until later tasks fill them): `apps/api/src/executions/execution-queries.ts`, `apps/api/src/executions/mappers.ts`, `apps/api/src/executions/problem-rows.ts`, `apps/api/src/executions/sync.service.ts`, `apps/api/src/reports/report-queries.ts`, `apps/api/src/checklists/checklists.service.ts`, `apps/api/src/notifications/notification-rules.ts`
- Modify (API tests that compare whole objects or the role list): `apps/api/test/roles.test.ts`, `apps/api/test/notification-rules-api.test.ts`, `apps/api/src/notifications/notification-rules.test.ts`, `apps/api/test/reports-runs.test.ts`, `apps/api/test/executions-sync.test.ts`, `apps/api/src/reports/export/report-tables.test.ts`
- Modify (app test fixtures typed with the changed output types): `apps/web/src/features/executions/fixtures.ts`, `apps/web/src/features/executions/answers-view.test.tsx`, `apps/web/src/features/tasks/fixtures.ts`, `apps/web/src/features/executions/problems-page.test.tsx`, `apps/web/src/features/reports/fixtures.ts`, `apps/web/src/features/checklists/checklist-detail-page.test.tsx`, `apps/web/src/features/checklists/checklists-page.test.tsx`, `apps/web/src/features/notifications/fixtures.ts`, `apps/mobile/src/features/team/testing/fixtures.ts`, `apps/mobile/src/features/tasks/task-screen.test.tsx`, `apps/mobile/src/offline/testing/fixtures.ts`

**Interfaces:**
- Consumes: Task 1 (`AUDIT_LIMITS`, the enum schemas, `auditScoreSchema`, `auditBriefSchema`, `auditReportEmailsSchema`); `answerSchema` (`executions.ts`); `scoreSchema`, `progressSchema`, `executionStateSchema` (`execution-logic.ts`); `userRefSchema`, `occurrenceStatusSchema` (`occurrences.ts`); `executionDetailSchema` (`execution-views.ts`); `emailSchema` (`credentials.ts`); `cursorQuerySchema`, `pageOf` (`common.ts`); `dayNumber`, `localDateSchema` (`scheduling-time.ts`).
- Produces: everything under **Schemas** (`corrections.ts`, `audits.ts`) and **Changes to existing contracts** in *Interfaces for Parts 2 and 3*, with exactly those names and types, plus `type Score` (`execution-logic.ts`). The API mappers still return the defaults (`reworkRound: 0`, `rework: null`, `corrected: false`, `audit: null`, `clearedAt: null`, `auditState: null`, `requiresAudit: false`, `auditReportEmails: []`); Tasks 9–11 and 17 replace them with real values.

The app fixtures change only by gaining the new fields with their default values; no app behaviour changes in this part. **Parts 2 and 3 start from these fixtures** and must not add the same fields again.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/audits.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AuditItemVerdict, AuditScore, AuditVerdictInput, CancelAuditInput, FinishAuditInput, Score, SendAuditReportInput } from './index.js';
import {
  ALL_PERMISSIONS,
  AUDIT_FLOW_AUDIT_ACTIONS,
  AUDIT_ISSUE_CODES,
  AUDIT_REPORT_CONTENT_TYPE,
  auditDetailSchema,
  auditDtoSchema,
  auditQueueQuerySchema,
  auditQueueRowSchema,
  auditReportFileName,
  auditVerdictInputSchema,
  cancelAuditInputSchema,
  checklistDetailSchema,
  COMPLETED_STATUSES,
  correctAnswersInputSchema,
  CORRECTION_ISSUE_CODES,
  correctionResultSchema,
  DEFAULT_RULES,
  ERROR_HTTP_STATUS,
  errorBodySchema,
  EXECUTION_STATES,
  executionCorrectionsSchema,
  executionDetailSchema,
  executionProblemSchema,
  finishAuditInputSchema,
  isAuditType,
  myExecutionSchema,
  NOTIFICATION_GROUPS,
  NOTIFICATION_ISSUE_CODES,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  notificationRuleDtoSchema,
  OCCURRENCE_STATUSES,
  PERMISSION_GROUPS,
  problemDtoSchema,
  problemListQuerySchema,
  reportExportQuerySchema,
  reportRunSchema,
  reportRunsQuerySchema,
  resubmitCommandSchema,
  resubmitResultSchema,
  reworkRequestSchema,
  sendAuditReportInputSchema,
  sendBackInputSchema,
  SYSTEM_ROLE_DEFAULTS,
  updateChecklistInputSchema,
  updateNotificationRuleSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const ID2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';
const AT = '2026-11-02T04:20:00.000Z';
const user = { id: ID, fullName: 'Leyla' };

describe('exported types', () => {
  it('exports the input and output types the apps use', () => {
    expectTypeOf<Score>().toEqualTypeOf<{ earned: number; possible: number; percent: number | null; problems: { itemId: string; severity: 'normal' | 'critical' }[] }>();
    expectTypeOf<AuditScore>().toEqualTypeOf<{ approved: number; rejected: number; reviewed: number; percent: number | null }>();
    expectTypeOf<AuditItemVerdict['verdict']>().toEqualTypeOf<'approved' | 'rejected'>();
    expectTypeOf<AuditVerdictInput>().toEqualTypeOf<{ verdict: 'approved' | 'rejected'; comment?: string | null }>();
    expectTypeOf<FinishAuditInput['result']>().toEqualTypeOf<'passed' | 'failed'>();
    expectTypeOf<CancelAuditInput>().toEqualTypeOf<{ reason: string }>();
    expectTypeOf<SendAuditReportInput>().toEqualTypeOf<{ emails?: string[] }>();
  });
});

describe('new statuses (spec §3.1, §3.2)', () => {
  it('adds correction_required and rework last, and counts correction_required as completed', () => {
    expect(OCCURRENCE_STATUSES.at(-1)).toBe('correction_required');
    expect(EXECUTION_STATES.at(-1)).toBe('rework');
    expect(COMPLETED_STATUSES).toEqual(['completed', 'audit_pending', 'audited', 'correction_required']);
  });
});

describe('correction inputs', () => {
  const change = { itemId: ID, answer: { number: 5 } };

  it('accepts a correction and trims the reason', () => {
    expect(correctAnswersInputSchema.parse({ answersRev: 3, changes: [change, { itemId: ID2, answer: null }], reason: '  Səhv yazılıb ' })).toEqual({
      answersRev: 3,
      changes: [change, { itemId: ID2, answer: null }],
      reason: 'Səhv yazılıb',
    });
  });

  it('refuses a manual problem, a duplicate item, an empty reason and too many changes', () => {
    const bad = (v: object) => correctAnswersInputSchema.safeParse({ answersRev: 3, changes: [change], reason: 'x', ...v });
    expect(bad({ changes: [{ itemId: ID, answer: { problem: { severity: 'normal', note: 'x', mediaIds: [] } } }] }).success).toBe(false);
    expect(bad({ changes: [change, change] }).error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['changes.1.itemId', 'corrections.issues.duplicateItem']]);
    expect(bad({ reason: '   ' }).success).toBe(false);
    expect(bad({ changes: [] }).success).toBe(false);
    expect(bad({ changes: Array.from({ length: 201 }, () => change) }).success).toBe(false);
    expect(bad({ answersRev: 0 }).success).toBe(false);
  });

  it('accepts a send-back with an optional due date and refuses duplicates and blank comments', () => {
    expect(sendBackInputSchema.parse({ items: [{ itemId: ID, comment: ' Fotonu yenidən çəkin ' }] })).toEqual({ items: [{ itemId: ID, comment: 'Fotonu yenidən çəkin' }] });
    expect(sendBackInputSchema.safeParse({ items: [{ itemId: ID, comment: 'x' }], dueAt: AT }).success).toBe(true);
    expect(sendBackInputSchema.safeParse({ items: [{ itemId: ID, comment: 'x' }, { itemId: ID, comment: 'y' }] }).success).toBe(false);
    expect(sendBackInputSchema.safeParse({ items: [{ itemId: ID, comment: '' }] }).success).toBe(false);
    expect(sendBackInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(CORRECTION_ISSUE_CODES).toEqual(['corrections.issues.dueInPast', 'corrections.issues.duplicateItem']);
  });

  it('takes the resubmit timing like the other phone commands', () => {
    expect(resubmitCommandSchema.parse({ resubmittedAt: AT, deviceTime: AT, clientOffsetMs: 0 })).toEqual({ resubmittedAt: AT, deviceTime: AT, clientOffsetMs: 0 });
    expect(resubmitCommandSchema.safeParse({ resubmittedAt: AT }).success).toBe(false);
  });
});

describe('correction outputs', () => {
  const request = {
    id: ID, round: 1, items: [{ itemId: ID, comment: 'Foto' }], dueAt: null, requestedBy: user, requestedAt: AT, resubmittedAt: null, withdrawnAt: null, withdrawnBy: null,
    answersBefore: { [ID]: { number: 10 } },
  };

  it('parses a request, a result, the history and a resubmit result', () => {
    expect(reworkRequestSchema.parse(request)).toEqual(request);
    expect(reworkRequestSchema.parse({ ...request, requestedBy: null }).requestedBy).toBeNull();
    expect(correctionResultSchema.parse({ executionId: ID, answersRev: 4, changedItemIds: [ID], score: null }).answersRev).toBe(4);
    const history = {
      original: { answers: { [ID]: { number: 10 } }, score: { earned: 1, possible: 2, percent: 50, problems: [] }, capturedAt: AT },
      corrections: [{ id: ID, itemId: ID, kind: 'manual', round: 0, before: { number: 10 }, after: { number: 5 }, reason: 'Səhv', actor: { kind: 'user', name: 'Leyla' }, at: AT }],
      reworkRequests: [request],
      diff: [{ itemId: ID, original: { number: 10 }, current: { number: 5 } }],
    };
    expect(executionCorrectionsSchema.parse(history)).toEqual(history);
    expect(executionCorrectionsSchema.parse({ original: null, corrections: [], reworkRequests: [], diff: [] }).original).toBeNull();
    const progress = { answered: 3, total: 4, requiredMissing: 0 };
    expect(resubmitResultSchema.parse({ executionId: ID, state: 'completed', status: 'audit_pending', progress, score: null }).status).toBe('audit_pending');
  });
});

describe('audit inputs', () => {
  it('requires a comment to reject', () => {
    expect(auditVerdictInputSchema.parse({ verdict: 'approved' })).toEqual({ verdict: 'approved' });
    expect(auditVerdictInputSchema.safeParse({ verdict: 'rejected', comment: '  ' }).error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['comment', 'audits.issues.commentRequired'],
    ]);
    expect(auditVerdictInputSchema.parse({ verdict: 'rejected', comment: ' Pis ' })).toEqual({ verdict: 'rejected', comment: 'Pis' });
    expect(auditVerdictInputSchema.safeParse({ verdict: 'approved', comment: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('lower-cases and de-duplicates the extra report addresses, at most 20', () => {
    expect(finishAuditInputSchema.parse({ result: 'failed', extraEmails: ['A@x.az', 'a@x.az'] })).toEqual({ result: 'failed', extraEmails: ['a@x.az'] });
    expect(finishAuditInputSchema.safeParse({ result: 'passed', extraEmails: Array.from({ length: 21 }, (_, i) => `u${i}@x.az`) }).success).toBe(false);
    expect(finishAuditInputSchema.safeParse({ result: 'passed', comment: 'x'.repeat(4001) }).success).toBe(false);
    expect(sendAuditReportInputSchema.safeParse({ emails: [] }).success).toBe(false);
    expect(sendAuditReportInputSchema.parse({})).toEqual({});
    expect(cancelAuditInputSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('validates the queue query: a queue, both dates or none, at most 366 days', () => {
    expect(auditQueueQuerySchema.parse({ queue: 'waiting' })).toEqual({ queue: 'waiting', limit: 50 });
    expect(auditQueueQuerySchema.safeParse({ queue: 'waiting', from: '2026-11-01' }).error?.issues[0]?.path).toEqual(['to']);
    expect(auditQueueQuerySchema.safeParse({ queue: 'finished', from: '2026-01-01', to: '2027-01-02' }).error?.issues[0]?.message).toBe('audits.issues.rangeTooLong');
    expect(auditQueueQuerySchema.safeParse({ queue: 'finished', from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(auditQueueQuerySchema.safeParse({ queue: 'done' }).success).toBe(false);
    expect(AUDIT_ISSUE_CODES).toEqual(['audits.issues.commentRequired', 'audits.issues.rangeTooLong', 'audits.issues.tooManyEmails', 'audits.issues.notAuditable']);
  });
});

describe('audit outputs', () => {
  const dto = {
    id: ID, executionId: ID, occurrenceId: ID, status: 'in_progress', paused: false,
    auditor: { kind: 'user', id: ID, name: 'Auditor' }, startedAt: AT, finishedAt: null, cancelledAt: null, cancelReason: null,
    result: null, score: null, comment: null, reportStatus: 'none', reportRecipients: [], reportSentAt: null,
    verdicts: [{ itemId: ID, verdict: 'rejected', comment: 'Pis', updatedBy: user, updatedAt: AT }],
  };

  it('parses an audit and a queue row', () => {
    expect(auditDtoSchema.parse(dto)).toEqual(dto);
    const row = {
      occurrenceId: ID, executionId: ID, auditId: null, checklist: { id: ID, name: 'Açılış' }, site: { id: ID, name: 'Filial 1' }, executor: user,
      localDate: '2026-11-02', completedAt: AT, status: 'audit_pending', auditState: 'waiting', auditor: null, result: null, percent: null, startedAt: null, finishedAt: null,
    };
    expect(auditQueueRowSchema.parse(row)).toEqual(row);
  });

  it('names the report file in ASCII with the run date', () => {
    expect(auditReportFileName('Açılış yoxlaması', '2026-11-02')).toBe('taskop-audit-acilis-yoxlamasi-2026-11-02.pdf');
    expect(auditReportFileName('Gündəlik İŞ / Ğ-Ö-Ü', '2026-11-02')).toBe('taskop-audit-gundelik-is-g-o-u-2026-11-02.pdf');
    expect(auditReportFileName('???', '2026-11-02')).toBe('taskop-audit-checklist-2026-11-02.pdf');
    expect(AUDIT_REPORT_CONTENT_TYPE).toBe('application/pdf');
  });

  it('extends the audit with the run detail and its history', () => {
    expect(Object.keys(auditDetailSchema.shape)).toEqual(expect.arrayContaining(['execution', 'corrections', 'auditableItemIds', 'checklistReportEmails', 'requiresAudit']));
  });
});

describe('defaults on the existing views', () => {
  it('fills the new fields of older payloads', () => {
    const problem = { id: ID, itemId: ID, source: 'rule', severity: 'normal', note: null, mediaIds: [], createdAt: AT, resolution: 'none', taskId: null };
    expect(executionProblemSchema.parse(problem).clearedAt).toBeNull();
    expect(Object.keys(executionDetailSchema.shape)).toEqual(expect.arrayContaining(['reworkRound', 'rework', 'corrected', 'audit']));
    expect(Object.keys(myExecutionSchema.shape)).toEqual(expect.arrayContaining(['reworkRound', 'rework']));
    expect(Object.keys(problemDtoSchema.shape)).toContain('clearedAt');
    expect(problemListQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', includeCleared: 'true' }).includeCleared).toBe(true);
    expect(Object.keys(checklistDetailSchema.shape)).toEqual(expect.arrayContaining(['requiresAudit', 'auditReportEmails']));
    expect(updateChecklistInputSchema.parse({ requiresAudit: true, auditReportEmails: ['QA@x.az'] })).toEqual({ requiresAudit: true, auditReportEmails: ['qa@x.az'] });
    expect(Object.keys(reportRunSchema.shape)).toEqual(expect.arrayContaining(['auditState', 'corrected']));
    expect(reportRunsQuerySchema.parse({ from: '2026-11-01', to: '2026-11-02', auditState: 'failed' }).auditState).toBe('failed');
    expect(reportExportQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-02', format: 'csv', auditState: 'nope' }).success).toBe(false);
  });
});

describe('permissions, errors, audit actions and notifications', () => {
  it('adds the executions and audits groups after reports, with the role defaults', () => {
    expect(PERMISSION_GROUPS.slice(-3)).toEqual([
      { group: 'reports', keys: ['reports.view', 'reports.export'] },
      { group: 'executions', keys: ['executions.correct'] },
      { group: 'audits', keys: ['audits.perform'] },
    ]);
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toContain('executions.correct');
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('audits.perform');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toContain('audits.perform');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).not.toContain('executions.correct');
    expect(SYSTEM_ROLE_DEFAULTS.admin.permissions).toEqual(ALL_PERMISSIONS);
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
  });

  it('adds ten error codes with their statuses and the audit id and item ids details', () => {
    expect({
      EXECUTION_LOCKED: ERROR_HTTP_STATUS.EXECUTION_LOCKED,
      EXECUTION_NOT_CORRECTABLE: ERROR_HTTP_STATUS.EXECUTION_NOT_CORRECTABLE,
      ANSWERS_CONFLICT: ERROR_HTTP_STATUS.ANSWERS_CONFLICT,
      ITEM_NOT_IN_REWORK: ERROR_HTTP_STATUS.ITEM_NOT_IN_REWORK,
      MEDIA_NOT_CORRECTABLE: ERROR_HTTP_STATUS.MEDIA_NOT_CORRECTABLE,
      AUDIT_EXISTS: ERROR_HTTP_STATUS.AUDIT_EXISTS,
      AUDIT_PAUSED: ERROR_HTTP_STATUS.AUDIT_PAUSED,
      AUDIT_INCOMPLETE: ERROR_HTTP_STATUS.AUDIT_INCOMPLETE,
      AUDIT_NOT_IN_PROGRESS: ERROR_HTTP_STATUS.AUDIT_NOT_IN_PROGRESS,
      REPORT_NOT_READY: ERROR_HTTP_STATUS.REPORT_NOT_READY,
    }).toEqual({
      EXECUTION_LOCKED: 409, EXECUTION_NOT_CORRECTABLE: 409, ANSWERS_CONFLICT: 409, ITEM_NOT_IN_REWORK: 422, MEDIA_NOT_CORRECTABLE: 422,
      AUDIT_EXISTS: 409, AUDIT_PAUSED: 409, AUDIT_INCOMPLETE: 422, AUDIT_NOT_IN_PROGRESS: 409, REPORT_NOT_READY: 409,
    });
    const body = errorBodySchema.parse({
      error: { code: 'AUDIT_INCOMPLETE', messageKey: 'errors.AUDIT_INCOMPLETE', fields: null, retryAfterSeconds: null, requestId: 'r1', itemIds: [ID], auditId: ID2 },
    });
    expect(body.error).toMatchObject({ itemIds: [ID], auditId: ID2 });
  });

  it('lists the audit-flow log actions', () => {
    expect(AUDIT_FLOW_AUDIT_ACTIONS).toEqual([
      'audit.started', 'audit.finished', 'audit.cancelled', 'audit.report_sent',
      'execution.corrected', 'execution.sent_back', 'execution.send_back_withdrawn', 'execution.resubmitted',
    ]);
  });

  it('adds three notification types in the audit group, before manual', () => {
    expect(NOTIFICATION_TYPES.slice(-4)).toEqual(['run.correction_required', 'run.resubmitted', 'audit.finished', 'manual']);
    expect(NOTIFICATION_GROUPS).toEqual(['checklist', 'problem', 'task', 'audit']);
    expect(NOTIFICATION_TYPE_META['run.correction_required']).toEqual({ group: 'audit', audiences: ['assignees'], hasLeadTime: false, hasResultFilter: false });
    expect(NOTIFICATION_TYPE_META['run.resubmitted']).toEqual({ group: 'audit', audiences: ['creator'], hasLeadTime: false, hasResultFilter: false });
    expect(NOTIFICATION_TYPE_META['audit.finished']).toEqual({ group: 'audit', audiences: ['assignees'], hasLeadTime: false, hasResultFilter: true });
    expect(DEFAULT_RULES['audit.finished']).toMatchObject({ push: false, email: false, notifyAssignees: true, systemRoles: ['manager'], resultFilter: 'failed' });
    expect(DEFAULT_RULES['run.correction_required']).toMatchObject({ push: true, notifyAssignees: true, resultFilter: null });
    expect(DEFAULT_RULES['run.resubmitted']).toMatchObject({ push: false, notifyCreator: true, resultFilter: null });
    expect(NOTIFICATION_TYPES.filter(isAuditType)).toEqual(['run.correction_required', 'run.resubmitted', 'audit.finished']);
    expect(NOTIFICATION_ISSUE_CODES).toContain('notifications.issues.resultFilterNotApplicable');
  });

  it('carries the result filter on rules, defaulting to null for old clients', () => {
    const rule = { enabled: true, push: false, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null };
    expect(updateNotificationRuleSchema.parse(rule).resultFilter).toBeNull();
    expect(updateNotificationRuleSchema.parse({ ...rule, resultFilter: 'any' }).resultFilter).toBe('any');
    expect(updateNotificationRuleSchema.safeParse({ ...rule, resultFilter: 'passed' }).success).toBe(false);
    expect(notificationRuleDtoSchema.parse({ type: 'audit.finished', ...rule, resultFilter: 'failed', isDefault: true }).resultFilter).toBe('failed');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- audits`
Expected: FAIL: `correctAnswersInputSchema` and the other new names are not exported.

- [ ] **Step 3: Add the new statuses**

In `packages/contracts/src/occurrences.ts`, the status list becomes:

```ts
/**
 * FR-11.01. Sub-project 3 writes pending, overdue, missed and cancelled; sub-project 4 the run statuses; sub-project 8
 * audit_pending, audited and correction_required ("Düzəliş tələb olunur", FR-19.15).
 */
export const OCCURRENCE_STATUSES = ['pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited', 'correction_required'] as const;
```

In `packages/contracts/src/execution-logic.ts`:

```ts
/** `rework`: sent back to the worker after completion (SP8 spec §3.2). */
export const EXECUTION_STATES = ['active', 'completed', 'partial', 'rejected', 'rework'] as const;
```

and after `scoreSchema`:

```ts
/** A run's score as the API sends it (the schema of ScoreResult). */
export type Score = z.infer<typeof scoreSchema>;
```

In `packages/contracts/src/report-logic.ts`:

```ts
/** A run sent back was executed: its completion and lateness keep counting (SP8 spec §3.1). */
export const COMPLETED_STATUSES = ['completed', 'audit_pending', 'audited', 'correction_required'] as const satisfies readonly OccurrenceStatus[];
```

- [ ] **Step 4: Write `corrections.ts`**

`packages/contracts/src/corrections.ts`:

```ts
import { z } from 'zod';
import { AUDIT_LIMITS, correctionKindSchema } from './audit-logic.js';
import { idSchema, isoDateTimeSchema } from './common.js';
import { executionStateSchema, progressSchema, scoreSchema } from './execution-logic.js';
import { answerSchema } from './executions.js';
import { occurrenceStatusSchema, userRefSchema } from './occurrences.js';

/** Field keys of correction validation errors; also i18n keys. */
export const CORRECTION_ISSUE_CODES = ['corrections.issues.dueInPast', 'corrections.issues.duplicateItem'] as const;
export type CorrectionIssueCode = (typeof CORRECTION_ISSUE_CODES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

/** One issue per repeated item id, at `<list>.<index>.itemId`. */
const uniqueItems =
  (list: 'changes' | 'items') =>
  (v: Record<typeof list, { itemId: string }[]>, ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    v[list].forEach((x, i) => {
      if (seen.has(x.itemId)) ctx.addIssue({ code: 'custom', path: [list, i, 'itemId'], message: 'corrections.issues.duplicateItem' });
      seen.add(x.itemId);
    });
  };

/** Spec decision 2: everything a worker's answer holds except the manual problem, which a correction never edits. */
export const correctionAnswerSchema = answerSchema.omit({ problem: true });
export type CorrectionAnswer = z.infer<typeof correctionAnswerSchema>;

/** POST /executions/:id/corrections. `answer: null` clears the item (its manual problem stays). */
export const correctAnswersInputSchema = z
  .object({
    answersRev: z.number().int().min(1),
    changes: z.array(z.object({ itemId: idSchema, answer: correctionAnswerSchema.nullable() })).min(1).max(AUDIT_LIMITS.changes),
    reason: text(AUDIT_LIMITS.reason),
  })
  .superRefine(uniqueItems('changes'));
export type CorrectAnswersInput = z.input<typeof correctAnswersInputSchema>;
export type CorrectAnswersParams = z.output<typeof correctAnswersInputSchema>;

export const correctionResultSchema = z.object({
  executionId: idSchema,
  /** The stored revision after the correction (unchanged when nothing changed). */
  answersRev: z.number().int(),
  changedItemIds: z.array(idSchema),
  score: scoreSchema.nullable(),
});
export type CorrectionResult = z.infer<typeof correctionResultSchema>;

export const reworkItemSchema = z.object({ itemId: idSchema, comment: text(AUDIT_LIMITS.reason) });
export type ReworkItem = z.infer<typeof reworkItemSchema>;

/** POST /executions/:id/send-back. A `dueAt` in the past is refused by the API (`corrections.issues.dueInPast`). */
export const sendBackInputSchema = z
  .object({
    items: z.array(reworkItemSchema).min(1).max(AUDIT_LIMITS.reworkItems),
    dueAt: isoDateTimeSchema.nullable().optional(),
  })
  .superRefine(uniqueItems('items'));
export type SendBackInput = z.input<typeof sendBackInputSchema>;
export type SendBackParams = z.output<typeof sendBackInputSchema>;

export const reworkRequestSchema = z.object({
  id: idSchema,
  round: z.number().int(),
  items: z.array(reworkItemSchema),
  /** Informational: nothing happens when it passes (spec §3.2). */
  dueAt: isoDateTimeSchema.nullable(),
  /** null = a platform admin (Taskop support) sent it back. */
  requestedBy: userRefSchema.nullable(),
  requestedAt: isoDateTimeSchema,
  resubmittedAt: isoDateTimeSchema.nullable(),
  withdrawnAt: isoDateTimeSchema.nullable(),
  withdrawnBy: userRefSchema.nullable(),
  /** The answers when the run was sent back: the base of the rework guard (reworkViolations), so the phone starts from it. */
  answersBefore: z.record(z.string(), answerSchema),
});
export type ReworkRequest = z.infer<typeof reworkRequestSchema>;

export const correctionActorSchema = z.object({ kind: z.enum(['user', 'platform']), name: z.string().nullable() });
export type CorrectionActor = z.infer<typeof correctionActorSchema>;

/** One changed item (FR-19.13): who, when, which item, old and new value, and why. */
export const correctionSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  kind: correctionKindSchema,
  round: z.number().int(),
  before: answerSchema.nullable(),
  after: answerSchema.nullable(),
  /** manual: the manager's reason; rework: the manager's comment on the item. */
  reason: z.string(),
  actor: correctionActorSchema,
  at: isoDateTimeSchema,
});
export type Correction = z.infer<typeof correctionSchema>;

export const answerDiffSchema = z.object({ itemId: idSchema, original: answerSchema.nullable(), current: answerSchema.nullable() });
export type AnswerDiff = z.infer<typeof answerDiffSchema>;

/** GET /executions/:id/corrections (NFR-07.05). */
export const executionCorrectionsSchema = z.object({
  /** The one-time snapshot; null until the first correction or send-back. */
  original: z.object({ answers: z.record(z.string(), answerSchema), score: scoreSchema.nullable(), capturedAt: isoDateTimeSchema }).nullable(),
  /** Oldest first. */
  corrections: z.array(correctionSchema),
  /** Round order. */
  reworkRequests: z.array(reworkRequestSchema),
  /** Items whose current answer differs from the original, in checklist order. */
  diff: z.array(answerDiffSchema),
});
export type ExecutionCorrections = z.infer<typeof executionCorrectionsSchema>;

/** POST /executions/:id/resubmit: the device time of the tap, with the usual command timing (spec §6.6 of SP4). */
export const resubmitCommandSchema = z.object({
  resubmittedAt: isoDateTimeSchema,
  deviceTime: isoDateTimeSchema,
  clientOffsetMs: z.number().int().min(-2_000_000_000).max(2_000_000_000),
});
export type ResubmitCommand = z.input<typeof resubmitCommandSchema>;

export const resubmitResultSchema = z.object({
  executionId: idSchema,
  state: executionStateSchema,
  status: occurrenceStatusSchema,
  progress: progressSchema,
  score: scoreSchema.nullable(),
});
export type ResubmitResult = z.infer<typeof resubmitResultSchema>;
```

- [ ] **Step 5: Write `audits.ts`**

`packages/contracts/src/audits.ts`:

```ts
import { z } from 'zod';
import {
  AUDIT_LIMITS,
  auditQueueSchema,
  auditReportStatusSchema,
  auditResultSchema,
  auditScoreSchema,
  auditStatusSchema,
  auditVerdictSchema,
  runAuditStateSchema,
} from './audit-logic.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema, pageOf } from './common.js';
import { executionCorrectionsSchema } from './corrections.js';
import { emailSchema } from './credentials.js';
import { executionDetailSchema } from './execution-views.js';
import { occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, type LocalDate, localDateSchema } from './scheduling-time.js';

/** Field keys of audit validation errors; also i18n keys. */
export const AUDIT_ISSUE_CODES = ['audits.issues.commentRequired', 'audits.issues.rangeTooLong', 'audits.issues.tooManyEmails', 'audits.issues.notAuditable'] as const;
export type AuditIssueCode = (typeof AUDIT_ISSUE_CODES)[number];

export const auditActorSchema = z.object({ kind: z.enum(['user', 'platform']), id: idSchema.nullable(), name: z.string().nullable() });
export type AuditActor = z.infer<typeof auditActorSchema>;

export const auditItemVerdictSchema = z.object({
  itemId: idSchema,
  verdict: auditVerdictSchema,
  comment: z.string().nullable(),
  /** null = a platform admin. */
  updatedBy: userRefSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type AuditItemVerdict = z.infer<typeof auditItemVerdictSchema>;

export const auditDtoSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  occurrenceId: idSchema,
  status: auditStatusSchema,
  /** In progress while the run is sent back: verdicts can change, finish is refused (spec §3.3). */
  paused: z.boolean(),
  auditor: auditActorSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
  result: auditResultSchema.nullable(),
  score: auditScoreSchema.nullable(),
  comment: z.string().nullable(),
  reportStatus: auditReportStatusSchema,
  reportRecipients: z.array(z.string()),
  reportSentAt: isoDateTimeSchema.nullable(),
  verdicts: z.array(auditItemVerdictSchema),
});
export type AuditDto = z.infer<typeof auditDtoSchema>;

/** GET /audits/:id: the audit with everything the audit screen shows (spec §8.3). */
export const auditDetailSchema = auditDtoSchema.extend({
  execution: executionDetailSchema,
  corrections: executionCorrectionsSchema,
  /** visibleItems of the current answers, in checklist order (Spec decision 1). */
  auditableItemIds: z.array(idSchema),
  checklistReportEmails: z.array(z.string()),
  requiresAudit: z.boolean(),
});
export type AuditDetail = z.infer<typeof auditDetailSchema>;

/** GET /audits (Spec decision 13). `from` and `to` filter the run's local day and go together. */
export const auditQueueQuerySchema = cursorQuerySchema
  .extend({
    queue: auditQueueSchema,
    siteId: idSchema.optional(),
    checklistId: idSchema.optional(),
    auditorId: idSchema.optional(),
    result: auditResultSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.from === undefined && v.to === undefined) return;
    if (v.from === undefined || v.to === undefined) {
      ctx.addIssue({ code: 'custom', path: [v.from === undefined ? 'from' : 'to'], message: 'errors.validation.required' });
      return;
    }
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > AUDIT_LIMITS.queueMaxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'audits.issues.rangeTooLong' });
  });
export type AuditQueueQuery = z.input<typeof auditQueueQuerySchema>;
export type AuditQueueParams = z.output<typeof auditQueueQuerySchema>;

const refSchema = z.object({ id: idSchema, name: z.string() });

export const auditQueueRowSchema = z.object({
  occurrenceId: idSchema,
  executionId: idSchema,
  /** null in the Waiting tab. */
  auditId: idSchema.nullable(),
  checklist: refSchema,
  site: refSchema,
  executor: userRefSchema,
  localDate: localDateSchema,
  completedAt: isoDateTimeSchema,
  status: occurrenceStatusSchema,
  auditState: runAuditStateSchema.nullable(),
  auditor: auditActorSchema.nullable(),
  result: auditResultSchema.nullable(),
  percent: z.number().nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type AuditQueueRow = z.infer<typeof auditQueueRowSchema>;
export const auditQueuePageSchema = pageOf(auditQueueRowSchema);

/** PUT /audits/:id/items/:itemId. A rejection needs a comment (FR-19.05). */
export const auditVerdictInputSchema = z
  .object({ verdict: auditVerdictSchema, comment: z.string().trim().max(AUDIT_LIMITS.verdictComment).nullable().optional() })
  .superRefine((v, ctx) => {
    if (v.verdict === 'rejected' && !v.comment) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'audits.issues.commentRequired' });
  });
export type AuditVerdictInput = z.input<typeof auditVerdictInputSchema>;
export type AuditVerdictParams = z.output<typeof auditVerdictInputSchema>;

const emailList = (min: number) =>
  z
    .array(emailSchema)
    .min(min)
    .max(AUDIT_LIMITS.recipients, { error: 'audits.issues.tooManyEmails' })
    .transform((list) => [...new Set(list)]);

export const finishAuditInputSchema = z.object({
  result: auditResultSchema,
  comment: z.string().trim().max(AUDIT_LIMITS.finalComment).nullable().optional(),
  extraEmails: emailList(0).optional(),
});
export type FinishAuditInput = z.input<typeof finishAuditInputSchema>;
export type FinishAuditParams = z.output<typeof finishAuditInputSchema>;

export const cancelAuditInputSchema = z.object({ reason: z.string().trim().min(1).max(AUDIT_LIMITS.cancelReason) });
export type CancelAuditInput = z.input<typeof cancelAuditInputSchema>;

/** POST /audits/:id/report/send. Without `emails`, the stored recipients. */
export const sendAuditReportInputSchema = z.object({ emails: emailList(1).optional() });
export type SendAuditReportInput = z.input<typeof sendAuditReportInputSchema>;
export type SendAuditReportParams = z.output<typeof sendAuditReportInputSchema>;

export const AUDIT_REPORT_CONTENT_TYPE = 'application/pdf';

const TRANSLIT: Record<string, string> = { ə: 'e', ı: 'i', ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u' };

/** `taskop-audit-<ascii slug>-<YYYY-MM-DD>.pdf`. Both İ and I become i before lower-casing, so no runtime locale is needed. */
export function auditReportFileName(checklistName: string, localDate: LocalDate): string {
  const slug = checklistName
    .replace(/[İI]/g, 'i')
    .toLowerCase()
    .replace(/[əışçğöü]/g, (c) => TRANSLIT[c]!)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `taskop-audit-${slug || 'checklist'}-${localDate}.pdf`;
}
```

- [ ] **Step 6: Change the existing contracts**

`packages/contracts/src/execution-views.ts`:
- add the imports

```ts
import { auditBriefSchema } from './audit-logic.js';
import { reworkRequestSchema } from './corrections.js';
```

- in `myExecutionSchema`, after `mediaPending: z.number().int(),` add

```ts
  /** Send-back rounds so far (SP8 spec §3.2). */
  reworkRound: z.number().int().default(0),
  /** The open send-back while `state` is `rework`; the phone edits only its items. */
  rework: reworkRequestSchema.nullable().default(null),
```

- in `executionProblemSchema`, after `taskId: idSchema.nullable(),` add

```ts
  /** Set when a correction removed the problem (SP8 spec §4.1); the row is kept. */
  clearedAt: isoDateTimeSchema.nullable().default(null),
```

- in `executionDetailSchema`, after `problems: z.array(executionProblemSchema),` add

```ts
  reworkRound: z.number().int().default(0),
  /** The open send-back, or null. */
  rework: reworkRequestSchema.nullable().default(null),
  /** The original answers were snapshotted: at least one correction or send-back happened. */
  corrected: z.boolean().default(false),
  /** The run's latest audit, cancelled ones included; null when none was ever started. */
  audit: auditBriefSchema.nullable().default(null),
```

- in `problemDtoSchema`, after `executionState: executionStateSchema,` add

```ts
  /** Set when a correction removed the problem; the problems page hides these unless `includeCleared`. */
  clearedAt: isoDateTimeSchema.nullable().default(null),
```

- in `problemListQuerySchema`'s `.extend({...})`, after `resolution: problemResolutionSchema.optional(),` add

```ts
    /** 'true' also lists problems a correction cleared (SP8 spec §8.3). */
    includeCleared: z.stringbool().optional(),
```

`packages/contracts/src/checklists.ts`:
- add `import { auditReportEmailsSchema } from './audit-logic.js';`
- `checklistDetailSchema` becomes

```ts
export const checklistDetailSchema = checklistSummarySchema.extend({
  currentVersionId: idSchema.nullable(),
  source: checklistSourceSchema.nullable(),
  /** Draft first, then published versions newest first. */
  versions: z.array(checklistVersionSummarySchema),
  /** Completed runs move to audit_pending (SP8 spec §4.1). A setting, not versioned content. */
  requiresAudit: z.boolean().default(false),
  /** Where the audit report goes (FR-19.08). */
  auditReportEmails: z.array(z.string()).default([]),
});
```

- `updateChecklistInputSchema` becomes

```ts
export const updateChecklistInputSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  category: templateCategorySchema.nullable().optional(),
  requiresAudit: z.boolean().optional(),
  auditReportEmails: auditReportEmailsSchema.optional(),
});
```

`packages/contracts/src/reports.ts`:
- add `import { runAuditStateSchema } from './audit-logic.js';`
- `reportRunsQuerySchema` becomes

```ts
export const reportRunsQuerySchema = z
  .object({ ...filterShape, bucket: runBucketSchema.default('all'), auditState: runAuditStateSchema.optional(), cursor: idSchema.optional() })
  .superRefine(toNotBeforeFrom);
```

- `reportExportQuerySchema` becomes

```ts
export const reportExportQuerySchema = z
  .object({
    ...filterShape,
    format: reportFormatSchema,
    bucket: runBucketSchema.optional(),
    /** The runs export only (SP8 spec §8.3). */
    auditState: runAuditStateSchema.optional(),
    severity: problemSeveritySchema.optional(),
  })
  .superRefine(toNotBeforeFrom);
```

- in `reportRunSchema`, after `clockSuspect: z.boolean(),` add

```ts
  /** waiting / in_progress / passed / failed; null without an audit (SP8 spec §8.3). */
  auditState: runAuditStateSchema.nullable().default(null),
  /** The answers were corrected (the original snapshot exists). */
  corrected: z.boolean().default(false),
```

`packages/contracts/src/permissions.ts`: after the `reports` group add

```ts
  { group: 'executions', keys: ['executions.correct'] },
  { group: 'audits', keys: ['audits.perform'] },
```

and the defaults become (Manager gains `executions.correct`, Auditor gains `audits.perform`):

```ts
  manager: {
    name: 'Manager',
    dataScope: 'site_subtree',
    permissions: ['sites.view', 'teams.view', 'users.view', 'checklists.view', 'checklists.manage', 'assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage', 'tasks.view', 'tasks.manage', 'notifications.send', 'reports.view', 'reports.export', 'executions.correct'],
    editable: true,
  },
  worker: { name: 'Worker', dataScope: 'own', permissions: [], editable: true },
  auditor: {
    name: 'Auditor',
    dataScope: 'all',
    permissions: ['sites.view', 'users.view', 'audit.view', 'checklists.view', 'assignments.view', 'shifts.view', 'tasks.view', 'reports.view', 'reports.export', 'audits.perform'],
    editable: true,
  },
```

`packages/contracts/src/errors.ts`:
- in `ErrorCode`, before `INTERNAL: 'INTERNAL',` add

```ts
  EXECUTION_LOCKED: 'EXECUTION_LOCKED',
  EXECUTION_NOT_CORRECTABLE: 'EXECUTION_NOT_CORRECTABLE',
  ANSWERS_CONFLICT: 'ANSWERS_CONFLICT',
  ITEM_NOT_IN_REWORK: 'ITEM_NOT_IN_REWORK',
  MEDIA_NOT_CORRECTABLE: 'MEDIA_NOT_CORRECTABLE',
  AUDIT_EXISTS: 'AUDIT_EXISTS',
  AUDIT_PAUSED: 'AUDIT_PAUSED',
  AUDIT_INCOMPLETE: 'AUDIT_INCOMPLETE',
  AUDIT_NOT_IN_PROGRESS: 'AUDIT_NOT_IN_PROGRESS',
  REPORT_NOT_READY: 'REPORT_NOT_READY',
```

- in `ERROR_HTTP_STATUS`, before `INTERNAL: 500,` add

```ts
  EXECUTION_LOCKED: 409,
  EXECUTION_NOT_CORRECTABLE: 409,
  ANSWERS_CONFLICT: 409,
  ITEM_NOT_IN_REWORK: 422,
  MEDIA_NOT_CORRECTABLE: 422,
  AUDIT_EXISTS: 409,
  AUDIT_PAUSED: 409,
  AUDIT_INCOMPLETE: 422,
  AUDIT_NOT_IN_PROGRESS: 409,
  REPORT_NOT_READY: 409,
```

- in `errorBodySchema`, after `limit: z.number().int().optional(),` add

```ts
    /** AUDIT_EXISTS: the run's existing audit. */
    auditId: z.string().optional(),
    /** AUDIT_INCOMPLETE: the auditable items without a verdict. */
    itemIds: z.array(z.string()).optional(),
```

`packages/contracts/src/audit.ts`: append

```ts
/**
 * Audited audit and correction actions (SP8 spec §6.4). `audit.*` use entity type `audit`; `execution.*` entity type
 * `execution`. before/after hold only the changed items. Verdict edits and the system's completed → audit_pending move
 * are recorded only in their own tables and in the status history.
 */
export const AUDIT_FLOW_AUDIT_ACTIONS = [
  'audit.started',
  'audit.finished',
  'audit.cancelled',
  'audit.report_sent',
  'execution.corrected',
  'execution.sent_back',
  'execution.send_back_withdrawn',
  'execution.resubmitted',
] as const;
export type AuditFlowAuditAction = (typeof AUDIT_FLOW_AUDIT_ACTIONS)[number];
```

`packages/contracts/src/notifications.ts`:
- `NOTIFICATION_TYPES`: between `'task.cancelled',` and `'manual',` add `'run.correction_required', 'run.resubmitted', 'audit.finished',`.
- `export const NOTIFICATION_GROUPS = ['checklist', 'problem', 'task', 'audit'] as const;`
- `NotificationTypeMeta` and the metadata helpers become

```ts
export interface NotificationTypeMeta {
  group: NotificationGroup;
  /** The direct audiences the settings row shows; others must stay false. */
  audiences: readonly DirectAudience[];
  /** Only checklist.due_soon has a lead time. */
  hasLeadTime: boolean;
  /** Only audit.finished: notify on every result, or on failed audits only (SP8 spec §7.1). */
  hasResultFilter: boolean;
}

const checklistMeta = (hasLeadTime = false): NotificationTypeMeta => ({ group: 'checklist', audiences: ['assignees'], hasLeadTime, hasResultFilter: false });
const problemMeta: NotificationTypeMeta = { group: 'problem', audiences: [], hasLeadTime: false, hasResultFilter: false };
const taskMeta: NotificationTypeMeta = { group: 'task', audiences: ['assignees', 'creator'], hasLeadTime: false, hasResultFilter: false };
/** SP8: for run.correction_required and audit.finished "assignees" is the executor; for run.resubmitted "creator" is who sent it back. */
const auditMeta = (audiences: readonly DirectAudience[], hasResultFilter = false): NotificationTypeMeta => ({ group: 'audit', audiences, hasLeadTime: false, hasResultFilter });
```

- in `NOTIFICATION_TYPE_META`, after `'task.cancelled': taskMeta,` add

```ts
  'run.correction_required': auditMeta(['assignees']),
  'run.resubmitted': auditMeta(['creator']),
  'audit.finished': auditMeta(['assignees'], true),
```

- after `leadMinutesSchema` add

```ts
/** audit.finished's rule option (SP8 spec §7.1). */
export const AUDIT_RESULT_FILTERS = ['any', 'failed'] as const;
export const auditResultFilterSchema = z.enum(AUDIT_RESULT_FILTERS);
export type AuditResultFilter = z.infer<typeof auditResultFilterSchema>;
```

- `DefaultRule` and `rule` become

```ts
export type DefaultRule = {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  /** Turned into the tenant's role ids by the API (roles.system_key); clients never see this. */
  systemRoles: readonly SystemRoleKey[];
  leadMinutes: LeadMinutes | null;
  /** audit.finished only; null elsewhere. */
  resultFilter: AuditResultFilter | null;
};

const rule = (
  push: boolean,
  email: boolean,
  notifyAssignees: boolean,
  notifyCreator: boolean,
  systemRoles: readonly SystemRoleKey[] = [],
  leadMinutes: LeadMinutes | null = null,
  resultFilter: AuditResultFilter | null = null,
): DefaultRule => ({ enabled: true, push, email, notifyAssignees, notifyCreator, systemRoles, leadMinutes, resultFilter });
```

- in `DEFAULT_RULES`, after `'task.cancelled': rule(true, false, true, false),` add

```ts
  'run.correction_required': rule(true, false, true, false),
  'run.resubmitted': rule(false, false, false, true),
  'audit.finished': rule(false, false, true, false, ['manager'], null, 'failed'),
```

- after `isProblemType` add

```ts
/** The SP8 types: their inbox items open the run, like checklist types. */
export const isAuditType = (t: NotificationType): boolean => t === 'run.correction_required' || t === 'run.resubmitted' || t === 'audit.finished';
```

- in `notificationRuleDtoSchema`, after `leadMinutes: leadMinutesSchema.nullable(),` add `resultFilter: auditResultFilterSchema.nullable(),`
- in `updateNotificationRuleSchema`, after `leadMinutes: leadMinutesSchema.nullable(),` add `resultFilter: auditResultFilterSchema.nullable().default(null),`
- in `NOTIFICATION_ISSUE_CODES`, after `'notifications.issues.audienceNotApplicable',` add `'notifications.issues.resultFilterNotApplicable',`

`packages/contracts/src/index.ts`: after `export * from './audit-logic.js';` add

```ts
export * from './corrections.js';
export * from './audits.js';
```

- [ ] **Step 7: Update the contract tests that pin the old lists**

In `packages/contracts/src/report-logic.test.ts`:
- in `expected` of `puts every status in its buckets…`, after `audited: ['planned', 'due', 'completed'],` add `correction_required: ['planned', 'due', 'completed'],`
- `expect(COMPLETED_STATUSES).toEqual(['completed', 'audit_pending', 'audited']);` becomes `expect(COMPLETED_STATUSES).toEqual(['completed', 'audit_pending', 'audited', 'correction_required']);`

In `packages/contracts/src/scheduling-resources.test.ts`, the status assertion becomes

```ts
    expect(OCCURRENCE_STATUSES).toEqual(['pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited', 'correction_required']);
```

In `packages/contracts/src/reports.test.ts`, `expect(PERMISSION_GROUPS.at(-1)).toEqual({ group: 'reports', … });` becomes

```ts
    expect(PERMISSION_GROUPS.find((g) => g.group === 'reports')).toEqual({ group: 'reports', keys: ['reports.view', 'reports.export'] });
```

and the test name `adds the reports permissions last, …` becomes `adds the reports permissions, …`. In the same file, `parses a run row with the device and the server completion times` now gets the defaults back:

```ts
    expect(reportRunPageSchema.parse({ items: [row], nextCursor: null }).items[0]).toEqual({ ...row, auditState: null, corrected: false });
```

In `packages/contracts/src/task-views.test.ts`, the `problem` of the `detail` fixture ends `…, taskId: ID, executionState: 'partial', clearedAt: null,` so `taskDetailSchema.parse(detail)` still equals `detail`.

In `packages/contracts/src/notifications.test.ts`:
- add `isAuditType` to the import list;
- the test `groups each type by its prefix…` becomes

```ts
  it('groups each type by its prefix, the SP8 types under audit, and keeps the lead time on due_soon and the result filter on audit.finished', () => {
    for (const t of RULE_TYPES.filter((x) => !isAuditType(x))) expect(t.startsWith(`${NOTIFICATION_TYPE_META[t].group}.`)).toBe(true);
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].group === 'audit')).toEqual(['run.correction_required', 'run.resubmitted', 'audit.finished']);
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].hasLeadTime)).toEqual(['checklist.due_soon']);
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].hasResultFilter)).toEqual(['audit.finished']);
  });
```

- in `keeps every default rule inside what its type allows`, after the `leadMinutes` line add `expect(d.resultFilter !== null).toBe(meta.hasResultFilter);`
- in `rule schemas`, `accepts a full rule and removes duplicate role ids` becomes

```ts
  it('accepts a full rule and removes duplicate role ids', () => {
    expect(updateNotificationRuleSchema.parse(base)).toEqual({ ...base, roleIds: [ID, ID2], resultFilter: null });
    expect(updateNotificationRuleSchema.safeParse({ ...base, leadMinutes: null }).success).toBe(true);
  });
```

- in `parses the effective rule a client receives, for rule types only`, the dto gets `resultFilter: null`:

```ts
    const dto = { type: 'checklist.due_soon', ...base, roleIds: [ID], leadMinutes: 30, resultFilter: null, isDefault: false };
```

- in `adds the notification permissions last, with the role defaults` change only the name to `adds the notification permissions, with the role defaults` (its assertions already use `find`).

- [ ] **Step 8: Run the contract tests**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS.

- [ ] **Step 9: Add the two status labels the API's export indexes at once**

`packages/i18n/src/az/scheduling.ts`, in `statuses`, after `audited: 'Audit olunub',` add `correction_required: 'Düzəliş tələb olunur',`.

`packages/i18n/src/az/executions.ts`, in `states`, after `rejected: 'Rədd edilib',` add `rework: 'Düzəlişdə',`.

Run: `pnpm --filter @taskop/i18n typecheck && pnpm --filter @taskop/i18n build`
Expected: PASS. (`pnpm --filter @taskop/i18n test` stays red until Task 3 labels the new notification types and group; run Task 3 next.)

- [ ] **Step 10: Fill the new fields in the API's mappers with their defaults**

`apps/api/src/executions/execution-queries.ts`, in the object `detail` returns, after `problems: problems.map((r) => toProblemEntry(r.p, r.taskId, r.taskStatus)),` add

```ts
      // Sub-project 8: filled from the rework, snapshot and audit rows in Task 10.
      reworkRound: 0,
      rework: null,
      corrected: false,
      audit: null,
```

`apps/api/src/executions/mappers.ts`, in `toProblemEntry`, after `taskId,` add `clearedAt: null,`.

`apps/api/src/executions/problem-rows.ts`, in `toProblemDtos`' mapped object, after `executionState: r.executionState,` add `clearedAt: null,`.

`apps/api/src/executions/sync.service.ts`, in `executions: own.map(…)`, after `mediaPending,` add

```ts
        reworkRound: 0,
        rework: null,
```

`apps/api/src/reports/report-queries.ts`, in `toReportRun`, after `clockSuspect: r.clock_suspect,` add

```ts
  auditState: null,
  corrected: false,
```

`apps/api/src/checklists/checklists.service.ts`, in `get`'s returned object, after `versions: versions.map(toVersionSummary),` add

```ts
      requiresAudit: false,
      auditReportEmails: [],
```

`apps/api/src/notifications/notification-rules.ts`, in `effectiveRule`:
- in the default branch, after `leadMinutes: d.leadMinutes,` add `resultFilter: d.resultFilter,`
- in the row branch, after the `leadMinutes: …` line add

```ts
    // Task 16 stores the tenant's own filter; until then a row keeps the default's.
    resultFilter: NOTIFICATION_TYPE_META[type].hasResultFilter ? d.resultFilter : null,
```

- [ ] **Step 11: Update the API tests that compare whole objects or the role list**

`apps/api/test/roles.test.ts`, the Manager list becomes

```ts
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual([
      'assignments.manage', 'assignments.view', 'checklists.manage', 'checklists.view', 'executions.correct', 'notifications.send', 'reports.export', 'reports.view', 'shifts.manage', 'shifts.view', 'sites.view', 'tasks.manage', 'tasks.view', 'teams.view', 'users.view',
    ]);
```

`apps/api/test/notification-rules-api.test.ts`:
- the `problem.critical` expectation gets `resultFilter: null,` after `leadMinutes: null,`;
- `expect(saved.body).toEqual({ type: 'task.overdue', ...full, roleIds: [manager], isDefault: false });` becomes `expect(saved.body).toEqual({ type: 'task.overdue', ...full, roleIds: [manager], resultFilter: null, isDefault: false });`

`apps/api/src/notifications/notification-rules.test.ts`:
- the `checklist.missed` expectation gets `resultFilter: null,` after `leadMinutes: null,`;
- `expect(effectiveRule('task.assigned', row, roles)).toEqual({ type: 'task.assigned', ...row, roleIds: [CUSTOM], isDefault: false });` becomes `expect(effectiveRule('task.assigned', row, roles)).toEqual({ type: 'task.assigned', ...row, roleIds: [CUSTOM], resultFilter: null, isDefault: false });`

`apps/api/test/reports-runs.test.ts`, in the `r7` `toEqual`, after `clockSuspect: false,` add

```ts
      auditState: null,
      corrected: false,
```

`apps/api/test/executions-sync.test.ts`, in the expected execution of `…executions).toEqual([ { id: executionId, … } ])`, after `mediaPending: 1,` add

```ts
        reworkRound: 0,
        rework: null,
```

`apps/api/src/reports/export/report-tables.test.ts`:
- the `run: ReportRun` literal ends `…, late: false, clockSuspect: true, auditState: null, corrected: false,`;
- the `problem` literal (`satisfies ReportProblem`) ends `…, executionState: 'completed', taskStatus: 'in_progress', clearedAt: null,`.

- [ ] **Step 12: Add the new fields to the apps' test fixtures**

Web:
- `apps/web/src/features/executions/fixtures.ts`: each of the three `problems` entries ends `…, taskId: null, createdAt: CREATED, clearedAt: null },`; in `detail`, after `problems,` add `reworkRound: 0, rework: null, corrected: false, audit: null,`.
- `apps/web/src/features/executions/answers-view.test.tsx`: the `pr9` literal ends `…, taskId: null, createdAt: '2026-11-02T04:20:00.000Z', clearedAt: null }];`.
- `apps/web/src/features/tasks/fixtures.ts`: in `problemDto`, after `taskId: null,` add `clearedAt: null,`.
- `apps/web/src/features/executions/problems-page.test.tsx`: in `problem`, `…, executionState: 'completed', ...over,` becomes `…, executionState: 'completed', clearedAt: null, ...over,`.
- `apps/web/src/features/reports/fixtures.ts`: in `reportRun`, after `clockSuspect: false,` add `auditState: null, corrected: false,`.
- `apps/web/src/features/checklists/checklist-detail-page.test.tsx`: in `detail`, after the `versions: [ … ],` array add `requiresAudit: false, auditReportEmails: [],`.
- `apps/web/src/features/checklists/checklists-page.test.tsx`: both `create.mockResolvedValue({ ...row(), id: …, versions: [], currentVersionId: null, source: null })` calls get `, requiresAudit: false, auditReportEmails: []` before the closing `}`.
- `apps/web/src/features/notifications/fixtures.ts`: in `ruleDto`, after `leadMinutes: d.leadMinutes,` add `resultFilter: d.resultFilter,`.

Mobile:
- `apps/mobile/src/features/team/testing/fixtures.ts`: in `reportRun`, after `clockSuspect: false,` add `auditState: null, corrected: false,`; in `executionProblem`, after `taskId: null,` add `clearedAt: null,`; in `executionDetail`'s returned object, after the `problems: [ … ],` array add `reworkRound: 0, rework: null, corrected: false, audit: null,`.
- `apps/mobile/src/features/tasks/task-screen.test.tsx`: the `problem: ProblemDto` literal ends `…, taskId: TASK, executionState: 'completed', clearedAt: null,`.
- `apps/mobile/src/offline/testing/fixtures.ts`: in `myExecution`, after `mediaPending: 0,` add `reworkRound: 0, rework: null,`.

- [ ] **Step 13: Typecheck everything that consumes the contracts**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/api test -- roles notification-rules reports-runs executions-sync report-tables`
Expected: PASS. If a typecheck names another test literal typed as one of `ExecutionDetail`, `ExecutionProblem`, `ProblemDto`, `ReportRun`, `MyExecution`, `ChecklistDetail` or `NotificationRuleDto`, add the same default fields there (`reworkRound: 0, rework: null, corrected: false, audit: null` / `clearedAt: null` / `auditState: null, corrected: false` / `requiresAudit: false, auditReportEmails: []` / `resultFilter: null`).

- [ ] **Step 14: Commit**

```bash
git add packages/contracts packages/i18n/src/az/scheduling.ts packages/i18n/src/az/executions.ts \
  apps/api/src/executions/execution-queries.ts apps/api/src/executions/mappers.ts apps/api/src/executions/problem-rows.ts apps/api/src/executions/sync.service.ts \
  apps/api/src/reports/report-queries.ts apps/api/src/checklists/checklists.service.ts apps/api/src/notifications/notification-rules.ts \
  apps/api/src/notifications/notification-rules.test.ts apps/api/src/reports/export/report-tables.test.ts \
  apps/api/test/roles.test.ts apps/api/test/notification-rules-api.test.ts apps/api/test/reports-runs.test.ts apps/api/test/executions-sync.test.ts \
  apps/web/src/features apps/mobile/src/features apps/mobile/src/offline/testing/fixtures.ts
git commit -m "feat(contracts): add the correction, send-back and audit contracts and the new statuses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Azerbaijani strings for audits, corrections, errors, permissions, the audit log, the nav and notifications

**Files:**
- Create: `packages/i18n/src/az/audits.ts`, `packages/i18n/src/az/corrections.ts`
- Modify: `packages/i18n/src/az/index.ts`, `packages/i18n/src/az/errors.ts`, `packages/i18n/src/az/roles.ts`, `packages/i18n/src/az/audit.ts`, `packages/i18n/src/az/nav.ts`, `packages/i18n/src/az/notifications.ts`, `packages/i18n/src/format.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: Task 1 and Task 2 constants (`AUDIT_*`, `RUN_AUDIT_STATES`, `CORRECTION_KINDS`, `CORRECTION_ISSUE_CODES`, `AUDIT_ISSUE_CODES`, `AUDIT_FLOW_AUDIT_ACTIONS`, `AUDIT_RESULT_FILTERS`, `NOTIFICATION_TYPES`, `NOTIFICATION_GROUPS`, `NOTIFICATION_ISSUE_CODES`, `ErrorCode`, `PERMISSION_GROUPS`).
- Produces: every key under *`@taskop/i18n` (Task 3)* in *Interfaces for Parts 2 and 3*, plus `interpolate(template: string, vars: Record<string, string | number>): string` exported from `@taskop/i18n` (the API renders PDF, mail and notification texts with it). Extra keys the API needs: `az.audits.report.{ checklist, site, version, photos, noAnswer, none }`, `az.notifications.templates['run.correction_required'].due`.

- [ ] **Step 1: Write the failing tests**

In `packages/i18n/src/i18n.test.ts`:
- add to the `@taskop/contracts` import: `AUDIT_FLOW_AUDIT_ACTIONS, AUDIT_ISSUE_CODES, AUDIT_QUEUES, AUDIT_REPORT_STATUSES, AUDIT_RESULT_FILTERS, AUDIT_RESULTS, AUDIT_STATUSES, AUDIT_VERDICTS, CORRECTION_ISSUE_CODES, CORRECTION_KINDS, isAuditType, RUN_AUDIT_STATES`;
- change the import from `./index.js` to `import { az, formatDate, formatDateTime, interpolate } from './index.js';`;
- in `notification translations › uses the agreed wording…` the groups line becomes

```ts
    expect(az.notifications.groups).toEqual({ checklist: 'Checklistlər', problem: 'Problemlər', task: 'Tapşırıqlar', audit: 'Audit və düzəlişlər' });
```

- append:

```ts
describe('audit and correction translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('labels every audit status, result, verdict, report status, queue, run audit state, correction kind and issue', () => {
    for (const s of AUDIT_STATUSES) expect(az.audits.statuses[s], s).toBeTypeOf('string');
    for (const r of AUDIT_RESULTS) expect(az.audits.results[r], r).toBeTypeOf('string');
    for (const v of AUDIT_VERDICTS) expect(az.audits.verdicts[v], v).toBeTypeOf('string');
    expect(az.audits.verdicts.unreviewed).toBeTypeOf('string');
    for (const s of AUDIT_REPORT_STATUSES) expect(az.audits.reportStatuses[s], s).toBeTypeOf('string');
    for (const q of AUDIT_QUEUES) expect(az.audits.queues[q], q).toBeTypeOf('string');
    for (const s of RUN_AUDIT_STATES) expect(az.audits.runAuditStates[s], s).toBeTypeOf('string');
    for (const k of CORRECTION_KINDS) expect(az.corrections.kinds[k], k).toBeTypeOf('string');
    for (const code of [...AUDIT_ISSUE_CODES, ...CORRECTION_ISSUE_CODES]) expect(lookup(code), code).toBeTypeOf('string');
    expect(Object.keys(az.audits.issues).sort()).toEqual(AUDIT_ISSUE_CODES.map((c) => c.split('.').pop()).sort());
    expect(Object.keys(az.corrections.issues).sort()).toEqual(CORRECTION_ISSUE_CODES.map((c) => c.split('.').pop()).sort());
  });

  it('has the actions, fields, PDF and e-mail texts with their placeholders', () => {
    for (const k of ['start', 'open', 'finish', 'cancel', 'approve', 'reject', 'clearVerdict', 'downloadReport', 'resendReport', 'retryReport'] as const) {
      expect(az.audits.actions[k], k).toBeTypeOf('string');
    }
    for (const k of ['result', 'comment', 'extraEmails', 'reportEmails', 'requiresAudit', 'cancelReason', 'auditor', 'startedAt', 'finishedAt', 'recipients', 'sentAt'] as const) {
      expect(az.audits.fields[k], k).toBeTypeOf('string');
    }
    for (const k of [
      'title', 'run', 'executor', 'window', 'startedAt', 'completedAt', 'syncedAt', 'auditor', 'finishedAt', 'result', 'auditScore', 'runScore', 'originalScore',
      'comment', 'item', 'answer', 'verdict', 'original', 'correctedBy', 'problem', 'videos', 'morePhotos', 'generatedAt', 'auditId', 'page',
      'checklist', 'site', 'version', 'photos', 'noAnswer', 'none',
    ] as const) {
      expect(az.audits.report[k], k).toBeTypeOf('string');
    }
    expect(az.audits.report.videos).toContain('{{count}}');
    expect(az.audits.report.morePhotos).toContain('{{count}}');
    expect(az.audits.report.page).toBe('Səhifə {{page}} / {{pages}}');
    expect(az.audits.progress).toContain('{{reviewed}}');
    for (const p of ['{{checklist}}', '{{site}}', '{{date}}']) expect(az.audits.email.subject, p).toContain(p);
    for (const p of ['{{checklist}}', '{{site}}', '{{date}}', '{{result}}', '{{auditor}}']) expect(az.audits.email.body, p).toContain(p);
    for (const k of ['correct', 'sendBack', 'withdraw', 'resubmit'] as const) expect(az.corrections.actions[k], k).toBeTypeOf('string');
    for (const k of ['reason', 'itemComment', 'dueAt', 'items'] as const) expect(az.corrections.fields[k], k).toBeTypeOf('string');
    expect(az.corrections.round).toContain('{{round}}');
    expect(az.corrections.dueAt).toContain('{{date}}');
  });

  it('uses the FR-19.15 wording and the agreed labels', () => {
    expect(az.scheduling.statuses.correction_required).toBe('Düzəliş tələb olunur');
    expect(az.corrections.reworkBanner).toBe('Düzəliş tələb olunur');
    expect(az.executions.states.rework).toBe('Düzəlişdə');
    expect(az.scheduling.statuses.audit_pending).toBe('Audit gözləyir');
    expect(az.scheduling.statuses.audited).toBe('Audit olunub');
    expect(az.audits.title).toBe('Auditlər');
    expect(az.nav.audits).toBe('Auditlər');
    expect(az.corrections.title).toBe('Düzəlişlər');
    expect(az.corrections.kinds).toEqual({ manual: 'Rəhbər düzəlişi', rework: 'İcraçı düzəlişi' });
    expect(az.roles.groups.executions).toBeTypeOf('string');
    expect(az.roles.groups.audits).toBeTypeOf('string');
    expect(az.roles.keys.executions_correct).toBeTypeOf('string');
    expect(az.roles.keys.audits_perform).toBeTypeOf('string');
    expect(az.audit.entityTypes.audit).toBe('Audit');
    expect(az.audit.entityTypes.execution).toBe('İcra');
    for (const a of AUDIT_FLOW_AUDIT_ACTIONS) expect(az.audit.actions[a], a).toBeTypeOf('string');
  });

  it('has the notification labels, filters and templates of the three audit types', () => {
    for (const f of AUDIT_RESULT_FILTERS) expect(az.notifications.resultFilters[f], f).toBeTypeOf('string');
    for (const ty of NOTIFICATION_TYPES.filter(isAuditType)) {
      const tpl = az.notifications.templates[ty as keyof typeof az.notifications.templates];
      expect(tpl.title, ty).toBeTypeOf('string');
      expect(tpl.body, ty).toContain('{{checklist}}');
    }
    expect(az.notifications.templates['run.correction_required'].body).toContain('{{count}}');
    expect(az.notifications.templates['run.correction_required'].due).toContain('{{date}}');
    expect(az.notifications.templates['run.resubmitted'].body).toContain('{{executor}}');
    expect(az.notifications.templates['audit.finished'].body).toContain('{{result}}');
  });

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(interpolate('{{a}} və {{b}}', { a: 1, b: 'iki' })).toBe('1 və iki');
    expect(interpolate('{{a}} {{x}}', { a: 'A' })).toBe('A {{x}}');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL: `interpolate` is not exported, `az.audits` is undefined, the notification labels for the three new types and the `audit` group are missing.

- [ ] **Step 3: Write the two new namespaces**

`packages/i18n/src/az/audits.ts`:

```ts
export default {
  title: 'Auditlər',
  audit: 'Audit',
  score: 'Audit balı',
  paused: 'İcraçıya düzəlişə qaytarılıb — yenidən təqdim gözlənilir',
  progress: '{{reviewed}} / {{total}} bənd yoxlanılıb',
  noAudit: 'Audit aparılmayıb',
  queues: { waiting: 'Gözləyən', in_progress: 'Davam edən', finished: 'Bitmiş' },
  results: { passed: 'Uğurlu', failed: 'Uğursuz' },
  verdicts: { approved: 'Təsdiqlənib', rejected: 'Rədd edilib', unreviewed: 'Yoxlanılmayıb' },
  statuses: { in_progress: 'Davam edir', finished: 'Bitib', cancelled: 'Ləğv edilib' },
  reportStatuses: { none: 'Hesabat yoxdur', pending: 'Hesabat hazırlanır', ready: 'Hesabat hazırdır', failed: 'Hesabat hazırlanmadı' },
  runAuditStates: { waiting: 'Audit gözləyir', in_progress: 'Audit davam edir', passed: 'Audit uğurlu', failed: 'Audit uğursuz' },
  actions: {
    start: 'Auditə başla',
    open: 'Auditi aç',
    finish: 'Auditi bitir',
    cancel: 'Auditi ləğv et',
    approve: 'Təsdiqlə',
    reject: 'Rədd et',
    clearVerdict: 'Qərarı sil',
    downloadReport: 'PDF hesabatı yüklə',
    resendReport: 'Hesabatı yenidən göndər',
    retryReport: 'Yenidən cəhd et',
  },
  fields: {
    result: 'Nəticə',
    comment: 'Şərh',
    extraEmails: 'Əlavə e-poçt ünvanları',
    reportEmails: 'Audit hesabatı göndəriləcək ünvanlar',
    requiresAudit: 'Audit tələb olunur',
    cancelReason: 'Ləğvetmə səbəbi',
    auditor: 'Auditor',
    startedAt: 'Başlanıb',
    finishedAt: 'Bitib',
    recipients: 'Alıcılar',
    sentAt: 'Göndərilib',
  },
  issues: {
    commentRequired: 'Rədd etmək üçün şərh yazın.',
    rangeTooLong: 'Tarix aralığı ən çox 366 gün ola bilər.',
    tooManyEmails: 'Ünvanların sayı limiti keçir.',
    notAuditable: 'Bu bənd cari cavablarda görünmür.',
  },
  /** The PDF report (spec §7.2). */
  report: {
    title: 'Audit hesabatı',
    checklist: 'Yoxlama vərəqəsi',
    version: 'Versiya {{number}}',
    site: 'Obyekt',
    run: 'İcra',
    executor: 'İcra edən',
    window: 'İcra müddəti',
    startedAt: 'Başlanıb (cihaz)',
    completedAt: 'Tamamlanıb (cihaz)',
    syncedAt: 'Serverə çatıb',
    auditor: 'Auditor',
    finishedAt: 'Audit bitib',
    result: 'Nəticə',
    auditScore: 'Audit balı',
    runScore: 'İcra balı',
    originalScore: 'İlkin bal',
    comment: 'Yekun şərh',
    item: 'Bənd',
    answer: 'Cavab',
    verdict: 'Qərar',
    original: 'İlkin cavab',
    correctedBy: 'Düzəliş: {{name}} — {{reason}}',
    problem: 'Problem',
    photos: '{{count}} foto',
    videos: '{{count}} video',
    morePhotos: '+{{count}} foto',
    noAnswer: 'Cavab yoxdur',
    none: '—',
    generatedAt: 'Hazırlanma vaxtı',
    auditId: 'Audit ID',
    page: 'Səhifə {{page}} / {{pages}}',
  },
  /** The report e-mail (plain text, the PDF attached). */
  email: {
    subject: 'Audit hesabatı: {{checklist}} — {{site}}, {{date}}',
    body: 'Salam!\n\n{{checklist}} — {{site}} ({{date}}) icrasının auditi tamamlandı.\nNəticə: {{result}}.\nAuditor: {{auditor}}.\n\nPDF hesabat məktuba əlavə olunub.\n\nTaskop',
  },
} as const;
```

`packages/i18n/src/az/corrections.ts`:

```ts
export default {
  title: 'Düzəlişlər',
  kinds: { manual: 'Rəhbər düzəlişi', rework: 'İcraçı düzəlişi' },
  original: 'İlkin',
  current: 'Cari',
  corrected: 'Düzəliş edilib',
  cleared: 'Düzəlişlə aradan qaldırılıb',
  round: 'Raund {{round}}',
  /** FR-19.15. */
  reworkBanner: 'Düzəliş tələb olunur',
  dueAt: 'Son tarix: {{date}}',
  noCorrections: 'Düzəliş edilməyib',
  emptyAnswer: 'Cavab yoxdur',
  actions: { correct: 'Cavabları düzəlt', sendBack: 'Düzəlişə qaytar', withdraw: 'Qaytarmanı geri götür', resubmit: 'Yenidən təqdim et' },
  fields: { reason: 'Səbəb', itemComment: 'Bənd üzrə şərh', dueAt: 'Son tarix', items: 'Düzəldilməli bəndlər' },
  issues: {
    dueInPast: 'Son tarix keçmişdə ola bilməz.',
    duplicateItem: 'Bu bənd artıq seçilib.',
  },
} as const;
```

`packages/i18n/src/az/index.ts`: import both and register them:

```ts
import audits from './audits.js';
import corrections from './corrections.js';
```

```ts
export const az = { common, errors, executions, audit, audits, auth, checklists, corrections, mobile, nav, notifications, platform, reports, roles, scheduling, settings, sites, tasks, teams, users } as const;
```

- [ ] **Step 4: Add errors, permissions, audit-log, nav and notification labels**

`packages/i18n/src/az/errors.ts`, before `INTERNAL: …` add:

```ts
  EXECUTION_LOCKED: 'Bu icranın auditi tamamlanıb; onu artıq dəyişmək olmaz.',
  EXECUTION_NOT_CORRECTABLE: 'Bu icranı indiki vəziyyətində düzəltmək və ya düzəlişə qaytarmaq olmaz.',
  ANSWERS_CONFLICT: 'Cavabları bu arada başqası dəyişib. Səhifəni yeniləyin və yenidən cəhd edin.',
  ITEM_NOT_IN_REWORK: 'Bu bənd düzəlişə qaytarılmayıb; onu dəyişmək olmaz.',
  MEDIA_NOT_CORRECTABLE: 'Düzəlişdə yalnız mövcud foto və videoları çıxarmaq olar; yenisini əlavə etmək olmaz.',
  AUDIT_EXISTS: 'Bu icra üçün artıq audit var.',
  AUDIT_PAUSED: 'İcra düzəlişə qaytarılıb. Audit yenidən təqdim olunandan sonra bitirilə bilər.',
  AUDIT_INCOMPLETE: 'Bütün bəndlər üzrə qərar verin.',
  AUDIT_NOT_IN_PROGRESS: 'Bu audit artıq bitib və ya ləğv edilib.',
  REPORT_NOT_READY: 'Audit hesabatı hələ hazırlanır.',
```

`packages/i18n/src/az/roles.ts`: in `groups`, after `reports: 'Hesabatlar',` add `executions: 'İcralar', audits: 'Auditlər',`; in `keys`, after `reports_export: …,` add

```ts
    executions_correct: 'İcraların cavablarını düzəltmək və icranı düzəlişə qaytarmaq',
    audits_perform: 'Audit aparmaq və audit hesabatlarını göndərmək',
```

`packages/i18n/src/az/audit.ts`: in `entityTypes`, after `report: 'Hesabat',` add `audit: 'Audit', execution: 'İcra',`; after `entityTypes` add

```ts
  /** The SP8 actions (AUDIT_FLOW_AUDIT_ACTIONS). Other actions are shown as their code. */
  actions: {
    'audit.started': 'Audit başladı',
    'audit.finished': 'Audit bitdi',
    'audit.cancelled': 'Audit ləğv edildi',
    'audit.report_sent': 'Audit hesabatı göndərildi',
    'execution.corrected': 'İcranın cavabları düzəldildi',
    'execution.sent_back': 'İcra düzəlişə qaytarıldı',
    'execution.send_back_withdrawn': 'Düzəlişə qaytarma geri götürüldü',
    'execution.resubmitted': 'İcra yenidən təqdim edildi',
  },
```

`packages/i18n/src/az/nav.ts`: after `reports: 'Hesabatlar',` add `audits: 'Auditlər',`.

`packages/i18n/src/az/notifications.ts`:
- in `types`, after `'task.cancelled': 'Tapşırıq ləğv edildi',` add

```ts
    'run.correction_required': 'İcra düzəlişə qaytarıldı',
    'run.resubmitted': 'Düzəliş təqdim edildi',
    'audit.finished': 'Audit tamamlandı',
```

- `groups: { checklist: 'Checklistlər', problem: 'Problemlər', task: 'Tapşırıqlar', audit: 'Audit və düzəlişlər' },`
- in `issues`, after `audienceNotApplicable: …,` add `resultFilterNotApplicable: 'Nəticə filtri yalnız «Audit tamamlandı» bildirişinə aiddir.',`
- after `leadMinutes: '{{count}} dəq əvvəl',` add

```ts
  /** audit.finished's rule option (SP8 spec §7.1). */
  resultFilters: { any: 'Bütün nəticələr', failed: 'Yalnız uğursuz auditlər' },
  /** Push and inbox texts of the SP8 types, rendered once at fan-out. */
  templates: {
    'run.correction_required': {
      title: 'Düzəliş tələb olunur',
      body: '{{checklist}} — {{site}}: {{count}} bənd düzəliş gözləyir.',
      due: 'Son tarix: {{date}}.',
    },
    'run.resubmitted': {
      title: 'Düzəliş təqdim edildi',
      body: '{{checklist}} — {{site}}: {{executor}} düzəlişləri təqdim etdi (raund {{round}}).',
    },
    'audit.finished': {
      title: 'Audit tamamlandı',
      body: '{{checklist}} — {{site}}: {{result}}, audit balı {{percent}}.',
    },
  },
```

`packages/i18n/src/format.ts`, append:

```ts
/** Fills `{{name}}` placeholders; a placeholder without a value stays visible, so a missing variable is noticed. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n typecheck && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api typecheck`
Expected: PASS, including the existing `has a message for every API error code`, `labels every permission group and key` and `has no labels for types or statuses that do not exist`.

- [ ] **Step 6: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add the audit, correction and send-back texts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API client methods for audits, corrections and resubmit

**Files:**
- Modify: `packages/api-client/src/errors.ts`, `packages/api-client/src/client.ts`, `packages/api-client/src/endpoints.ts`
- Test: `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: the Task 2 schemas and input types (`auditQueuePageSchema`, `auditDtoSchema`, `auditDetailSchema`, `auditItemVerdictSchema`, `correctionResultSchema`, `reworkRequestSchema`, `executionCorrectionsSchema`, `resubmitResultSchema`, `AuditQueueQuery`, `AuditVerdictInput`, `FinishAuditInput`, `CancelAuditInput`, `SendAuditReportInput`, `CorrectAnswersInput`, `SendBackInput`, `ResubmitCommand`); `ApiClient.download` and `ReportFile` (SP7).
- Produces: the table under *`@taskop/api-client` (Task 4)*: `createAuditsApi(c)` (namespaces `audits` and `corrections`), `type AuditsApi`, `executions.resubmit`, and `ApiError.auditId: string | null`, `ApiError.itemIds: string[] | null` (the last two constructor parameters).

- [ ] **Step 1: Write the failing tests**

Append to `packages/api-client/src/client.test.ts`:

```ts
describe('audit and correction endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'web', store);
  }
  const AT = '2026-11-02T04:20:00.000Z';
  const user = { id, fullName: 'Leyla' };
  const audit = {
    id, executionId: id, occurrenceId: id, status: 'in_progress', paused: false, auditor: { kind: 'user', id, name: 'Auditor' },
    startedAt: AT, finishedAt: null, cancelledAt: null, cancelReason: null, result: null, score: null, comment: null,
    reportStatus: 'none', reportRecipients: [], reportSentAt: null, verdicts: [],
  };
  const verdict = { itemId: id, verdict: 'approved', comment: null, updatedBy: user, updatedAt: AT };
  const request = { id, round: 1, items: [{ itemId: id, comment: 'Foto' }], dueAt: null, requestedBy: user, requestedAt: AT, resubmittedAt: null, withdrawnAt: null, withdrawnBy: null, answersBefore: {} };
  const history = { original: null, corrections: [], reworkRequests: [], diff: [] };
  const correction = { executionId: id, answersRev: 2, changedItemIds: [id], score: null };
  const resubmitted = { executionId: id, state: 'completed', status: 'audit_pending', progress: { answered: 1, total: 1, requiredMissing: 0 }, score: null };

  it('builds every path, method and body and parses each response', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url} ${init.body ?? ''}`.trim());
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/audits?queue=waiting&siteId=' + id)) return json(200, { items: [], nextCursor: null });
      if (url.includes('/items/')) return json(200, verdict);
      if (url.endsWith('/corrections') && init.method === 'POST') return json(200, correction);
      if (url.endsWith('/corrections')) return json(200, history);
      if (url.includes('/send-back')) return json(200, request);
      if (url.endsWith('/resubmit')) return json(200, resubmitted);
      return json(200, audit);
    });
    const t = createTaskopApi(api);
    expect(await t.audits.list({ queue: 'waiting', siteId: id })).toEqual({ items: [], nextCursor: null });
    expect(await t.audits.start(id)).toEqual(audit);
    expect(await t.audits.setVerdict(id, id, { verdict: 'approved' })).toEqual(verdict);
    expect(await t.audits.clearVerdict(id, id)).toBeUndefined();
    expect(await t.audits.finish(id, { result: 'passed', extraEmails: ['a@x.az'] })).toEqual(audit);
    expect(await t.audits.cancel(id, { reason: 'Səhv' })).toEqual(audit);
    expect(await t.audits.sendReport(id)).toEqual(audit);
    expect(await t.corrections.correct(id, { answersRev: 1, changes: [{ itemId: id, answer: { number: 5 } }], reason: 'Səhv' })).toEqual(correction);
    expect(await t.corrections.sendBack(id, { items: [{ itemId: id, comment: 'Foto' }] })).toEqual(request);
    expect(await t.corrections.withdraw(id)).toEqual(request);
    expect(await t.corrections.history(id)).toEqual(history);
    expect(await t.executions.resubmit(id, { resubmittedAt: AT, deviceTime: AT, clientOffsetMs: 0 })).toEqual(resubmitted);
    expect(calls).toEqual([
      `GET /api/v1/audits?queue=waiting&siteId=${id}`,
      `POST /api/v1/executions/${id}/audits {}`,
      `PUT /api/v1/audits/${id}/items/${id} {"verdict":"approved"}`,
      `DELETE /api/v1/audits/${id}/items/${id}`,
      `POST /api/v1/audits/${id}/finish {"result":"passed","extraEmails":["a@x.az"]}`,
      `POST /api/v1/audits/${id}/cancel {"reason":"Səhv"}`,
      `POST /api/v1/audits/${id}/report/send {}`,
      `POST /api/v1/executions/${id}/corrections {"answersRev":1,"changes":[{"itemId":"${id}","answer":{"number":5}}],"reason":"Səhv"}`,
      `POST /api/v1/executions/${id}/send-back {"items":[{"itemId":"${id}","comment":"Foto"}]}`,
      `POST /api/v1/executions/${id}/send-back/cancel {}`,
      `GET /api/v1/executions/${id}/corrections`,
      `POST /api/v1/executions/${id}/resubmit {"resubmittedAt":"${AT}","deviceTime":"${AT}","clientOffsetMs":0}`,
    ]);
  });

  it('gets the audit detail through its schema', async () => {
    const { api } = await authed(() => json(200, { ...audit, verdicts: 'not a list' }));
    await expect(createTaskopApi(api).audits.get(id)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('downloads the PDF, named by Content-Disposition or audit-<id>.pdf', async () => {
    const pdf = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="taskop-audit-acilis-2026-11-02.pdf"' } });
    const seen: string[] = [];
    const { api } = await authed((url) => {
      seen.push(url);
      return seen.length === 1 ? pdf() : new Response('x', { status: 200 });
    });
    const a = createTaskopApi(api).audits;
    expect((await a.downloadReport(id)).filename).toBe('taskop-audit-acilis-2026-11-02.pdf');
    expect((await a.downloadReport(id)).filename).toBe(`audit-${id}.pdf`);
    expect(seen).toEqual([`/api/v1/audits/${id}/report.pdf`, `/api/v1/audits/${id}/report.pdf`]);
  });

  it('exposes the existing audit id and the items without a verdict', async () => {
    const errorOf = (code: string, extra: object) => json(409, { error: { code, messageKey: `errors.${code}`, fields: null, retryAfterSeconds: null, requestId: 'r1', ...extra } });
    const exists = await authed(() => errorOf('AUDIT_EXISTS', { auditId: id }));
    await expect(createTaskopApi(exists.api).audits.start(id)).rejects.toMatchObject({ code: 'AUDIT_EXISTS', auditId: id, itemIds: null });
    const incomplete = await authed(() => errorOf('AUDIT_INCOMPLETE', { itemIds: [id] }));
    await expect(createTaskopApi(incomplete.api).audits.finish(id, { result: 'passed' })).rejects.toMatchObject({ code: 'AUDIT_INCOMPLETE', itemIds: [id], auditId: null });
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api-client test`
Expected: FAIL: `t.audits` is undefined.

- [ ] **Step 3: Extend `ApiError`**

`packages/api-client/src/errors.ts`, after the `limit` parameter add:

```ts
    /** AUDIT_EXISTS: the run's existing audit, so the app can open it. */
    readonly auditId: string | null = null,
    /** AUDIT_INCOMPLETE: the auditable items without a verdict. */
    readonly itemIds: string[] | null = null,
```

`packages/api-client/src/client.ts`, in `toApiError` the last line becomes:

```ts
  return new ApiError(
    res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId, e.issues ?? null, e.currentRevision ?? null,
    e.userIds ?? null, e.missing ?? null, e.rows ?? null, e.limit ?? null, e.auditId ?? null, e.itemIds ?? null,
  );
```

- [ ] **Step 4: Add the endpoints**

`packages/api-client/src/endpoints.ts`:
- add to the `@taskop/contracts` import list:

```ts
  auditDetailSchema,
  auditDtoSchema,
  auditItemVerdictSchema,
  auditQueuePageSchema,
  type AuditQueueQuery,
  type AuditVerdictInput,
  type CancelAuditInput,
  type CorrectAnswersInput,
  correctionResultSchema,
  executionCorrectionsSchema,
  type FinishAuditInput,
  type ResubmitCommand,
  resubmitResultSchema,
  reworkRequestSchema,
  type SendAuditReportInput,
  type SendBackInput,
```

- in `createExecutionsApi`, after `complete: …,` add

```ts
      /** SP8: closes a rework round (the outbox sends it after answers and media). */
      resubmit: (id: string, body: ResubmitCommand) => c.request('POST', `/executions/${id}/resubmit`, { body, schema: resubmitResultSchema }),
```

- in `createTaskopApi`, after `...createReportsApi(c),` add `...createAuditsApi(c),`
- append:

```ts
/**
 * Sub-project 8: audits (audits.perform; the detail and the PDF also reports.view) and corrections (executions.correct;
 * the history also for anyone who can read the run).
 */
export function createAuditsApi(c: ApiClient) {
  return {
    audits: {
      list: (query: AuditQueueQuery) => c.request('GET', '/audits', { query: q(query), schema: auditQueuePageSchema }),
      start: (executionId: string) => c.request('POST', `/executions/${executionId}/audits`, { body: {}, schema: auditDtoSchema }),
      get: (id: string) => c.request('GET', `/audits/${id}`, { schema: auditDetailSchema }),
      setVerdict: (id: string, itemId: string, body: AuditVerdictInput) => c.request('PUT', `/audits/${id}/items/${itemId}`, { body, schema: auditItemVerdictSchema }),
      clearVerdict: (id: string, itemId: string) => c.request<void>('DELETE', `/audits/${id}/items/${itemId}`),
      finish: (id: string, body: FinishAuditInput) => c.request('POST', `/audits/${id}/finish`, { body, schema: auditDtoSchema }),
      cancel: (id: string, body: CancelAuditInput) => c.request('POST', `/audits/${id}/cancel`, { body, schema: auditDtoSchema }),
      sendReport: (id: string, body: SendAuditReportInput = {}) => c.request('POST', `/audits/${id}/report/send`, { body, schema: auditDtoSchema }),
      /** The stored PDF; REPORT_NOT_READY (409) while it is being built. */
      downloadReport: async (id: string): Promise<ReportFile> => {
        const file = await c.download(`/audits/${id}/report.pdf`);
        return { blob: file.blob, filename: file.filename ?? `audit-${id}.pdf` };
      },
    },
    corrections: {
      correct: (executionId: string, body: CorrectAnswersInput) => c.request('POST', `/executions/${executionId}/corrections`, { body, schema: correctionResultSchema }),
      sendBack: (executionId: string, body: SendBackInput) => c.request('POST', `/executions/${executionId}/send-back`, { body, schema: reworkRequestSchema }),
      withdraw: (executionId: string) => c.request('POST', `/executions/${executionId}/send-back/cancel`, { body: {}, schema: reworkRequestSchema }),
      history: (executionId: string) => c.request('GET', `/executions/${executionId}/corrections`, { schema: executionCorrectionsSchema }),
    },
  };
}
export type AuditsApi = ReturnType<typeof createAuditsApi>;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. Tasks 1–4 are now complete: Parts 2 and 3 can start.

- [ ] **Step 6: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add the audit, correction and resubmit methods" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Migrations 0015 and 0016: statuses, tables, the snapshot trigger, grants, RLS and the permission backfill

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0015_audit_corrections.sql` (generated), `apps/api/drizzle/0016_audit_corrections_tables.sql` (generated, then extended), `apps/api/drizzle/meta/0015_snapshot.json`, `apps/api/drizzle/meta/0016_snapshot.json`, `apps/api/drizzle/meta/_journal.json` (generated)
- Test: `apps/api/test/audit-db.test.ts`

**Interfaces:**
- Consumes: the permission keys `executions.correct` and `audits.perform` (Task 2).
- Produces, in `apps/api/src/db/schema.ts`:
  - enums `correctionKind`, `auditStatus`, `auditResult`, `auditVerdict`, `auditReportStatus`; `occurrenceStatus` + `'correction_required'`; `executionState` + `'rework'`;
  - `checklists.requiresAudit`, `checklists.auditReportEmails`;
  - `executions.originalAnswers`, `originalScore`, `originalCapturedAt`, `reworkRound`;
  - `executionProblems.clearedAt`, `clearedByCorrectionId`, and the partial unique index `execution_problems_active_item_uq (execution_id, item_id, source) WHERE cleared_at IS NULL` in place of the constraint `execution_problems_item_uq`;
  - tables `executionCorrections`, `executionReworkRequests`, `audits` (with `reportAttempts`), `auditItemVerdicts`;
  - `notificationRules.resultFilter`.
- Produces, in the database: the trigger `executions_original_immutable`; grants (`execution_corrections`: SELECT, INSERT; `execution_rework_requests`: SELECT, INSERT and UPDATE of `resubmitted_at, withdrawn_at, withdrawn_by_user_id`; `audits`: SELECT, INSERT, UPDATE; `audit_item_verdicts`: SELECT, INSERT, UPDATE, DELETE); forced RLS on the four new tables; every existing `admin` and `manager` role holds `executions.correct`, every `admin` and `auditor` role holds `audits.perform`, and their `version` is bumped.

`0016` must not mention `'correction_required'` or `'rework'` (Global Constraints: the migrator applies both files in one transaction).

- [ ] **Step 1: Write the failing test**

`apps/api/test/audit-db.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { signupTenant } from './fixtures';
import { asApp } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems } from './task-fixtures';

const TABLES = ['execution_corrections', 'execution_rework_requests', 'audits', 'audit_item_verdicts'];

describe('audit and correction tables (SP8 spec §4)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  afterAll(() => t.close());

  const run = () => closedRunWithProblems(t, clock);
  const correctionRow = (tenantId: string, executionId: string, actor: string) =>
    ownerQuery<{ id: string }>(
      `insert into execution_corrections (id, tenant_id, execution_id, item_id, kind, round, before, after, reason, actor_user_id, at)
       values ($1, $2, $3, gen_random_uuid(), 'manual', 0, '{"number":10}', '{"number":5}', 'Səhv', $4, now()) returning id`,
      [uuidv7(), tenantId, executionId, actor],
    );
  const auditRow = (tenantId: string, executionId: string, occurrenceId: string, auditor: string, status = 'in_progress') =>
    ownerQuery<{ id: string }>(
      `insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at, cancelled_at, cancel_reason)
       values ($1, $2, $3, $4, $5, $6, now(), case when $5 = 'cancelled' then now() end, case when $5 = 'cancelled' then 'x' end) returning id`,
      [uuidv7(), tenantId, executionId, occurrenceId, status, auditor],
    );

  it('adds the two enum values and forces row level security on every new table', async () => {
    const values = await ownerQuery<{ v: string }>("select unnest(enum_range(null::occurrence_status))::text as v");
    expect(values.rows.map((r) => r.v).at(-1)).toBe('correction_required');
    const states = await ownerQuery<{ v: string }>("select unnest(enum_range(null::execution_state))::text as v");
    expect(states.rows.map((r) => r.v).at(-1)).toBe('rework');
    const r = await ownerQuery<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname',
      [TABLES],
    );
    expect(r.rows).toHaveLength(TABLES.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('writes the original answers once and refuses to change them afterwards', async () => {
    const { executionId } = await run();
    await ownerQuery(
      `update executions set original_answers = answers, original_score = score, original_captured_at = now() where id = $1`,
      [executionId],
    );
    await expect(ownerQuery(`update executions set original_answers = '{}'::jsonb where id = $1`, [executionId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery(`update executions set original_score = null where id = $1`, [executionId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery(`update executions set original_captured_at = now() + interval '1 day' where id = $1`, [executionId])).rejects.toThrow(/immutable/);
    // Everything else still updates.
    expect((await ownerQuery(`update executions set rework_round = rework_round + 1 where id = $1`, [executionId])).rowCount).toBe(1);
  });

  it('keeps corrections append-only and lets the app update only the closing columns of a rework request', async () => {
    const { w, executionId } = await run();
    await correctionRow(w.s.tenantId, executionId, w.s.ownerId);
    await ownerQuery(
      `insert into execution_rework_requests (id, tenant_id, execution_id, round, items, requested_by_user_id, requested_at, answers_before, status_before)
       values ($1, $2, $3, 1, '[]', $4, now(), '{}', 'completed')`,
      [uuidv7(), w.s.tenantId, executionId, w.s.ownerId],
    );
    await asApp(w.s.tenantId, async (c) => {
      expect((await c.query('select id from execution_corrections')).rowCount).toBe(1);
      for (const stmt of ["update execution_corrections set reason = 'x'", 'delete from execution_corrections', "update execution_rework_requests set items = '[]'", 'delete from execution_rework_requests', 'delete from audits']) {
        await c.query('savepoint sp');
        await expect(c.query(stmt), stmt).rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint sp');
      }
      expect((await c.query('update execution_rework_requests set withdrawn_at = now(), withdrawn_by_user_id = null')).rowCount).toBe(1);
    });
  });

  it('hides another tenant’s rows', async () => {
    const { w, executionId } = await run();
    const other = await signupTenant(t);
    await correctionRow(w.s.tenantId, executionId, w.s.ownerId);
    await auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId);
    for (const table of ['execution_corrections', 'audits']) {
      expect((await asApp(other.tenantId, (c) => c.query(`select 1 from ${table}`))).rowCount, table).toBe(0);
      expect((await asApp(w.s.tenantId, (c) => c.query(`select 1 from ${table}`))).rowCount, table).toBe(1);
    }
  });

  it('allows a cleared problem and a new active one on the same item, but never two active ones', async () => {
    const { w, executionId, ruleProblemId } = await run();
    const insertRule = () =>
      ownerQuery(
        `insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity)
         select gen_random_uuid(), tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, 'rule', 'normal' from execution_problems where id = $1`,
        [ruleProblemId],
      );
    await expect(insertRule()).rejects.toThrow(/execution_problems_active_item_uq/);
    const correctionId = (await correctionRow(w.s.tenantId, executionId, w.s.ownerId)).rows[0]!.id;
    await ownerQuery('update execution_problems set cleared_at = now(), cleared_by_correction_id = $2 where id = $1', [ruleProblemId, correctionId]);
    await insertRule();
    const rows = await ownerQuery<{ cleared: boolean }>("select cleared_at is not null as cleared from execution_problems where execution_id = $1 and source = 'rule' order by created_at, id", [executionId]);
    expect(rows.rows.map((r) => r.cleared).sort()).toEqual([false, true]);
  });

  it('allows one non-cancelled audit per execution and requires a comment to reject', async () => {
    const { w, executionId } = await run();
    await auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId, 'cancelled');
    const live = (await auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId)).rows[0]!.id;
    await expect(auditRow(w.s.tenantId, executionId, w.occurrenceId, w.s.ownerId)).rejects.toThrow(/audits_open_uq/);
    await expect(
      ownerQuery("insert into audit_item_verdicts (tenant_id, audit_id, item_id, verdict, updated_by_user_id, updated_at) values ($1, $2, gen_random_uuid(), 'rejected', $3, now())", [w.s.tenantId, live, w.s.ownerId]),
    ).rejects.toThrow(/audit_item_verdicts_comment_ck/);
  });

  it('backfills the new keys for existing Admin, Manager and Auditor roles and bumps their version', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) =>
      (await ownerQuery<{ id: string; version: number }>('select id, version from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!;
    const before = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key in ('executions.correct', 'audits.perform')", [Object.values(before).map((r) => r.id)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0016_audit_corrections_tables.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    const from = stmts.findIndex((x) => x.includes('SET LOCAL row_security = off'));
    expect(from).toBeGreaterThan(0);
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts.slice(from)) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = async (roleId: string) =>
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key in ('executions.correct', 'audits.perform') order by 1", [roleId])).rows.map((r) => r.k);
    expect(await keys(before.admin.id)).toEqual(['audits.perform', 'executions.correct']);
    expect(await keys(before.manager.id)).toEqual(['executions.correct']);
    expect(await keys(before.auditor.id)).toEqual(['audits.perform']);
    expect(await keys(before.worker.id)).toEqual([]);
    for (const key of ['admin', 'manager', 'auditor'] as const) expect((await roleOf(key)).version, key).toBe(before[key].version + 1);
    expect((await roleOf('worker')).version).toBe(before.worker.version);
  });

  it('gives a new tenant’s Manager and Auditor the keys from the role defaults', async () => {
    const s = await signupTenant(t);
    const keysOf = async (key: string) =>
      (await ownerQuery<{ k: string }>(
        "select rp.permission_key as k from role_permissions rp join roles r on r.id = rp.role_id where r.tenant_id = $1 and r.system_key = $2 and rp.permission_key in ('executions.correct', 'audits.perform')",
        [s.tenantId, key],
      )).rows.map((r) => r.k);
    expect(await keysOf('manager')).toEqual(['executions.correct']);
    expect(await keysOf('auditor')).toEqual(['audits.perform']);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- audit-db`
Expected: FAIL: `invalid input value for enum occurrence_status` / `relation "execution_corrections" does not exist`.

- [ ] **Step 3: Add the enum values and generate 0015**

In `apps/api/src/db/schema.ts`:
- the comment above `occurrenceStatus` stays; append `'correction_required',` after `'audited',` in its list;
- `export const executionState = pgEnum('execution_state', ['active', 'completed', 'partial', 'rejected', 'rework']);`

Run:

```bash
pnpm --filter @taskop/api exec drizzle-kit generate --name audit_corrections
```

Check: `apps/api/drizzle/0015_audit_corrections.sql` contains exactly

```sql
ALTER TYPE "public"."occurrence_status" ADD VALUE 'correction_required';--> statement-breakpoint
ALTER TYPE "public"."execution_state" ADD VALUE 'rework';
```

(the two lines may come in the other order), and `meta/_journal.json` has the entry `0015_audit_corrections`.

- [ ] **Step 4: Add the tables and columns to the schema**

In `apps/api/src/db/schema.ts`:

In `checklists`, after `sourceVersionId: uuid('source_version_id'),` add:

```ts
    // SP8 spec §4.1: settings, not versioned content.
    requiresAudit: boolean('requires_audit').notNull().default(false),
    auditReportEmails: text('audit_report_emails').array().notNull().default(sql`'{}'::text[]`),
```

After `export const problemSeverity = …;` add:

```ts
// Must match CORRECTION_KINDS in @taskop/contracts.
export const correctionKind = pgEnum('correction_kind', ['manual', 'rework']);
```

In `executions`, after `device: jsonb('device').notNull(),` add:

```ts
    // The one-time snapshot taken by the first correction or send-back (SP8 spec §4.1); a trigger keeps it immutable.
    originalAnswers: jsonb('original_answers'),
    originalScore: jsonb('original_score'),
    originalCapturedAt: ts('original_captured_at'),
    // Send-back rounds so far.
    reworkRound: integer('rework_round').notNull().default(0),
```

Between `executionMedia` and `executionProblems` add:

```ts
/** Append-only (BR-14, FR-19.13): one row per changed item. The app account may only INSERT and SELECT. */
export const executionCorrections = pgTable(
  'execution_corrections',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    itemId: uuid('item_id').notNull(),
    kind: correctionKind('kind').notNull(),
    // executions.rework_round at the time: 0 for a manual correction before any send-back.
    round: integer('round').notNull(),
    // The item's whole answer before and after, or null.
    before: jsonb('before'),
    after: jsonb('after'),
    // manual: the manager's reason; rework: the manager's comment on the item.
    reason: text('reason').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorPlatformAdminId: uuid('actor_platform_admin_id'),
    at: ts('at').notNull(),
  },
  (t) => [
    unique('execution_corrections_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_corrections_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.actorUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_corrections_actor_fk' }),
    check('execution_corrections_actor_ck', sql`num_nonnulls(${t.actorUserId}, ${t.actorPlatformAdminId}) = 1`),
    index('execution_corrections_execution_idx').on(t.tenantId, t.executionId, t.at),
  ],
);
```

In `executionProblems`, after `mediaIds: …,` add

```ts
    // A correction after close removed it (SP8 spec §4.1): the row stays, so a task made from it keeps its link.
    clearedAt: ts('cleared_at'),
    clearedByCorrectionId: uuid('cleared_by_correction_id'),
```

and in its table config replace `unique('execution_problems_item_uq').on(t.executionId, t.itemId, t.source),` with

```ts
    // One active problem per item and source; a cleared row and a new active row may coexist.
    uniqueIndex('execution_problems_active_item_uq').on(t.executionId, t.itemId, t.source).where(sql`cleared_at is null`),
    foreignKey({
      columns: [t.tenantId, t.clearedByCorrectionId],
      foreignColumns: [executionCorrections.tenantId, executionCorrections.id],
      name: 'execution_problems_cleared_by_fk',
    }),
```

After `executionProblems` add:

```ts
/** A send-back (SP8 spec §4.2). Open while both resubmitted_at and withdrawn_at are null. */
export const executionReworkRequests = pgTable(
  'execution_rework_requests',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    round: integer('round').notNull(),
    // [{ itemId, comment }]
    items: jsonb('items').notNull(),
    dueAt: ts('due_at'),
    requestedByUserId: uuid('requested_by_user_id'),
    requestedByPlatformAdminId: uuid('requested_by_platform_admin_id'),
    requestedAt: ts('requested_at').notNull(),
    // The answers when the run was sent back: the base of the rework guard and of the rework corrections.
    answersBefore: jsonb('answers_before').notNull(),
    // completed or audit_pending; restored when the send-back is withdrawn.
    statusBefore: occurrenceStatus('status_before').notNull(),
    resubmittedAt: ts('resubmitted_at'),
    withdrawnAt: ts('withdrawn_at'),
    withdrawnByUserId: uuid('withdrawn_by_user_id'),
  },
  (t) => [
    unique('execution_rework_requests_tenant_id_uq').on(t.tenantId, t.id),
    unique('execution_rework_requests_round_uq').on(t.executionId, t.round),
    uniqueIndex('execution_rework_requests_open_uq').on(t.executionId).where(sql`resubmitted_at is null and withdrawn_at is null`),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_rework_requests_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.requestedByUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_rework_requests_requested_by_fk' }),
    foreignKey({ columns: [t.tenantId, t.withdrawnByUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_rework_requests_withdrawn_by_fk' }),
    check('execution_rework_requests_requester_ck', sql`num_nonnulls(${t.requestedByUserId}, ${t.requestedByPlatformAdminId}) = 1`),
    check('execution_rework_requests_status_before_ck', sql`${t.statusBefore} in ('completed', 'audit_pending')`),
  ],
);
```

In `notificationRules`, after `leadMinutes: integer('lead_minutes'),` add

```ts
    // audit.finished only: any | failed (SP8 spec §7.1).
    resultFilter: text('result_filter'),
```

and in its config, after `notification_rules_lead_ck` add

```ts
    check('notification_rules_result_filter_ck', sql`${t.resultFilter} is null or ${t.resultFilter} in ('any', 'failed')`),
```

At the end of the file add:

```ts
// Must match AUDIT_STATUSES, AUDIT_RESULTS, AUDIT_VERDICTS and AUDIT_REPORT_STATUSES in @taskop/contracts.
export const auditStatus = pgEnum('audit_status', ['in_progress', 'finished', 'cancelled']);
export const auditResult = pgEnum('audit_result', ['passed', 'failed']);
export const auditVerdict = pgEnum('audit_verdict', ['approved', 'rejected']);
export const auditReportStatus = pgEnum('audit_report_status', ['none', 'pending', 'ready', 'failed']);

/** A formal audit of a completed run (SP8 spec §4.2). At most one non-cancelled audit per execution. */
export const audits = pgTable(
  'audits',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    status: auditStatus('status').notNull().default('in_progress'),
    auditorUserId: uuid('auditor_user_id'),
    auditorPlatformAdminId: uuid('auditor_platform_admin_id'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    result: auditResult('result'),
    // { approved, rejected, reviewed, percent }
    auditScore: jsonb('audit_score'),
    comment: text('comment'),
    reportStatus: auditReportStatus('report_status').notNull().default('none'),
    reportStorageKey: text('report_storage_key'),
    reportRecipients: text('report_recipients').array().notNull().default(sql`'{}'::text[]`),
    reportSentAt: ts('report_sent_at'),
    // Failed attempts of the audit.report job (Spec decision 27).
    reportAttempts: integer('report_attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('audits_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('audits_open_uq').on(t.executionId).where(sql`status <> 'cancelled'`),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'audits_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'audits_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.auditorUserId], foreignColumns: [users.tenantId, users.id], name: 'audits_auditor_fk' }),
    check('audits_auditor_ck', sql`num_nonnulls(${t.auditorUserId}, ${t.auditorPlatformAdminId}) = 1`),
    check('audits_finished_ck', sql`(${t.status} = 'finished') = (${t.finishedAt} is not null and ${t.result} is not null)`),
    check('audits_cancelled_ck', sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    // The queue's In progress and Finished tabs.
    index('audits_status_started_idx').on(t.tenantId, t.status, t.startedAt),
    index('audits_status_finished_idx').on(t.tenantId, t.status, t.finishedAt),
    index('audits_occurrence_idx').on(t.tenantId, t.occurrenceId),
  ],
);

/** One verdict per audited item (FR-19.04–05). Editable while the audit is in progress (Spec decision 23: own tenant_id). */
export const auditItemVerdicts = pgTable(
  'audit_item_verdicts',
  {
    tenantId: tenantId(),
    auditId: uuid('audit_id').notNull(),
    itemId: uuid('item_id').notNull(),
    verdict: auditVerdict('verdict').notNull(),
    comment: text('comment'),
    // Null for a platform admin.
    updatedByUserId: uuid('updated_by_user_id'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'audit_item_verdicts_pk', columns: [t.auditId, t.itemId] }),
    foreignKey({ columns: [t.tenantId, t.auditId], foreignColumns: [audits.tenantId, audits.id], name: 'audit_item_verdicts_audit_fk' }),
    foreignKey({ columns: [t.tenantId, t.updatedByUserId], foreignColumns: [users.tenantId, users.id], name: 'audit_item_verdicts_updated_by_fk' }),
    check('audit_item_verdicts_comment_ck', sql`${t.verdict} <> 'rejected' or ${t.comment} is not null`),
  ],
);
```

- [ ] **Step 5: Generate 0016 and extend it**

Run:

```bash
pnpm --filter @taskop/api exec drizzle-kit generate --name audit_corrections_tables
```

Check `apps/api/drizzle/0016_audit_corrections_tables.sql`: it creates the five enum types, the four tables, adds the columns to `checklists`, `executions`, `execution_problems` and `notification_rules`, drops the constraint `execution_problems_item_uq`, creates `execution_problems_active_item_uq … WHERE cleared_at is null`, the foreign keys, checks and indexes. It must not use the two values 0015 added: `grep -n "correction_required" apps/api/drizzle/0016_audit_corrections_tables.sql` prints nothing, and `'rework'` appears only in `CREATE TYPE "public"."correction_kind" AS ENUM('manual', 'rework')` (a type created in this file, which is allowed).

Append to the end of `0016_audit_corrections_tables.sql` (keep the generated statements above it untouched):

```sql
--> statement-breakpoint
-- SP8 spec §4.1, BR-14: the original answers are written once, by the first correction or send-back, and never change.
CREATE FUNCTION executions_original_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.original_captured_at IS NOT NULL AND (
        NEW.original_answers IS DISTINCT FROM OLD.original_answers
        OR NEW.original_score IS DISTINCT FROM OLD.original_score
        OR NEW.original_captured_at IS DISTINCT FROM OLD.original_captured_at))
     OR (OLD.original_answers IS NOT NULL AND NEW.original_answers IS DISTINCT FROM OLD.original_answers) THEN
    RAISE EXCEPTION 'the original answers of execution % are immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER executions_original_immutable BEFORE UPDATE ON executions
  FOR EACH ROW EXECUTE FUNCTION executions_original_guard();
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['execution_corrections','execution_rework_requests','audits','audit_item_verdicts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Corrections are append-only (spec §4.2).
GRANT SELECT, INSERT ON execution_corrections TO taskop_app, taskop_platform;
--> statement-breakpoint
-- A send-back is closed by a resubmit or a withdrawal; nothing else of it ever changes.
GRANT SELECT, INSERT ON execution_rework_requests TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT UPDATE (resubmitted_at, withdrawn_at, withdrawn_by_user_id) ON execution_rework_requests TO taskop_app, taskop_platform;
--> statement-breakpoint
-- Audits are never deleted; verdicts are cleared by the auditor and reset by a resubmit.
GRANT SELECT, INSERT, UPDATE ON audits TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_item_verdicts TO taskop_app, taskop_platform;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS keys (new tenants get them at signup); Admin roles hold every key.
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'executions.correct' FROM roles r WHERE r.system_key IN ('admin', 'manager')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'audits.perform' FROM roles r WHERE r.system_key IN ('admin', 'auditor')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager', 'auditor');
--> statement-breakpoint
SET LOCAL row_security = on;
```

- [ ] **Step 6: Point the problem upsert at the new partial index**

The constraint the SP4 upsert targeted is gone, so `apps/api/src/executions/problem-writer.ts` must name the partial index's predicate. In `rewrite`, the `.onConflictDoUpdate({ … })` call becomes:

```ts
        .onConflictDoUpdate({
          target: [executionProblems.executionId, executionProblems.itemId, executionProblems.source],
          // The partial unique index execution_problems_active_item_uq.
          targetWhere: sql`cleared_at is null`,
          set: { severity: sql`excluded.severity`, note: sql`excluded.note`, mediaIds: sql`excluded.media_ids`, updatedAt: now },
        })
```

and the final `delete` gets `isNull(executionProblems.clearedAt),` as its first condition inside `and(…)` (import `isNull` from `drizzle-orm`).

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audit-db executions-db executions-answers executions-complete tasks-db problems-resolution roles notifications-db reports-db`
Expected: PASS. The global setup applies 0015 and 0016 to a fresh container in one transaction; a "unsafe use of new value" error there means `0016` mentions one of the two new enum values.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/executions/problem-writer.ts apps/api/test/audit-db.test.ts
git commit -m "feat(api): add the audit and correction tables, the snapshot trigger and the permission backfill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Recalculation after close: clear problems instead of deleting them

**Files:**
- Modify: `apps/api/src/executions/problem-writer.ts`, `apps/api/src/executions/executions.module.ts`
- Create: `apps/api/src/executions/recalculation.ts`
- Test: `apps/api/test/corrections-recalculate.test.ts`

**Interfaces:**
- Consumes: `deriveProblems`, `computeScore`, `progress` (contracts); the `cleared_at` / `cleared_by_correction_id` columns and the partial index (Task 5).
- Produces:
  - `ProblemWriter.rewriteAfterClose(e: { id: string; tenantId: string }, o: { id: string; siteId: string; checklistId: string }, content: ChecklistContent, answers: Answers, clearedBy: ReadonlyMap<string, string>, now: Date): Promise<void>`. `clearedBy` maps an item id to the correction row that changed it.
  - `ExecutionRecalculator.recalculate(input: RecalcInput): Promise<{ score: ScoreResult; progress: ExecutionProgress }>` with
    `interface RecalcInput { execution: ExecutionRow; occurrence: OccurrenceRow; content: ChecklistContent; answers: Answers; clearedBy: ReadonlyMap<string, string>; now: Date }`.
    It runs in the caller's transaction: it updates `executions.score`, `progress` and `updated_at`, then the problems. The caller stores the answers first. Nothing on `occurrences` changes.
  - Both are providers of `ExecutionsModule`. Tasks 7 and 9 call `recalculate`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/corrections-recalculate.test.ts`:

```ts
import type { Answers } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { executions, occurrences } from '../src/db/schema';
import { ExecutionLookups } from '../src/executions/execution-lookups';
import { ExecutionRecalculator } from '../src/executions/recalculation';
import { createTestApp, type TestApp } from './app';
import { executionRow } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { eventRows } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems, insertTaskRow } from './task-fixtures';

const NOW = '2026-11-02T06:00:00.000Z';

interface ProblemDbRow {
  id: string;
  item_id: string;
  source: string;
  severity: string;
  note: string | null;
  cleared_at: Date | null;
  cleared_by_correction_id: string | null;
}

describe('recalculation after close (SP8 spec §6.3)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** A manual correction row for one item, as CorrectionsService writes it (Task 7). */
  const correctionFor = async (tenantId: string, executionId: string, actor: string, itemId: string): Promise<string> =>
    (
      await ownerQuery<{ id: string }>(
        `insert into execution_corrections (id, tenant_id, execution_id, item_id, kind, round, reason, actor_user_id, at)
         values ($1, $2, $3, $4, 'manual', 0, 'Səhv', $5, now()) returning id`,
        [uuidv7(), tenantId, executionId, itemId, actor],
      )
    ).rows[0]!.id;

  /** Stores `answers` and recalculates in one tenant transaction, as the correction endpoint does. */
  const recalc = (tenantId: string, userId: string, executionId: string, answers: Answers, clearedBy = new Map<string, string>()) =>
    t.app.get(DbService).withTenant(tenantId, userId, async (tx) => {
      const [e] = await tx.select().from(executions).where(eq(executions.id, executionId));
      const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, e!.occurrenceId));
      const content = await t.app.get(ExecutionLookups).content(e!.checklistVersionId);
      await tx.update(executions).set({ answers }).where(eq(executions.id, executionId));
      return t.app.get(ExecutionRecalculator).recalculate({ execution: e!, occurrence: o!, content, answers, clearedBy, now: new Date(NOW) });
    });

  const problemsOf = async (executionId: string): Promise<ProblemDbRow[]> =>
    (
      await ownerQuery<ProblemDbRow>(
        'select id, item_id, source, severity, note, cleared_at, cleared_by_correction_id from execution_problems where execution_id = $1 order by created_at, id',
        [executionId],
      )
    ).rows;

  it('clears a problem with a task instead of deleting it, and updates the score', async () => {
    const { w, executionId, ruleProblemId, manualProblemId } = await closedRunWithProblems(t, clock);
    const taskId = await insertTaskRow({ tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId: ruleProblemId });
    const answers = (await executionRow(executionId)).answers;
    expect((await executionRow(executionId)).score?.percent).toBe(50);
    // 5 °C is inside 2–8: the rule problem goes; the manual problem rides along unchanged.
    const corrected: Answers = { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 5 } };
    const correctionId = await correctionFor(w.s.tenantId, executionId, w.s.ownerId, w.c.temp.id);

    const result = await recalc(w.s.tenantId, w.s.ownerId, executionId, corrected, new Map([[w.c.temp.id, correctionId]]));

    expect(result.score).toMatchObject({ earned: 2, possible: 2, percent: 100, problems: [] });
    expect((await executionRow(executionId)).score).toMatchObject({ percent: 100, problems: [] });
    const rows = await problemsOf(executionId);
    expect(rows).toHaveLength(2);
    const rule = rows.find((r) => r.id === ruleProblemId)!;
    expect(rule.cleared_by_correction_id).toBe(correctionId);
    expect(rule.cleared_at?.toISOString()).toBe(NOW);
    expect(rows.find((r) => r.id === manualProblemId)!.cleared_at).toBeNull();
    expect((await ownerQuery<{ problem_id: string }>('select problem_id from tasks where id = $1', [taskId])).rows[0]!.problem_id).toBe(ruleProblemId);
  });

  it('inserts a problem the new answers derive beside the cleared row of the same item, and notifies it', async () => {
    const { w, executionId, ruleProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 5 } });
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 12 } });
    const rule = (await problemsOf(executionId)).filter((r) => r.source === 'rule');
    expect(rule.map((r) => [r.id === ruleProblemId, r.cleared_at === null])).toEqual([
      [true, false],
      [false, true],
    ]);
    // A rule problem with no correction of its item (clearedBy without it) is cleared with a null link.
    expect(rule[0]!.cleared_by_correction_id).toBeNull();
    const recorded = await eventRows(w.s.tenantId, 'problem.recorded');
    expect(recorded.map((e) => e.payload.problemId)).toContain(rule[1]!.id);
  });

  it('updates the severity and note of a problem the answers still derive, keeping its id', async () => {
    const { w, executionId, ruleProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: { ...answers[w.c.temp.id], number: 12, note: 'çox isti' } });
    const rule = (await problemsOf(executionId)).filter((r) => r.source === 'rule');
    expect(rule.map((r) => [r.id, r.note, r.cleared_at])).toEqual([[ruleProblemId, 'çox isti', null]]);
  });

  it('never touches manual problems, even when the answers drop them', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const answers = (await executionRow(executionId)).answers;
    const { problem: _dropped, ...temp } = answers[w.c.temp.id]!;
    await recalc(w.s.tenantId, w.s.ownerId, executionId, { ...answers, [w.c.temp.id]: temp });
    const manual = (await problemsOf(executionId)).find((r) => r.id === manualProblemId)!;
    expect(manual).toMatchObject({ source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', cleared_at: null });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- corrections-recalculate`
Expected: FAIL: `Cannot find module '../src/executions/recalculation'`.

- [ ] **Step 3: Split the problem writer**

`apps/api/src/executions/problem-writer.ts` becomes:

```ts
import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, type DerivedProblem, deriveProblems } from '@taskop/contracts';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';

type ExecutionRef = { id: string; tenantId: string };
type OccurrenceRef = { id: string; siteId: string; checklistId: string };

@Injectable()
export class ProblemWriter {
  constructor(
    private readonly db: DbService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * While the run is open: rewrites a counted execution's problems from its answers (spec §5.2). Upserting on (execution,
   * item, source) keeps a problem's id and created_at while it persists; problems that are gone are deleted, unless a
   * task was created from them.
   */
  async rewrite(e: ExecutionRef, o: OccurrenceRef, content: ChecklistContent, answers: Answers, now: Date): Promise<void> {
    const derived = deriveProblems(content, answers);
    await this.upsert(e, o, derived, now);
    const keep = derived.map((d) => `${d.itemId}:${d.source}`);
    await this.db
      .tx()
      .delete(executionProblems)
      .where(
        and(
          isNull(executionProblems.clearedAt),
          eq(executionProblems.executionId, e.id),
          keep.length ? notInArray(sql<string>`${executionProblems.itemId}::text || ':' || ${executionProblems.source}::text`, keep) : undefined,
          // A problem turned into a task stays (spec §5): a late answers sync on a swept run may no longer derive it.
          sql`not exists (select 1 from tasks k where k.problem_id = ${executionProblems.id})`,
        ),
      );
  }

  /**
   * After the run closed, for corrections and resubmits (SP8 spec §6.3): rule problems only, and nothing is deleted.
   * A rule problem the answers no longer derive is cleared and points at the correction of its item (`clearedBy`); a new
   * one is inserted; a kept one gets the new severity, note and media. Manual problems are never touched, so a task made
   * from any problem keeps its link.
   */
  async rewriteAfterClose(
    e: ExecutionRef,
    o: OccurrenceRef,
    content: ChecklistContent,
    answers: Answers,
    clearedBy: ReadonlyMap<string, string>,
    now: Date,
  ): Promise<void> {
    const derived = deriveProblems(content, answers).filter((d) => d.source === 'rule');
    await this.upsert(e, o, derived, now);
    const kept = derived.map((d) => d.itemId);
    const tx = this.db.tx();
    const gone = await tx
      .select({ id: executionProblems.id, itemId: executionProblems.itemId })
      .from(executionProblems)
      .where(
        and(
          eq(executionProblems.executionId, e.id),
          eq(executionProblems.source, 'rule'),
          isNull(executionProblems.clearedAt),
          kept.length ? notInArray(executionProblems.itemId, kept) : undefined,
        ),
      );
    for (const p of gone) {
      await tx
        .update(executionProblems)
        .set({ clearedAt: now, clearedByCorrectionId: clearedBy.get(p.itemId) ?? null, updatedAt: now })
        .where(eq(executionProblems.id, p.id));
    }
  }

  /** Upserts on the item's active row. Each row it inserts (not a re-save) emits problem.recorded (SP6 spec §6.1). */
  private async upsert(e: ExecutionRef, o: OccurrenceRef, derived: DerivedProblem[], now: Date): Promise<void> {
    if (!derived.length) return;
    const rows = await this.db
      .tx()
      .insert(executionProblems)
      .values(
        derived.map((d) => ({
          tenantId: e.tenantId,
          executionId: e.id,
          occurrenceId: o.id,
          siteId: o.siteId,
          checklistId: o.checklistId,
          itemId: d.itemId,
          source: d.source,
          severity: d.severity,
          note: d.note,
          mediaIds: d.mediaIds,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [executionProblems.executionId, executionProblems.itemId, executionProblems.source],
        // The partial unique index execution_problems_active_item_uq.
        targetWhere: sql`cleared_at is null`,
        set: { severity: sql`excluded.severity`, note: sql`excluded.note`, mediaIds: sql`excluded.media_ids`, updatedAt: now },
      })
      // xmax = 0 only for rows this statement inserted; an updated (re-saved) row carries this transaction's id.
      .returning({ id: executionProblems.id, severity: executionProblems.severity, inserted: sql<boolean>`(xmax = 0)` });
    const actorUserId = actorColumns(this.db).userId;
    for (const r of rows) {
      if (!r.inserted) continue;
      await this.events.emit('problem.recorded', { tenantId: e.tenantId, problemId: r.id, occurrenceId: o.id, severity: r.severity, actorUserId });
    }
  }
}
```

- [ ] **Step 4: Write the recalculator**

`apps/api/src/executions/recalculation.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, computeScore, type ExecutionProgress, progress, type ScoreResult } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executions } from '../db/schema';
import type { ExecutionRow, OccurrenceRow } from './executions.service';
import { ProblemWriter } from './problem-writer';

export interface RecalcInput {
  execution: ExecutionRow;
  occurrence: OccurrenceRow;
  /** The pinned version's content. */
  content: ChecklistContent;
  /** The answers just stored. */
  answers: Answers;
  /** Item id → the correction row that changed it, for cleared_by_correction_id. */
  clearedBy: ReadonlyMap<string, string>;
  now: Date;
}

/**
 * SP8 spec §6.3, shared by corrections and resubmits, in the caller's transaction: the score and progress from the
 * answers, then the problems after close. `completed_at`, `late` and the occurrence are never touched.
 */
@Injectable()
export class ExecutionRecalculator {
  constructor(
    private readonly db: DbService,
    private readonly problems: ProblemWriter,
  ) {}

  async recalculate(input: RecalcInput): Promise<{ score: ScoreResult; progress: ExecutionProgress }> {
    const { execution: e, occurrence: o, content, answers, clearedBy, now } = input;
    const score = computeScore(content, answers);
    const prog = progress(content, answers);
    await this.db.tx().update(executions).set({ score, progress: prog, updatedAt: now }).where(eq(executions.id, e.id));
    await this.problems.rewriteAfterClose(e, o, content, answers, clearedBy, now);
    return { score, progress: prog };
  }
}
```

In `apps/api/src/executions/executions.module.ts`, add `ExecutionRecalculator` (import from `./recalculation`) to `providers`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- corrections-recalculate executions-answers executions-complete tasks-problems problems-resolution notification-events`
Expected: PASS. The SP4 and SP5 tests show the open-run writer still deletes vanished problems and keeps those with a task.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/executions/problem-writer.ts apps/api/src/executions/recalculation.ts apps/api/src/executions/executions.module.ts apps/api/test/corrections-recalculate.test.ts
git commit -m "feat(api): recalculate score and problems after close, clearing instead of deleting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `POST /executions/:id/corrections`

**Files:**
- Modify: `apps/api/src/common/app-error.ts`, `apps/api/src/common/error.filter.ts`, `apps/api/src/common/error.filter.test.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.module.ts`
- Create: `apps/api/src/executions/run-locks.ts`, `apps/api/src/executions/correction-apply.ts`, `apps/api/src/executions/corrections.service.ts`, `apps/api/src/executions/corrections.controller.ts`, `apps/api/test/audit-fixtures.ts`
- Test: `apps/api/test/corrections.test.ts`

**Interfaces:**
- Consumes: `canCorrect`, `changedItemIds`, `correctAnswersInputSchema`, `correctionResultSchema`, `answerIssues`, `requirements`, `walkItems` (contracts); `ExecutionRecalculator` (Task 6); `SchedulingScope.occurrences(a: Actor)`; `actorColumns(db)`; `AuditService.record`; `ExecutionLookups.content` / `registeredMedia`; `controllerDecorators`, `named`, `perm`, `type RouteMode` (`checklists/route-mode.ts`); `CurrentActor`, `type Actor` (`scheduling/actor.ts`); `PlatformTenantInterceptor`, `PlatformModule`.
- Produces:
  - `AppErrorDetails` gains `auditId?: string` and `itemIds?: string[]`; the error filter passes `audits.*` and `corrections.*` Zod messages through as field keys.
  - `run-locks.ts`: `interface LockedRun { e: ExecutionRow; o: OccurrenceRow }`, `lockRun(db: DbService, scope: SQL | undefined, executionId: string): Promise<LockedRun>` (404 for unknown, out of scope or rejected executions; locks the occurrence, then the execution), `assertCorrectable(run: LockedRun): void` (`EXECUTION_LOCKED` / `EXECUTION_NOT_CORRECTABLE`), `snapshotColumns(e: ExecutionRow, now: Date)` (the `original_*` values on the first change, `{}` afterwards).
  - `correction-apply.ts`: `applyCorrection(content: ChecklistContent, before: Answers, changes: CorrectAnswersParams['changes']): Answers` (`VALIDATION_FAILED` for unknown items, `MEDIA_NOT_CORRECTABLE` for added media; keeps each item's manual problem).
  - `CorrectionsService.correct(a: Actor, executionId: string, input: CorrectAnswersParams): Promise<CorrectionResult>`.
  - `correctionsControllerFor(mode)`, `TenantCorrectionsController`, `PlatformTenantCorrectionsController` (path `executions`, `POST :id/corrections`, `executions.correct`).
  - `test/audit-fixtures.ts`: `auditWorld(t, clock, opts?)`, `type AuditWorld`, `type Staff`, and the helpers `correct`, `sendBack`, `withdraw`, `resubmit`, `startAudit`, `correctionRows`, `reworkRows`, `auditLogOf`, `problemRows`, `markUploaded`, used by Tasks 7–18.

- [ ] **Step 1: Write the fixtures**

`apps/api/test/audit-fixtures.ts`:

```ts
import type { Answers } from '@taskop/contracts';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { claimOk, completeExecution, type ExecutionWorld, executionWorld, registerPhoto, type TestWorker } from './execution-fixtures';
import type { FakeClock } from './fake-clock';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import type { Api } from './scheduling-fixtures';

export interface Staff {
  id: string;
  api: Api;
}

export interface AuditWorld {
  w: ExecutionWorld;
  executionId: string;
  /** İşçi 1, the executor. */
  worker: TestWorker;
  /** The photo item's photo (registered, not uploaded; `markUploaded` uploads it). */
  photoId: string;
  /** The problem item's photo with `problemYes`. */
  problemPhotoId: string | null;
  /** What İşçi 1 completed with. */
  answers: Answers;
  /** "Menecer": built-in Manager at Filial 1 (executions.correct, reports.view). */
  manager: Staff;
  /** "Auditor": built-in Auditor, whole tenant (audits.perform, reports.view). */
  auditor: Staff;
  /** "Başqa menecer": built-in Manager at Filial 2 only: the run is out of their scope. */
  outsider: Staff;
}

/**
 * İşçi 1 completes today's run at 08:20 Baku; the clock then reads 08:20. Answers: "Xeyr" on the problem item (with
 * `problemYes`: "Bəli" with a photo and the follow-up comment "Su axır", a critical rule problem), 10 °C with the note
 * "isti" (a normal rule problem), one photo. `requiresAudit` sets the checklist flag before the run completes.
 */
export async function auditWorld(t: TestApp, clock: FakeClock, opts: { requiresAudit?: boolean; problemYes?: boolean } = {}): Promise<AuditWorld> {
  const w = await executionWorld(t);
  if (opts.requiresAudit) await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
  const worker = w.workers[0];
  clock.set('2026-11-02T04:20:00Z');
  const executionId = await claimOk(worker.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
  const photoId = await registerPhoto(worker.api, executionId, w.c.photo.id);
  const problemPhotoId = opts.problemYes ? await registerPhoto(worker.api, executionId, w.c.problem.id) : null;
  const answers: Answers = {
    [w.c.problem.id]: problemPhotoId ? { optionIds: [w.c.yes.id], photos: [problemPhotoId] } : { optionIds: [w.c.no.id] },
    ...(problemPhotoId ? { [w.c.comment.id]: { text: 'Su axır' } } : {}),
    [w.c.temp.id]: { number: 10, note: 'isti' },
    [w.c.photo.id]: { photos: [photoId] },
  };
  const res = await completeExecution(worker.api, executionId, 1, answers, '2026-11-02T04:20:00.000Z');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const staff = async (roleKey: 'manager' | 'auditor', siteIds: string[], name: string): Promise<Staff> => {
    const s = await staffAt(t, w.s.tenantId, w.owner, roleKey, siteIds, name);
    return { id: s.id, api: s.api };
  };
  return {
    w,
    executionId,
    worker,
    photoId,
    problemPhotoId,
    answers,
    manager: await staff('manager', [w.siteId], 'Menecer'),
    auditor: await staff('auditor', [], 'Auditor'),
    outsider: await staff('manager', [w.otherSiteId], 'Başqa menecer'),
  };
}

export const correct = (api: Api, executionId: string, body: object) => api.post(`/api/v1/executions/${executionId}/corrections`, body);
export const sendBack = (api: Api, executionId: string, body: object) => api.post(`/api/v1/executions/${executionId}/send-back`, body);
export const withdraw = (api: Api, executionId: string) => api.post(`/api/v1/executions/${executionId}/send-back/cancel`);
export const resubmit = (api: Api, executionId: string, at: string) =>
  api.post(`/api/v1/executions/${executionId}/resubmit`, { resubmittedAt: at, deviceTime: at, clientOffsetMs: 0 });
export const startAudit = (api: Api, executionId: string) => api.post(`/api/v1/executions/${executionId}/audits`);

export interface CorrectionDbRow {
  id: string;
  item_id: string;
  kind: string;
  round: number;
  before: unknown;
  after: unknown;
  reason: string;
  actor_user_id: string | null;
  actor_platform_admin_id: string | null;
  at: Date;
}

export const correctionRows = async (executionId: string): Promise<CorrectionDbRow[]> =>
  (await ownerQuery<CorrectionDbRow>('select * from execution_corrections where execution_id = $1 order by at, id', [executionId])).rows;

export interface ReworkDbRow {
  id: string;
  round: number;
  items: { itemId: string; comment: string }[];
  due_at: Date | null;
  requested_by_user_id: string | null;
  answers_before: Answers;
  status_before: string;
  resubmitted_at: Date | null;
  withdrawn_at: Date | null;
  withdrawn_by_user_id: string | null;
}

export const reworkRows = async (executionId: string): Promise<ReworkDbRow[]> =>
  (await ownerQuery<ReworkDbRow>('select * from execution_rework_requests where execution_id = $1 order by round', [executionId])).rows;

export interface AuditLogDbRow {
  action: string;
  entity_type: string;
  actor_user_id: string | null;
  actor_platform_admin_id: string | null;
  before: unknown;
  after: unknown;
}

/** The audit-log rows of one entity, oldest first. */
export const auditLogOf = async (entityId: string): Promise<AuditLogDbRow[]> =>
  (
    await ownerQuery<AuditLogDbRow>(
      'select action, entity_type, actor_user_id, actor_platform_admin_id, before, after from audit_log where entity_id = $1 order by occurred_at, id',
      [entityId],
    )
  ).rows;

export interface ProblemDbRow {
  id: string;
  item_id: string;
  source: string;
  severity: string;
  note: string | null;
  cleared_at: Date | null;
  cleared_by_correction_id: string | null;
}

export const problemRows = async (executionId: string): Promise<ProblemDbRow[]> =>
  (
    await ownerQuery<ProblemDbRow>(
      'select id, item_id, source, severity, note, cleared_at, cleared_by_correction_id from execution_problems where execution_id = $1 order by created_at, id',
      [executionId],
    )
  ).rows;

/** Marks every medium of the execution uploaded, as if the phone had finished its uploads. */
export const markUploaded = (executionId: string) =>
  ownerQuery("update execution_media set status = 'uploaded', uploaded_at = now() where execution_id = $1", [executionId]);
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/corrections.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, correctionRows, problemRows } from './audit-fixtures';
import { executionRow, historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems } from './task-fixtures';

const AT = '2026-11-02T05:00:00.000Z';

describe('direct corrections (POST /executions/:id/corrections, spec §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (opts: { requiresAudit?: boolean } = {}): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    return a;
  };
  const tempTo = (a: AuditWorld, number: number) => ({ answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number } }], reason: 'Termometr səhv oxunub' });

  it('corrects a value: one correction row, the snapshot, the new score and rev, a cleared problem and an audit entry', async () => {
    const a = await world();
    const before = await executionRow(a.executionId);
    const res = await correct(a.manager.api, a.executionId, tempTo(a, 5));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId: a.executionId,
      answersRev: 2,
      changedItemIds: [a.w.c.temp.id],
      score: { earned: 2, possible: 2, percent: 100, problems: [] },
    });
    const rows = await correctionRows(a.executionId);
    expect(rows).toEqual([
      expect.objectContaining({
        item_id: a.w.c.temp.id, kind: 'manual', round: 0, before: { number: 10, note: 'isti' }, after: { number: 5 },
        reason: 'Termometr səhv oxunub', actor_user_id: a.manager.id, actor_platform_admin_id: null, at: new Date(AT),
      }),
    ]);
    const after = await ownerQuery<{ answers: unknown; answers_rev: number; original_answers: unknown; original_score: { percent: number }; original_captured_at: Date; completed_at: Date; late: boolean }>(
      'select answers, answers_rev, original_answers, original_score, original_captured_at, completed_at, late from executions where id = $1',
      [a.executionId],
    );
    expect(after.rows[0]).toMatchObject({
      answers_rev: 2,
      original_answers: a.answers,
      original_score: { percent: 50 },
      original_captured_at: new Date(AT),
      completed_at: before.completed_at,
      late: before.late,
    });
    expect((await problemRows(a.executionId)).map((p) => [p.item_id, p.cleared_by_correction_id])).toEqual([[a.w.c.temp.id, rows[0]!.id]]);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect(await auditLogOf(a.executionId)).toEqual([
      {
        action: 'execution.corrected', entity_type: 'execution', actor_user_id: a.manager.id, actor_platform_admin_id: null,
        before: { answers: { [a.w.c.temp.id]: { number: 10, note: 'isti' } } },
        after: { answers: { [a.w.c.temp.id]: { number: 5 } }, reason: 'Termometr səhv oxunub' },
      },
    ]);
    // Direct corrections never change the status (spec §3.1).
    expect((await historyOf(a.w.occurrenceId)).at(-1)![1]).toBe('completed');
  });

  it('keeps the original from the first correction only', async () => {
    const a = await world();
    expect((await correct(a.manager.api, a.executionId, tempTo(a, 5))).status).toBe(200);
    clock.set('2026-11-02T05:30:00Z');
    const second = await correct(a.manager.api, a.executionId, { ...tempTo(a, 6), answersRev: 2 });
    expect(second.body.answersRev).toBe(3);
    const r = await ownerQuery<{ original_answers: unknown; original_captured_at: Date }>('select original_answers, original_captured_at from executions where id = $1', [a.executionId]);
    expect(r.rows[0]).toEqual({ original_answers: a.answers, original_captured_at: new Date(AT) });
    expect((await correctionRows(a.executionId)).map((c) => [c.before, c.after])).toEqual([
      [{ number: 10, note: 'isti' }, { number: 5 }],
      [{ number: 5 }, { number: 6 }],
    ]);
  });

  it('answers 200 and writes nothing when no item changed', async () => {
    const a = await world();
    const res = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { note: 'isti', number: 10 } }], reason: 'Yoxladım' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answersRev: 1, changedItemIds: [] });
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect(await auditLogOf(a.executionId)).toEqual([]);
    expect((await executionRow(a.executionId)).answers_rev).toBe(1);
  });

  it('refuses a stale answersRev without writing anything', async () => {
    const a = await world();
    // Two managers press save at the same moment, both based on rev 1.
    const results = await Promise.all([correct(a.manager.api, a.executionId, tempTo(a, 5)), correct(a.manager.api, a.executionId, tempTo(a, 6))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('ANSWERS_CONFLICT');
    expect(await correctionRows(a.executionId)).toHaveLength(1);
    expect((await auditLogOf(a.executionId)).map((l) => l.action)).toEqual(['execution.corrected']);
    expect((await executionRow(a.executionId)).answers_rev).toBe(2);
  });

  it('refuses a correction that leaves a revealed required item unanswered', async () => {
    const a = await world();
    // "Bəli" reveals the required follow-up comment and asks for a photo on the item.
    const res = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.problem.id, answer: { optionIds: [a.w.c.yes.id] } }], reason: 'Problem var idi' });
    expect([res.status, res.body.error.code]).toEqual([422, 'REQUIREMENTS_UNMET']);
    expect(res.body.error.missing).toEqual([
      { itemId: a.w.c.problem.id, kind: 'photo' },
      { itemId: a.w.c.comment.id, kind: 'answer' },
    ]);
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect((await executionRow(a.executionId)).answers).toEqual(a.answers);
  });

  it('keeps the item’s manual problem and lets a manager unlink evidence but never add it', async () => {
    const { w, executionId, manualProblemId } = await closedRunWithProblems(t, clock);
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    const res = await correct(manager.api, executionId, { answersRev: 1, changes: [{ itemId: w.c.temp.id, answer: { number: 5, note: 'normal' } }], reason: 'Səhv' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await executionRow(executionId)).answers[w.c.temp.id]).toEqual({ number: 5, note: 'normal', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } });
    expect((await problemRows(executionId)).find((p) => p.id === manualProblemId)!.cleared_at).toBeNull();
    const added = await correct(manager.api, executionId, {
      answersRev: 2,
      changes: [{ itemId: w.c.photo.id, answer: { photos: ['0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f'] } }],
      reason: 'Başqa foto',
    });
    expect([added.status, added.body.error.code, added.body.error.fields]).toEqual([422, 'MEDIA_NOT_CORRECTABLE', { 'changes.0.answer.photos': 'errors.MEDIA_NOT_CORRECTABLE' }]);
  });

  it('refuses unknown items and invalid values', async () => {
    const a = await world();
    const unknown = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', answer: { number: 1 } }], reason: 'x' });
    expect([unknown.status, unknown.body.error.fields]).toEqual([400, { 'changes.0.itemId': 'executions.issues.unknownItem' }]);
    const outOfRange = await correct(a.manager.api, a.executionId, tempTo(a, 99));
    expect([outOfRange.status, outOfRange.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(outOfRange.body.error.issues).toEqual([{ path: ['answers', a.w.c.temp.id, 'number'], code: 'executions.issues.invalidValue' }]);
    const dup = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: null }, { itemId: a.w.c.temp.id, answer: null }], reason: 'x' });
    expect(dup.body.error.fields).toEqual({ 'changes.1.itemId': 'corrections.issues.duplicateItem' });
  });

  it('refuses audited, partial and missed runs with the right code', async () => {
    const audited = await world();
    await ownerQuery("update occurrences set status = 'audited' where id = $1", [audited.w.occurrenceId]);
    expect((await correct(audited.manager.api, audited.executionId, tempTo(audited, 5))).body.error.code).toBe('EXECUTION_LOCKED');
    const partial = await world();
    await ownerQuery("update occurrences set status = 'partial' where id = $1", [partial.w.occurrenceId]);
    await ownerQuery("update executions set state = 'partial' where id = $1", [partial.executionId]);
    expect((await correct(partial.manager.api, partial.executionId, tempTo(partial, 5))).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
  });

  it('is 404 out of scope or for a lost claim, and 403 without executions.correct', async () => {
    const a = await world();
    expect((await correct(a.outsider.api, a.executionId, tempTo(a, 5))).status).toBe(404);
    expect((await correct(a.auditor.api, a.executionId, tempTo(a, 5))).status).toBe(403);
    expect((await correct(a.worker.api, a.executionId, tempTo(a, 5))).status).toBe(403);
    await ownerQuery("update executions set state = 'rejected', rejected_reason = 'ALREADY_CLAIMED' where id = $1", [a.executionId]);
    expect((await correct(a.manager.api, a.executionId, tempTo(a, 5))).status).toBe(404);
  });
});
```

In `apps/api/src/common/error.filter.test.ts`, append inside `describe('toAppError', …)`:

```ts
  it('passes audit and correction issue keys through as field keys', () => {
    const r = z
      .object({ comment: z.string(), changes: z.array(z.string()) })
      .superRefine((_v, ctx) => {
        ctx.addIssue({ code: 'custom', path: ['comment'], message: 'audits.issues.commentRequired' });
        ctx.addIssue({ code: 'custom', path: ['changes', 1, 'itemId'], message: 'corrections.issues.duplicateItem' });
      })
      .safeParse({ comment: '', changes: [] });
    expect(toAppError(new ZodValidationException(r.error!)).fields).toEqual({ comment: 'audits.issues.commentRequired', 'changes.1.itemId': 'corrections.issues.duplicateItem' });
  });

  it('carries the audit id and the item ids as error details', () => {
    expect(new AppError('AUDIT_EXISTS', { details: { auditId: 'a1' } }).details).toEqual({ auditId: 'a1' });
    expect(new AppError('AUDIT_INCOMPLETE', { details: { itemIds: ['i1'] } }).details).toEqual({ itemIds: ['i1'] });
  });
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- corrections.test error.filter`
Expected: FAIL: `POST /executions/:id/corrections` answers 404 (no route), and the filter maps `audits.issues.commentRequired` to `errors.validation.invalid`. (`AppErrorDetails` has no `auditId`: the typecheck in Step 5 catches it.)

- [ ] **Step 4: Implement**

`apps/api/src/common/app-error.ts`, in `AppErrorDetails` after `limit?: number;` add:

```ts
  /** AUDIT_EXISTS: the run's existing audit (SP8 spec §6.2). */
  auditId?: string;
  /** AUDIT_INCOMPLETE: the auditable items without a verdict. */
  itemIds?: string[];
```

`apps/api/src/common/error.filter.ts`, the field-key pattern becomes:

```ts
      fields[key] ??= /^(errors|scheduling|executions|tasks|notifications|reports|audits|corrections)\./.test(issue.message) ? issue.message : 'errors.validation.invalid';
```

`apps/api/src/executions/run-locks.ts`:

```ts
import { canCorrect } from '@taskop/contracts';
import { and, eq, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { DbService } from '../db/db.service';
import { executions, occurrences } from '../db/schema';
import type { ExecutionRow, OccurrenceRow } from './executions.service';

export interface LockedRun {
  e: ExecutionRow;
  o: OccurrenceRow;
}

/**
 * Locks a counted execution and its occurrence for a manager's or an auditor's change, in the order every execution
 * command uses: the occurrence, then the execution. Unknown, out of `scope` (SchedulingScope.occurrences) or a lost
 * claim (rejected) is 404 (Spec decision 26).
 */
export async function lockRun(db: DbService, scope: SQL | undefined, executionId: string): Promise<LockedRun> {
  const tx = db.tx();
  const [peek] = await tx.select({ occurrenceId: executions.occurrenceId, state: executions.state }).from(executions).where(eq(executions.id, executionId));
  if (!peek || peek.state === 'rejected') throw new AppError('NOT_FOUND');
  const [o] = await tx
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.id, peek.occurrenceId), scope))
    .for('update');
  if (!o) throw new AppError('NOT_FOUND');
  const [e] = await tx.select().from(executions).where(eq(executions.id, executionId)).for('update');
  return { e: e!, o };
}

/** Spec §3.1: an audited run is locked; anything else canCorrect refuses is not correctable. */
export function assertCorrectable(run: LockedRun): void {
  if (run.o.status === 'audited') throw new AppError('EXECUTION_LOCKED');
  if (!canCorrect({ status: run.o.status, executionState: run.e.state })) throw new AppError('EXECUTION_NOT_CORRECTABLE');
}

/** The original_* columns, written by the first correction or send-back only; the trigger refuses any later change. */
export function snapshotColumns(e: ExecutionRow, now: Date): Partial<Pick<ExecutionRow, 'originalAnswers' | 'originalScore' | 'originalCapturedAt'>> {
  return e.originalCapturedAt ? {} : { originalAnswers: e.answers, originalScore: e.score, originalCapturedAt: now };
}
```

`apps/api/src/executions/correction-apply.ts`:

```ts
import { type Answer, type Answers, type ChecklistContent, type CorrectAnswersParams, walkItems } from '@taskop/contracts';
import { AppError } from '../common/app-error';

/**
 * The answers after a manager's changes (Spec decision 2). An item's manual problem is always kept; `answer: null`
 * clears the rest of it. Photos and videos may only be removed: every medium must already be on that item.
 */
export function applyCorrection(content: ChecklistContent, before: Answers, changes: CorrectAnswersParams['changes']): Answers {
  const known = new Set<string>();
  walkItems(content, (item) => known.add(item.id));
  const after: Answers = { ...before };
  changes.forEach((change, i) => {
    if (!known.has(change.itemId)) throw new AppError('VALIDATION_FAILED', { fields: { [`changes.${i}.itemId`]: 'executions.issues.unknownItem' } });
    const old = before[change.itemId];
    if (change.answer) {
      for (const field of ['photos', 'videos'] as const) {
        const existing = new Set(old?.[field] ?? []);
        if ((change.answer[field] ?? []).some((id) => !existing.has(id))) {
          throw new AppError('MEDIA_NOT_CORRECTABLE', { fields: { [`changes.${i}.answer.${field}`]: 'errors.MEDIA_NOT_CORRECTABLE' } });
        }
      }
    }
    const next: Answer = { ...(change.answer ?? {}), ...(old?.problem ? { problem: old.problem } : {}) };
    if (Object.keys(next).length) after[change.itemId] = next;
    else delete after[change.itemId];
  });
  return after;
}
```

`apps/api/src/executions/corrections.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type Answer, type Answers, answerIssues, changedItemIds, type CorrectAnswersParams, type CorrectionResult, requirements, type ScoreResult } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { executionCorrections, executions } from '../db/schema';
import type { Actor } from '../scheduling/actor';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { applyCorrection } from './correction-apply';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionRecalculator } from './recalculation';
import { assertCorrectable, lockRun, snapshotColumns } from './run-locks';

/** Only the changed items, for the audit log (spec §6.4). */
export const pickAnswers = (answers: Answers, ids: readonly string[]): Record<string, Answer | null> =>
  Object.fromEntries(ids.map((id) => [id, answers[id] ?? null]));

/** SP8 spec §6.2: a manager's direct corrections, send-back and withdrawal. Runs in the request's tenant transaction. */
@Injectable()
export class CorrectionsService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly audit: AuditService,
    private readonly lookups: ExecutionLookups,
    private readonly recalculator: ExecutionRecalculator,
  ) {}

  /**
   * FR-19.09–14: one correction row per changed item, the snapshot on the first change, then the recalculation.
   * `answersRev` must match the stored rev (Spec decision 4); nothing changed answers 200 and writes nothing.
   */
  async correct(a: Actor, id: string, input: CorrectAnswersParams): Promise<CorrectionResult> {
    const now = this.clock.now();
    const run = await lockRun(this.db, this.scope.occurrences(a), id);
    assertCorrectable(run);
    const { e, o } = run;
    if (input.answersRev !== e.answersRev) throw new AppError('ANSWERS_CONFLICT');
    const content = await this.lookups.content(e.checklistVersionId);
    const before = e.answers as Answers;
    const after = applyCorrection(content, before, input.changes);
    const issues = answerIssues(content, after, await this.lookups.registeredMedia(e.id));
    if (issues.length) throw new AppError('VALIDATION_FAILED', { details: { issues } });
    // Spec decision 3: a correction must leave the run completable.
    const missing = requirements(content, after);
    if (missing.length) throw new AppError('REQUIREMENTS_UNMET', { details: { missing } });
    const changed = changedItemIds(before, after);
    if (!changed.length) return { executionId: e.id, answersRev: e.answersRev, changedItemIds: [], score: (e.score as ScoreResult | null) ?? null };

    const tx = this.db.tx();
    const actor = actorColumns(this.db);
    const rows = await tx
      .insert(executionCorrections)
      .values(
        changed.map((itemId) => ({
          tenantId: e.tenantId,
          executionId: e.id,
          itemId,
          kind: 'manual' as const,
          round: e.reworkRound,
          before: before[itemId] ?? null,
          after: after[itemId] ?? null,
          reason: input.reason,
          actorUserId: actor.userId,
          actorPlatformAdminId: actor.platformAdminId,
          at: now,
        })),
      )
      .returning({ id: executionCorrections.id, itemId: executionCorrections.itemId });
    await tx
      .update(executions)
      .set({ answers: after, answersRev: e.answersRev + 1, updatedAt: now, ...snapshotColumns(e, now) })
      .where(eq(executions.id, e.id));
    const { score } = await this.recalculator.recalculate({ execution: e, occurrence: o, content, answers: after, clearedBy: new Map(rows.map((r) => [r.itemId, r.id])), now });
    await this.audit.record({
      action: 'execution.corrected',
      entityType: 'execution',
      entityId: e.id,
      before: { answers: pickAnswers(before, changed) },
      after: { answers: pickAnswers(after, changed), reason: input.reason },
    });
    return { executionId: e.id, answersRev: e.answersRev + 1, changedItemIds: changed, score };
  }
}
```

The audit-log `before`/`after` above store `null` for an item that had no answer; the test's expectation lists only items that had one.

`apps/api/src/executions/dto.ts`: add `correctAnswersInputSchema, correctionResultSchema` to the contracts import and

```ts
export class CorrectAnswersDto extends createZodDto(correctAnswersInputSchema) {}
export class CorrectionResultResponse extends createZodDto(correctionResultSchema) {}
```

`apps/api/src/executions/corrections.controller.ts`:

```ts
import { Body, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { CorrectionResult } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from '../scheduling/actor';
import { CorrectionsService } from './corrections.service';
import { CorrectAnswersDto, CorrectionResultResponse } from './dto';

/** SP8 spec §6.2: a manager's corrections and send-backs, for tenant users and platform admins (Spec decision 24). */
export function correctionsControllerFor(mode: RouteMode) {
  const correct = perm(mode, 'executions.correct');

  @controllerDecorators(mode, 'executions', 'executions')
  class CorrectionsController {
    constructor(@Inject(CorrectionsService) private readonly corrections: CorrectionsService) {}

    @Post(':id/corrections')
    @HttpCode(200)
    @correct
    @ApiOkResponse({ type: CorrectionResultResponse })
    correct(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: CorrectAnswersDto): Promise<CorrectionResult> {
      return this.corrections.correct(a, id, body);
    }
  }
  return named(CorrectionsController, mode === 'tenant' ? 'CorrectionsController' : 'PlatformTenantCorrectionsController');
}

export const TenantCorrectionsController = correctionsControllerFor('tenant');
export const PlatformTenantCorrectionsController = correctionsControllerFor('platform');
```

`apps/api/src/executions/executions.module.ts` becomes:

```ts
import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TasksModule } from '../tasks/tasks.module';
import { PlatformTenantCorrectionsController, TenantCorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';
import { ExecutionAccess } from './execution-access';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionQueries } from './execution-queries';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { MediaController } from './media.controller';
import { MediaJobs } from './media-jobs';
import { MediaService } from './media.service';
import { ProblemWriter } from './problem-writer';
import { ProblemsController } from './problems.controller';
import { ProblemsService } from './problems.service';
import { ExecutionRecalculator } from './recalculation';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** Sub-projects 4 and 8: execution, evidence, problems and corrections. Depends on scheduling, never the other way round. */
@Module({
  imports: [PlatformModule, SchedulingModule, TasksModule, NotificationsModule],
  controllers: [ExecutionsController, MediaController, ProblemsController, SyncController, TenantCorrectionsController, PlatformTenantCorrectionsController],
  providers: [
    ExecutionsService,
    ExecutionQueries,
    ExecutionAccess,
    ExecutionLookups,
    MediaJobs,
    MediaService,
    ProblemWriter,
    ProblemsService,
    SyncService,
    ExecutionRecalculator,
    CorrectionsService,
    PlatformTenantInterceptor,
  ],
})
export class ExecutionsModule {}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- corrections.test error.filter corrections-recalculate executions-read`
Expected: PASS. In `refuses a stale answersRev…` the two requests serialise on the occurrence lock; the second sees rev 2 and answers 409.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common apps/api/src/executions apps/api/test/audit-fixtures.ts apps/api/test/corrections.test.ts
git commit -m "feat(api): correct a completed run's answers, keeping the original" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /executions/:id/send-back` and `POST /executions/:id/send-back/cancel`

**Files:**
- Create: `apps/api/src/executions/rework-requests.ts`, `apps/api/src/executions/audit-lookup.ts`
- Modify: `apps/api/src/common/domain-events.ts`, `apps/api/src/executions/corrections.service.ts`, `apps/api/src/executions/corrections.controller.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.module.ts`
- Test: `apps/api/test/send-back.test.ts`

**Interfaces:**
- Consumes: `lockRun`, `assertCorrectable`, `snapshotColumns` (Task 7); `canWithdrawSendBack`, `sendBackInputSchema`, `reworkRequestSchema` (contracts); `OccurrenceWriter.applyTransitions(steps: Transition[])`; `DomainEvents.emit`.
- Produces:
  - `DomainEventMap['execution.sent_back']: { tenantId: string; executionId: string; occurrenceId: string; round: number; actorUserId: string | null }`.
  - `ReworkRequests` (provider): `open(executionId): Promise<ReworkRequestRow | null>`, `latest(executionId): Promise<ReworkRequestRow | null>`, `all(executionId): Promise<ReworkRequestRow[]>` (round order), `toDtos(rows: ReworkRequestRow[]): Promise<ReworkRequest[]>`, `openByExecution(executionIds: string[]): Promise<Map<string, ReworkRequest>>`; `type ReworkRequestRow`.
  - `AuditLookup` (provider, owned by `executions`, plain SQL on `audits` — Architecture "Module boundary"): `requiresAudit(checklistId): Promise<boolean>`, `openAudit(executionId): Promise<{ id: string; status: 'in_progress' | 'finished' } | null>` (the non-cancelled audit). Task 9 adds `resetVerdicts`, Task 10 `brief`.
  - `CorrectionsService.sendBack(a: Actor, executionId: string, input: SendBackParams): Promise<ReworkRequest>` and `CorrectionsService.withdraw(a: Actor, executionId: string): Promise<ReworkRequest>`.
  - Routes `POST /executions/:id/send-back` and `POST /executions/:id/send-back/cancel` (tenant and platform variants, `executions.correct`).

- [ ] **Step 1: Write the failing test**

`apps/api/test/send-back.test.ts`:

```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, reworkRows, sendBack, withdraw } from './audit-fixtures';
import { executionRow, historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const DUE = '2026-11-03T06:00:00.000Z';

describe('send-back and withdrawal (spec §3.1, §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (opts: { requiresAudit?: boolean } = {}): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    return a;
  };
  const items = (a: AuditWorld) => [
    { itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır, yenidən çəkin' },
    { itemId: a.w.c.temp.id, comment: 'Temperaturu yenidən ölçün' },
  ];

  it('sends a run back: the request, rework state, round 1, correction_required, the snapshot, the event and the audit entry', async () => {
    const a = await world();
    const seen: unknown[] = [];
    const off = t.app.get(DomainEvents).on('execution.sent_back', (e) => void seen.push(e));
    const res = await sendBack(a.manager.api, a.executionId, { items: items(a), dueAt: DUE });
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      id: expect.any(String), round: 1, items: items(a), dueAt: DUE, requestedBy: { id: a.manager.id, fullName: 'Menecer' },
      requestedAt: AT, resubmittedAt: null, withdrawnAt: null, withdrawnBy: null, answersBefore: a.answers,
    });
    expect(await reworkRows(a.executionId)).toEqual([
      expect.objectContaining({ round: 1, answers_before: a.answers, status_before: 'completed', requested_by_user_id: a.manager.id, due_at: new Date(DUE) }),
    ]);
    expect(await executionRow(a.executionId)).toMatchObject({ state: 'rework', answers: a.answers, answers_rev: 1 });
    const x = await ownerQuery<{ rework_round: number; original_answers: unknown; original_captured_at: Date }>('select rework_round, original_answers, original_captured_at from executions where id = $1', [a.executionId]);
    expect(x.rows[0]).toEqual({ rework_round: 1, original_answers: a.answers, original_captured_at: new Date(AT) });
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['completed', 'correction_required', AT, null, a.manager.id]);
    expect(seen).toEqual([{ tenantId: a.w.s.tenantId, executionId: a.executionId, occurrenceId: a.w.occurrenceId, round: 1, actorUserId: a.manager.id }]);
    expect((await auditLogOf(a.executionId)).map((l) => [l.action, l.after])).toEqual([['execution.sent_back', { round: 1, items: items(a), dueAt: DUE }]]);
  });

  it('sends back an audit-pending run and remembers that status', async () => {
    const a = await world({ requiresAudit: true });
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    expect((await sendBack(a.manager.api, a.executionId, { items: items(a) })).status).toBe(200);
    expect((await reworkRows(a.executionId))[0]!.status_before).toBe('audit_pending');
  });

  it('refuses a second send-back, corrections while sent back, unknown items and a past due date', async () => {
    const a = await world();
    const unknown = await sendBack(a.manager.api, a.executionId, { items: [{ itemId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', comment: 'x' }] });
    expect([unknown.status, unknown.body.error.fields]).toEqual([400, { 'items.0.itemId': 'executions.issues.unknownItem' }]);
    const past = await sendBack(a.manager.api, a.executionId, { items: items(a), dueAt: '2026-11-02T04:00:00.000Z' });
    expect([past.status, past.body.error.fields]).toEqual([400, { dueAt: 'corrections.issues.dueInPast' }]);
    expect((await sendBack(a.manager.api, a.executionId, { items: items(a) })).status).toBe(200);
    expect((await sendBack(a.manager.api, a.executionId, { items: items(a) })).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
    const c = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number: 5 } }], reason: 'x' });
    expect(c.body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
    expect(await reworkRows(a.executionId)).toHaveLength(1);
  });

  it('withdraws: completed again, the status before, the request closed and an audit entry', async () => {
    const a = await world();
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    clock.set('2026-11-02T05:30:00Z');
    const res = await withdraw(a.manager.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ round: 1, withdrawnAt: '2026-11-02T05:30:00.000Z', withdrawnBy: { id: a.manager.id, fullName: 'Menecer' }, resubmittedAt: null });
    expect((await executionRow(a.executionId)).state).toBe('completed');
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['correction_required', 'completed', '2026-11-02T05:30:00.000Z', null, a.manager.id]);
    expect((await auditLogOf(a.executionId)).map((l) => l.action)).toEqual(['execution.sent_back', 'execution.send_back_withdrawn']);
    // The run can be corrected directly again.
    expect((await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number: 5 } }], reason: 'x' })).status).toBe(200);
  });

  it('returns a withdrawn audit-pending run to completed when its audit was cancelled and the checklist does not require audit', async () => {
    const a = await world();
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    await ownerQuery(
      `insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at, cancelled_at, cancel_reason)
       values ($1, $2, $3, $4, 'cancelled', $5, now(), now(), 'Səhv başladı')`,
      [uuidv7(), a.w.s.tenantId, a.executionId, a.w.occurrenceId, a.auditor.id],
    );
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
  });

  it('refuses to withdraw when nothing is open, and keeps scope and permission', async () => {
    const a = await world();
    expect((await withdraw(a.manager.api, a.executionId)).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
    expect((await sendBack(a.outsider.api, a.executionId, { items: items(a) })).status).toBe(404);
    expect((await sendBack(a.auditor.api, a.executionId, { items: items(a) })).status).toBe(403);
    await sendBack(a.manager.api, a.executionId, { items: items(a) });
    expect((await withdraw(a.outsider.api, a.executionId)).status).toBe(404);
    expect((await withdraw(a.worker.api, a.executionId)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- send-back`
Expected: FAIL: the send-back routes answer 404.

- [ ] **Step 3: Add the domain event**

`apps/api/src/common/domain-events.ts`, in `DomainEventMap` after `'problem.recorded': …;` add:

```ts
  /** SP8: a manager sent a completed run back to its executor (spec §6.2). SP6 turns it into run.correction_required. */
  'execution.sent_back': { tenantId: string; executionId: string; occurrenceId: string; round: number; actorUserId: string | null };
```

- [ ] **Step 4: Write the lookups**

`apps/api/src/executions/rework-requests.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Answer, ReworkItem, ReworkRequest } from '@taskop/contracts';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executionReworkRequests, users } from '../db/schema';

export type ReworkRequestRow = typeof executionReworkRequests.$inferSelect;

/** Send-back rows of executions (SP8 spec §4.2). Run inside the tenant transaction. */
@Injectable()
export class ReworkRequests {
  constructor(private readonly db: DbService) {}

  /** The open request: neither resubmitted nor withdrawn. At most one (execution_rework_requests_open_uq). */
  async open(executionId: string): Promise<ReworkRequestRow | null> {
    const [r] = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(and(eq(executionReworkRequests.executionId, executionId), isNull(executionReworkRequests.resubmittedAt), isNull(executionReworkRequests.withdrawnAt)));
    return r ?? null;
  }

  async latest(executionId: string): Promise<ReworkRequestRow | null> {
    const [r] = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(eq(executionReworkRequests.executionId, executionId))
      .orderBy(desc(executionReworkRequests.round))
      .limit(1);
    return r ?? null;
  }

  async all(executionId: string): Promise<ReworkRequestRow[]> {
    return this.db.tx().select().from(executionReworkRequests).where(eq(executionReworkRequests.executionId, executionId)).orderBy(asc(executionReworkRequests.round));
  }

  /** The open request of each execution that has one (/me/sync, Spec decision 8). */
  async openByExecution(executionIds: string[]): Promise<Map<string, ReworkRequest>> {
    if (!executionIds.length) return new Map();
    const rows = await this.db
      .tx()
      .select()
      .from(executionReworkRequests)
      .where(and(inArray(executionReworkRequests.executionId, executionIds), isNull(executionReworkRequests.resubmittedAt), isNull(executionReworkRequests.withdrawnAt)));
    const dtos = await this.toDtos(rows);
    return new Map(rows.map((r, i) => [r.executionId, dtos[i]!]));
  }

  async toDtos(rows: ReworkRequestRow[]): Promise<ReworkRequest[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.requestedByUserId, r.withdrawnByUserId]).filter((id): id is string => id !== null))];
    const names = ids.length ? await this.db.tx().select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    const ref = (id: string | null) => {
      const u = id ? names.find((n) => n.id === id) : undefined;
      return u ? { id: u.id, fullName: u.fullName } : null;
    };
    return rows.map((r) => ({
      id: r.id,
      round: r.round,
      items: r.items as ReworkItem[],
      dueAt: r.dueAt?.toISOString() ?? null,
      requestedBy: ref(r.requestedByUserId),
      requestedAt: r.requestedAt.toISOString(),
      resubmittedAt: r.resubmittedAt?.toISOString() ?? null,
      withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
      withdrawnBy: ref(r.withdrawnByUserId),
      answersBefore: r.answersBefore as Record<string, Answer>,
    }));
  }
}
```

`apps/api/src/executions/audit-lookup.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { audits, checklists } from '../db/schema';

/**
 * What the executions module needs to know about audits (Architecture: "Module boundary"): plain reads and writes of
 * the audit tables, so `executions` never imports the `audits` module, which depends on it.
 */
@Injectable()
export class AuditLookup {
  constructor(private readonly db: DbService) {}

  async requiresAudit(checklistId: string): Promise<boolean> {
    const [c] = await this.db.tx().select({ requiresAudit: checklists.requiresAudit }).from(checklists).where(eq(checklists.id, checklistId));
    return c?.requiresAudit ?? false;
  }

  /** The run's non-cancelled audit (at most one: audits_open_uq). */
  async openAudit(executionId: string): Promise<{ id: string; status: 'in_progress' | 'finished' } | null> {
    const [a] = await this.db
      .tx()
      .select({ id: audits.id, status: audits.status })
      .from(audits)
      .where(and(eq(audits.executionId, executionId), ne(audits.status, 'cancelled')));
    return a ? { id: a.id, status: a.status as 'in_progress' | 'finished' } : null;
  }
}
```

- [ ] **Step 5: Implement send-back and withdrawal**

`apps/api/src/executions/corrections.service.ts`:
- imports become

```ts
import { Injectable } from '@nestjs/common';
import {
  type Answer,
  type Answers,
  answerIssues,
  canWithdrawSendBack,
  changedItemIds,
  type CorrectAnswersParams,
  type CorrectionResult,
  type OccurrenceStatus,
  requirements,
  type ReworkRequest,
  type ScoreResult,
  type SendBackParams,
  walkItems,
} from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { executionCorrections, executionReworkRequests, executions } from '../db/schema';
import type { Actor } from '../scheduling/actor';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { AuditLookup } from './audit-lookup';
import { applyCorrection } from './correction-apply';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionRecalculator } from './recalculation';
import { ReworkRequests } from './rework-requests';
import { assertCorrectable, lockRun, snapshotColumns } from './run-locks';
```

- the constructor becomes

```ts
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly audit: AuditService,
    private readonly lookups: ExecutionLookups,
    private readonly recalculator: ExecutionRecalculator,
    private readonly writer: OccurrenceWriter,
    private readonly events: DomainEvents,
    private readonly requests: ReworkRequests,
    private readonly audits: AuditLookup,
  ) {}
```

- add after `correct`:

```ts
  /**
   * FR-19.15: only the flagged items reopen, each with a comment. The run moves to correction_required and its execution
   * to rework; the snapshot is taken if this is the first change. `dueAt` is informational (spec §3.2).
   */
  async sendBack(a: Actor, id: string, input: SendBackParams): Promise<ReworkRequest> {
    const now = this.clock.now();
    const run = await lockRun(this.db, this.scope.occurrences(a), id);
    assertCorrectable(run);
    const { e, o } = run;
    const content = await this.lookups.content(e.checklistVersionId);
    const known = new Set<string>();
    walkItems(content, (item) => known.add(item.id));
    const fields: Record<string, string> = {};
    input.items.forEach((x, i) => {
      if (!known.has(x.itemId)) fields[`items.${i}.itemId`] = 'executions.issues.unknownItem';
    });
    if (input.dueAt && new Date(input.dueAt) <= now) fields.dueAt = 'corrections.issues.dueInPast';
    if (Object.keys(fields).length) throw new AppError('VALIDATION_FAILED', { fields });

    const tx = this.db.tx();
    const actor = actorColumns(this.db);
    const round = e.reworkRound + 1;
    const [request] = await tx
      .insert(executionReworkRequests)
      .values({
        tenantId: e.tenantId,
        executionId: e.id,
        round,
        items: input.items,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        requestedByUserId: actor.userId,
        requestedByPlatformAdminId: actor.platformAdminId,
        requestedAt: now,
        answersBefore: e.answers,
        statusBefore: o.status,
      })
      .returning();
    await tx
      .update(executions)
      .set({ state: 'rework', reworkRound: round, updatedAt: now, ...snapshotColumns(e, now) })
      .where(eq(executions.id, e.id));
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: 'correction_required', at: now }]);
    await this.events.emit('execution.sent_back', { tenantId: e.tenantId, executionId: e.id, occurrenceId: o.id, round, actorUserId: actor.userId });
    await this.audit.record({ action: 'execution.sent_back', entityType: 'execution', entityId: e.id, after: { round, items: input.items, dueAt: input.dueAt ?? null } });
    return (await this.requests.toDtos([request!]))[0]!;
  }

  /**
   * Spec §6.2: withdraws the open send-back. The run returns to the status it had (Spec decision 22) and its execution to
   * completed; answers the worker already synced stay and are not counted as corrections.
   */
  async withdraw(a: Actor, id: string): Promise<ReworkRequest> {
    const now = this.clock.now();
    const { e, o } = await lockRun(this.db, this.scope.occurrences(a), id);
    if (o.status === 'audited') throw new AppError('EXECUTION_LOCKED');
    const open = await this.requests.open(e.id);
    if (!open || !canWithdrawSendBack({ status: o.status, executionState: e.state })) throw new AppError('EXECUTION_NOT_CORRECTABLE');
    const tx = this.db.tx();
    const actor = actorColumns(this.db);
    const [row] = await tx
      .update(executionReworkRequests)
      .set({ withdrawnAt: now, withdrawnByUserId: actor.userId })
      .where(eq(executionReworkRequests.id, open.id))
      .returning();
    await tx.update(executions).set({ state: 'completed', updatedAt: now }).where(eq(executions.id, e.id));
    const back = await this.statusAfterWithdraw(open.statusBefore, o.checklistId, e.id);
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: back, at: now }]);
    await this.audit.record({ action: 'execution.send_back_withdrawn', entityType: 'execution', entityId: e.id, before: { round: open.round }, after: { status: back } });
    return (await this.requests.toDtos([row!]))[0]!;
  }

  /** Spec decision 22: audit_pending only while an audit exists or the checklist requires one. */
  private async statusAfterWithdraw(before: OccurrenceStatus, checklistId: string, executionId: string): Promise<OccurrenceStatus> {
    if (before !== 'audit_pending') return before;
    if (await this.audits.requiresAudit(checklistId)) return before;
    return (await this.audits.openAudit(executionId)) ? before : 'completed';
  }
```

`apps/api/src/executions/dto.ts`: add `reworkRequestSchema, sendBackInputSchema` to the import and

```ts
export class SendBackDto extends createZodDto(sendBackInputSchema) {}
export class ReworkRequestResponse extends createZodDto(reworkRequestSchema) {}
```

`apps/api/src/executions/corrections.controller.ts`: import `type ReworkRequest` from `@taskop/contracts` and `ReworkRequestResponse, SendBackDto` from `./dto`, then add inside the class after `correct`:

```ts
    @Post(':id/send-back')
    @HttpCode(200)
    @correct
    @ApiOkResponse({ type: ReworkRequestResponse })
    sendBack(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: SendBackDto): Promise<ReworkRequest> {
      return this.corrections.sendBack(a, id, body);
    }

    @Post(':id/send-back/cancel')
    @HttpCode(200)
    @correct
    @ApiOkResponse({ type: ReworkRequestResponse })
    withdraw(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<ReworkRequest> {
      return this.corrections.withdraw(a, id);
    }
```

`apps/api/src/executions/executions.module.ts`: add `ReworkRequests` and `AuditLookup` (imports from `./rework-requests` and `./audit-lookup`) to `providers`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- send-back corrections.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/domain-events.ts apps/api/src/executions apps/api/test/send-back.test.ts
git commit -m "feat(api): send a completed run back to its executor, and withdraw it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The worker's rework: guarded answers and media, `POST /executions/:id/resubmit`, verdict reset and `/me/sync`

**Files:**
- Modify: `apps/api/src/common/domain-events.ts`, `apps/api/src/executions/run-locks.ts`, `apps/api/src/executions/audit-lookup.ts`, `apps/api/src/executions/executions.service.ts`, `apps/api/src/executions/media.service.ts`, `apps/api/src/executions/sync.service.ts`, `apps/api/src/executions/executions.controller.ts`, `apps/api/src/executions/corrections.service.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.module.ts`
- Create: `apps/api/src/executions/rework.service.ts`
- Test: `apps/api/test/rework.test.ts`

**Interfaces:**
- Consumes: `reworkViolations`, `changedItemIds`, `nextStatusAfterResubmit`, `requirements`, `resubmitCommandSchema`, `resubmitResultSchema` (contracts); `ReworkRequests`, `AuditLookup` (Task 8); `ExecutionRecalculator` (Task 6); `pickAnswers` (Task 7, `corrections.service.ts`).
- Produces:
  - `DomainEventMap['execution.resubmitted']: { tenantId: string; executionId: string; occurrenceId: string; round: number; actorUserId: string }`.
  - `AuditLookup.resetVerdicts(auditId: string, itemIds: readonly string[]): Promise<void>` (deletes those verdict rows, Spec decision 7).
  - `lockOwnRun(db: DbService, p: Principal, executionId: string): Promise<LockedRun>` in `run-locks.ts` (404 / `NOT_EXECUTOR`).
  - `ReworkService.resubmit(p: Principal, executionId: string, cmd: ResubmitCommandDto): Promise<ResubmitResult>` and the route `POST /executions/:id/resubmit` (the executor; no permission key).
  - `PUT /executions/:id/answers` and `POST /executions/:id/media` accept a `rework` execution for its flagged items and the follow-ups their change reveals or hides (`422 ITEM_NOT_IN_REWORK`, `fields['answers.<itemId>']` / `fields.itemId`; Spec decision 28), with no `closes_at` limit; a rework save stores answers, rev and progress only (Spec decision 21). After a withdrawal or resubmit both answer `409 EXECUTION_NOT_ACTIVE` (the existing closed-execution checks).
  - `reworkReason(content, before, after, items): (itemId: string) => string` in `rework.service.ts` (the comment of the item or of its nearest flagged ancestor).
  - `/me/sync`: the caller's `rework` executions are always listed with `reworkRound` and `rework` (the open request), and their occurrences (`correction_required`) and pinned versions with them (Spec decision 8).

- [ ] **Step 1: Write the failing tests**

`apps/api/test/rework.test.ts`:

```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correctionRows, problemRows, resubmit, reworkRows, sendBack, withdraw } from './audit-fixtures';
import { answersBody, executionRow, historyOf, photoBody, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

/** Hours after the window closed at 07:00Z: rework is not limited by closes_at. */
const LATER = '2026-11-02T12:00:00.000Z';

describe('rework on the phone (spec §3.2, §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** The manager sends the temperature (and the photo item) back at 09:00 Baku; the clock then reads 16:00 Baku. */
  async function sentBack(opts: { requiresAudit?: boolean; photo?: boolean; status?: 'audit_pending' } = {}) {
    const a = await auditWorld(t, clock, { requiresAudit: opts.requiresAudit });
    if (opts.status) await ownerQuery('update occurrences set status = $2 where id = $1', [a.w.occurrenceId, opts.status]);
    clock.set('2026-11-02T05:00:00Z');
    const items = [{ itemId: a.w.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, ...(opts.photo ? [{ itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }] : [])];
    const res = await sendBack(a.manager.api, a.executionId, { items });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    clock.set(LATER);
    return a;
  }
  const save = (a: AuditWorld, rev: number, answers: object) => a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(rev, answers as never, LATER));
  const fixedTemp = (a: AuditWorld) => ({ ...a.answers, [a.w.c.temp.id]: { number: 5, note: 'yenidən ölçüldü' } });

  it('takes changes to flagged items only, after closes_at, without recalculating yet', async () => {
    const a = await sentBack();
    const ok = await save(a, 2, fixedTemp(a));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ rev: 2, stale: false, state: 'rework' });
    expect(await executionRow(a.executionId)).toMatchObject({ answers_rev: 2, answers: fixedTemp(a), score: { percent: 50 } });
    const outside = await save(a, 3, { ...fixedTemp(a), [a.w.c.problem.id]: { optionIds: [a.w.c.yes.id] } });
    expect([outside.status, outside.body.error.code, outside.body.error.fields]).toEqual([422, 'ITEM_NOT_IN_REWORK', { [`answers.${a.w.c.problem.id}`]: 'errors.ITEM_NOT_IN_REWORK' }]);
    expect((await executionRow(a.executionId)).answers_rev).toBe(2);
    // A stale command is still ignored before any check.
    expect((await save(a, 1, {})).body).toMatchObject({ rev: 2, stale: true });
  });

  it('takes media for flagged items and manual problems only', async () => {
    const a = await sentBack({ photo: true });
    const register = (itemId: string | null) => a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(itemId, { capturedAt: LATER, deviceTime: LATER }));
    expect((await register(a.w.c.photo.id)).status).toBe(200);
    expect((await register(null)).status).toBe(200);
    const notFlagged = await register(a.w.c.problem.id);
    expect([notFlagged.status, notFlagged.body.error.code]).toEqual([422, 'ITEM_NOT_IN_REWORK']);
  });

  it('resubmits: rework corrections with the comments as reasons, recalculation, completed again, an event and an audit entry', async () => {
    const a = await sentBack();
    await save(a, 2, fixedTemp(a));
    const seen: unknown[] = [];
    const off = t.app.get(DomainEvents).on('execution.resubmitted', (e) => void seen.push(e));
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId: a.executionId, state: 'completed', status: 'completed',
      progress: { answered: 3, total: 4, requiredMissing: 0 }, score: { earned: 2, possible: 2, percent: 100, problems: [] },
    });
    const rows = await correctionRows(a.executionId);
    expect(rows).toEqual([
      expect.objectContaining({
        item_id: a.w.c.temp.id, kind: 'rework', round: 1, before: { number: 10, note: 'isti' }, after: { number: 5, note: 'yenidən ölçüldü' },
        reason: 'Temperaturu yenidən ölçün', actor_user_id: a.worker.id,
      }),
    ]);
    expect((await problemRows(a.executionId)).map((p) => [p.item_id, p.cleared_by_correction_id])).toEqual([[a.w.c.temp.id, rows[0]!.id]]);
    expect((await reworkRows(a.executionId))[0]!.resubmitted_at?.toISOString()).toBe(LATER);
    const x = await executionRow(a.executionId);
    expect(x).toMatchObject({ state: 'completed', late: false });
    expect(x.completed_at?.toISOString()).toBe('2026-11-02T04:20:00.000Z');
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['correction_required', 'completed', LATER, null, a.worker.id]);
    expect(seen).toEqual([{ tenantId: a.w.s.tenantId, executionId: a.executionId, occurrenceId: a.w.occurrenceId, round: 1, actorUserId: a.worker.id }]);
    expect((await auditLogOf(a.executionId)).map((l) => [l.action, l.actor_user_id])).toEqual([
      ['execution.sent_back', a.manager.id],
      ['execution.resubmitted', a.worker.id],
    ]);
  });

  it('goes to audit_pending when the checklist requires audit', async () => {
    const a = await sentBack();
    await ownerQuery('update checklists set requires_audit = true where id = $1', [a.w.checklistId]);
    await save(a, 2, fixedTemp(a));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).body.status).toBe('audit_pending');
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
  });

  it('resets the verdicts of changed items while an audit is open, and returns the run to the audit', async () => {
    const a = await auditWorld(t, clock);
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    const auditId = uuidv7();
    await ownerQuery(
      "insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at) values ($1, $2, $3, $4, 'in_progress', $5, now())",
      [auditId, a.w.s.tenantId, a.executionId, a.w.occurrenceId, a.auditor.id],
    );
    await ownerQuery(
      `insert into audit_item_verdicts (tenant_id, audit_id, item_id, verdict, comment, updated_by_user_id, updated_at)
       values ($1, $2, $3, 'rejected', 'Temperatur yüksəkdir', $4, now()), ($1, $2, $5, 'approved', null, $4, now())`,
      [a.w.s.tenantId, auditId, a.w.c.temp.id, a.auditor.id, a.w.c.photo.id],
    );
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set(LATER);
    await save(a, 2, fixedTemp(a));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).body.status).toBe('audit_pending');
    const verdicts = await ownerQuery<{ item_id: string }>('select item_id from audit_item_verdicts where audit_id = $1', [auditId]);
    expect(verdicts.rows.map((v) => v.item_id)).toEqual([a.w.c.photo.id]);
  });

  it('answers a repeated resubmit with the same result and writes nothing more', async () => {
    const a = await sentBack();
    await save(a, 2, fixedTemp(a));
    const first = await resubmit(a.worker.api, a.executionId, LATER);
    const again = await resubmit(a.worker.api, a.executionId, LATER);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await correctionRows(a.executionId)).toHaveLength(1);
    expect((await historyOf(a.w.occurrenceId)).filter((h) => h[0] === 'correction_required')).toHaveLength(1);
  });

  it('refuses a resubmit after the send-back was withdrawn', async () => {
    const a = await sentBack();
    await save(a, 2, fixedTemp(a));
    expect((await withdraw(a.manager.api, a.executionId)).status).toBe(200);
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect([res.status, res.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    expect(await correctionRows(a.executionId)).toEqual([]);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await reworkRows(a.executionId))[0]).toMatchObject({ resubmitted_at: null });
    // The answers the phone synced before the withdrawal stay, uncounted as corrections.
    expect((await executionRow(a.executionId)).answers).toEqual(fixedTemp(a));
    expect((await auditLogOf(a.executionId)).map((l) => l.action)).toEqual(['execution.sent_back', 'execution.send_back_withdrawn']);
    // Later rework commands of the stale phone are refused the same way: answers and a new medium.
    expect((await save(a, 3, fixedTemp(a))).body.error.code).toBe('EXECUTION_NOT_ACTIVE');
    const media = await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.temp.id, { capturedAt: LATER, deviceTime: LATER }));
    expect([media.status, media.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('refuses an incomplete resubmit and keeps the rework open', async () => {
    const a = await sentBack({ photo: true });
    await save(a, 2, { ...a.answers, [a.w.c.photo.id]: { photos: [] } });
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect([res.status, res.body.error.code, res.body.error.missing]).toEqual([422, 'REQUIREMENTS_UNMET', [{ itemId: a.w.c.photo.id, kind: 'answer' }]]);
    expect((await executionRow(a.executionId)).state).toBe('rework');
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
  });

  it('lets a flagged change reveal a required follow-up, which the worker answers, and resubmits', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.problem.id, comment: 'Problem var idi, düzəldin' }] });
    clock.set(LATER);
    // "Bəli" asks for a photo on the item and reveals the required follow-up comment, which was never flagged.
    const photo = await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.problem.id, { capturedAt: LATER, deviceTime: LATER }));
    expect(photo.status, JSON.stringify(photo.body)).toBe(200);
    const photoId = photo.body.mediaId as string;
    const answers = { ...a.answers, [a.w.c.problem.id]: { optionIds: [a.w.c.yes.id], photos: [photoId] }, [a.w.c.comment.id]: { text: 'Su axır' } };
    const saved = await save(a, 2, answers);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('completed');
    expect((await correctionRows(a.executionId)).map((c) => [c.item_id, c.kind, c.reason])).toEqual([
      [a.w.c.problem.id, 'rework', 'Problem var idi, düzəldin'],
      [a.w.c.comment.id, 'rework', 'Problem var idi, düzəldin'],
    ]);
  });

  it('accepts a follow-up answered and then hidden again, and resubmits without a correction for it', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.problem.id, comment: 'Yenidən baxın' }] });
    clock.set(LATER);
    const photo = (await a.worker.api.post(`/api/v1/executions/${a.executionId}/media`, photoBody(a.w.c.problem.id, { capturedAt: LATER, deviceTime: LATER }))).body.mediaId as string;
    const shown = { ...a.answers, [a.w.c.problem.id]: { optionIds: [a.w.c.yes.id], photos: [photo] }, [a.w.c.comment.id]: { text: 'Su axır' } };
    expect((await save(a, 2, shown)).status).toBe(200);
    // Back to "Xeyr": the follow-up is hidden again, its answer left behind.
    const hidden = { ...a.answers, [a.w.c.comment.id]: { text: 'Su axır' } };
    const saved = await save(a, 3, hidden);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const res = await resubmit(a.worker.api, a.executionId, LATER);
    expect([res.status, res.body.status]).toEqual([200, 'completed']);
    expect(await correctionRows(a.executionId)).toEqual([]);
  });

  it('is for the executor only', async () => {
    const a = await sentBack();
    expect((await resubmit(a.w.workers[1].api, a.executionId, LATER)).body.error.code).toBe('NOT_EXECUTOR');
    expect((await a.w.workers[1].api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, fixedTemp(a), LATER))).body.error.code).toBe('NOT_EXECUTOR');
  });

  it('carries the rework run in /me/sync whatever its date, and drops it once resubmitted and out of the windows', async () => {
    const a = await sentBack();
    clock.set('2026-11-05T08:00:00Z');
    const pull = async () => (await a.worker.api.get('/api/v1/me/sync')).body;
    const during = await pull();
    expect(during.executions.find((x: { id: string }) => x.id === a.executionId)).toMatchObject({
      state: 'rework',
      reworkRound: 1,
      rework: { round: 1, items: [{ itemId: a.w.c.temp.id, comment: 'Temperaturu yenidən ölçün' }], dueAt: null, requestedBy: { id: a.manager.id, fullName: 'Menecer' } },
    });
    expect(during.occurrences.find((o: { id: string }) => o.id === a.w.occurrenceId)).toMatchObject({ status: 'correction_required', checklistVersionId: a.w.versionId });
    expect(during.checklistVersions.map((v: { id: string }) => v.id)).toContain(a.w.versionId);
    // Another worker of the same site never gets it.
    expect((await a.w.workers[1].api.get('/api/v1/me/sync')).body.executions).toEqual([]);
    await save(a, 2, fixedTemp(a));
    expect((await resubmit(a.worker.api, a.executionId, '2026-11-05T08:00:00.000Z')).status).toBe(200);
    clock.set('2026-11-06T09:00:00Z');
    const after = await pull();
    expect(after.executions.map((x: { id: string }) => x.id)).not.toContain(a.executionId);
    expect(after.occurrences.map((o: { id: string }) => o.id)).not.toContain(a.w.occurrenceId);
  });

  it('leaves rework runs to the worker: the partial sweep never touches them', async () => {
    const a = await sentBack();
    clock.set('2026-11-03T12:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([a.w.s.tenantId]);
    expect((await executionRow(a.executionId)).state).toBe('rework');
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- rework.test`
Expected: FAIL: the first save answers `409 EXECUTION_NOT_ACTIVE` (the device time is after `closes_at`) and `/resubmit` is 404.

- [ ] **Step 3: Add the event, the executor lock and the verdict reset**

`apps/api/src/common/domain-events.ts`, after `'execution.sent_back': …;` add:

```ts
  /** SP8: the executor resubmitted a run sent back. SP6 turns it into run.resubmitted for whoever sent it back. */
  'execution.resubmitted': { tenantId: string; executionId: string; occurrenceId: string; round: number; actorUserId: string };
```

`apps/api/src/executions/run-locks.ts`: add `import type { Principal } from '../common/request';` and

```ts
/** The executor's own run, locked like every phone command (occurrence, then execution). */
export async function lockOwnRun(db: DbService, p: Principal, executionId: string): Promise<LockedRun> {
  const tx = db.tx();
  const [found] = await tx.select({ occurrenceId: executions.occurrenceId }).from(executions).where(eq(executions.id, executionId));
  if (!found) throw new AppError('NOT_FOUND');
  const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, found.occurrenceId)).for('update');
  const [e] = await tx.select().from(executions).where(eq(executions.id, executionId)).for('update');
  if (e!.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
  return { e: e!, o: o! };
}
```

`apps/api/src/executions/audit-lookup.ts`: add `inArray` to the drizzle import, `auditItemVerdicts` to the schema import, and

```ts
  /** Spec decision 7: the auditor reviews the items a rework changed again. */
  async resetVerdicts(auditId: string, itemIds: readonly string[]): Promise<void> {
    if (!itemIds.length) return;
    await this.db
      .tx()
      .delete(auditItemVerdicts)
      .where(and(eq(auditItemVerdicts.auditId, auditId), inArray(auditItemVerdicts.itemId, [...itemIds])));
  }
```

- [ ] **Step 4: Accept rework answers and media**

`apps/api/src/executions/executions.service.ts`:
- add to the contracts import: `type ReworkItem, reworkViolations`; add `import { ReworkRequests } from './rework-requests';`
- add `private readonly reworkRequests: ReworkRequests,` as the last constructor parameter;
- in `saveAnswers`, after `if (cmd.rev <= e.answersRev) return this.answersResult(e, true);` add

```ts
    if (e.state === 'rework') return this.saveReworkAnswers(e, cmd, bounds.clockSuspect, receivedAt);
```

- add the method after `saveAnswers`:

```ts
  /**
   * SP8 Spec decisions 5, 21 and 28: a run sent back takes answers for its flagged items (and the follow-ups they reveal or
   * hide) only, whatever closes_at says. Score
   * and problems are recalculated by the resubmit. No open request (withdrawn) is EXECUTION_NOT_ACTIVE.
   */
  private async saveReworkAnswers(e: ExecutionRow, cmd: SaveAnswersCommandDto, suspect: boolean, receivedAt: Date): Promise<SaveAnswersResult> {
    const request = await this.reworkRequests.open(e.id);
    if (!request) throw new AppError('EXECUTION_NOT_ACTIVE');
    const content = await this.lookups.content(e.checklistVersionId);
    const flagged = new Set((request.items as ReworkItem[]).map((x) => x.itemId));
    // Spec decision 28: the follow-ups a flagged change reveals or hides may change too.
    const outside = reworkViolations(content, request.answersBefore as Answers, cmd.answers, flagged);
    if (outside.length) {
      throw new AppError('ITEM_NOT_IN_REWORK', { fields: Object.fromEntries(outside.map((itemId) => [`answers.${itemId}`, 'errors.ITEM_NOT_IN_REWORK'])) });
    }
    await this.assertValidAnswers(content, e.id, cmd.answers);
    const [row] = await this.db
      .tx()
      .update(executions)
      .set({ ...this.answersColumns(e, cmd.answers, cmd.rev, cmd.clientOffsetMs, suspect, receivedAt), progress: progress(content, cmd.answers) })
      .where(eq(executions.id, e.id))
      .returning();
    return this.answersResult(row!, false);
  }
```

Once a resubmit or a withdrawal has set the state back to `completed`, the existing `closed` check answers a stale phone's save with `EXECUTION_NOT_ACTIVE`.

`apps/api/src/executions/media.service.ts`:
- add `type Answers, type ReworkItem, visibleItems` to the contracts import and `import { ReworkRequests } from './rework-requests';`
- add `private readonly reworkRequests: ReworkRequests,` as the last constructor parameter;
- in `register`, after `if (!open) throw new AppError('EXECUTION_NOT_ACTIVE');` add

```ts
    // SP8 Spec decisions 5 and 28: a run sent back takes new media for its flagged items, for items hidden when it was
    // sent back (follow-ups a flagged change may reveal; registration order does not matter), and problem-only media.
    if (e.state === 'rework' && cmd.itemId !== null) {
      const request = await this.reworkRequests.open(e.id);
      if (!request) throw new AppError('EXECUTION_NOT_ACTIVE');
      const content = await this.lookups.content(e.checklistVersionId);
      const flagged = (request.items as ReworkItem[]).some((x) => x.itemId === cmd.itemId);
      const shownBefore = visibleItems(content, request.answersBefore as Answers).some((v) => v.item.id === cmd.itemId);
      if (!flagged && shownBefore) throw new AppError('ITEM_NOT_IN_REWORK', { fields: { itemId: 'errors.ITEM_NOT_IN_REWORK' } });
    }
```

- [ ] **Step 5: Write the resubmit**

`apps/api/src/executions/rework.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  type Answers,
  changedItemIds,
  type ChecklistContent,
  type ExecutionProgress,
  nextStatusAfterResubmit,
  type OccurrenceStatus,
  requirements,
  type ResubmitResult,
  type ReworkItem,
  type ScoreResult,
  visibleItems,
} from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { executionCorrections, executionReworkRequests, executions } from '../db/schema';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { AuditLookup } from './audit-lookup';
import { pickAnswers } from './corrections.service';
import { assertDeviceTimes } from './device-time';
import type { ResubmitCommandDto } from './dto';
import { ExecutionLookups } from './execution-lookups';
import type { ExecutionRow } from './executions.service';
import { ExecutionRecalculator } from './recalculation';
import { ReworkRequests } from './rework-requests';
import { lockOwnRun } from './run-locks';

/**
 * The reason of a rework correction (Spec decision 28): the item's own comment when it was flagged, else the comment of
 * its nearest flagged ancestor (a follow-up the flagged change revealed or hid), else the first flagged item's comment.
 */
export function reworkReason(content: ChecklistContent, before: Answers, after: Answers, items: readonly ReworkItem[]): (itemId: string) => string {
  const comments = new Map(items.map((x) => [x.itemId, x.comment]));
  const parents = new Map<string, string | null>();
  for (const v of [...visibleItems(content, before), ...visibleItems(content, after)]) parents.set(v.item.id, v.parentId);
  return (itemId) => {
    const seen = new Set<string>();
    for (let id: string | null | undefined = itemId; id && !seen.has(id); id = parents.get(id)) {
      seen.add(id);
      const comment = comments.get(id);
      if (comment) return comment;
    }
    return items[0]?.comment ?? '';
  };
}

/** POST /executions/:id/resubmit (SP8 spec §6.2): closes a rework round. Runs in the request's tenant transaction. */
@Injectable()
export class ReworkService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: OccurrenceWriter,
    private readonly lookups: ExecutionLookups,
    private readonly recalculator: ExecutionRecalculator,
    private readonly requests: ReworkRequests,
    private readonly audits: AuditLookup,
    private readonly events: DomainEvents,
    private readonly audit: AuditService,
  ) {}

  /**
   * Requirements, then one `rework` correction per changed item (the manager's comment as the reason), recalculation,
   * resubmitted_at, state completed and the status of nextStatusAfterResubmit. Verdicts of an open audit on the changed
   * items are reset (Spec decision 7). completed_at, completed_received_at and late keep their first values.
   * Idempotent: a repeat after success answers 200 (Spec decision 6).
   */
  async resubmit(p: Principal, id: string, cmd: ResubmitCommandDto): Promise<ResubmitResult> {
    const receivedAt = this.clock.now();
    const { e, o } = await lockOwnRun(this.db, p, id);
    const resubmittedAt = new Date(cmd.resubmittedAt);
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), resubmittedAt], receivedAt, cmd.clientOffsetMs);
    if (e.state === 'completed' && (await this.requests.latest(e.id))?.resubmittedAt) return this.result(e, o.status);
    if (e.state !== 'rework') throw new AppError('EXECUTION_NOT_ACTIVE');
    const request = await this.requests.open(e.id);
    if (!request) throw new AppError('EXECUTION_NOT_ACTIVE');
    const content = await this.lookups.content(e.checklistVersionId);
    const answers = e.answers as Answers;
    const missing = requirements(content, answers);
    if (missing.length) throw new AppError('REQUIREMENTS_UNMET', { details: { missing } });

    const tx = this.db.tx();
    const before = request.answersBefore as Answers;
    const items = request.items as ReworkItem[];
    // Spec decision 28: rows for every changed item visible before or after; a leftover answer hidden on both sides is not a correction.
    const shown = new Set([...visibleItems(content, before), ...visibleItems(content, answers)].map((v) => v.item.id));
    const changed = changedItemIds(before, answers).filter((id) => shown.has(id));
    const reasonOf = reworkReason(content, before, answers, items);
    const rows = changed.length
      ? await tx
          .insert(executionCorrections)
          .values(
            changed.map((itemId) => ({
              tenantId: e.tenantId,
              executionId: e.id,
              itemId,
              kind: 'rework' as const,
              round: request.round,
              before: before[itemId] ?? null,
              after: answers[itemId] ?? null,
              reason: reasonOf(itemId),
              actorUserId: p.userId,
              at: receivedAt,
            })),
          )
          .returning({ id: executionCorrections.id, itemId: executionCorrections.itemId })
      : [];
    const { score, progress } = await this.recalculator.recalculate({
      execution: e,
      occurrence: o,
      content,
      answers,
      clearedBy: new Map(rows.map((r) => [r.itemId, r.id])),
      now: receivedAt,
    });
    await tx.update(executionReworkRequests).set({ resubmittedAt }).where(eq(executionReworkRequests.id, request.id));
    await tx
      .update(executions)
      .set({ state: 'completed', lastSyncedAt: receivedAt, clockOffsetMs: cmd.clientOffsetMs, clockSuspect: e.clockSuspect || bounds.clockSuspect, updatedAt: receivedAt })
      .where(eq(executions.id, e.id));
    const audit = await this.audits.openAudit(e.id);
    const status = nextStatusAfterResubmit(await this.audits.requiresAudit(o.checklistId), audit !== null);
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: status, at: resubmittedAt }]);
    if (audit?.status === 'in_progress') await this.audits.resetVerdicts(audit.id, changed);
    await this.events.emit('execution.resubmitted', { tenantId: e.tenantId, executionId: e.id, occurrenceId: o.id, round: request.round, actorUserId: p.userId });
    await this.audit.record({
      action: 'execution.resubmitted',
      entityType: 'execution',
      entityId: e.id,
      before: { answers: pickAnswers(before, changed) },
      after: { answers: pickAnswers(answers, changed), round: request.round, status },
    });
    return { executionId: e.id, state: 'completed', status, progress, score };
  }

  private result(e: ExecutionRow, status: OccurrenceStatus): ResubmitResult {
    return { executionId: e.id, state: e.state, status, progress: e.progress as ExecutionProgress, score: (e.score as ScoreResult | null) ?? null };
  }
}
```

`apps/api/src/executions/dto.ts`: add `resubmitCommandSchema, resubmitResultSchema` to the import and

```ts
export class ResubmitCommandDto extends createZodDto(resubmitCommandSchema) {}
export class ResubmitResultResponse extends createZodDto(resubmitResultSchema) {}
```

`apps/api/src/executions/executions.controller.ts`:
- add `ResubmitResult` to the type import from `@taskop/contracts`, `ResubmitCommandDto, ResubmitResultResponse` to the `./dto` import, and `import { ReworkService } from './rework.service';`
- add `@Inject(ReworkService) private readonly rework: ReworkService,` to the constructor;
- add after `complete`:

```ts
  /** SP8: the executor closes a rework round; the outbox sends it after the round's answers and media. */
  @Post(':id/resubmit')
  @HttpCode(200)
  @ApiOkResponse({ type: ResubmitResultResponse })
  resubmit(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: ResubmitCommandDto): Promise<ResubmitResult> {
    return this.rework.resubmit(p, id, body);
  }
```

`apps/api/src/executions/executions.module.ts`: add `ReworkService` (from `./rework.service`) to `providers`.

- [ ] **Step 6: Carry rework runs in `/me/sync`**

`apps/api/src/executions/sync.service.ts`:
- add `import { ReworkRequests } from './rework-requests';` and `private readonly reworkRequests: ReworkRequests,` as the last constructor parameter;
- the `executingRows` query's last condition `eq(executions.state, 'active')` becomes `inArray(executions.state, ['active', 'rework'])`, and its comment gains "and of the caller's runs sent back to them, whatever their date (SP8 Spec decision 8)";
- the `own` query's `or(eq(executions.state, 'active'), gte(…))` becomes `or(inArray(executions.state, ['active', 'rework']), gte(executions.updatedAt, new Date(+now - EXECUTION_LIMITS.syncFinishedHours * HOUR)))`;
- after the `own` query add

```ts
    const rework = await this.reworkRequests.openByExecution(own.filter((r) => r.x.state === 'rework').map((r) => r.x.id));
```

- in `executions: own.map(…)`, replace the two Task 2 placeholders `reworkRound: 0, rework: null,` with

```ts
        reworkRound: x.reworkRound,
        rework: rework.get(x.id) ?? null,
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- rework.test send-back executions-answers executions-media executions-sync executions-sweep executions-complete`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common/domain-events.ts apps/api/src/executions apps/api/test/rework.test.ts
git commit -m "feat(api): let the executor rework the flagged items offline and resubmit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Read side: `GET /executions/:id/corrections`, the run detail fields, cleared problems

**Files:**
- Create: `apps/api/src/executions/correction-history.ts`
- Modify: `apps/api/src/executions/audit-lookup.ts`, `apps/api/src/executions/execution-queries.ts`, `apps/api/src/executions/execution-access.ts`, `apps/api/src/executions/mappers.ts`, `apps/api/src/executions/problem-rows.ts`, `apps/api/src/executions/problems.service.ts`, `apps/api/src/executions/executions.controller.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.module.ts`
- Test: `apps/api/test/corrections-read.test.ts`

**Interfaces:**
- Consumes: `answersEqual`, `isAuditPaused`, `walkItems`, `executionCorrectionsSchema` (contracts); `ReworkRequests` (Task 8); `AuditLookup` (Task 8).
- Produces:
  - `CorrectionHistory.of(executionId: string): Promise<ExecutionCorrections>` (no access check; Task 12 reuses it).
  - `ExecutionQueries.load(executionId: string): Promise<ExecutionDetail>` (no access check; Task 12 reuses it) and `ExecutionQueries.corrections(p: Principal, executionId: string): Promise<ExecutionCorrections>`.
  - `AuditLookup.brief(executionId: string, occurrenceStatus: OccurrenceStatus): Promise<AuditBrief | null>`: the non-cancelled audit, else the latest cancelled one.
  - `GET /executions/:id/corrections` (tenant), `ExecutionDetail.reworkRound / rework / corrected / audit` and `ExecutionProblem.clearedAt` filled; `ProblemDto.clearedAt`; `GET /problems?includeCleared=true`; `ExecutionSummary.problemCount` counts active problems only.
  - `ExecutionAccess.assertCanRead` accepts `assignments.view`, `reports.view`, `audits.perform` or `executions.correct` in scope.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/corrections-read.test.ts`:

```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditWorld, correct, resubmit, sendBack } from './audit-fixtures';
import { answersBody } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const LATER = '2026-11-02T12:00:00.000Z';

describe('reading corrections (spec §6.2, NFR-07.05)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock);
    clock.set(AT);
    return a;
  };
  const history = (api: Api, a: AuditWorld) => api.get(`/api/v1/executions/${a.executionId}/corrections`);
  const tempTo = (a: AuditWorld, rev: number, number: number) => ({ answersRev: rev, changes: [{ itemId: a.w.c.temp.id, answer: { number } }], reason: 'Termometr səhv oxunub' });

  it('returns the original, the corrections oldest first, the rework rounds and the diff in checklist order', async () => {
    const a = await world();
    expect((await history(a.manager.api, a)).body).toEqual({ original: null, corrections: [], reworkRequests: [], diff: [] });
    expect((await correct(a.manager.api, a.executionId, tempTo(a, 1, 5))).status).toBe(200);
    clock.set('2026-11-02T05:10:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set(LATER);
    await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(3, { ...a.answers, [a.w.c.temp.id]: { number: 6 } }, LATER));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).status).toBe(200);

    const res = await history(a.manager.api, a);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.original).toEqual({ answers: a.answers, score: { earned: 1, possible: 2, percent: 50, problems: [{ itemId: a.w.c.temp.id, severity: 'normal' }] }, capturedAt: AT });
    expect(res.body.corrections).toEqual([
      { id: expect.any(String), itemId: a.w.c.temp.id, kind: 'manual', round: 0, before: { number: 10, note: 'isti' }, after: { number: 5 }, reason: 'Termometr səhv oxunub', actor: { kind: 'user', name: 'Menecer' }, at: AT },
      { id: expect.any(String), itemId: a.w.c.temp.id, kind: 'rework', round: 1, before: { number: 5 }, after: { number: 6 }, reason: 'Yenidən ölçün', actor: { kind: 'user', name: 'İşçi 1' }, at: LATER },
    ]);
    expect(res.body.reworkRequests).toEqual([expect.objectContaining({ round: 1, resubmittedAt: LATER, withdrawnAt: null })]);
    expect(res.body.diff).toEqual([{ itemId: a.w.c.temp.id, original: { number: 10, note: 'isti' }, current: { number: 6 } }]);
  });

  it('fills the run detail: rework, the snapshot flag, the audit brief and cleared problems', async () => {
    const a = await world();
    const detail = async () => (await a.manager.api.get(`/api/v1/executions/${a.executionId}`)).body;
    expect(await detail()).toMatchObject({ reworkRound: 0, rework: null, corrected: false, audit: null, problems: [{ itemId: a.w.c.temp.id, clearedAt: null }] });
    await correct(a.manager.api, a.executionId, tempTo(a, 1, 5));
    expect(await detail()).toMatchObject({ corrected: true, problems: [{ itemId: a.w.c.temp.id, clearedAt: AT }] });
    const occurrence = (await a.manager.api.get(`/api/v1/occurrences/${a.w.occurrenceId}`)).body;
    expect(occurrence.execution.problemCount).toBe(0);
    const auditId = uuidv7();
    await ownerQuery("update occurrences set status = 'audit_pending' where id = $1", [a.w.occurrenceId]);
    await ownerQuery(
      "insert into audits (id, tenant_id, execution_id, occurrence_id, status, auditor_user_id, started_at) values ($1, $2, $3, $4, 'in_progress', $5, now())",
      [auditId, a.w.s.tenantId, a.executionId, a.w.occurrenceId, a.auditor.id],
    );
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }] });
    expect(await detail()).toMatchObject({
      state: 'rework',
      reworkRound: 1,
      rework: { round: 1, items: [{ itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }] },
      audit: { id: auditId, status: 'in_progress', result: null, percent: null, paused: true },
    });
  });

  it('lets the executor and every in-scope reader with one of the four keys read the history', async () => {
    const a = await world();
    const roleUser = async (permissions: string[]) => {
      const role = await a.w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope: 'all', permissions });
      expect(role.status, JSON.stringify(role.body)).toBe(201);
      const u = await createUserDirect(t, a.w.s.tenantId, { kind: 'staff', roleId: role.body.id, emailVerified: true });
      return as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    };
    expect((await history(a.worker.api, a)).status).toBe(200);
    expect((await history(a.manager.api, a)).status).toBe(200);
    expect((await history(a.auditor.api, a)).status).toBe(200);
    expect((await history(await roleUser(['executions.correct']), a)).status).toBe(200);
    expect((await history(await roleUser(['audits.perform']), a)).status).toBe(200);
    expect((await (await roleUser(['audits.perform'])).get(`/api/v1/executions/${a.executionId}`)).status).toBe(200);
    expect((await history(await roleUser(['checklists.view']), a)).status).toBe(404);
    expect((await history(a.outsider.api, a)).status).toBe(404);
    expect((await history(a.w.workers[1].api, a)).status).toBe(404);
  });

  it('hides cleared problems from GET /problems unless includeCleared', async () => {
    const a = await world();
    await correct(a.manager.api, a.executionId, tempTo(a, 1, 5));
    const list = (q = '') => a.manager.api.get(`/api/v1/problems?from=2026-11-01&to=2026-11-30${q}`);
    expect((await list()).body.items).toEqual([]);
    const all = (await list('&includeCleared=true')).body.items;
    expect(all.map((p: { itemId: string; clearedAt: string }) => [p.itemId, p.clearedAt])).toEqual([[a.w.c.temp.id, AT]]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- corrections-read`
Expected: FAIL: `GET /executions/:id/corrections` is 404 and the detail still has the Task 2 placeholders.

- [ ] **Step 3: Write the history and the brief**

`apps/api/src/executions/correction-history.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type Answer, type AnswerDiff, type Answers, answersEqual, type Correction, type ExecutionCorrections, type ScoreResult, walkItems } from '@taskop/contracts';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { executionCorrections, executions, users } from '../db/schema';
import { ExecutionLookups } from './execution-lookups';
import { ReworkRequests } from './rework-requests';

type CorrectionRow = { c: typeof executionCorrections.$inferSelect; actorName: string | null };

const toCorrection = (r: CorrectionRow): Correction => ({
  id: r.c.id,
  itemId: r.c.itemId,
  kind: r.c.kind,
  round: r.c.round,
  before: (r.c.before as Answer | null) ?? null,
  after: (r.c.after as Answer | null) ?? null,
  reason: r.c.reason,
  actor: r.c.actorPlatformAdminId ? { kind: 'platform', name: null } : { kind: 'user', name: r.actorName },
  at: r.c.at.toISOString(),
});

/** The correction history of a run (SP8 spec §6.2, NFR-07.05). Callers check read access first. */
@Injectable()
export class CorrectionHistory {
  constructor(
    private readonly db: DbService,
    private readonly lookups: ExecutionLookups,
    private readonly requests: ReworkRequests,
  ) {}

  async of(executionId: string): Promise<ExecutionCorrections> {
    const tx = this.db.tx();
    const [x] = await tx
      .select({
        answers: executions.answers,
        versionId: executions.checklistVersionId,
        originalAnswers: executions.originalAnswers,
        originalScore: executions.originalScore,
        originalCapturedAt: executions.originalCapturedAt,
      })
      .from(executions)
      .where(eq(executions.id, executionId));
    if (!x) throw new AppError('NOT_FOUND');
    const rows = await tx
      .select({ c: getTableColumns(executionCorrections), actorName: users.fullName })
      .from(executionCorrections)
      .leftJoin(users, eq(users.id, executionCorrections.actorUserId))
      .where(eq(executionCorrections.executionId, executionId))
      .orderBy(asc(executionCorrections.at), asc(executionCorrections.id));
    const original = x.originalCapturedAt
      ? { answers: x.originalAnswers as Record<string, Answer>, score: (x.originalScore as ScoreResult | null) ?? null, capturedAt: x.originalCapturedAt.toISOString() }
      : null;
    const diff: AnswerDiff[] = [];
    if (original) {
      const current = x.answers as Answers;
      walkItems(await this.lookups.content(x.versionId), (item) => {
        const before = original.answers[item.id];
        const now = current[item.id];
        if (!answersEqual(before, now)) diff.push({ itemId: item.id, original: before ?? null, current: now ?? null });
      });
    }
    return { original, corrections: rows.map(toCorrection), reworkRequests: await this.requests.toDtos(await this.requests.all(executionId)), diff };
  }
}
```

`apps/api/src/executions/audit-lookup.ts`:
- imports become

```ts
import { Injectable } from '@nestjs/common';
import { type AuditBrief, type AuditScore, isAuditPaused, type OccurrenceStatus } from '@taskop/contracts';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { auditItemVerdicts, audits, checklists } from '../db/schema';
```

- add:

```ts
  /** ExecutionDetail.audit: the non-cancelled audit, else the latest cancelled one; null when none was started. */
  async brief(executionId: string, occurrenceStatus: OccurrenceStatus): Promise<AuditBrief | null> {
    const [a] = await this.db
      .tx()
      .select({ id: audits.id, status: audits.status, result: audits.result, score: audits.auditScore })
      .from(audits)
      .where(eq(audits.executionId, executionId))
      .orderBy(sql`${audits.status} = 'cancelled'`, desc(audits.startedAt), desc(audits.id))
      .limit(1);
    if (!a) return null;
    return {
      id: a.id,
      status: a.status,
      result: a.result,
      percent: (a.score as AuditScore | null)?.percent ?? null,
      paused: a.status === 'in_progress' && isAuditPaused(occurrenceStatus),
    };
  }
```

- [ ] **Step 4: Fill the detail and the problem fields**

`apps/api/src/executions/execution-queries.ts` becomes:

```ts
import { Injectable } from '@nestjs/common';
import type { ExecutionCorrections, ExecutionDetail, ScoreResult } from '@taskop/contracts';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklistVersions, executionMedia, executionProblems, executions, occurrences, tasks, users } from '../db/schema';
import { toOccurrenceDto } from '../scheduling/mappers';
import { OccurrenceQueries } from '../scheduling/occurrence-queries';
import { AuditLookup } from './audit-lookup';
import { CorrectionHistory } from './correction-history';
import { ExecutionAccess } from './execution-access';
import { ExecutionLookups } from './execution-lookups';
import { asDevice, executionSummaryColumns, type ExecutionSummaryRow, toExecutionSummary, toMediaDto, toProblemEntry } from './mappers';
import { ReworkRequests } from './rework-requests';

/** GET /executions/:id (spec §6.8) and its correction history (SP8 spec §6.2). */
@Injectable()
export class ExecutionQueries {
  constructor(
    private readonly db: DbService,
    private readonly access: ExecutionAccess,
    private readonly occurrenceQueries: OccurrenceQueries,
    private readonly lookups: ExecutionLookups,
    private readonly requests: ReworkRequests,
    private readonly audits: AuditLookup,
    private readonly history: CorrectionHistory,
  ) {}

  async detail(p: Principal, id: string): Promise<ExecutionDetail> {
    const row = await this.summaryRow(id);
    await this.access.assertCanRead(p, row.x.executorUserId, row.x.occurrenceId);
    return this.build(row);
  }

  /** For callers that checked access themselves (the audits module, SP8 spec §6.1). */
  async load(id: string): Promise<ExecutionDetail> {
    return this.build(await this.summaryRow(id));
  }

  async corrections(p: Principal, id: string): Promise<ExecutionCorrections> {
    const row = await this.summaryRow(id);
    await this.access.assertCanRead(p, row.x.executorUserId, row.x.occurrenceId);
    return this.history.of(id);
  }

  private async summaryRow(id: string): Promise<ExecutionSummaryRow> {
    const [row] = await this.db.tx().select(executionSummaryColumns).from(executions).innerJoin(users, eq(users.id, executions.executorUserId)).where(eq(executions.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  private async build(row: ExecutionSummaryRow): Promise<ExecutionDetail> {
    const tx = this.db.tx();
    const id = row.x.id;
    const [occurrence] = await this.occurrenceQueries.select().where(eq(occurrences.id, row.x.occurrenceId));
    const [version] = await tx.select({ number: checklistVersions.number }).from(checklistVersions).where(eq(checklistVersions.id, row.x.checklistVersionId));
    const media = await tx
      .select({ m: getTableColumns(executionMedia), capturedByName: users.fullName })
      .from(executionMedia)
      .innerJoin(users, eq(users.id, executionMedia.capturedByUserId))
      .where(eq(executionMedia.executionId, id))
      .orderBy(asc(executionMedia.capturedAt), asc(executionMedia.id));
    const problems = await tx
      .select({ p: getTableColumns(executionProblems), taskId: tasks.id, taskStatus: tasks.status })
      .from(executionProblems)
      .leftJoin(tasks, eq(tasks.problemId, executionProblems.id))
      .where(eq(executionProblems.executionId, id))
      .orderBy(asc(executionProblems.createdAt), asc(executionProblems.id));
    return {
      ...toExecutionSummary(row),
      occurrence: toOccurrenceDto(occurrence!),
      checklistVersionId: row.x.checklistVersionId,
      versionNumber: version!.number!,
      content: await this.lookups.content(row.x.checklistVersionId),
      answers: row.x.answers as ExecutionDetail['answers'],
      answersRev: row.x.answersRev,
      score: (row.x.score as ScoreResult | null) ?? null,
      clockOffsetMs: row.x.clockOffsetMs,
      device: asDevice(row.x.device),
      lastSyncedAt: row.x.lastSyncedAt.toISOString(),
      media: media.map(toMediaDto),
      // Every problem, cleared ones included, each with clearedAt (Spec decision 18).
      problems: problems.map((r) => toProblemEntry(r.p, r.taskId, r.taskStatus)),
      reworkRound: row.x.reworkRound,
      rework: (await this.requests.openByExecution([id])).get(id) ?? null,
      corrected: row.x.originalCapturedAt !== null,
      audit: await this.audits.brief(id, occurrence!.o.status),
    };
  }
}
```

`apps/api/src/executions/mappers.ts`:
- `problemCountSql` becomes

```ts
/** Active problems only: a correction's cleared problems no longer count (SP8 spec §4.1). */
export const problemCountSql = sql<number>`(select count(*)::int from execution_problems pr where pr.execution_id = "executions"."id" and pr.cleared_at is null)`;
```

- in `toProblemEntry`, the Task 2 placeholder `clearedAt: null,` becomes `clearedAt: p.clearedAt?.toISOString() ?? null,`.

`apps/api/src/executions/problem-rows.ts`, in `toProblemDtos`, the placeholder `clearedAt: null,` becomes `clearedAt: r.pr.clearedAt?.toISOString() ?? null,`.

`apps/api/src/executions/problems.service.ts`: add `isNull` to the drizzle import and, after the `resolution` condition, add

```ts
    // Cleared by a correction (SP8 spec §8.3): hidden unless asked for.
    if (!q.includeCleared) conds.push(isNull(executionProblems.clearedAt));
```

`apps/api/src/executions/execution-access.ts`, `assertCanRead` becomes:

```ts
  /**
   * The executor, or a holder of assignments.view, reports.view (SP7 spec §5.6), audits.perform or executions.correct
   * (SP8 spec §5) whose data scope covers the occurrence; anyone else gets 404.
   */
  async assertCanRead(p: Principal, executorUserId: string, occurrenceId: string): Promise<void> {
    if (p.userId === executorUserId) return;
    if (READ_KEYS.some((k) => p.permissions.has(k))) {
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

with, above the class:

```ts
const READ_KEYS = ['assignments.view', 'reports.view', 'audits.perform', 'executions.correct'] as const satisfies readonly PermissionKey[];
```

and `import type { PermissionKey } from '@taskop/contracts';`.

`apps/api/src/executions/dto.ts`: add `executionCorrectionsSchema` to the import and `export class ExecutionCorrectionsResponse extends createZodDto(executionCorrectionsSchema) {}`.

`apps/api/src/executions/executions.controller.ts`: add `ExecutionCorrections` to the type import and `ExecutionCorrectionsResponse` to the `./dto` import, then after `get` add:

```ts
  /** NFR-07.05: the original, the corrections, the rework rounds and the diff; for anyone who can read the run. */
  @Get(':id/corrections')
  @ApiOkResponse({ type: ExecutionCorrectionsResponse })
  corrections(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<ExecutionCorrections> {
    return this.queries.corrections(p, id);
  }
```

`apps/api/src/executions/executions.module.ts`: add `CorrectionHistory` (from `./correction-history`) to `providers`, and add `exports: [ExecutionQueries, CorrectionHistory, ExecutionLookups, AuditLookup],` (the audits module reuses them in Task 12).

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- corrections-read executions-read executions-scope reports-run-access tasks-problems problems-resolution`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/executions apps/api/test/corrections-read.test.ts
git commit -m "feat(api): read the correction history, the rework and audit state of a run, and cleared problems" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Checklist audit settings, and `audit_pending` on completion

**Files:**
- Modify: `apps/api/src/checklists/checklists.service.ts`, `apps/api/src/scheduling/occurrence-writer.ts`, `apps/api/src/executions/executions.service.ts`
- Test: `apps/api/test/audit-required.test.ts`

**Interfaces:**
- Consumes: `checklists.requires_audit` / `audit_report_emails` (Task 5); `updateChecklistInputSchema` (Task 2); `AuditLookup.requiresAudit` (Task 8).
- Produces:
  - `GET /checklists/:id` returns `requiresAudit` and `auditReportEmails`; `PATCH /checklists/:id` (`checklists.manage`) takes them, and the `checklist.updated` audit entry carries them (spec §4.1). The platform in-tenant route `/platform/tenants/:tenantId/checklists/:id` shares the service, so it does the same (tested).
  - `Transition` (`occurrence-writer.ts`) gains `system?: boolean`: that history row has no actor.
  - `ExecutionsService.complete`: a completion inside the window of a checklist that requires audit records `… → completed` (the worker) and `completed → audit_pending` (the system) in one transaction (Spec decision 10). `partial` never enters audit.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/audit-required.test.ts`:

```ts
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { auditLogOf, auditWorld } from './audit-fixtures';
import { claimOk, completeExecution, executionWorld, fullAnswers, historyOf, registerPhoto, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, uniq } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

const DONE = '2026-11-02T04:20:00.000Z';

describe('audit settings and the audit queue on completion (spec §3.1, §4.1)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('stores the audit settings on the checklist, lower-cased and de-duplicated, as a checklist.updated entry', async () => {
    const w = await executionWorld(t);
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    const res = await manager.api.patch(`/api/v1/checklists/${w.checklistId}`, { requiresAudit: true, auditReportEmails: ['QA@Acme.az', 'qa@acme.az', 'boss@acme.az'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ requiresAudit: true, auditReportEmails: ['qa@acme.az', 'boss@acme.az'] });
    expect((await w.owner.get(`/api/v1/checklists/${w.checklistId}`)).body).toMatchObject({ requiresAudit: true, auditReportEmails: ['qa@acme.az', 'boss@acme.az'] });
    expect((await auditLogOf(w.checklistId)).at(-1)).toMatchObject({
      action: 'checklist.updated',
      before: { requiresAudit: false, auditReportEmails: [] },
      after: { requiresAudit: true, auditReportEmails: ['qa@acme.az', 'boss@acme.az'] },
    });
    // A name-only change keeps the settings.
    expect((await manager.api.patch(`/api/v1/checklists/${w.checklistId}`, { name: 'Yeni ad' })).body).toMatchObject({ name: 'Yeni ad', requiresAudit: true });
  });

  it('reads and writes the settings on the platform in-tenant route too', async () => {
    const w = await executionWorld(t);
    const email = `${uniq('admin')}@taskop.az`;
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    const platform = as(t, (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken);
    const base = `/api/v1/platform/tenants/${w.s.tenantId}/checklists/${w.checklistId}`;
    const res = await platform.patch(base, { requiresAudit: true, auditReportEmails: ['qa@acme.az'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await platform.get(base)).body).toMatchObject({ requiresAudit: true, auditReportEmails: ['qa@acme.az'] });
    expect((await auditLogOf(w.checklistId)).at(-1)).toMatchObject({ action: 'checklist.updated', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
  });

  it('refuses more than ten addresses and invalid ones', async () => {
    const w = await executionWorld(t);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@acme.az`);
    const many = await w.owner.patch(`/api/v1/checklists/${w.checklistId}`, { auditReportEmails: eleven });
    expect([many.status, many.body.error.fields]).toEqual([400, { auditReportEmails: 'audits.issues.tooManyEmails' }]);
    const bad = await w.owner.patch(`/api/v1/checklists/${w.checklistId}`, { auditReportEmails: ['not-an-address'] });
    expect([bad.status, bad.body.error.fields]).toEqual([400, { 'auditReportEmails.0': 'errors.validation.email' }]);
    expect((await w.workers[0].api.patch(`/api/v1/checklists/${w.checklistId}`, { requiresAudit: true })).status).toBe(403);
  });

  it('moves a completed run to audit_pending in the same transaction, the second step by the system', async () => {
    const a = await auditWorld(t, clock, { requiresAudit: true });
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
    expect((await historyOf(a.w.occurrenceId)).slice(-2)).toEqual([
      ['started', 'completed', DONE, null, a.worker.id],
      ['completed', 'audit_pending', DONE, null, null],
    ]);
    const occurrence = (await a.manager.api.get(`/api/v1/occurrences/${a.w.occurrenceId}`)).body;
    expect(occurrence.execution.state).toBe('completed');
  });

  it('leaves runs of a checklist without the flag completed', async () => {
    const a = await auditWorld(t, clock);
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
  });

  it('never sends a partial run to audit', async () => {
    const w = await executionWorld(t);
    await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:01:00Z');
    expect((await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T07:00:00.000Z')).body.state).toBe('partial');
    expect(await statusOf(w.occurrenceId)).toBe('partial');
  });

  it('sends a swept partial run revived by a late completion to audit as well', async () => {
    const w = await executionWorld(t);
    await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    clock.set('2026-11-02T07:30:00Z');
    expect((await completeExecution(api, executionId, 1, fullAnswers(w, photo), '2026-11-02T06:50:00.000Z')).body.state).toBe('completed');
    expect((await historyOf(w.occurrenceId)).slice(-2).map((h) => [h[0], h[1], h[3], h[4]])).toEqual([
      ['partial', 'completed', 'late_sync', w.workers[0].id],
      ['completed', 'audit_pending', null, null],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- audit-required`
Expected: FAIL: the PATCH answers `requiresAudit: false` (the field is dropped) and the run stays `completed`.

- [ ] **Step 3: Store and return the settings**

`apps/api/src/checklists/checklists.service.ts`:
- in `get`, the Task 2 placeholders `requiresAudit: false, auditReportEmails: [],` become

```ts
      requiresAudit: row.requiresAudit,
      auditReportEmails: row.auditReportEmails,
```

- `update` becomes

```ts
  async update(id: string, input: UpdateChecklistDto): Promise<ChecklistDetail> {
    const c = await this.lockActive(id);
    const before = { name: c.name, description: c.description, category: c.category, requiresAudit: c.requiresAudit, auditReportEmails: c.auditReportEmails };
    await this.db
      .tx()
      .update(checklists)
      .set({
        name: input.name,
        description: input.description,
        category: input.category,
        // SP8 spec §4.1: settings, not versioned content; undefined leaves them as they are.
        requiresAudit: input.requiresAudit,
        auditReportEmails: input.auditReportEmails,
        updatedAt: new Date(),
      })
      .where(eq(checklists.id, id));
    const after = await this.get(id);
    await this.audit.record({
      action: 'checklist.updated',
      entityType: 'checklist',
      entityId: id,
      before,
      after: { name: after.name, description: after.description, category: after.category, requiresAudit: after.requiresAudit, auditReportEmails: after.auditReportEmails },
    });
    return after;
  }
```

- [ ] **Step 4: Record system steps and enter the audit queue on completion**

`apps/api/src/scheduling/occurrence-writer.ts`:
- `Transition` becomes

```ts
export interface Transition {
  occurrenceId: string;
  from: OccurrenceStatus | null;
  to: OccurrenceStatus;
  at: Date;
  reason?: string | null;
  /** A step the system takes on its own inside a user's command (SP8: completed → audit_pending): recorded with no actor. */
  system?: boolean;
}
```

- in `recordTransitions`, the two actor columns become

```ts
          actorUserId: r.system ? null : actor.userId,
          actorPlatformAdminId: r.system ? null : actor.platformAdminId,
```

`apps/api/src/executions/executions.service.ts`:
- add `import { AuditLookup } from './audit-lookup';` and `type Transition` to the `../scheduling/occurrence-writer` import;
- add `private readonly auditLookup: AuditLookup,` as the last constructor parameter;
- in `complete`, the `if (inWindow) { … }` block becomes

```ts
    if (inWindow) {
      const steps: Transition[] = [{ occurrenceId: o.id, from: o.status, to: 'completed', at: completedAt, reason: o.status === 'partial' ? 'late_sync' : null }];
      // SP8 Spec decision 10: a checklist that requires audit puts the run in the audit queue in the same transaction.
      if (await this.auditLookup.requiresAudit(o.checklistId)) steps.push({ occurrenceId: o.id, from: 'completed', to: 'audit_pending', at: completedAt, system: true });
      await this.writer.applyTransitions(steps);
    } else if (o.status !== 'partial') {
```

(the `else if` branch stays as it is).

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audit-required checklists occurrence-writer executions-complete executions-sweep notification-events`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/checklists/checklists.service.ts apps/api/src/scheduling/occurrence-writer.ts apps/api/src/executions/executions.service.ts apps/api/test/audit-required.test.ts
git commit -m "feat(api): checklist audit settings, and completed runs that require audit enter the audit queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The audits module I: start, read, verdicts and cancel

**Files:**
- Create: `apps/api/src/audits/audits.module.ts`, `apps/api/src/audits/audits.service.ts`, `apps/api/src/audits/audits.controller.ts`, `apps/api/src/audits/audit-rows.ts`, `apps/api/src/audits/dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/audits.test.ts`

**Interfaces:**
- Consumes: `lockRun`, `type LockedRun` (Task 7); `ExecutionQueries.load`, `CorrectionHistory.of`, `ExecutionLookups.content`, `findItem`, `AuditLookup.requiresAudit` (exported by `ExecutionsModule`, Task 10); `canStartAudit`, `auditableItemIds`, `statusAfterAuditCancel`, `isAuditPaused` (contracts); `OccurrenceWriter.applyTransitions`, `SchedulingScope.occurrences`, `AuditService.record`, `actorColumns`, `permAny`, `perm`, `controllerDecorators`, `named`.
- Produces:
  - `AuditsService`: `start(a: Actor, executionId: string): Promise<AuditDto>`, `get(a: Actor, auditId: string): Promise<AuditDetail>`, `setVerdict(a: Actor, auditId: string, itemId: string, input: AuditVerdictParams): Promise<AuditItemVerdict>`, `clearVerdict(a: Actor, auditId: string, itemId: string): Promise<void>`, `cancel(a: Actor, auditId: string, input: { reason: string }): Promise<AuditDto>`, and the private helpers `lockAudit(a, auditId)` and `dto(auditId)` that Task 13 reuses.
  - `audit-rows.ts`: `type AuditRow`, `auditorOf(userId: string | null, name: string | null): AuditActor`, `toAuditDto(row: AuditRow, auditorName: string | null, occurrenceStatus: OccurrenceStatus, verdicts: AuditItemVerdict[]): AuditDto`.
  - Routes (tenant and `/platform/tenants/:tenantId/…`): `POST /executions/:id/audits` (201, `audits.perform`), `GET /audits/:id` (`audits.perform` or `reports.view`), `PUT /audits/:id/items/:itemId` and `DELETE /audits/:id/items/:itemId` (204) (`audits.perform`), `POST /audits/:id/cancel` (`audits.perform`).
  - `AuditsModule` (imports `PlatformModule`, `SchedulingModule`, `ExecutionsModule`; nothing imports it), registered in `AppModule`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/audits.test.ts`:

```ts
import { auditScore, type AuditVerdict, missingVerdicts } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, sendBack, startAudit } from './audit-fixtures';
import { historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';

describe('audits: start, read, verdicts, cancel (spec §3.1, §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (opts: { requiresAudit?: boolean; problemYes?: boolean } = {}): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    return a;
  };
  const started = async (a: AuditWorld): Promise<string> => {
    const res = await startAudit(a.auditor.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  const verdict = (api: Api, auditId: string, itemId: string, body: object) => api.put(`/api/v1/audits/${auditId}/items/${itemId}`, body);
  const detail = async (api: Api, auditId: string) => (await api.get(`/api/v1/audits/${auditId}`)).body;

  it('starts an audit on a completed run: audit_pending by the auditor, and an audit entry', async () => {
    const a = await world();
    const res = await startAudit(a.auditor.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String), executionId: a.executionId, occurrenceId: a.w.occurrenceId, status: 'in_progress', paused: false,
      auditor: { kind: 'user', id: a.auditor.id, name: 'Auditor' }, startedAt: AT, finishedAt: null, cancelledAt: null, cancelReason: null,
      result: null, score: null, comment: null, reportStatus: 'none', reportRecipients: [], reportSentAt: null, verdicts: [],
    });
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['completed', 'audit_pending', AT, null, a.auditor.id]);
    expect((await auditLogOf(res.body.id)).map((l) => [l.action, l.entity_type, l.actor_user_id])).toEqual([['audit.started', 'audit', a.auditor.id]]);
  });

  it('starts on a run already waiting without a status change', async () => {
    const a = await world({ requiresAudit: true });
    const before = (await historyOf(a.w.occurrenceId)).length;
    await started(a);
    expect(await statusOf(a.w.occurrenceId)).toBe('audit_pending');
    expect(await historyOf(a.w.occurrenceId)).toHaveLength(before);
  });

  it('refuses a second audit with its id, an audited run and a partial run', async () => {
    const a = await world();
    const auditId = await started(a);
    const again = await startAudit(a.auditor.api, a.executionId);
    expect([again.status, again.body.error.code, again.body.error.auditId]).toEqual([409, 'AUDIT_EXISTS', auditId]);
    await ownerQuery("update occurrences set status = 'audited' where id = $1", [a.w.occurrenceId]);
    expect((await startAudit(a.auditor.api, a.executionId)).body.error.code).toBe('EXECUTION_LOCKED');
    const p = await world();
    await ownerQuery("update occurrences set status = 'partial' where id = $1", [p.w.occurrenceId]);
    await ownerQuery("update executions set state = 'partial' where id = $1", [p.executionId]);
    expect((await startAudit(p.auditor.api, p.executionId)).body.error.code).toBe('EXECUTION_NOT_CORRECTABLE');
  });

  it('shows the audit with its run, history and auditable items to auditors and report viewers in scope', async () => {
    const a = await world();
    const auditId = await started(a);
    const body = await detail(a.auditor.api, auditId);
    expect(body).toMatchObject({
      id: auditId,
      execution: { id: a.executionId, answers: a.answers, audit: { id: auditId, status: 'in_progress', paused: false } },
      corrections: { original: null, corrections: [], reworkRequests: [], diff: [] },
      // "Xeyr" hides the follow-up comment.
      auditableItemIds: [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id],
      checklistReportEmails: [],
      requiresAudit: false,
    });
    expect((await a.manager.api.get(`/api/v1/audits/${auditId}`)).status).toBe(200);
    expect((await a.outsider.api.get(`/api/v1/audits/${auditId}`)).status).toBe(404);
    expect((await a.worker.api.get(`/api/v1/audits/${auditId}`)).status).toBe(403);
  });

  it('records verdicts: approve, reject with a comment, change and clear, without audit-log entries', async () => {
    const a = await world();
    const auditId = await started(a);
    const ok = await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'approved' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ itemId: a.w.c.temp.id, verdict: 'approved', comment: null, updatedBy: { id: a.auditor.id, fullName: 'Auditor' }, updatedAt: AT });
    const noComment = await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'rejected' });
    expect([noComment.status, noComment.body.error.fields]).toEqual([400, { comment: 'audits.issues.commentRequired' }]);
    expect((await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'rejected', comment: 'Temperatur yüksəkdir' })).body).toMatchObject({ verdict: 'rejected', comment: 'Temperatur yüksəkdir' });
    await verdict(a.auditor.api, auditId, a.w.c.photo.id, { verdict: 'approved' });
    expect((await detail(a.auditor.api, auditId)).verdicts.map((v: { itemId: string; verdict: string }) => [v.itemId, v.verdict])).toEqual(
      expect.arrayContaining([[a.w.c.temp.id, 'rejected'], [a.w.c.photo.id, 'approved']]),
    );
    expect((await a.auditor.api.delete(`/api/v1/audits/${auditId}/items/${a.w.c.photo.id}`)).status).toBe(204);
    expect((await detail(a.auditor.api, auditId)).verdicts.map((v: { itemId: string }) => v.itemId)).toEqual([a.w.c.temp.id]);
    expect((await auditLogOf(auditId)).map((l) => l.action)).toEqual(['audit.started']);
  });

  it('refuses verdicts on unknown and hidden items, and from report viewers', async () => {
    const a = await world();
    const auditId = await started(a);
    expect((await verdict(a.auditor.api, auditId, '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', { verdict: 'approved' })).status).toBe(404);
    const hidden = await verdict(a.auditor.api, auditId, a.w.c.comment.id, { verdict: 'approved' });
    expect([hidden.status, hidden.body.error.fields]).toEqual([400, { itemId: 'audits.issues.notAuditable' }]);
    expect((await verdict(a.manager.api, auditId, a.w.c.temp.id, { verdict: 'approved' })).status).toBe(403);
  });

  it('ignores verdicts on items the current answers hide', async () => {
    const a = await world({ problemYes: true });
    const auditId = await started(a);
    expect((await detail(a.auditor.api, auditId)).auditableItemIds).toContain(a.w.c.comment.id);
    await verdict(a.auditor.api, auditId, a.w.c.comment.id, { verdict: 'rejected', comment: 'Təsvir natamamdır' });
    // A manager corrects "Bəli" to "Xeyr": the follow-up comment is hidden, its answer and verdict stay.
    const fix = await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.problem.id, answer: { optionIds: [a.w.c.no.id], photos: [] } }], reason: 'Problem yox idi' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    for (const itemId of [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id]) await verdict(a.auditor.api, auditId, itemId, { verdict: 'approved' });
    const body = await detail(a.auditor.api, auditId);
    expect(body.auditableItemIds).not.toContain(a.w.c.comment.id);
    expect(body.verdicts.map((v: { itemId: string }) => v.itemId)).toContain(a.w.c.comment.id);
    const verdicts = new Map<string, AuditVerdict>(body.verdicts.map((v: { itemId: string; verdict: AuditVerdict }) => [v.itemId, v.verdict]));
    expect(missingVerdicts(verdicts, body.auditableItemIds)).toEqual([]);
    expect(auditScore(verdicts, body.auditableItemIds)).toEqual({ approved: 4, rejected: 0, reviewed: 4, percent: 100 });
    // A verdict can no longer be set on the hidden item.
    expect((await verdict(a.auditor.api, auditId, a.w.c.comment.id, { verdict: 'approved' })).body.error.fields).toEqual({ itemId: 'audits.issues.notAuditable' });
  });

  it('cancels: back to completed, or still waiting when the checklist requires audit; a second cancel is refused', async () => {
    const a = await world();
    const auditId = await started(a);
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'Səhv icra seçildi' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledAt: AT, cancelReason: 'Səhv icra seçildi' });
    expect(await statusOf(a.w.occurrenceId)).toBe('completed');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['audit_pending', 'completed', AT, 'Səhv icra seçildi', a.auditor.id]);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' })).body.error.code).toBe('AUDIT_NOT_IN_PROGRESS');
    expect((await verdict(a.auditor.api, auditId, a.w.c.temp.id, { verdict: 'approved' })).body.error.code).toBe('AUDIT_NOT_IN_PROGRESS');
    expect((await auditLogOf(auditId)).map((l) => [l.action, l.after])).toEqual([
      ['audit.started', { executionId: a.executionId, occurrenceId: a.w.occurrenceId }],
      ['audit.cancelled', { reason: 'Səhv icra seçildi', status: 'completed' }],
    ]);
    // A new audit can start after a cancelled one.
    expect((await startAudit(a.auditor.api, a.executionId)).status).toBe(201);
    const required = await world({ requiresAudit: true });
    const requiredAudit = await started(required);
    await required.auditor.api.post(`/api/v1/audits/${requiredAudit}/cancel`, { reason: 'Sonra' });
    expect(await statusOf(required.w.occurrenceId)).toBe('audit_pending');
  });

  it('pauses while the run is sent back: verdicts still change, cancel leaves the status for the resubmit', async () => {
    const a = await world();
    const auditId = await started(a);
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    expect(await detail(a.auditor.api, auditId)).toMatchObject({ status: 'in_progress', paused: true });
    expect((await verdict(a.auditor.api, auditId, a.w.c.photo.id, { verdict: 'approved' })).status).toBe(200);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'Gözləmirik' })).status).toBe(200);
    expect(await statusOf(a.w.occurrenceId)).toBe('correction_required');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- audits.test`
Expected: FAIL: `POST /executions/:id/audits` answers 404.

- [ ] **Step 3: Write the row mapping and the service**

`apps/api/src/audits/audit-rows.ts`:

```ts
import { type AuditActor, type AuditDto, type AuditItemVerdict, type AuditScore, isAuditPaused, type OccurrenceStatus } from '@taskop/contracts';
import type { audits } from '../db/schema';

export type AuditRow = typeof audits.$inferSelect;

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

/** A user auditor, or a platform admin (Spec decision 17). */
export const auditorOf = (userId: string | null, name: string | null): AuditActor => (userId ? { kind: 'user', id: userId, name } : { kind: 'platform', id: null, name: null });

export function toAuditDto(r: AuditRow, auditorName: string | null, occurrenceStatus: OccurrenceStatus, verdicts: AuditItemVerdict[]): AuditDto {
  return {
    id: r.id,
    executionId: r.executionId,
    occurrenceId: r.occurrenceId,
    status: r.status,
    paused: r.status === 'in_progress' && isAuditPaused(occurrenceStatus),
    auditor: auditorOf(r.auditorUserId, auditorName),
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    cancelledAt: iso(r.cancelledAt),
    cancelReason: r.cancelReason,
    result: r.result,
    score: (r.auditScore as AuditScore | null) ?? null,
    comment: r.comment,
    reportStatus: r.reportStatus,
    reportRecipients: r.reportRecipients,
    reportSentAt: iso(r.reportSentAt),
    verdicts,
  };
}
```

`apps/api/src/audits/audits.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  type Answers,
  auditableItemIds,
  type AuditDetail,
  type AuditDto,
  type AuditItemVerdict,
  type AuditVerdictParams,
  canStartAudit,
  statusAfterAuditCancel,
} from '@taskop/contracts';
import { and, asc, eq, getTableColumns, inArray, ne } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { auditItemVerdicts, audits, checklists, occurrences, users } from '../db/schema';
import { AuditLookup } from '../executions/audit-lookup';
import { CorrectionHistory } from '../executions/correction-history';
import { ExecutionLookups, findItem } from '../executions/execution-lookups';
import { ExecutionQueries } from '../executions/execution-queries';
import { type LockedRun, lockRun } from '../executions/run-locks';
import type { Actor } from '../scheduling/actor';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { type AuditRow, toAuditDto } from './audit-rows';

/** SP8 spec §6.2: formal audits of completed runs. Runs in the request's tenant transaction. */
@Injectable()
export class AuditsService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly writer: OccurrenceWriter,
    private readonly audit: AuditService,
    private readonly executionQueries: ExecutionQueries,
    private readonly history: CorrectionHistory,
    private readonly lookups: ExecutionLookups,
    private readonly auditLookup: AuditLookup,
  ) {}

  /**
   * Starts an audit (spec §6.2). An audited run is locked; an existing non-cancelled audit is AUDIT_EXISTS with its id;
   * otherwise canStartAudit decides. completed → audit_pending with the auditor as actor (Spec decision 11).
   */
  async start(a: Actor, executionId: string): Promise<AuditDto> {
    const now = this.clock.now();
    const { e, o } = await lockRun(this.db, this.scope.occurrences(a), executionId);
    if (o.status === 'audited') throw new AppError('EXECUTION_LOCKED');
    const tx = this.db.tx();
    const [existing] = await tx.select({ id: audits.id }).from(audits).where(and(eq(audits.executionId, e.id), ne(audits.status, 'cancelled')));
    if (existing) throw new AppError('AUDIT_EXISTS', { details: { auditId: existing.id } });
    if (!canStartAudit({ status: o.status, executionState: e.state }, false)) throw new AppError('EXECUTION_NOT_CORRECTABLE');
    const actor = actorColumns(this.db);
    const [row] = await tx
      .insert(audits)
      .values({
        tenantId: e.tenantId,
        executionId: e.id,
        occurrenceId: o.id,
        auditorUserId: actor.userId,
        auditorPlatformAdminId: actor.platformAdminId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: audits.id });
    if (o.status === 'completed') await this.writer.applyTransitions([{ occurrenceId: o.id, from: 'completed', to: 'audit_pending', at: now }]);
    await this.audit.record({ action: 'audit.started', entityType: 'audit', entityId: row!.id, after: { executionId: e.id, occurrenceId: o.id } });
    return this.dto(row!.id);
  }

  /** The audit screen (spec §8.3): the audit, the run's detail, its correction history and the auditable items. */
  async get(a: Actor, auditId: string): Promise<AuditDetail> {
    const row = await this.readable(a, auditId);
    const execution = await this.executionQueries.load(row.executionId);
    const [checklist] = await this.db
      .tx()
      .select({ requiresAudit: checklists.requiresAudit, auditReportEmails: checklists.auditReportEmails })
      .from(checklists)
      .where(eq(checklists.id, execution.occurrence.checklistId));
    return {
      ...(await this.dto(auditId)),
      execution,
      corrections: await this.history.of(row.executionId),
      auditableItemIds: auditableItemIds(execution.content, execution.answers as Answers),
      checklistReportEmails: checklist!.auditReportEmails,
      requiresAudit: checklist!.requiresAudit,
    };
  }

  /** FR-19.04–05. Paused audits take verdicts too; the item must be auditable now (Spec decision 1). Not audit-logged. */
  async setVerdict(a: Actor, auditId: string, itemId: string, input: AuditVerdictParams): Promise<AuditItemVerdict> {
    const now = this.clock.now();
    const { audit, e } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    const content = await this.lookups.content(e.checklistVersionId);
    if (!findItem(content, itemId)) throw new AppError('NOT_FOUND');
    if (!auditableItemIds(content, e.answers as Answers).includes(itemId)) throw new AppError('VALIDATION_FAILED', { fields: { itemId: 'audits.issues.notAuditable' } });
    const actor = actorColumns(this.db);
    const comment = input.comment ? input.comment : null;
    const [row] = await this.db
      .tx()
      .insert(auditItemVerdicts)
      .values({ tenantId: audit.tenantId, auditId, itemId, verdict: input.verdict, comment, updatedByUserId: actor.userId, updatedAt: now })
      .onConflictDoUpdate({ target: [auditItemVerdicts.auditId, auditItemVerdicts.itemId], set: { verdict: input.verdict, comment, updatedByUserId: actor.userId, updatedAt: now } })
      .returning();
    return (await this.verdictDtos([row!]))[0]!;
  }

  async clearVerdict(a: Actor, auditId: string, itemId: string): Promise<void> {
    const { audit } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    await this.db
      .tx()
      .delete(auditItemVerdicts)
      .where(and(eq(auditItemVerdicts.auditId, auditId), eq(auditItemVerdicts.itemId, itemId)));
  }

  /** Spec §3.1, Spec decision 12: back to completed, or audit_pending when required; a sent-back run keeps its status. */
  async cancel(a: Actor, auditId: string, input: { reason: string }): Promise<AuditDto> {
    const now = this.clock.now();
    const { audit, o } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    await this.db.tx().update(audits).set({ status: 'cancelled', cancelledAt: now, cancelReason: input.reason, updatedAt: now }).where(eq(audits.id, auditId));
    const next = statusAfterAuditCancel(await this.auditLookup.requiresAudit(o.checklistId), o.status);
    if (next !== o.status) await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: next, at: now, reason: input.reason }]);
    await this.audit.record({ action: 'audit.cancelled', entityType: 'audit', entityId: auditId, after: { reason: input.reason, status: next } });
    return this.dto(auditId);
  }

  /** The audit and its run, locked in the order of every run command: occurrence, execution, then the audit row. */
  private async lockAudit(a: Actor, auditId: string): Promise<{ audit: AuditRow } & LockedRun> {
    const tx = this.db.tx();
    const [peek] = await tx.select({ executionId: audits.executionId }).from(audits).where(eq(audits.id, auditId));
    if (!peek) throw new AppError('NOT_FOUND');
    const run = await lockRun(this.db, this.scope.occurrences(a), peek.executionId);
    const [audit] = await tx.select().from(audits).where(eq(audits.id, auditId)).for('update');
    return { audit: audit!, ...run };
  }

  /** The audit when its run lies in the actor's data scope; 404 otherwise. */
  private async readable(a: Actor, auditId: string): Promise<AuditRow> {
    const [row] = await this.db
      .tx()
      .select({ a: getTableColumns(audits) })
      .from(audits)
      .innerJoin(occurrences, eq(occurrences.id, audits.occurrenceId))
      .where(and(eq(audits.id, auditId), this.scope.occurrences(a)));
    if (!row) throw new AppError('NOT_FOUND');
    return row.a;
  }

  private async dto(auditId: string): Promise<AuditDto> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ a: getTableColumns(audits), auditorName: users.fullName, status: occurrences.status })
      .from(audits)
      .innerJoin(occurrences, eq(occurrences.id, audits.occurrenceId))
      .leftJoin(users, eq(users.id, audits.auditorUserId))
      .where(eq(audits.id, auditId));
    const verdicts = await tx.select().from(auditItemVerdicts).where(eq(auditItemVerdicts.auditId, auditId)).orderBy(asc(auditItemVerdicts.updatedAt), asc(auditItemVerdicts.itemId));
    return toAuditDto(row!.a, row!.auditorName, row!.status, await this.verdictDtos(verdicts));
  }

  private async verdictDtos(rows: (typeof auditItemVerdicts.$inferSelect)[]): Promise<AuditItemVerdict[]> {
    const ids = [...new Set(rows.map((r) => r.updatedByUserId).filter((id): id is string => id !== null))];
    const names = ids.length ? await this.db.tx().select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    return rows.map((r) => {
      const by = names.find((n) => n.id === r.updatedByUserId);
      return { itemId: r.itemId, verdict: r.verdict, comment: r.comment, updatedBy: by ? { id: by.id, fullName: by.fullName } : null, updatedAt: r.updatedAt.toISOString() };
    });
  }
}
```

- [ ] **Step 4: Write the controllers, DTOs and module**

`apps/api/src/audits/dto.ts`:

```ts
import {
  auditDetailSchema,
  auditDtoSchema,
  auditItemVerdictSchema,
  auditQueuePageSchema,
  auditQueueQuerySchema,
  auditVerdictInputSchema,
  cancelAuditInputSchema,
  finishAuditInputSchema,
  sendAuditReportInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class AuditDtoResponse extends createZodDto(auditDtoSchema) {}
export class AuditDetailResponse extends createZodDto(auditDetailSchema) {}
export class AuditItemVerdictResponse extends createZodDto(auditItemVerdictSchema) {}
export class AuditVerdictDto extends createZodDto(auditVerdictInputSchema) {}
export class CancelAuditDto extends createZodDto(cancelAuditInputSchema) {}
export class FinishAuditDto extends createZodDto(finishAuditInputSchema) {}
export class AuditQueueQueryDto extends createZodDto(auditQueueQuerySchema) {}
export class AuditQueuePageResponse extends createZodDto(auditQueuePageSchema) {}
export class SendAuditReportDto extends createZodDto(sendAuditReportInputSchema) {}
```

`apps/api/src/audits/audits.controller.ts`:

```ts
import { Body, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import type { AuditDetail, AuditDto, AuditItemVerdict } from '@taskop/contracts';
import { controllerDecorators, named, perm, permAny, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from '../scheduling/actor';
import { AuditsService } from './audits.service';
import { AuditDetailResponse, AuditDtoResponse, AuditItemVerdictResponse, AuditVerdictDto, CancelAuditDto } from './dto';

/** /audits (SP8 spec §6.2), for tenant users and platform admins (Spec decision 24). */
export function auditsControllerFor(mode: RouteMode) {
  const perform = perm(mode, 'audits.perform');
  // Managers see audit outcomes through reports.view (spec §5).
  const performOrReports = permAny(mode, 'audits.perform', 'reports.view');

  @controllerDecorators(mode, 'audits', 'audits')
  class AuditsController {
    constructor(@Inject(AuditsService) private readonly audits: AuditsService) {}

    @Get(':id')
    @performOrReports
    @ApiOkResponse({ type: AuditDetailResponse })
    get(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AuditDetail> {
      return this.audits.get(a, id);
    }

    @Put(':id/items/:itemId')
    @perform
    @ApiOkResponse({ type: AuditItemVerdictResponse })
    setVerdict(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Param('itemId', ParseIdPipe) itemId: string, @Body() body: AuditVerdictDto): Promise<AuditItemVerdict> {
      return this.audits.setVerdict(a, id, itemId, body);
    }

    @Delete(':id/items/:itemId')
    @HttpCode(204)
    @perform
    @ApiNoContentResponse()
    clearVerdict(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Param('itemId', ParseIdPipe) itemId: string): Promise<void> {
      return this.audits.clearVerdict(a, id, itemId);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @perform
    @ApiOkResponse({ type: AuditDtoResponse })
    cancel(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: CancelAuditDto): Promise<AuditDto> {
      return this.audits.cancel(a, id, body);
    }
  }
  return named(AuditsController, mode === 'tenant' ? 'AuditsController' : 'PlatformTenantAuditsController');
}

/** POST /executions/:id/audits lives with the audits: executions never depends on this module (NFR-15.02). */
export function executionAuditsControllerFor(mode: RouteMode) {
  const perform = perm(mode, 'audits.perform');

  @controllerDecorators(mode, 'executions', 'audits')
  class ExecutionAuditsController {
    constructor(@Inject(AuditsService) private readonly audits: AuditsService) {}

    @Post(':id/audits')
    @perform
    @ApiCreatedResponse({ type: AuditDtoResponse })
    start(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AuditDto> {
      return this.audits.start(a, id);
    }
  }
  return named(ExecutionAuditsController, mode === 'tenant' ? 'ExecutionAuditsController' : 'PlatformTenantExecutionAuditsController');
}

export const TenantAuditsController = auditsControllerFor('tenant');
export const PlatformTenantAuditsController = auditsControllerFor('platform');
export const TenantExecutionAuditsController = executionAuditsControllerFor('tenant');
export const PlatformTenantExecutionAuditsController = executionAuditsControllerFor('platform');
```

`apps/api/src/audits/audits.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { ExecutionsModule } from '../executions/executions.module';
import { PlatformModule } from '../platform/platform.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PlatformTenantAuditsController, PlatformTenantExecutionAuditsController, TenantAuditsController, TenantExecutionAuditsController } from './audits.controller';
import { AuditsService } from './audits.service';

/** Sub-project 8: audits. Depends on executions and scheduling; nothing depends on it (NFR-15.02). */
@Module({
  imports: [PlatformModule, SchedulingModule, ExecutionsModule],
  controllers: [TenantAuditsController, PlatformTenantAuditsController, TenantExecutionAuditsController, PlatformTenantExecutionAuditsController],
  providers: [AuditsService, PlatformTenantInterceptor],
})
export class AuditsModule {}
```

`apps/api/src/app.module.ts`: add `import { AuditsModule } from './audits/audits.module';` and `AuditsModule` after `ReportsModule` in `imports`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audits.test corrections-read send-back`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/audits apps/api/src/app.module.ts apps/api/test/audits.test.ts
git commit -m "feat(api): start, read, review and cancel audits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The audits module II: finish and the audit queue

**Files:**
- Create: `apps/api/src/audits/audit-queue.ts`, `apps/api/src/audits/report/queues.ts`
- Modify: `apps/api/src/common/domain-events.ts`, `apps/api/src/audits/audits.service.ts`, `apps/api/src/audits/audits.controller.ts`, `apps/api/src/audits/audits.module.ts`, `apps/api/test/audit-fixtures.ts`
- Test: `apps/api/test/audits-finish.test.ts`, `apps/api/test/audits-queue.test.ts`

**Interfaces:**
- Consumes: Task 12 (`AuditsService.lockAudit`, `dto`, `audit-rows.ts`); `auditableItemIds`, `auditScore`, `missingVerdicts`, `isAuditPaused`, `reportRecipients`, `runAuditState` (contracts); `JobsService.send(queue, data)`; `DbService.afterCommit`.
- Produces:
  - `DomainEventMap['audit.finished']: { tenantId: string; auditId: string; executionId: string; occurrenceId: string; result: AuditResult; actorUserId: string | null }`.
  - `report/queues.ts`: `AUDIT_QUEUES = { report: 'audit.report', dead: 'audit.dead' } as const`, `interface AuditReportJobData { tenantId: string; auditId: string; emails?: string[] }`, `AUDIT_REPORT_JOB = { retryLimit: 5, retryDelay: 15, retryDelayMax: 240, localConcurrency: 2, maxAttempts: 5 } as const` (Task 15's worker uses them).
  - `AuditsService.finish(a: Actor, auditId: string, input: FinishAuditParams): Promise<AuditDto>`; `AuditQueueQuery.page(a: Actor, q: AuditQueueParams): Promise<Page<AuditQueueRow>>`.
  - Routes `POST /audits/:id/finish` and `GET /audits` (`audits.perform`, tenant and platform).
  - `test/audit-fixtures.ts`: `completeRunOn(t, clock, w, date): Promise<{ occurrenceId: string; executionId: string }>`, `verdictAll(api, auditId, itemIds, rejected?)`.

- [ ] **Step 1: Add the fixtures**

Append to `apps/api/test/audit-fixtures.ts` (and add `fullAnswers, occurrenceOn` to its `./execution-fixtures` import):

```ts
/** İşçi 1 completes the run of `date` (YYYY-MM-DD) at 08:20 Baku that day, with every required answer. */
export async function completeRunOn(t: TestApp, clock: FakeClock, w: ExecutionWorld, date: string): Promise<{ occurrenceId: string; executionId: string }> {
  const occurrenceId = await occurrenceOn(w.assignmentId, date);
  const at = `${date}T04:20:00.000Z`;
  clock.set(at);
  const api = w.workers[0].api;
  const executionId = await claimOk(api, occurrenceId, `${date}T04:10:00.000Z`);
  const photo = await registerPhoto(api, executionId, w.c.photo.id, { capturedAt: at, deviceTime: at });
  const res = await completeExecution(api, executionId, 1, fullAnswers(w, photo), at);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await markUploaded(executionId);
  return { occurrenceId, executionId };
}

/** Approves every item of `itemIds`, rejecting those in `rejected` with a comment. */
export async function verdictAll(api: Api, auditId: string, itemIds: readonly string[], rejected: readonly string[] = []): Promise<void> {
  for (const itemId of itemIds) {
    const body = rejected.includes(itemId) ? { verdict: 'rejected', comment: 'Uyğun deyil' } : { verdict: 'approved' };
    const res = await api.put(`/api/v1/audits/${auditId}/items/${itemId}`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
}
```

- [ ] **Step 2: Write the failing tests**

`apps/api/test/audits-finish.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { JobsService } from '../src/scheduling/jobs.service';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correct, markUploaded, resubmit, sendBack, startAudit, verdictAll } from './audit-fixtures';
import { answersBody, historyOf, statusOf } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';
const DONE = '2026-11-02T06:00:00.000Z';

describe('finishing an audit (FR-19.06, spec §6.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A run with an audit in progress; `items` are the four auditable items ("Xeyr" hides the follow-up). */
  async function audited(opts: { problemYes?: boolean } = {}) {
    const a = await auditWorld(t, clock, opts);
    clock.set(AT);
    const res = await startAudit(a.auditor.api, a.executionId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const items = [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id];
    return { a, auditId: res.body.id as string, items };
  }
  const finish = (a: AuditWorld, auditId: string, body: object) => a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, body);

  it('refuses to finish while auditable items lack a verdict, naming them', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items.slice(0, 2));
    const res = await finish(a, auditId, { result: 'passed' });
    expect([res.status, res.body.error.code, res.body.error.itemIds]).toEqual([422, 'AUDIT_INCOMPLETE', items.slice(2)]);
  });

  it('refuses to finish while a photo of the answers is still uploading', async () => {
    const { a, auditId, items } = await audited();
    await verdictAll(a.auditor.api, auditId, items);
    expect((await finish(a, auditId, { result: 'passed' })).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
    await markUploaded(a.executionId);
    expect((await finish(a, auditId, { result: 'passed' })).status).toBe(200);
  });

  it('refuses to finish while the run is sent back', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items);
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    expect((await finish(a, auditId, { result: 'passed' })).body.error.code).toBe('AUDIT_PAUSED');
  });

  it('finishes: audited, the score, the recipients, the report pending, the event, the audit entry and the job', async () => {
    const { a, auditId, items } = await audited();
    await ownerQuery("update checklists set audit_report_emails = '{qa@acme.az}' where id = $1", [a.w.checklistId]);
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items, [a.w.c.temp.id]);
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const seen: unknown[] = [];
    const off = t.app.get(DomainEvents).on('audit.finished', (e) => void seen.push(e));
    clock.set(DONE);
    const res = await finish(a, auditId, { result: 'failed', comment: 'Temperatur rejimi pozulub', extraEmails: ['Boss@acme.az', 'qa@acme.az'] });
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const score = { approved: 3, rejected: 1, reviewed: 4, percent: 75 };
    expect(res.body).toMatchObject({
      status: 'finished', finishedAt: DONE, result: 'failed', score, comment: 'Temperatur rejimi pozulub',
      reportStatus: 'pending', reportRecipients: ['qa@acme.az', 'boss@acme.az'], reportSentAt: null, paused: false,
    });
    expect(await statusOf(a.w.occurrenceId)).toBe('audited');
    expect((await historyOf(a.w.occurrenceId)).at(-1)).toEqual(['audit_pending', 'audited', DONE, null, a.auditor.id]);
    expect(seen).toEqual([{ tenantId: a.w.s.tenantId, auditId, executionId: a.executionId, occurrenceId: a.w.occurrenceId, result: 'failed', actorUserId: a.auditor.id }]);
    expect(send).toHaveBeenCalledWith('audit.report', { tenantId: a.w.s.tenantId, auditId });
    expect((await auditLogOf(auditId)).at(-1)).toMatchObject({
      action: 'audit.finished',
      after: { result: 'failed', score, rejectedItemIds: [a.w.c.temp.id], comment: 'Temperatur rejimi pozulub', recipients: ['qa@acme.az', 'boss@acme.az'] },
    });
  });

  it('locks the run once audited', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items);
    expect((await finish(a, auditId, { result: 'passed' })).status).toBe(200);
    expect((await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.temp.id, answer: { number: 5 } }], reason: 'x' })).body.error.code).toBe('EXECUTION_LOCKED');
    expect((await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }] })).body.error.code).toBe('EXECUTION_LOCKED');
    expect((await startAudit(a.auditor.api, a.executionId)).body.error.code).toBe('EXECUTION_LOCKED');
    for (const res of [
      await finish(a, auditId, { result: 'passed' }),
      await a.auditor.api.put(`/api/v1/audits/${auditId}/items/${a.w.c.temp.id}`, { verdict: 'approved' }),
      await a.auditor.api.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' }),
    ]) {
      expect(res.body.error.code).toBe('AUDIT_NOT_IN_PROGRESS');
    }
    expect((await finish({ ...a, auditor: a.manager }, auditId, { result: 'passed' })).status).toBe(403);
  });

  it('finishes when only items the answers hide lack a verdict, and leaves them out of the score', async () => {
    const { a, auditId } = await audited({ problemYes: true });
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, [a.w.c.comment.id], [a.w.c.comment.id]);
    await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.problem.id, answer: { optionIds: [a.w.c.no.id], photos: [] } }], reason: 'Problem yox idi' });
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id]);
    const res = await finish(a, auditId, { result: 'passed' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.score).toEqual({ approved: 4, rejected: 0, reviewed: 4, percent: 100 });
    expect((await auditLogOf(auditId)).at(-1)!.after).toMatchObject({ rejectedItemIds: [] });
  });

  it('resumes after a resubmit: the changed item needs a new verdict, then the audit finishes', async () => {
    const { a, auditId, items } = await audited();
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, items, [a.w.c.temp.id]);
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    const later = '2026-11-02T12:00:00.000Z';
    clock.set(later);
    await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, { ...a.answers, [a.w.c.temp.id]: { number: 5 } }, later));
    expect((await resubmit(a.worker.api, a.executionId, later)).body.status).toBe('audit_pending');
    const incomplete = await finish(a, auditId, { result: 'passed' });
    expect([incomplete.body.error.code, incomplete.body.error.itemIds]).toEqual(['AUDIT_INCOMPLETE', [a.w.c.temp.id]]);
    await verdictAll(a.auditor.api, auditId, [a.w.c.temp.id]);
    expect((await finish(a, auditId, { result: 'passed' })).body).toMatchObject({ status: 'finished', score: { approved: 4, percent: 100 } });
  });
});
```

`apps/api/test/audits-queue.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type Staff, completeRunOn, startAudit, verdictAll } from './audit-fixtures';
import { type ExecutionWorld, executionWorld } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

describe('the audit queue (GET /audits, Spec decision 13)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: ExecutionWorld;
  let auditor: Staff;
  const runs: Record<string, { occurrenceId: string; executionId: string }> = {};
  const auditIds: Record<string, string> = {};

  /** Four runs of a checklist that requires audit, completed on 2–5 November: d2 waits, d3 is being audited, d4 passed, d5 failed. */
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await executionWorld(t);
    await ownerQuery('update checklists set requires_audit = true where id = $1', [w.checklistId]);
    const s = await staffAt(t, w.s.tenantId, w.owner, 'auditor', [], 'Auditor');
    auditor = { id: s.id, api: s.api };
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) runs[d] = await completeRunOn(t, clock, w, d);
    const items = [w.c.problem.id, w.c.temp.id, w.c.photo.id, w.c.note.id];
    for (const [d, minute] of [['2026-11-03', '10'], ['2026-11-04', '11'], ['2026-11-05', '12']] as const) {
      clock.set(`2026-11-06T06:${minute}:00Z`);
      const res = await startAudit(auditor.api, runs[d]!.executionId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      auditIds[d] = res.body.id as string;
    }
    for (const [d, result, minute] of [['2026-11-04', 'passed', '20'], ['2026-11-05', 'failed', '30']] as const) {
      await verdictAll(auditor.api, auditIds[d]!, items, result === 'failed' ? [w.c.temp.id] : []);
      clock.set(`2026-11-06T06:${minute}:00Z`);
      expect((await auditor.api.post(`/api/v1/audits/${auditIds[d]}/finish`, { result })).status).toBe(200);
    }
  });
  beforeEach(() => clock.set('2026-11-06T08:00:00Z'));
  afterAll(() => t.close());

  const page = async (api: Api, query: string) => {
    const res = await api.get(`/api/v1/audits?${query}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as { items: { occurrenceId: string }[]; nextCursor: string | null };
  };
  const ids = (p: { items: { occurrenceId: string }[] }) => p.items.map((r) => r.occurrenceId);
  const of = (...days: string[]) => days.map((d) => runs[d]!.occurrenceId);

  it('lists the waiting, in-progress and finished runs, each in its order', async () => {
    expect(ids(await page(auditor.api, 'queue=waiting'))).toEqual(of('2026-11-02'));
    expect(ids(await page(auditor.api, 'queue=in_progress'))).toEqual(of('2026-11-03'));
    expect(ids(await page(auditor.api, 'queue=finished'))).toEqual(of('2026-11-05', '2026-11-04'));
  });

  it('returns the run and audit columns of a row', async () => {
    const [row] = (await page(auditor.api, 'queue=finished&result=failed')).items;
    expect(row).toEqual({
      occurrenceId: runs['2026-11-05']!.occurrenceId,
      executionId: runs['2026-11-05']!.executionId,
      auditId: auditIds['2026-11-05'],
      checklist: { id: w.checklistId, name: 'İcra yoxlaması' },
      site: { id: w.siteId, name: 'Filial 1' },
      executor: { id: w.workers[0].id, fullName: 'İşçi 1' },
      localDate: '2026-11-05',
      completedAt: '2026-11-05T04:20:00.000Z',
      status: 'audited',
      auditState: 'failed',
      auditor: { kind: 'user', id: auditor.id, name: 'Auditor' },
      result: 'failed',
      percent: 75,
      startedAt: '2026-11-06T06:12:00.000Z',
      finishedAt: '2026-11-06T06:30:00.000Z',
    });
    expect((await page(auditor.api, 'queue=waiting')).items[0]).toMatchObject({ auditId: null, auditState: 'waiting', auditor: null, result: null, percent: null, status: 'audit_pending' });
  });

  it('filters by result, dates, site, checklist and auditor', async () => {
    expect(ids(await page(auditor.api, 'queue=finished&result=passed'))).toEqual(of('2026-11-04'));
    expect(ids(await page(auditor.api, 'queue=finished&from=2026-11-04&to=2026-11-04'))).toEqual(of('2026-11-04'));
    expect(ids(await page(auditor.api, `queue=finished&siteId=${w.otherSiteId}`))).toEqual([]);
    expect(ids(await page(auditor.api, `queue=finished&siteId=${w.siteId}&checklistId=${w.checklistId}`))).toEqual(of('2026-11-05', '2026-11-04'));
    expect(ids(await page(auditor.api, `queue=finished&auditorId=${auditor.id}`))).toEqual(of('2026-11-05', '2026-11-04'));
    expect(ids(await page(auditor.api, `queue=finished&auditorId=${w.s.ownerId}`))).toEqual([]);
    const long = await auditor.api.get('/api/v1/audits?queue=finished&from=2026-01-01&to=2027-01-02');
    expect([long.status, long.body.error.fields]).toEqual([400, { to: 'audits.issues.rangeTooLong' }]);
  });

  it('pages with a cursor', async () => {
    const first = await page(auditor.api, 'queue=finished&limit=1');
    expect([ids(first), first.nextCursor]).toEqual([of('2026-11-05'), runs['2026-11-05']!.occurrenceId]);
    const second = await page(auditor.api, `queue=finished&limit=1&cursor=${first.nextCursor}`);
    expect([ids(second), second.nextCursor]).toEqual([of('2026-11-04'), null]);
  });

  it('follows the data scope and needs audits.perform', async () => {
    const role = await w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope: 'site_subtree', permissions: ['audits.perform'] });
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: role.body.id, emailVerified: true });
    expect((await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    const elsewhere = as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
    expect(ids(await page(elsewhere, 'queue=finished'))).toEqual([]);
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    expect((await manager.api.get('/api/v1/audits?queue=waiting')).status).toBe(403);
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- audits-finish audits-queue`
Expected: FAIL: `POST /audits/:id/finish` and `GET /audits` answer 404.

- [ ] **Step 4: Add the event and the queue names**

`apps/api/src/common/domain-events.ts`: add `type AuditResult` to the contracts import and, after `'execution.resubmitted': …;`:

```ts
  /** SP8: an audit finished (spec §6.2). SP6 turns it into audit.finished. */
  'audit.finished': { tenantId: string; auditId: string; executionId: string; occurrenceId: string; result: AuditResult; actorUserId: string | null };
```

`apps/api/src/audits/report/queues.ts`:

```ts
/** SP8 spec §7.2. */
export const AUDIT_QUEUES = { report: 'audit.report', dead: 'audit.dead' } as const;

/** The SP6 worker settings (Global Constraints): five retries, 15 s doubling to at most 240 s, two workers per node. */
export const AUDIT_REPORT_JOB = { retryLimit: 5, retryDelay: 15, retryDelayMax: 240, localConcurrency: 2, maxAttempts: 5 } as const;

export interface AuditReportJobData {
  tenantId: string;
  auditId: string;
  /** POST /audits/:id/report/send with addresses: send to these instead of the stored recipients. */
  emails?: string[];
}
```

- [ ] **Step 5: Implement finish**

`apps/api/src/audits/audits.service.ts`:
- the contracts import gains `auditScore, type FinishAuditParams, isAuditPaused, missingVerdicts, reportRecipients`; the drizzle import gains `count, isNull`; the schema import gains `executionMedia`; add `import { Logger } from '@nestjs/common';` to the Nest import, and

```ts
import { DomainEvents } from '../common/domain-events';
import { sanitiseForLog } from '../common/error.filter';
import { JobsService } from '../scheduling/jobs.service';
import { AUDIT_QUEUES, type AuditReportJobData } from './report/queues';
```

- add `private readonly logger = new Logger('AuditsService');` as the first class member, and `private readonly events: DomainEvents, private readonly jobs: JobsService,` as the last two constructor parameters;
- add after `cancel`:

```ts
  /**
   * FR-19.06 (spec §6.2): an in-progress audit of a run that is not sent back, a verdict on every auditable item, and every
   * medium the answers reference uploaded. Stores the score, the result and the recipients, moves the run to audited (the
   * run is then locked), emits audit.finished and queues the report after commit.
   */
  async finish(a: Actor, auditId: string, input: FinishAuditParams): Promise<AuditDto> {
    const now = this.clock.now();
    const { audit, e, o } = await this.lockAudit(a, auditId);
    if (audit.status !== 'in_progress') throw new AppError('AUDIT_NOT_IN_PROGRESS');
    if (isAuditPaused(o.status)) throw new AppError('AUDIT_PAUSED');
    const tx = this.db.tx();
    const answers = e.answers as Answers;
    const ids = auditableItemIds(await this.lookups.content(e.checklistVersionId), answers);
    const rows = await tx.select({ itemId: auditItemVerdicts.itemId, verdict: auditItemVerdicts.verdict }).from(auditItemVerdicts).where(eq(auditItemVerdicts.auditId, auditId));
    const verdicts = new Map(rows.map((r) => [r.itemId, r.verdict]));
    const missing = missingVerdicts(verdicts, ids);
    if (missing.length) throw new AppError('AUDIT_INCOMPLETE', { details: { itemIds: missing } });
    if (await this.mediaStillUploading(e.id, answers)) throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    const score = auditScore(verdicts, ids);
    const [checklist] = await tx.select({ emails: checklists.auditReportEmails }).from(checklists).where(eq(checklists.id, o.checklistId));
    const recipients = reportRecipients(checklist!.emails, input.extraEmails ?? []);
    const comment = input.comment ? input.comment : null;
    await tx
      .update(audits)
      .set({ status: 'finished', finishedAt: now, result: input.result, auditScore: score, comment, reportStatus: 'pending', reportRecipients: recipients, reportAttempts: 0, updatedAt: now })
      .where(eq(audits.id, auditId));
    await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: 'audited', at: now }]);
    await this.events.emit('audit.finished', { tenantId: audit.tenantId, auditId, executionId: e.id, occurrenceId: o.id, result: input.result, actorUserId: actorColumns(this.db).userId });
    await this.audit.record({
      action: 'audit.finished',
      entityType: 'audit',
      entityId: auditId,
      after: { result: input.result, score, rejectedItemIds: ids.filter((id) => verdicts.get(id) === 'rejected'), comment, recipients },
    });
    this.queueReport({ tenantId: audit.tenantId, auditId });
    return this.dto(auditId);
  }

  /** After commit. A lost send leaves report_status = pending; POST /audits/:id/report/send queues it again. */
  private queueReport(job: AuditReportJobData): void {
    this.db.afterCommit(async () => {
      try {
        await this.jobs.send(AUDIT_QUEUES.report, job);
      } catch (e) {
        this.logger.error(sanitiseForLog(e, null), `Queueing the report of audit ${job.auditId} failed`);
      }
    });
  }

  /** Spec §6.2 "MEDIA_PENDING": a medium the answers reference is still pending. A purged one never uploads, so it is ignored. */
  private async mediaStillUploading(executionId: string, answers: Answers): Promise<boolean> {
    const ids = [...new Set(Object.values(answers).flatMap((x) => [...(x?.photos ?? []), ...(x?.videos ?? []), ...(x?.problem?.mediaIds ?? [])]))];
    if (!ids.length) return false;
    const [r] = await this.db
      .tx()
      .select({ n: count() })
      .from(executionMedia)
      .where(and(eq(executionMedia.executionId, executionId), inArray(executionMedia.id, ids), eq(executionMedia.status, 'pending'), isNull(executionMedia.storagePurgedAt)));
    return (r?.n ?? 0) > 0;
  }
```

- [ ] **Step 6: Write the queue**

`apps/api/src/audits/audit-queue.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type AuditQueueParams, type AuditQueueRow, type AuditResult, type AuditStatus, type OccurrenceStatus, type Page, runAuditState } from '@taskop/contracts';
import { type SQL, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import type { Actor } from '../scheduling/actor';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { auditorOf } from './audit-rows';

type QueueRow = {
  occurrence_id: string;
  execution_id: string;
  audit_id: string | null;
  checklist_id: string;
  checklist_name: string;
  site_id: string;
  site_name: string;
  executor_user_id: string;
  executor_name: string;
  local_date: string;
  completed_at: string;
  status: OccurrenceStatus;
  audit_status: AuditStatus | null;
  audit_result: AuditResult | null;
  percent: number | null;
  started_at: string | null;
  finished_at: string | null;
  auditor_user_id: string | null;
  auditor_name: string | null;
};

// Drizzle's pg driver returns timestamps from `execute` as raw strings.
const isoOf = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

/** GET /audits (Spec decision 13): one row per counted execution, with its non-cancelled audit; keyset pages. */
@Injectable()
export class AuditQueueQuery {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  async page(a: Actor, q: AuditQueueParams): Promise<Page<AuditQueueRow>> {
    const conds: SQL[] = [this.scope.occurrences(a) ?? sql`true`];
    let order: SQL;
    switch (q.queue) {
      case 'waiting':
        conds.push(sql`${occurrences.status} = 'audit_pending' and au.id is null`);
        if (q.cursor) {
          conds.push(sql`(x.completed_at, ${occurrences.id}) > (select cx.completed_at, cx.occurrence_id from executions cx where cx.occurrence_id = ${q.cursor} and cx.state <> 'rejected')`);
        }
        order = sql`x.completed_at asc, ${occurrences.id} asc`;
        break;
      case 'in_progress':
        conds.push(sql`au.status = 'in_progress'`);
        if (q.cursor) conds.push(sql`(au.started_at, ${occurrences.id}) < (select ca.started_at, ca.occurrence_id from audits ca where ca.occurrence_id = ${q.cursor} and ca.status <> 'cancelled')`);
        order = sql`au.started_at desc, ${occurrences.id} desc`;
        break;
      case 'finished':
        conds.push(sql`au.status = 'finished'`);
        if (q.cursor) conds.push(sql`(au.finished_at, ${occurrences.id}) < (select ca.finished_at, ca.occurrence_id from audits ca where ca.occurrence_id = ${q.cursor} and ca.status <> 'cancelled')`);
        order = sql`au.finished_at desc, ${occurrences.id} desc`;
        break;
    }
    if (q.siteId) conds.push(sql`exists (select 1 from sites fs, sites f where f.id = ${q.siteId} and fs.id = ${occurrences.siteId} and fs.path <@ f.path)`);
    if (q.checklistId) conds.push(sql`${occurrences.checklistId} = ${q.checklistId}`);
    if (q.auditorId) conds.push(sql`au.auditor_user_id = ${q.auditorId}`);
    if (q.result) conds.push(sql`au.result = ${q.result}`);
    if (q.from && q.to) conds.push(sql`${occurrences.localDate} between ${q.from}::date and ${q.to}::date`);
    const rows = (
      await this.db.tx().execute<QueueRow>(sql`
        select ${occurrences.id} as occurrence_id, x.id as execution_id, au.id as audit_id,
               c.id as checklist_id, c.name as checklist_name, s.id as site_id, s.name as site_name,
               x.executor_user_id, eu.full_name as executor_name, ${occurrences.localDate}::text as local_date, x.completed_at,
               ${occurrences.status}::text as status, au.status::text as audit_status, au.result::text as audit_result,
               (au.audit_score->>'percent')::float8 as percent, au.started_at, au.finished_at, au.auditor_user_id, aud.full_name as auditor_name
          from occurrences
          join executions x on x.occurrence_id = ${occurrences.id} and x.state <> 'rejected'
          join checklists c on c.id = ${occurrences.checklistId}
          join sites s on s.id = ${occurrences.siteId}
          join users eu on eu.id = x.executor_user_id
          left join audits au on au.execution_id = x.id and au.status <> 'cancelled'
          left join users aud on aud.id = au.auditor_user_id
         where ${sql.join(conds, sql` and `)}
         order by ${order!}
         limit ${q.limit + 1}`)
    ).rows;
    const items = rows.slice(0, q.limit).map((r): AuditQueueRow => ({
      occurrenceId: r.occurrence_id,
      executionId: r.execution_id,
      auditId: r.audit_id,
      checklist: { id: r.checklist_id, name: r.checklist_name },
      site: { id: r.site_id, name: r.site_name },
      executor: { id: r.executor_user_id, fullName: r.executor_name },
      localDate: r.local_date,
      completedAt: isoOf(r.completed_at)!,
      status: r.status,
      auditState: runAuditState(r.status, r.audit_status ? { status: r.audit_status, result: r.audit_result } : null),
      auditor: r.audit_id ? auditorOf(r.auditor_user_id, r.auditor_name) : null,
      result: r.audit_result,
      percent: r.percent,
      startedAt: isoOf(r.started_at),
      finishedAt: isoOf(r.finished_at),
    }));
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.occurrenceId : null };
  }
}
```

- [ ] **Step 7: Add the routes**

`apps/api/src/audits/audits.controller.ts`:
- add `Query` to the Nest import, `AuditQueueRow, Page` to the type import, `import { AuditQueueQuery } from './audit-queue';`, and `AuditQueuePageResponse, AuditQueueQueryDto, FinishAuditDto` to the `./dto` import;
- the `AuditsController` constructor becomes

```ts
    constructor(
      @Inject(AuditsService) private readonly audits: AuditsService,
      @Inject(AuditQueueQuery) private readonly queue: AuditQueueQuery,
    ) {}
```

- add before `get`:

```ts
    @Get()
    @perform
    @ApiOkResponse({ type: AuditQueuePageResponse })
    list(@CurrentActor() a: Actor, @Query() q: AuditQueueQueryDto): Promise<Page<AuditQueueRow>> {
      return this.queue.page(a, q);
    }
```

- add after `cancel`:

```ts
    @Post(':id/finish')
    @HttpCode(200)
    @perform
    @ApiOkResponse({ type: AuditDtoResponse })
    finish(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: FinishAuditDto): Promise<AuditDto> {
      return this.audits.finish(a, id, body);
    }
```

`apps/api/src/audits/audits.module.ts`: add `AuditQueueQuery` (from `./audit-queue`) to `providers`.

- [ ] **Step 8: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audits-finish audits-queue audits.test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/common/domain-events.ts apps/api/src/audits apps/api/test/audit-fixtures.ts apps/api/test/audits-finish.test.ts apps/api/test/audits-queue.test.ts
git commit -m "feat(api): finish audits and list the audit queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Mail attachments and the audit report PDF builder, with the spec §7.2 performance check

**Files:**
- Modify: `apps/api/src/mail/mailer.ts`, `apps/api/src/mail/templates.ts`, `apps/api/src/reports/pdf/pdf-document.ts`, `apps/api/test/memory-mailer.ts`
- Create: `apps/api/src/audits/report/answer-text.ts`, `apps/api/src/audits/report/audit-report-builder.ts`, `apps/api/test/png.ts`
- Test: `apps/api/src/mail/mailer.test.ts`, `apps/api/src/mail/templates.test.ts`, `apps/api/src/audits/report/answer-text.test.ts`, `apps/api/src/audits/report/audit-report-builder.test.ts`, `apps/api/test/audit-report-perf.test.ts`

**Interfaces:**
- Consumes: `az.audits.report`, `az.audits.email`, `az.audits.results`, `az.audits.verdicts`, `interpolate` (Task 3); `AUDIT_LIMITS`, `AUDIT_REPORT_CONTENT_TYPE`, `isAnswered`, `type Item`, `type Answer` (contracts); SP7's `formatInstant` (`reports/export/report-table.ts`) and the pdfmake setup with Noto Sans (`reports/pdf/pdf-document.ts`).
- Produces:
  - `MailMessage.attachments?: MailAttachment[]` with `interface MailAttachment { filename: string; content: Buffer; contentType: string }`; `SmtpMailer` passes them to nodemailer.
  - `auditReportMail(p: { to: string; checklistName: string; siteName: string; localDate: string; result: AuditResult; auditorName: string; pdf: Buffer; filename: string }): MailMessage` in `mail/templates.ts`.
  - `renderPdf(definition: TDocumentDefinitions): Promise<Buffer>` in `reports/pdf/pdf-document.ts` (`toPdf` now calls it).
  - `answerText(item: Item, answer: Answer | undefined): string` and `answerLine(item: Item, answer: Answer | undefined): string` (with the note) in `audits/report/answer-text.ts`.
  - In `audits/report/audit-report-builder.ts`: `interface ReportItem`, `interface ReportSection`, `interface AuditReportData` (below), `selectReportPhotos(itemIds: readonly string[], photosByItem: ReadonlyMap<string, readonly string[]>): { embedded: Map<string, string[]>; skipped: Map<string, number> }`, `auditReportDefinition(d: AuditReportData): TDocumentDefinitions`, `buildAuditReport(d: AuditReportData): Promise<Buffer>`.
  - `test/memory-mailer.ts`: `MemoryMailer.failFor: Set<string>` (a send to one of these addresses throws).
  - `test/png.ts`: `noisePng(width: number, height: number, seed?: number): Buffer`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/mail/mailer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config';
import { SmtpMailer } from './mailer';

describe('SmtpMailer', () => {
  it('passes attachments to nodemailer with the sender', async () => {
    const mailer = new SmtpMailer({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'Taskop <no-reply@taskop.test>' } as AppConfig);
    const transport = (mailer as unknown as { transport: { sendMail: (m: object) => Promise<unknown> } }).transport;
    const sendMail = vi.spyOn(transport, 'sendMail').mockResolvedValue({});
    const pdf = Buffer.from('%PDF-1.7');
    await mailer.send({ to: 'qa@acme.az', subject: 'S', text: 'T', attachments: [{ filename: 'a.pdf', content: pdf, contentType: 'application/pdf' }] });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Taskop <no-reply@taskop.test>', to: 'qa@acme.az', subject: 'S', text: 'T',
      attachments: [{ filename: 'a.pdf', content: pdf, contentType: 'application/pdf' }],
    });
  });
});
```

`apps/api/src/mail/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { auditReportMail } from './templates';

describe('auditReportMail', () => {
  it('names the checklist, site, day, result and auditor, with the PDF attached', () => {
    const pdf = Buffer.from('%PDF-1.7');
    const m = auditReportMail({ to: 'qa@acme.az', checklistName: 'Açılış', siteName: 'Filial 1', localDate: '2026-11-02', result: 'failed', auditorName: 'Auditor', pdf, filename: 'x.pdf' });
    expect(m.subject).toBe('Audit hesabatı: Açılış — Filial 1, 02.11.2026');
    expect(m.text).toContain('Nəticə: Uğursuz.');
    expect(m.text).toContain('Auditor: Auditor.');
    expect(m.attachments).toEqual([{ filename: 'x.pdf', content: pdf, contentType: 'application/pdf' }]);
  });
});
```

`apps/api/src/audits/report/answer-text.test.ts`:

```ts
import { type Item, newItem, type NumberItem, type SingleChoiceItem, type YesNoItem } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { answerLine, answerText } from './answer-text';

describe('answer text', () => {
  it('prints every item type in Azerbaijani', () => {
    const yn = newItem('yes_no') as YesNoItem;
    expect(answerText(yn, { optionIds: [yn.options[0].id] })).toBe('Bəli');
    const choice = newItem('single_choice') as SingleChoiceItem;
    choice.options[1]!.label = 'Təmiz';
    expect(answerText(choice, { optionIds: [choice.options[1]!.id] })).toBe('Təmiz');
    const n = newItem('number') as NumberItem;
    n.unit = '°C';
    expect(answerText(n, { number: 5 })).toBe('5 °C');
    expect(answerText(newItem('text'), { text: 'Hazırdır' })).toBe('Hazırdır');
    expect(answerText(newItem('datetime'), { datetime: '2026-11-02T08:00+04:00' })).toBe('2026-11-02T08:00+04:00');
    expect(answerText(newItem('photo'), { photos: ['a', 'b'] })).toBe('2 foto');
    expect(answerText(newItem('video'), { videos: ['v'] })).toBe('1 video');
    expect(answerText(newItem('text'), undefined)).toBe('Cavab yoxdur');
    expect(answerText(newItem('text') as Item, { text: '  ' })).toBe('Cavab yoxdur');
  });

  it('adds the note', () => {
    const n = newItem('number') as NumberItem;
    expect(answerLine(n, { number: 10, note: 'isti' })).toBe('10 — isti');
    expect(answerLine(n, { number: 10 })).toBe('10');
  });
});
```

`apps/api/src/audits/report/audit-report-builder.test.ts`:

```ts
import { extractText } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { noisePng } from '../../../test/png';
import { type AuditReportData, buildAuditReport, type ReportItem, selectReportPhotos } from './audit-report-builder';

const dataUrl = (seed: number) => `data:image/png;base64,${noisePng(8, 8, seed).toString('base64')}`;
const item = (over: Partial<ReportItem>): ReportItem => ({
  itemId: 'i', label: 'Sual', depth: 0, answer: 'Bəli', original: null, correctedBy: null, verdict: 'approved', verdictComment: null,
  problem: null, photos: [], morePhotos: 0, videos: 0, ...over,
});

const reportData = (over: Partial<AuditReportData> = {}): AuditReportData => ({
  auditId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f',
  tenantName: 'Acme MMC',
  timezone: 'Asia/Baku',
  checklistName: 'Açılış yoxlaması',
  versionNumber: 3,
  siteName: 'Filial 1',
  executorName: 'İşçi 1',
  localDate: '2026-11-02',
  window: { startsAt: new Date('2026-11-02T04:00:00Z'), closesAt: new Date('2026-11-02T07:00:00Z') },
  startedAt: new Date('2026-11-02T04:10:00Z'),
  completedAt: new Date('2026-11-02T04:20:00Z'),
  syncedAt: new Date('2026-11-02T05:00:00Z'),
  auditorName: 'Auditor',
  finishedAt: new Date('2026-11-02T06:00:00Z'),
  result: 'failed',
  auditScore: { approved: 3, rejected: 1, reviewed: 4, percent: 75 },
  runScore: 100,
  originalScore: 50,
  comment: 'Temperatur rejimi pozulub',
  sections: [
    {
      title: 'Zal',
      items: [
        item({ itemId: 'a', label: 'Problem varmı?', answer: 'Xeyr' }),
        item({
          itemId: 'b', label: 'Temperatur', answer: '5 — yenidən ölçüldü', original: '10 — isti', correctedBy: { name: 'Menecer', reason: 'Termometr səhv oxunub' },
          verdict: 'rejected', verdictComment: 'Hələ də yüksəkdir', problem: { severity: 'normal', note: 'isti' },
        }),
        item({ itemId: 'c', label: 'Ümumi görünüş', answer: '5 foto', photos: [dataUrl(1), dataUrl(2), dataUrl(3)], morePhotos: 2, videos: 1, verdict: null }),
      ],
    },
  ],
  generatedAt: new Date('2026-11-02T06:01:00Z'),
  ...over,
});

const imageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;

describe('audit report builder (spec §7.2)', () => {
  it('prints the header, the items with verdicts, corrections and problems, and the footer', async () => {
    const pdf = await buildAuditReport(reportData());
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of [
      'Acme MMC', 'Audit hesabatı', 'Açılış yoxlaması · Versiya 3', 'Filial 1', 'İşçi 1', '02.11.2026 08:00 – 02.11.2026 11:00',
      'Başlanıb (cihaz) 02.11.2026 08:10', 'Tamamlanıb (cihaz) 02.11.2026 08:20', 'Serverə çatıb 02.11.2026 09:00', 'Audit bitib 02.11.2026 10:00',
      'Nəticə Uğursuz', 'Audit balı 75.0% (3/4)', 'İcra balı 100.0% (İlkin bal: 50.0%)', 'Temperatur rejimi pozulub',
      'Zal', 'Problem varmı?', 'Xeyr', 'Təsdiqlənib', 'Temperatur', 'İlkin cavab: 10 — isti', 'Düzəliş: Menecer — Termometr səhv oxunub',
      'Problem: Adi — isti', 'Rədd edilib', 'Hələ də yüksəkdir', 'Yoxlanılmayıb', '+2 foto · 1 video',
      'Audit ID: 0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', 'Səhifə 1 / 1',
    ]) {
      expect(flat, s).toContain(s);
    }
    expect(imageCount(pdf)).toBe(3);
  });

  it('prints only the current score when the run was never corrected', async () => {
    const { text } = await extractText(new Uint8Array(await buildAuditReport(reportData({ runScore: 50, originalScore: null, comment: null }))), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).toContain('İcra balı 50.0%');
    expect(flat).not.toContain('İlkin bal');
    expect(flat).toContain('Yekun şərh —');
  });

  it('embeds at most 3 photos per item and 40 per report, in checklist order, counting the rest', () => {
    const items = Array.from({ length: 20 }, (_, i) => `i${i}`);
    const photos = new Map(items.map((id) => [id, ['p1', 'p2', 'p3', 'p4']]));
    const { embedded, skipped } = selectReportPhotos(items, photos);
    expect([...embedded.values()].flat()).toHaveLength(40);
    expect(embedded.get('i0')).toEqual(['p1', 'p2', 'p3']);
    expect(embedded.get('i13')).toEqual(['p1']);
    expect(embedded.has('i14')).toBe(false);
    expect([skipped.get('i0'), skipped.get('i13'), skipped.get('i19')]).toEqual([1, 3, 4]);
    expect(selectReportPhotos(['x'], new Map()).embedded.size).toBe(0);
  });
});
```

`apps/api/test/png.ts`:

```ts
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A valid 8-bit RGB PNG of seeded noise. Noise does not compress, so the file is about width × height × 3 bytes
 * (708 × 708 ≈ 1.5 MB); different seeds give different images, so PDFKit embeds each one.
 */
export function noisePng(width: number, height: number, seed = 1): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < raw.length; i++) {
    if (i % stride === 0) continue; // filter type 0 for every row
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    raw[i] = x & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
```

`apps/api/test/audit-report-perf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type AuditReportData, buildAuditReport, type ReportSection } from '../src/audits/report/audit-report-builder';
import { noisePng } from './png';

const MB = 1024 * 1024;

/** Spec §7.2: 200 items and 40 photos of about 1.5 MB build in under 10 s and under 300 MB of heap growth. */
describe('audit report performance', () => {
  it('builds 200 items with 40 photos of 1.5 MB in under 10 s and 300 MB of heap', async () => {
    const photos = Array.from({ length: 40 }, (_, i) => noisePng(708, 708, i + 1));
    expect(photos[0]!.length).toBeGreaterThan(1.4 * MB);
    const sections: ReportSection[] = Array.from({ length: 10 }, (_, s) => ({
      title: `Bölmə ${s + 1}`,
      items: Array.from({ length: 20 }, (_, i) => {
        const n = s * 20 + i;
        // The first 14 items carry 3, 3, …, 1 photos: 40 in all, as selectReportPhotos would pass them.
        const own = n < 13 ? [n * 3, n * 3 + 1, n * 3 + 2] : n === 13 ? [39] : [];
        return {
          itemId: `item-${n}`,
          label: `Sual ${n + 1}: soyuducunun temperaturu normadadırmı?`,
          depth: n % 3 === 2 ? 1 : 0,
          answer: n % 2 ? 'Bəli' : '5 °C — qeyd yoxdur',
          original: n % 10 === 0 ? '10 °C' : null,
          correctedBy: n % 10 === 0 ? { name: 'Menecer', reason: 'Termometr səhv oxunub' } : null,
          verdict: n % 7 === 0 ? 'rejected' : 'approved',
          verdictComment: n % 7 === 0 ? 'Uyğun deyil' : null,
          problem: n % 9 === 0 ? { severity: 'normal', note: 'Temperatur yüksəkdir' } : null,
          photos: own.map((p) => `data:image/png;base64,${photos[p]!.toString('base64')}`),
          morePhotos: 0,
          videos: n % 25 === 0 ? 1 : 0,
        };
      }),
    }));
    const data: AuditReportData = {
      auditId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', tenantName: 'Acme MMC', timezone: 'Asia/Baku', checklistName: 'Böyük yoxlama', versionNumber: 1,
      siteName: 'Filial 1', executorName: 'İşçi 1', localDate: '2026-11-02',
      window: { startsAt: new Date('2026-11-02T04:00:00Z'), closesAt: new Date('2026-11-02T07:00:00Z') },
      startedAt: new Date('2026-11-02T04:10:00Z'), completedAt: new Date('2026-11-02T05:00:00Z'), syncedAt: new Date('2026-11-02T05:00:00Z'),
      auditorName: 'Auditor', finishedAt: new Date('2026-11-02T06:00:00Z'), result: 'passed',
      auditScore: { approved: 171, rejected: 29, reviewed: 200, percent: 85.5 }, runScore: 90, originalScore: 80, comment: null,
      sections, generatedAt: new Date('2026-11-02T06:01:00Z'),
    };
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 20);
    const started = performance.now();
    const pdf = await buildAuditReport(data);
    const ms = performance.now() - started;
    clearInterval(sampler);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    console.info(`audit report: ${Math.round(ms)} ms, heap +${Math.round((peak - baseline) / MB)} MB, rss ${Math.round(process.memoryUsage().rss / MB)} MB, ${Math.round(pdf.length / MB)} MB PDF`);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(40);
    expect(ms).toBeLessThan(10_000);
    expect(peak - baseline).toBeLessThan(300 * MB);
  }, 60_000);
});
```

`apps/api/test/memory-mailer.ts` becomes:

```ts
import type { MailMessage } from '../src/mail/mailer';

export class MemoryMailer {
  readonly sent: MailMessage[] = [];
  /** Sends to these addresses fail, as an SMTP server refusing a recipient would (SP8 Review Focus 4). */
  readonly failFor = new Set<string>();

  async send(message: MailMessage): Promise<void> {
    if (this.failFor.has(message.to)) throw new Error(`550 Mailbox unavailable: ${message.to}`);
    this.sent.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to.toLowerCase());
  }

  /** Extracts the `token=` query value from the most recent mail to `to`. */
  tokenFor(to: string): string {
    const mail = this.lastTo(to);
    const match = mail?.text.match(/token=([^\s&]+)/);
    if (!match?.[1]) throw new Error(`No token mail for ${to}`);
    return decodeURIComponent(match[1]);
  }
}
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- mailer templates.test answer-text audit-report-builder audit-report-perf`
Expected: FAIL: `auditReportMail`, `answer-text` and `audit-report-builder` don't exist, and the mailer test's `attachments` is not part of `MailMessage` (typecheck).

- [ ] **Step 3: Add attachments and the report mail**

`apps/api/src/mail/mailer.ts`, the message types become:

```ts
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** SP8: the audit report PDF (spec §7.2). Nodemailer takes this shape as it is. */
  attachments?: MailAttachment[];
}
```

(`SmtpMailer.send` already spreads the whole message into `sendMail`.)

`apps/api/src/mail/templates.ts`, append (and add the imports at the top):

```ts
import { AUDIT_REPORT_CONTENT_TYPE, type AuditResult } from '@taskop/contracts';
import { az, interpolate } from '@taskop/i18n';
```

```ts
/** SP8 spec §7.2: plain text with the PDF attached; one message per recipient. */
export function auditReportMail(p: {
  to: string;
  checklistName: string;
  siteName: string;
  localDate: string;
  result: AuditResult;
  auditorName: string;
  pdf: Buffer;
  filename: string;
}): MailMessage {
  const vars = { checklist: p.checklistName, site: p.siteName, date: p.localDate.split('-').reverse().join('.'), result: az.audits.results[p.result], auditor: p.auditorName };
  return {
    to: p.to,
    subject: interpolate(az.audits.email.subject, vars),
    text: interpolate(az.audits.email.body, vars),
    attachments: [{ filename: p.filename, content: p.pdf, contentType: AUDIT_REPORT_CONTENT_TYPE }],
  };
}
```

`apps/api/src/reports/pdf/pdf-document.ts`, the last function becomes:

```ts
/** Renders any definition with the Noto Sans fonts and the access policies above; SP8's audit report uses it too. */
export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake.createPdf(definition).getBuffer();
}

export function toPdf(doc: ReportDocument): Promise<Buffer> {
  return renderPdf(pdfDefinition(doc));
}
```

- [ ] **Step 4: Write the answer text and the builder**

`apps/api/src/audits/report/answer-text.ts`:

```ts
import { type Answer, isAnswered, type Item } from '@taskop/contracts';
import { az, interpolate } from '@taskop/i18n';

const L = az.audits.report;

/** An answer as the audit report prints it (spec §7.2). */
export function answerText(item: Item, a: Answer | undefined): string {
  if (!a || !isAnswered(item, a)) return L.noAnswer;
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny':
      return (a.optionIds ?? [])
        .map((id) => {
          const o = (item.options as ReadonlyArray<{ id: string; key: 'yes' | 'no' | 'confirm' | 'deny' }>).find((x) => x.id === id);
          return o ? az.checklists.builder.fixedOptions[o.key] : id;
        })
        .join(', ');
    case 'single_choice':
    case 'multi_choice':
      return (a.optionIds ?? []).map((id) => item.options.find((x) => x.id === id)?.label || id).join(', ');
    case 'number':
      return `${a.number}${item.unit ? ` ${item.unit}` : ''}`;
    case 'text':
    case 'comment':
      return a.text!;
    case 'datetime':
      return a.datetime!;
    case 'photo':
      return interpolate(L.photos, { count: a.photos!.length });
    case 'video':
      return interpolate(L.videos, { count: a.videos!.length });
  }
}

/** The answer followed by the item's note. */
export function answerLine(item: Item, a: Answer | undefined): string {
  const note = a?.note?.trim();
  return note ? `${answerText(item, a)} — ${note}` : answerText(item, a);
}
```

`apps/api/src/audits/report/audit-report-builder.ts`:

```ts
import { AUDIT_LIMITS, type AuditResult, type AuditScore, type AuditVerdict, type ProblemSeverity } from '@taskop/contracts';
import { az, interpolate } from '@taskop/i18n';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatInstant } from '../../reports/export/report-table';
import { renderPdf } from '../../reports/pdf/pdf-document';

const L = az.audits.report;

/** One item row, already printable: the loader (Task 15) turns the run into these. */
export interface ReportItem {
  itemId: string;
  label: string;
  /** Follow-up depth, for the indent. */
  depth: number;
  /** The current answer with its note. */
  answer: string;
  /** The original answer with its note when a correction changed it; null otherwise. */
  original: string | null;
  /** The latest correction of the item. */
  correctedBy: { name: string; reason: string } | null;
  verdict: AuditVerdict | null;
  verdictComment: string | null;
  /** The item's active rule or manual problem (the more severe one). */
  problem: { severity: ProblemSeverity; note: string | null } | null;
  /** data: URLs of the embedded photos (at most 3, see selectReportPhotos). */
  photos: string[];
  /** Photos counted, not embedded. */
  morePhotos: number;
  videos: number;
}

export interface ReportSection {
  title: string;
  items: ReportItem[];
}

export interface AuditReportData {
  auditId: string;
  tenantName: string;
  timezone: string;
  checklistName: string;
  versionNumber: number;
  siteName: string;
  executorName: string;
  localDate: string;
  window: { startsAt: Date; closesAt: Date };
  /** Device times (FR-10.14). */
  startedAt: Date;
  completedAt: Date | null;
  /** The server receipt of the completion. */
  syncedAt: Date | null;
  auditorName: string;
  finishedAt: Date;
  result: AuditResult;
  auditScore: AuditScore;
  runScore: number | null;
  /** The score before the first correction; null when never corrected. */
  originalScore: number | null;
  comment: string | null;
  sections: ReportSection[];
  generatedAt: Date;
}

/** Spec §7.2: up to 3 photos per item and 40 per report, in checklist order; the rest are counted, not embedded. */
export function selectReportPhotos(itemIds: readonly string[], photosByItem: ReadonlyMap<string, readonly string[]>): { embedded: Map<string, string[]>; skipped: Map<string, number> } {
  const embedded = new Map<string, string[]>();
  const skipped = new Map<string, number>();
  let left = AUDIT_LIMITS.photosPerReport;
  for (const id of itemIds) {
    const all = photosByItem.get(id) ?? [];
    const take = all.slice(0, Math.min(AUDIT_LIMITS.photosPerItem, left));
    left -= take.length;
    if (take.length) embedded.set(id, [...take]);
    if (all.length > take.length) skipped.set(id, all.length - take.length);
  }
  return { embedded, skipped };
}

const percent = (v: number | null): string => (v === null ? L.none : `${v.toFixed(1)}%`);
const at = (d: Date | null, tz: string): string => (d ? formatInstant(d, tz) : L.none);

/** A4 portrait: the header table, one table per section (item, answer, verdict), and a footer with time, id and page. */
export function auditReportDefinition(d: AuditReportData): TDocumentDefinitions {
  const tz = d.timezone;
  const images: Record<string, string> = {};
  const image = (dataUrl: string): string => {
    const key = `photo${Object.keys(images).length}`;
    images[key] = dataUrl;
    return key;
  };
  const runScore = d.originalScore !== null && d.originalScore !== d.runScore ? `${percent(d.runScore)} (${L.originalScore}: ${percent(d.originalScore)})` : percent(d.runScore);
  const header: [string, string][] = [
    [L.checklist, `${d.checklistName} · ${interpolate(L.version, { number: d.versionNumber })}`],
    [L.site, d.siteName],
    [L.executor, d.executorName],
    [L.window, `${formatInstant(d.window.startsAt, tz)} – ${formatInstant(d.window.closesAt, tz)}`],
    [L.startedAt, at(d.startedAt, tz)],
    [L.completedAt, at(d.completedAt, tz)],
    [L.syncedAt, at(d.syncedAt, tz)],
    [L.auditor, d.auditorName],
    [L.finishedAt, at(d.finishedAt, tz)],
    [L.result, az.audits.results[d.result]],
    [L.auditScore, `${percent(d.auditScore.percent)} (${d.auditScore.approved}/${d.auditScore.reviewed})`],
    [L.runScore, runScore],
    [L.comment, d.comment ?? L.none],
  ];
  const content: Content[] = [
    { text: d.tenantName, style: 'tenant' },
    { text: L.title, style: 'title' },
    { table: { widths: [130, '*'], body: header.map(([k, v]): TableCell[] => [{ text: k, bold: true }, { text: v }]) }, layout: 'noBorders' },
  ];
  for (const section of d.sections) {
    const body: TableCell[][] = [[L.item, L.answer, L.verdict].map((t): TableCell => ({ text: t, bold: true, fillColor: '#eeeeee' }))];
    for (const it of section.items) {
      const answer: Content[] = [{ text: it.answer }];
      if (it.original !== null) answer.push({ text: `${L.original}: ${it.original}`, style: 'muted' });
      if (it.correctedBy) answer.push({ text: interpolate(L.correctedBy, { name: it.correctedBy.name, reason: it.correctedBy.reason }), style: 'muted' });
      if (it.problem) answer.push({ text: `${L.problem}: ${az.executions.severities[it.problem.severity]}${it.problem.note ? ` — ${it.problem.note}` : ''}`, color: '#b42318' });
      if (it.photos.length) answer.push({ columns: it.photos.map((p): Content => ({ image: image(p), fit: [150, 150] })), columnGap: 6, margin: [0, 4, 0, 0] });
      const extras = [it.morePhotos ? interpolate(L.morePhotos, { count: it.morePhotos }) : null, it.videos ? interpolate(L.videos, { count: it.videos }) : null].filter(Boolean);
      if (extras.length) answer.push({ text: extras.join(' · '), style: 'muted' });
      const verdict: Content[] = [{ text: it.verdict ? az.audits.verdicts[it.verdict] : az.audits.verdicts.unreviewed, bold: it.verdict === 'rejected' }];
      if (it.verdictComment) verdict.push({ text: it.verdictComment, style: 'muted' });
      body.push([{ text: it.label, margin: [it.depth * 10, 0, 0, 0] }, { stack: answer }, { stack: verdict }]);
    }
    content.push({ text: section.title, style: 'section' }, { table: { headerRows: 1, dontBreakRows: true, widths: ['30%', '45%', '25%'], body }, layout: 'lightHorizontalLines' });
  }
  return {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 40],
    info: { title: `${L.title} ${d.auditId}`, creator: 'Taskop' },
    defaultStyle: { font: 'NotoSans', fontSize: 9 },
    styles: {
      tenant: { fontSize: 14, bold: true },
      title: { fontSize: 12, margin: [0, 2, 0, 8] },
      section: { fontSize: 11, bold: true, margin: [0, 12, 0, 4] },
      muted: { color: '#666666', fontSize: 8 },
    },
    images,
    footer: (current, total) => ({
      columns: [
        { width: '*', text: `${L.generatedAt}: ${formatInstant(d.generatedAt, tz)} · ${L.auditId}: ${d.auditId}` },
        { width: 'auto', text: interpolate(L.page, { page: current, pages: total }), alignment: 'right' },
      ],
      margin: [28, 10, 28, 0],
      fontSize: 7,
      color: '#666666',
    }),
    content,
  };
}

export function buildAuditReport(d: AuditReportData): Promise<Buffer> {
  return renderPdf(auditReportDefinition(d));
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- mailer templates.test answer-text audit-report-builder audit-report-perf pdf-document auth-signup`
Expected: PASS. The performance test prints one line such as `audit report: 1800 ms, heap +120 MB, rss 640 MB, 58 MB PDF`; copy it into the commit message body. If the PDF holds fewer than 40 images, pdfmake did not take the `data:` URLs from `images`: check that the `image` value is the dictionary key (`photo0`, …), not the URL.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/mail apps/api/src/reports/pdf/pdf-document.ts apps/api/src/audits/report apps/api/test/memory-mailer.ts apps/api/test/png.ts apps/api/test/audit-report-perf.test.ts
git commit -m "feat(api): build the audit report PDF and send mail attachments" -m "<the line the performance test printed>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The `audit.report` job, `GET /audits/:id/report.pdf` and `POST /audits/:id/report/send`

**Files:**
- Modify: `apps/api/src/storage/s3.service.ts`, `apps/api/src/audits/audits.service.ts`, `apps/api/src/audits/audits.controller.ts`, `apps/api/src/audits/audits.module.ts`, `apps/api/test/app.ts`
- Create: `apps/api/src/audits/report/audit-report-loader.ts`, `apps/api/src/audits/report/audit-report.job.ts`, `apps/api/test/memory-storage.ts`
- Test: `apps/api/test/audit-report-job.test.ts`, `apps/api/test/storage-objects.test.ts`

**Interfaces:**
- Consumes: `buildAuditReport`, `selectReportPhotos`, `answerLine`, `type AuditReportData` (Task 14); `auditReportMail`, `MAILER`, `type Mailer` (Task 14); `AUDIT_QUEUES`, `AUDIT_REPORT_JOB`, `type AuditReportJobData` (Task 13); `JobsService.defineWorker(name, handler, opts)`; `DbService.withTenant`; `auditReportFileName`, `AUDIT_REPORT_CONTENT_TYPE`, `answersEqual`, `visibleItems` (contracts).
- Produces:
  - `S3Service.putObject(key: string, body: Buffer, contentType: string): Promise<void>` and `S3Service.getObject(key: string): Promise<Buffer | null>`.
  - `AuditReportLoader.load(tenantId: string, auditId: string): Promise<AuditReportData | null>` and `AuditReportLoader.mailInfo(tenantId: string, auditId: string): Promise<ReportMailInfo | null>` with `interface ReportMailInfo { checklistName: string; siteName: string; localDate: string; result: AuditResult; auditorName: string }`.
  - `AuditReportJob.run(job: AuditReportJobData): Promise<'sent' | 'stored' | 'missing' | 'failed'>` and the pg-boss worker on `audit.report` (the SP6 settings of Global Constraints, dead letter `audit.dead`).
  - `AuditsService.report(a: Actor, auditId: string): Promise<{ body: Buffer; filename: string }>` and `AuditsService.sendReport(a: Actor, auditId: string, input: SendAuditReportParams): Promise<AuditDto>`; routes `GET /audits/:id/report.pdf` (`audits.perform` or `reports.view`) and `POST /audits/:id/report/send` (`audits.perform`).
  - `createTestApp(overrides, { clock?, storage? })`: `storage` replaces `S3Service`; `test/memory-storage.ts`: `MemoryStorage` with `objects`, `failPut`.

- [ ] **Step 1: Write the test helpers**

`apps/api/test/memory-storage.ts`:

```ts
import type { PresignedPut, StoredObject } from '../src/storage/s3.service';

/** An in-memory stand-in for S3Service, so job tests need no SeaweedFS. `failPut` makes every put throw. */
export class MemoryStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  failPut = false;

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.failPut) throw new Error('storage unavailable');
    this.objects.set(key, { body, contentType });
  }

  async getObject(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async head(key: string): Promise<StoredObject | null> {
    const o = this.objects.get(key);
    return o ? { contentLength: o.body.length, contentType: o.contentType } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    return { url: `http://files.taskop.test/${key}`, headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) }, expiresAt: new Date(Date.now() + 900_000) };
  }

  async presignGet(key: string): Promise<{ url: string; expiresAt: Date }> {
    return { url: `http://files.taskop.test/${key}`, expiresAt: new Date(Date.now() + 300_000) };
  }
}
```

`apps/api/test/app.ts`:
- add `import { S3Service } from '../src/storage/s3.service';`
- `createTestApp`'s signature and overrides become

```ts
export async function createTestApp(overrides: Record<string, string> = {}, opts: { clock?: Clock; storage?: object } = {}): Promise<TestApp> {
  const config = loadConfig(testEnv(overrides));
  const mailer = new MemoryMailer();
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(MAILER)
    .useValue(mailer);
  if (opts.clock) builder = builder.overrideProvider(Clock).useValue(opts.clock);
  if (opts.storage) builder = builder.overrideProvider(S3Service).useValue(opts.storage);
```

(the rest of the function is unchanged).

- [ ] **Step 2: Write the failing tests**

`apps/api/test/storage-objects.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Service } from '../src/storage/s3.service';
import { createTestApp, type TestApp } from './app';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

describe('whole-object storage against SeaweedFS (SP8 audit reports)', () => {
  let sw: Seaweed;
  let t: TestApp;
  beforeAll(async () => {
    sw = await startSeaweedfs();
    t = await createTestApp(sw.env);
  });
  afterAll(async () => {
    await t?.close();
    await sw?.stop();
  });

  it('puts, heads and gets an object, and answers null for a missing one', async () => {
    const s3 = t.app.get(S3Service);
    const body = Buffer.from('%PDF-1.7 audit');
    await s3.putObject('tenants/t1/audits/a1/report.pdf', body, 'application/pdf');
    expect(await s3.head('tenants/t1/audits/a1/report.pdf')).toEqual({ contentLength: body.length, contentType: 'application/pdf' });
    expect(await s3.getObject('tenants/t1/audits/a1/report.pdf')).toEqual(body);
    expect(await s3.getObject('tenants/t1/audits/missing/report.pdf')).toBeNull();
  });
});
```

`apps/api/test/audit-report-job.test.ts`:

```ts
import { extractText } from 'unpdf';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditReportJob } from '../src/audits/report/audit-report.job';
import { JobsService } from '../src/scheduling/jobs.service';
import { createTestApp, type TestApp } from './app';
import { auditLogOf, auditWorld, markUploaded, startAudit, verdictAll } from './audit-fixtures';
import { FakeClock } from './fake-clock';
import { MemoryStorage } from './memory-storage';
import { ownerQuery } from './owner-db';
import { noisePng } from './png';
import { MONDAY_0800 } from './scheduling-fixtures';

const FILE = 'taskop-audit-icra-yoxlamasi-2026-11-02.pdf';

interface AuditDbRow {
  report_status: string;
  report_storage_key: string | null;
  report_recipients: string[];
  report_sent_at: Date | null;
  report_attempts: number;
}

describe('the audit report job (spec §7.2)', () => {
  const clock = new FakeClock(MONDAY_0800);
  const storage = new MemoryStorage();
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock, storage });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    storage.failPut = false;
    t.mailer.failFor.clear();
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A finished audit (failed: the temperature rejected) whose photo is in storage; recipients from the checklist plus `extra`. */
  async function finished(opts: { checklistEmails?: string[]; extra?: string[] } = {}) {
    const a = await auditWorld(t, clock);
    await ownerQuery('update checklists set audit_report_emails = $2 where id = $1', [a.w.checklistId, opts.checklistEmails ?? ['qa@acme.az']]);
    await markUploaded(a.executionId);
    const key = (await ownerQuery<{ storage_key: string }>('select storage_key from execution_media where id = $1', [a.photoId])).rows[0]!.storage_key;
    storage.objects.set(key, { body: noisePng(16, 16, 7), contentType: 'image/jpeg' });
    clock.set('2026-11-02T05:00:00Z');
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id], [a.w.c.temp.id]);
    clock.set('2026-11-02T06:00:00Z');
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, { result: 'failed', comment: 'Temperatur yüksəkdir', extraEmails: opts.extra ?? [] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { a, auditId, job: { tenantId: a.w.s.tenantId, auditId } };
  }
  const row = async (auditId: string) => (await ownerQuery<AuditDbRow>('select * from audits where id = $1', [auditId])).rows[0]!;
  const run = (job: { tenantId: string; auditId: string; emails?: string[] }) => t.app.get(AuditReportJob).run(job);

  it('builds, stores and mails the report, one message per recipient', async () => {
    const { a, auditId, job } = await finished({ extra: ['boss@acme.az'] });
    const pending = await a.auditor.api.get(`/api/v1/audits/${auditId}/report.pdf`);
    expect([pending.status, pending.body.error.code]).toEqual([409, 'REPORT_NOT_READY']);
    clock.set('2026-11-02T06:01:00Z');
    expect(await run(job)).toBe('sent');
    const r = await row(auditId);
    expect(r).toMatchObject({ report_status: 'ready', report_storage_key: `tenants/${a.w.s.tenantId}/audits/${auditId}/report.pdf`, report_attempts: 0 });
    expect(r.report_sent_at?.toISOString()).toBe('2026-11-02T06:01:00.000Z');
    const stored = storage.objects.get(r.report_storage_key!)!;
    expect(stored.contentType).toBe('application/pdf');
    const mails = t.mailer.sent.filter((m) => m.attachments?.length && ['qa@acme.az', 'boss@acme.az'].includes(m.to));
    expect(mails.map((m) => [m.to, m.subject, m.attachments![0]!.filename])).toEqual([
      ['qa@acme.az', 'Audit hesabatı: İcra yoxlaması — Filial 1, 02.11.2026', FILE],
      ['boss@acme.az', 'Audit hesabatı: İcra yoxlaması — Filial 1, 02.11.2026', FILE],
    ]);
    const { text } = await extractText(new Uint8Array(stored.body), { mergePages: true });
    const flat = text.replace(/\s+/g, ' ');
    for (const s of ['Audit hesabatı', 'İcra yoxlaması · Versiya 1', 'Filial 1', 'İşçi 1', 'Nəticə Uğursuz', 'Audit balı 75.0% (3/4)', 'Temperatur yüksəkdir', 'Problem: Adi — isti', 'Auditor']) {
      expect(flat, s).toContain(s);
    }
    expect((stored.body.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length).toBe(1);

    const pdf = await a.auditor.api.get(`/api/v1/audits/${auditId}/report.pdf`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="${FILE}"`);
    expect((await a.manager.api.get(`/api/v1/audits/${auditId}/report.pdf`)).status).toBe(200);
    expect((await a.outsider.api.get(`/api/v1/audits/${auditId}/report.pdf`)).status).toBe(404);
    expect((await a.worker.api.get(`/api/v1/audits/${auditId}/report.pdf`)).status).toBe(403);
    expect((await a.auditor.api.get(`/api/v1/audits/${auditId}`)).body).toMatchObject({ reportStatus: 'ready', reportSentAt: '2026-11-02T06:01:00.000Z' });
  });

  it('sends to the remaining recipients when one fails', async () => {
    const { auditId, job } = await finished({ checklistEmails: ['qa@acme.az', 'bad@acme.az'], extra: ['boss@acme.az'] });
    t.mailer.failFor.add('bad@acme.az');
    expect(await run(job)).toBe('sent');
    expect(t.mailer.sent.filter((m) => m.attachments?.length).map((m) => m.to)).toEqual(expect.arrayContaining(['qa@acme.az', 'boss@acme.az']));
    expect(t.mailer.sent.map((m) => m.to)).not.toContain('bad@acme.az');
    expect(await row(auditId)).toMatchObject({ report_status: 'ready', report_attempts: 0 });
    expect((await row(auditId)).report_sent_at).not.toBeNull();
  });

  it('retries when every send fails, reusing the stored PDF, and gives up on the fifth failure', async () => {
    const { a, auditId, job } = await finished();
    t.mailer.failFor.add('qa@acme.az');
    for (let attempt = 1; attempt <= 4; attempt++) {
      await expect(run(job), `attempt ${attempt}`).rejects.toThrow(/Every audit report e-mail/);
      expect((await row(auditId)).report_attempts).toBe(attempt);
    }
    expect(storage.objects.size).toBeGreaterThan(0);
    expect(await run(job)).toBe('failed');
    expect(await row(auditId)).toMatchObject({ report_status: 'failed', report_sent_at: null, report_attempts: 5 });
    expect((await a.auditor.api.get(`/api/v1/audits/${auditId}/report.pdf`)).body.error.code).toBe('REPORT_NOT_READY');
  });

  it('rebuilds a failed report through POST /report/send and sends it to the given addresses', async () => {
    const { a, auditId, job } = await finished();
    t.mailer.failFor.add('qa@acme.az');
    for (let attempt = 1; attempt <= 4; attempt++) await expect(run(job)).rejects.toThrow();
    expect(await run(job)).toBe('failed');
    t.mailer.failFor.clear();
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const res = await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, { emails: ['New@acme.az'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ reportStatus: 'pending', reportRecipients: ['qa@acme.az'] });
    expect(await row(auditId)).toMatchObject({ report_status: 'pending', report_attempts: 0 });
    expect(send).toHaveBeenCalledWith('audit.report', { tenantId: a.w.s.tenantId, auditId, emails: ['new@acme.az'] });
    expect((await auditLogOf(auditId)).at(-1)).toMatchObject({ action: 'audit.report_sent', after: { recipients: ['new@acme.az'], rebuilt: true } });
    expect(await run({ ...job, emails: ['new@acme.az'] })).toBe('sent');
    expect(t.mailer.lastTo('new@acme.az')?.attachments?.[0]?.filename).toBe(FILE);
    expect((await row(auditId)).report_status).toBe('ready');
    expect((await a.manager.api.post(`/api/v1/audits/${auditId}/report/send`, {})).status).toBe(403);
  });

  it('retries when storing the PDF fails, and builds without mailing when nobody is listed', async () => {
    const { auditId, job } = await finished({ checklistEmails: [] });
    storage.failPut = true;
    await expect(run(job)).rejects.toThrow(/storage unavailable/);
    expect(await row(auditId)).toMatchObject({ report_status: 'pending', report_attempts: 1 });
    storage.failPut = false;
    expect(await run(job)).toBe('stored');
    expect(await row(auditId)).toMatchObject({ report_status: 'ready', report_sent_at: null });
  });

  it('refuses to send the report of an audit that has not finished, and skips a missing audit', async () => {
    const a = await auditWorld(t, clock);
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/report/send`, {})).body.error.code).toBe('REPORT_NOT_READY');
    expect(await run({ tenantId: a.w.s.tenantId, auditId: uuidv7() })).toBe('missing');
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- audit-report-job storage-objects`
Expected: FAIL: `AuditReportJob` doesn't exist and `S3Service.putObject` is not a function.

- [ ] **Step 4: Store and read whole objects**

`apps/api/src/storage/s3.service.ts`, add after `head`:

```ts
  /** Stores a whole object from the server (SP8: the audit report PDF). */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.internal.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
  }

  /** The whole object, or null when it does not exist (SP8: report download and photos for the report). */
  async getObject(key: string): Promise<Buffer | null> {
    try {
      const r = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
```

- [ ] **Step 5: Write the loader**

`apps/api/src/audits/report/audit-report-loader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type Answers, answersEqual, type AuditResult, type AuditScore, type ScoreResult, visibleItems } from '@taskop/contracts';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { auditItemVerdicts, audits, checklists, checklistVersions, executionCorrections, executionMedia, executionProblems, executions, occurrences, sites, tenants, users } from '../../db/schema';
import { ExecutionLookups } from '../../executions/execution-lookups';
import { S3Service } from '../../storage/s3.service';
import { answerLine } from './answer-text';
import { type AuditReportData, type ReportItem, selectReportPhotos } from './audit-report-builder';

export interface ReportMailInfo {
  checklistName: string;
  siteName: string;
  localDate: string;
  result: AuditResult;
  auditorName: string;
}

interface Media {
  id: string;
  kind: 'photo' | 'video';
  mime: string;
  status: 'pending' | 'uploaded';
  storageKey: string;
}

/** Spec §7.2 step 1: the audit, the run, the version, the corrections and the media, read for the PDF and the e-mail. */
@Injectable()
export class AuditReportLoader {
  constructor(
    private readonly db: DbService,
    private readonly lookups: ExecutionLookups,
    private readonly s3: S3Service,
  ) {}

  async mailInfo(tenantId: string, auditId: string): Promise<ReportMailInfo | null> {
    return this.db.withTenant(tenantId, null, async (tx) => {
      const [r] = await tx
        .select({ checklistName: checklists.name, siteName: sites.name, localDate: occurrences.localDate, result: audits.result, auditorName: users.fullName })
        .from(audits)
        .innerJoin(occurrences, eq(occurrences.id, audits.occurrenceId))
        .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
        .innerJoin(sites, eq(sites.id, occurrences.siteId))
        .leftJoin(users, eq(users.id, audits.auditorUserId))
        .where(eq(audits.id, auditId));
      if (!r?.result) return null;
      return { checklistName: r.checklistName, siteName: r.siteName, localDate: r.localDate, result: r.result, auditorName: r.auditorName ?? 'Taskop' };
    });
  }

  /** Rows in one tenant transaction; the photo bytes are fetched afterwards, outside it. Null for a missing or unfinished audit. */
  async load(tenantId: string, auditId: string): Promise<AuditReportData | null> {
    const plan = await this.db.withTenant(tenantId, null, async (tx) => {
      const [a] = await tx
        .select({ audit: audits, auditorName: users.fullName })
        .from(audits)
        .leftJoin(users, eq(users.id, audits.auditorUserId))
        .where(eq(audits.id, auditId));
      if (!a || a.audit.status !== 'finished' || !a.audit.finishedAt || !a.audit.result) return null;
      const [x] = await tx
        .select({ e: executions, o: occurrences, executorName: users.fullName, checklistName: checklists.name, siteName: sites.name, versionNumber: checklistVersions.number })
        .from(executions)
        .innerJoin(occurrences, eq(occurrences.id, executions.occurrenceId))
        .innerJoin(users, eq(users.id, executions.executorUserId))
        .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
        .innerJoin(sites, eq(sites.id, occurrences.siteId))
        .innerJoin(checklistVersions, eq(checklistVersions.id, executions.checklistVersionId))
        .where(eq(executions.id, a.audit.executionId));
      const [tenant] = await tx.select({ name: tenants.name, timezone: tenants.timezone }).from(tenants);
      const content = await this.lookups.content(x!.e.checklistVersionId);
      const verdicts = await tx.select().from(auditItemVerdicts).where(eq(auditItemVerdicts.auditId, auditId));
      const corrections = await tx
        .select({ itemId: executionCorrections.itemId, reason: executionCorrections.reason, actorName: users.fullName })
        .from(executionCorrections)
        .leftJoin(users, eq(users.id, executionCorrections.actorUserId))
        .where(eq(executionCorrections.executionId, x!.e.id))
        .orderBy(asc(executionCorrections.at), asc(executionCorrections.id));
      const problems = await tx
        .select({ itemId: executionProblems.itemId, severity: executionProblems.severity, note: executionProblems.note })
        .from(executionProblems)
        .where(and(eq(executionProblems.executionId, x!.e.id), isNull(executionProblems.clearedAt)));
      const media: Media[] = await tx
        .select({ id: executionMedia.id, kind: executionMedia.kind, mime: executionMedia.mime, status: executionMedia.status, storageKey: executionMedia.storageKey })
        .from(executionMedia)
        .where(eq(executionMedia.executionId, x!.e.id));
      return { a, x: x!, tenant: tenant!, content, verdicts, corrections, problems, media };
    });
    if (!plan) return null;
    const { a, x, tenant, content, verdicts, corrections, problems, media } = plan;
    const answers = x.e.answers as Answers;
    const original = (x.e.originalAnswers as Answers | null) ?? null;
    const visible = visibleItems(content, answers);
    const byId = new Map(media.map((m) => [m.id, m]));
    // Only uploaded photos can be embedded; the selection keeps checklist order.
    const photosOf = new Map(visible.map((v) => [v.item.id, (answers[v.item.id]?.photos ?? []).filter((id) => byId.get(id)?.status === 'uploaded')]));
    const { embedded, skipped } = selectReportPhotos(visible.map((v) => v.item.id), photosOf);
    const dataUrls = new Map<string, string>();
    for (const id of [...embedded.values()].flat()) {
      const m = byId.get(id)!;
      const body = await this.s3.getObject(m.storageKey);
      if (body) dataUrls.set(id, `data:${m.mime};base64,${body.toString('base64')}`);
    }
    const latestCorrection = new Map(corrections.map((c) => [c.itemId, c]));
    const sections = content.sections.map((s) => ({
      title: s.title,
      items: visible
        .filter((v) => v.sectionId === s.id)
        .map(({ item, depth }): ReportItem => {
          const current = answers[item.id];
          const changed = original !== null && !answersEqual(original[item.id], current);
          const correction = changed ? latestCorrection.get(item.id) : undefined;
          const verdict = verdicts.find((v) => v.itemId === item.id);
          const itemProblems = problems.filter((p) => p.itemId === item.id);
          const problem = itemProblems.find((p) => p.severity === 'critical') ?? itemProblems[0];
          const shown = (embedded.get(item.id) ?? []).map((id) => dataUrls.get(id)).filter((u): u is string => u !== undefined);
          const notShown = (embedded.get(item.id)?.length ?? 0) - shown.length;
          return {
            itemId: item.id,
            label: item.label,
            depth,
            answer: answerLine(item, current),
            original: changed ? answerLine(item, original![item.id]) : null,
            correctedBy: correction ? { name: correction.actorName ?? 'Taskop', reason: correction.reason } : null,
            verdict: verdict?.verdict ?? null,
            verdictComment: verdict?.comment ?? null,
            problem: problem ? { severity: problem.severity, note: problem.note } : null,
            photos: shown,
            morePhotos: (skipped.get(item.id) ?? 0) + notShown,
            videos: current?.videos?.length ?? 0,
          };
        }),
    }));
    return {
      auditId,
      tenantName: tenant.name,
      timezone: tenant.timezone,
      checklistName: x.checklistName,
      versionNumber: x.versionNumber ?? 0,
      siteName: x.siteName,
      executorName: x.executorName,
      localDate: x.o.localDate,
      window: { startsAt: x.o.startsAt, closesAt: x.o.closesAt },
      startedAt: x.e.startedAt,
      completedAt: x.e.completedAt,
      syncedAt: x.e.completedReceivedAt,
      auditorName: a.auditorName ?? 'Taskop',
      finishedAt: a.audit.finishedAt!,
      result: a.audit.result!,
      auditScore: a.audit.auditScore as AuditScore,
      runScore: (x.e.score as ScoreResult | null)?.percent ?? null,
      originalScore: x.e.originalCapturedAt ? ((x.e.originalScore as ScoreResult | null)?.percent ?? null) : null,
      comment: a.audit.comment,
      sections,
      generatedAt: new Date(),
    };
  }
}
```

(`generatedAt` is the real time of the build: it is printed in the footer, not compared by any test.)

- [ ] **Step 6: Write the job**

`apps/api/src/audits/report/audit-report.job.ts`:

```ts
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AUDIT_REPORT_CONTENT_TYPE, auditReportFileName } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { Clock } from '../../common/clock';
import { sanitiseForLog } from '../../common/error.filter';
import { DbService } from '../../db/db.service';
import { audits } from '../../db/schema';
import { MAILER, type Mailer } from '../../mail/mailer';
import { auditReportMail } from '../../mail/templates';
import { JobsService } from '../../scheduling/jobs.service';
import { S3Service } from '../../storage/s3.service';
import { buildAuditReport } from './audit-report-builder';
import { AuditReportLoader } from './audit-report-loader';
import { AUDIT_QUEUES, AUDIT_REPORT_JOB, type AuditReportJobData } from './queues';

export type AuditReportOutcome = 'sent' | 'stored' | 'missing' | 'failed';

/**
 * Spec §7.2: build the PDF, store it under tenants/{tenantId}/audits/{auditId}/report.pdf, then mail it, one message per
 * recipient. A stored PDF is reused by retries and resends; a failed recipient is logged and skipped (Spec decision 20).
 */
@Injectable()
export class AuditReportJob implements OnModuleInit {
  private readonly logger = new Logger('AuditReportJob');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly s3: S3Service,
    private readonly loader: AuditReportLoader,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.jobs.defineWorker<AuditReportJobData>(
      AUDIT_QUEUES.report,
      async (job) => {
        await this.run(job);
      },
      {
        retryLimit: AUDIT_REPORT_JOB.retryLimit,
        retryDelay: AUDIT_REPORT_JOB.retryDelay,
        retryDelayMax: AUDIT_REPORT_JOB.retryDelayMax,
        localConcurrency: AUDIT_REPORT_JOB.localConcurrency,
        deadLetter: AUDIT_QUEUES.dead,
      },
    );
  }

  /** Throws below the 5th failed attempt so pg-boss retries with backoff; on the 5th, marks the report failed. */
  async run(job: AuditReportJobData): Promise<AuditReportOutcome> {
    try {
      return await this.attempt(job);
    } catch (e) {
      const attempts = await this.countFailure(job);
      if (attempts === null || attempts < AUDIT_REPORT_JOB.maxAttempts) throw e;
      this.logger.error(sanitiseForLog(e, null), `The report of audit ${job.auditId} failed ${attempts} times; giving up`);
      await this.db.withTenant(job.tenantId, null, (tx) => tx.update(audits).set({ reportStatus: 'failed', updatedAt: this.clock.now() }).where(eq(audits.id, job.auditId)));
      return 'failed';
    }
  }

  private async attempt(job: AuditReportJobData): Promise<AuditReportOutcome> {
    const state = await this.db.withTenant(job.tenantId, null, async (tx) => {
      const [a] = await tx
        .select({ status: audits.status, reportStatus: audits.reportStatus, key: audits.reportStorageKey, recipients: audits.reportRecipients })
        .from(audits)
        .where(eq(audits.id, job.auditId));
      return a ?? null;
    });
    if (!state || state.status !== 'finished') return 'missing';
    let pdf = state.reportStatus === 'ready' && state.key ? await this.s3.getObject(state.key) : null;
    if (!pdf) {
      const data = await this.loader.load(job.tenantId, job.auditId);
      if (!data) return 'missing';
      pdf = await buildAuditReport(data);
      const key = `tenants/${job.tenantId}/audits/${job.auditId}/report.pdf`;
      await this.s3.putObject(key, pdf, AUDIT_REPORT_CONTENT_TYPE);
      await this.db.withTenant(job.tenantId, null, (tx) =>
        tx.update(audits).set({ reportStatus: 'ready', reportStorageKey: key, updatedAt: this.clock.now() }).where(eq(audits.id, job.auditId)),
      );
    }
    const recipients = job.emails ?? state.recipients;
    if (!recipients.length) return 'stored';
    const info = await this.loader.mailInfo(job.tenantId, job.auditId);
    if (!info) return 'missing';
    const filename = auditReportFileName(info.checklistName, info.localDate);
    let sent = 0;
    for (const to of recipients) {
      try {
        await this.mailer.send(auditReportMail({ to, ...info, pdf, filename }));
        sent++;
      } catch (e) {
        this.logger.warn(sanitiseForLog(e, null), `The report of audit ${job.auditId} could not be mailed to one recipient; the others still get it`);
      }
    }
    if (!sent) throw new Error(`Every audit report e-mail of audit ${job.auditId} failed`);
    await this.db.withTenant(job.tenantId, null, (tx) =>
      tx.update(audits).set({ reportSentAt: this.clock.now(), reportAttempts: 0, updatedAt: this.clock.now() }).where(eq(audits.id, job.auditId)),
    );
    return 'sent';
  }

  /** In its own transaction. Null when it cannot be recorded (pg-boss then retries). */
  private async countFailure(job: AuditReportJobData): Promise<number | null> {
    try {
      return await this.db.withTenant(job.tenantId, null, async (tx) => {
        const [r] = await tx
          .update(audits)
          .set({ reportAttempts: sql`${audits.reportAttempts} + 1` })
          .where(eq(audits.id, job.auditId))
          .returning({ attempts: audits.reportAttempts });
        return r?.attempts ?? null;
      });
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 7: Add the download and resend endpoints**

`apps/api/src/audits/audits.service.ts`:
- the contracts import gains `auditReportFileName, type SendAuditReportParams`; add `import { S3Service } from '../storage/s3.service';` and `private readonly s3: S3Service,` as the last constructor parameter;
- add after `finish`:

```ts
  /** GET /audits/:id/report.pdf: the stored PDF; REPORT_NOT_READY while it is pending or after it failed. */
  async report(a: Actor, auditId: string): Promise<{ body: Buffer; filename: string }> {
    const row = await this.readable(a, auditId);
    if (row.reportStatus !== 'ready' || !row.reportStorageKey) throw new AppError('REPORT_NOT_READY');
    const body = await this.s3.getObject(row.reportStorageKey);
    if (!body) throw new AppError('REPORT_NOT_READY');
    const [r] = await this.db
      .tx()
      .select({ name: checklists.name, localDate: occurrences.localDate })
      .from(occurrences)
      .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
      .where(eq(occurrences.id, row.occurrenceId));
    return { body, filename: auditReportFileName(r!.name, r!.localDate) };
  }

  /**
   * POST /audits/:id/report/send: queues the report job for the given addresses or the stored recipients. A failed
   * report is rebuilt (spec §7.2). Audit-logged as audit.report_sent.
   */
  async sendReport(a: Actor, auditId: string, input: SendAuditReportParams): Promise<AuditDto> {
    const { audit } = await this.lockAudit(a, auditId);
    if (audit.status !== 'finished') throw new AppError('REPORT_NOT_READY');
    const rebuilt = audit.reportStatus === 'failed';
    if (rebuilt) await this.db.tx().update(audits).set({ reportStatus: 'pending', reportAttempts: 0, updatedAt: this.clock.now() }).where(eq(audits.id, auditId));
    const recipients = input.emails ?? audit.reportRecipients;
    await this.audit.record({ action: 'audit.report_sent', entityType: 'audit', entityId: auditId, after: { recipients, rebuilt } });
    this.queueReport({ tenantId: audit.tenantId, auditId, ...(input.emails ? { emails: input.emails } : {}) });
    return this.dto(auditId);
  }
```

`apps/api/src/audits/audits.controller.ts`:
- add `StreamableFile` to the Nest import, `ApiProduces` to the swagger import, `AUDIT_REPORT_CONTENT_TYPE` as a value import from `@taskop/contracts`, and `SendAuditReportDto` to the `./dto` import;
- add after `finish`:

```ts
    /** The stored PDF (spec §6.2): REPORT_NOT_READY (409) while it is being built. */
    @Get(':id/report.pdf')
    @performOrReports
    @ApiProduces(AUDIT_REPORT_CONTENT_TYPE)
    @ApiOkResponse({ description: 'The audit report', schema: { type: 'string', format: 'binary' } })
    async report(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<StreamableFile> {
      const file = await this.audits.report(a, id);
      return new StreamableFile(file.body, { type: AUDIT_REPORT_CONTENT_TYPE, disposition: `attachment; filename="${file.filename}"`, length: file.body.length });
    }

    @Post(':id/report/send')
    @HttpCode(200)
    @perform
    @ApiOkResponse({ type: AuditDtoResponse })
    sendReport(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: SendAuditReportDto): Promise<AuditDto> {
      return this.audits.sendReport(a, id, body);
    }
```

`apps/api/src/audits/audits.module.ts`: add `AuditReportLoader` (from `./report/audit-report-loader`) and `AuditReportJob` (from `./report/audit-report.job`) to `providers`.

- [ ] **Step 8: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audit-report-job storage-objects audits-finish jobs-wiring executions-storage`
Expected: PASS. `jobs-wiring` shows the new worker queue is created when jobs are enabled.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/storage/s3.service.ts apps/api/src/audits apps/api/test/app.ts apps/api/test/memory-storage.ts apps/api/test/audit-report-job.test.ts apps/api/test/storage-objects.test.ts
git commit -m "feat(api): build, store and mail the audit report, with download and resend" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Notifications: the three types, the result filter, listeners and texts

**Files:**
- Modify: `apps/api/src/notifications/payloads.ts`, `notification-targets.ts`, `notification-templates.ts`, `notification-recipients.ts`, `notification-rules.ts`, `rules.service.ts`, `notification-fanout.ts`, `notification-listeners.ts`, `apps/api/src/notifications/notification-rules.test.ts`, `apps/api/src/notifications/notification-templates.test.ts`
- Test: `apps/api/test/audit-notifications.test.ts`

**Interfaces:**
- Consumes: the domain events `execution.sent_back` (Task 8), `execution.resubmitted` (Task 9), `audit.finished` (Task 13); `notification_rules.result_filter` (Task 5); `az.notifications.templates`, `az.audits.results`, `interpolate` (Task 3); `isAuditType`, `NOTIFICATION_TYPE_META[...].hasResultFilter`, `DEFAULT_RULES[...].resultFilter` (Task 2).
- Produces:
  - `RunPayload { occurrenceId: string; executionId: string; round?: number; auditId?: string }` for the three types in `PayloadOf`.
  - `RunTarget` (kind `'run'`) in `RuleTarget`: `{ kind: 'run'; occurrence: OccurrenceTarget; executionId: string; executorUserId: string; executorName: string; round: number | null; flaggedCount: number; dueAt: Date | null; sentBackByUserId: string | null; auditResult: AuditResult | null; auditPercent: number | null }`.
  - Rendered inbox rows and push data of the three types with `targetKind: 'occurrence'`, `targetId` = occurrence id, `targetDate` = its local date (Interfaces "Notifications of the three new types").
  - Audiences: `notifyAssignees` = the executor; `notifyCreator` = whoever sent the run back; roles see a run with `assignments.view`, `reports.view`, `audits.perform` or `executions.correct` in their data scope (Spec decision 16).
  - `resultFilter` stored and returned by the rules API (`null` on every type but `audit.finished`, `fields.resultFilter = 'notifications.issues.resultFilterNotApplicable'` otherwise); a `failed` filter skips a passed audit with the fan-out outcome `'filtered'` (Global Constraints: it applies to the whole rule).

- [ ] **Step 1: Write the failing tests**

`apps/api/test/audit-notifications.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditWorld, markUploaded, resubmit, sendBack, startAudit, verdictAll } from './audit-fixtures';
import { answersBody } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { addDevice, deliveriesOf, eventRows, fanOutAll, inboxOf } from './notification-fixtures';
import { MONDAY_0800 } from './scheduling-fixtures';

const LATER = '2026-11-02T12:00:00.000Z';

describe('audit and correction notifications (spec §7.1)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const only = async (userId: string, type: string) => (await inboxOf(userId)).filter((n) => n.type === type);

  /** Finishes an audit with the temperature rejected (failed, 75 %) or everything approved (passed, 100 %). */
  async function finishAudit(a: AuditWorld, result: 'passed' | 'failed') {
    await markUploaded(a.executionId);
    clock.set('2026-11-02T05:00:00Z');
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id], result === 'failed' ? [a.w.c.temp.id] : []);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, { result })).status).toBe(200);
    return auditId;
  }

  it('tells the executor of a send-back by push and inbox, with the count and the due date, opening the run', async () => {
    const a = await auditWorld(t, clock);
    // Earlier events (checklist.assigned, …) fan out before the device exists, so only the new push is counted.
    await fanOutAll(t, a.w.s.tenantId);
    const device = await addDevice(a.w.s.tenantId, a.worker.id);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, {
      items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }, { itemId: a.w.c.photo.id, comment: 'Foto bulanıqdır' }],
      dueAt: '2026-11-03T06:00:00.000Z',
    });
    await fanOutAll(t, a.w.s.tenantId);
    expect(await only(a.worker.id, 'run.correction_required')).toEqual([
      expect.objectContaining({
        title: 'Düzəliş tələb olunur',
        body: 'İcra yoxlaması — Filial 1: 2 bənd düzəliş gözləyir. Son tarix: 03.11.2026 10:00.',
        target_kind: 'occurrence',
        target_id: a.w.occurrenceId,
        target_date: '2026-11-02',
      }),
    ]);
    expect((await deliveriesOf(a.worker.id)).map((d) => [d.channel, d.device_id])).toEqual([['push', device.id]]);
    expect(await only(a.manager.id, 'run.correction_required')).toEqual([]);
    expect(await only(a.w.workers[1].id, 'run.correction_required')).toEqual([]);
  });

  it('tells whoever sent the run back of the resubmit, in the inbox only', async () => {
    const a = await auditWorld(t, clock);
    await fanOutAll(t, a.w.s.tenantId);
    await addDevice(a.w.s.tenantId, a.manager.id);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set(LATER);
    await a.worker.api.put(`/api/v1/executions/${a.executionId}/answers`, answersBody(2, { ...a.answers, [a.w.c.temp.id]: { number: 5 } }, LATER));
    expect((await resubmit(a.worker.api, a.executionId, LATER)).status).toBe(200);
    await fanOutAll(t, a.w.s.tenantId);
    expect(await only(a.manager.id, 'run.resubmitted')).toEqual([
      expect.objectContaining({ title: 'Düzəliş təqdim edildi', body: 'İcra yoxlaması — Filial 1: İşçi 1 düzəlişləri təqdim etdi (raund 1).', target_id: a.w.occurrenceId }),
    ]);
    expect(await deliveriesOf(a.manager.id)).toEqual([]);
    expect(await only(a.worker.id, 'run.resubmitted')).toEqual([]);
  });

  it('tells the executor and the managers in scope of a failed audit', async () => {
    const a = await auditWorld(t, clock);
    await finishAudit(a, 'failed');
    await fanOutAll(t, a.w.s.tenantId);
    const expected = expect.objectContaining({ title: 'Audit tamamlandı', body: 'İcra yoxlaması — Filial 1: Uğursuz, audit balı 75%.', target_kind: 'occurrence', target_date: '2026-11-02' });
    expect(await only(a.worker.id, 'audit.finished')).toEqual([expected]);
    expect(await only(a.manager.id, 'audit.finished')).toEqual([expected]);
    expect(await only(a.outsider.id, 'audit.finished')).toEqual([]);
    expect(await only(a.auditor.id, 'audit.finished')).toEqual([]);
  });

  it('skips a passed audit under the default failed-only filter, and notifies it once the filter is any', async () => {
    const a = await auditWorld(t, clock);
    await finishAudit(a, 'passed');
    await fanOutAll(t, a.w.s.tenantId);
    expect((await eventRows(a.w.s.tenantId, 'audit.finished')).map((e) => e.outcome)).toEqual(['filtered']);
    expect(await only(a.worker.id, 'audit.finished')).toEqual([]);

    const b = await auditWorld(t, clock);
    const rule = { enabled: true, push: false, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, resultFilter: 'any' };
    const saved = await b.w.owner.put('/api/v1/notification-rules/audit.finished', rule);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ type: 'audit.finished', resultFilter: 'any', isDefault: false });
    await finishAudit(b, 'passed');
    await fanOutAll(t, b.w.s.tenantId);
    expect((await only(b.worker.id, 'audit.finished')).map((n) => n.body)).toEqual(['İcra yoxlaması — Filial 1: Uğurlu, audit balı 100%.']);
  });

  it('keeps the result filter to audit.finished in the rules API', async () => {
    const a = await auditWorld(t, clock);
    const rules = (await a.w.owner.get('/api/v1/notification-rules')).body as { type: string; resultFilter: string | null }[];
    expect(rules.filter((r) => r.resultFilter !== null).map((r) => [r.type, r.resultFilter])).toEqual([['audit.finished', 'failed']]);
    const base = { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null };
    const bad = await a.w.owner.put('/api/v1/notification-rules/checklist.overdue', { ...base, resultFilter: 'any' });
    expect([bad.status, bad.body.error.fields]).toEqual([400, { resultFilter: 'notifications.issues.resultFilterNotApplicable' }]);
    // An old client without the field keeps the default filter.
    expect((await a.w.owner.put('/api/v1/notification-rules/audit.finished', { ...base, push: false })).body.resultFilter).toBe('failed');
  });
});
```

In `apps/api/src/notifications/notification-rules.test.ts`, append inside `describe('effectiveRule', …)`:

```ts
  it('keeps the result filter on audit.finished only, falling back to the default', () => {
    expect(effectiveRule('audit.finished', null, roles).resultFilter).toBe('failed');
    expect(effectiveRule('audit.finished', { ...row, resultFilter: 'any' }, roles).resultFilter).toBe('any');
    expect(effectiveRule('audit.finished', { ...row, resultFilter: null }, roles).resultFilter).toBe('failed');
    expect(effectiveRule('task.assigned', { ...row, resultFilter: 'any' }, roles).resultFilter).toBeNull();
  });
```

and in its `ruleIssues` describe (or at the end of the file):

```ts
describe('ruleIssues and the result filter', () => {
  const input = { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, resultFilter: 'any' as const };
  it('refuses a result filter outside audit.finished', () => {
    expect(ruleIssues('checklist.overdue', input)).toEqual({ resultFilter: 'notifications.issues.resultFilterNotApplicable' });
    expect(ruleIssues('audit.finished', input)).toEqual({});
  });
});
```

The `row` constant at the top of that file gets `resultFilter: null` (it is a `RuleRow`).

In `apps/api/src/notifications/notification-templates.test.ts`, append:

```ts
describe('SP8 texts', () => {
  const occurrence = {
    kind: 'occurrence' as const, occurrenceId: 'o1', assignmentId: 'as1', localDate: '2026-11-02', startsAt: new Date('2026-11-02T04:00:00Z'),
    dueAt: new Date('2026-11-02T06:00:00Z'), checklistName: 'Açılış', siteName: 'Filial 1', timezone: 'Asia/Baku',
  };
  const run = {
    kind: 'run' as const, occurrence, executionId: 'x1', executorUserId: 'u1', executorName: 'Aysel', round: 2, flaggedCount: 3,
    dueAt: null, sentBackByUserId: 'm1', auditResult: null, auditPercent: null,
  };
  it('renders the three types on the run', () => {
    expect(renderNotification('run.correction_required', run)).toEqual({
      title: 'Düzəliş tələb olunur', body: 'Açılış — Filial 1: 3 bənd düzəliş gözləyir.', targetKind: 'occurrence', targetId: 'o1', targetDate: '2026-11-02',
    });
    expect(renderNotification('run.resubmitted', run).body).toBe('Açılış — Filial 1: Aysel düzəlişləri təqdim etdi (raund 2).');
    expect(renderNotification('audit.finished', { ...run, auditResult: 'failed', auditPercent: 66.7 }).body).toBe('Açılış — Filial 1: Uğursuz, audit balı 66.7%.');
    expect(() => renderNotification('task.assigned', run)).toThrow(/cannot be rendered/);
  });
});
```

(`renderNotification` is already imported there; if not, add `import { renderNotification } from './notification-templates';`.)

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- audit-notifications notification-rules notification-templates`
Expected: FAIL: the events are recorded but fan-out fails to render them (`Notification type run.correction_required cannot be rendered…`), and the rules API ignores `resultFilter`.

- [ ] **Step 3: Payloads and targets**

`apps/api/src/notifications/payloads.ts`: add

```ts
/** SP8: the run, the send-back round, the audit (spec §7.1). */
export interface RunPayload {
  occurrenceId: string;
  executionId: string;
  round?: number;
  auditId?: string;
}
```

and in `PayloadOf`, before `manual`:

```ts
  'run.correction_required': RunPayload;
  'run.resubmitted': RunPayload;
  'audit.finished': RunPayload;
```

`apps/api/src/notifications/notification-targets.ts`:
- imports: `type AuditResult, type AuditScore, isAuditType, type NotificationType, type ProblemSeverity, type ReworkItem` from contracts; `and` with `eq` from drizzle; schema imports gain `audits, executionReworkRequests, executions, users`; `RunPayload` from `./payloads`;
- add the target type and put it in the union:

```ts
/** SP8: a run sent back, resubmitted or audited. Opens the run like checklist notifications do. */
export interface RunTarget {
  kind: 'run';
  occurrence: OccurrenceTarget;
  executionId: string;
  executorUserId: string;
  executorName: string;
  round: number | null;
  /** Items of the send-back round. */
  flaggedCount: number;
  dueAt: Date | null;
  /** Who sent the run back: run.resubmitted's "creator" audience. */
  sentBackByUserId: string | null;
  auditResult: AuditResult | null;
  auditPercent: number | null;
}

export type RuleTarget = OccurrenceTarget | ProblemTarget | AssignmentTarget | TaskTarget | RunTarget;
```

- in `load`, before `if (type === 'checklist.assigned')` add `if (isAuditType(type)) return this.run(payload as RunPayload);`
- add the method:

```ts
  private async run(p: RunPayload): Promise<RunTarget | null> {
    const occurrence = await this.occurrence(p.occurrenceId);
    if (!occurrence) return null;
    const tx = this.db.tx();
    const [x] = await tx
      .select({ executorUserId: executions.executorUserId, executorName: users.fullName })
      .from(executions)
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .where(eq(executions.id, p.executionId));
    if (!x) return null;
    const [request] =
      p.round === undefined
        ? []
        : await tx
            .select({ items: executionReworkRequests.items, dueAt: executionReworkRequests.dueAt, by: executionReworkRequests.requestedByUserId })
            .from(executionReworkRequests)
            .where(and(eq(executionReworkRequests.executionId, p.executionId), eq(executionReworkRequests.round, p.round)));
    const [audit] = p.auditId ? await tx.select({ result: audits.result, score: audits.auditScore }).from(audits).where(eq(audits.id, p.auditId)) : [];
    return {
      kind: 'run',
      occurrence,
      executionId: p.executionId,
      executorUserId: x.executorUserId,
      executorName: x.executorName,
      round: p.round ?? null,
      flaggedCount: request ? (request.items as ReworkItem[]).length : 0,
      dueAt: request?.dueAt ?? null,
      sentBackByUserId: request?.by ?? null,
      auditResult: audit?.result ?? null,
      auditPercent: (audit?.score as AuditScore | null | undefined)?.percent ?? null,
    };
  }
```

- [ ] **Step 4: Texts and recipients**

`apps/api/src/notifications/notification-templates.ts`:
- imports gain `import { az, interpolate } from '@taskop/i18n';` and `RunTarget` from `./notification-targets`;
- add before `renderNotification`:

```ts
/** SP8 spec §7.1: the texts live in @taskop/i18n (az.notifications.templates). */
function runText(type: NotificationType, r: RunTarget): { title: string; body: string } | null {
  const T = az.notifications.templates;
  const place = { checklist: r.occurrence.checklistName, site: r.occurrence.siteName };
  switch (type) {
    case 'run.correction_required': {
      const body = interpolate(T['run.correction_required'].body, { ...place, count: r.flaggedCount });
      const due = r.dueAt ? ` ${interpolate(T['run.correction_required'].due, { date: dayTime(r.dueAt, r.occurrence.timezone) })}` : '';
      return { title: T['run.correction_required'].title, body: `${body}${due}` };
    }
    case 'run.resubmitted':
      return { title: T['run.resubmitted'].title, body: interpolate(T['run.resubmitted'].body, { ...place, executor: r.executorName, round: r.round ?? 1 }) };
    case 'audit.finished':
      return {
        title: T['audit.finished'].title,
        body: interpolate(T['audit.finished'].body, {
          ...place,
          result: r.auditResult ? az.audits.results[r.auditResult] : az.audits.report.none,
          percent: r.auditPercent === null ? az.audits.report.none : `${r.auditPercent}%`,
        }),
      };
    default:
      return null;
  }
}
```

- in `renderNotification`'s switch, before `default:` add:

```ts
    case 'run': {
      const text = runText(type, target);
      if (!text) throw mismatch(type, target);
      return { ...text, ...onOccurrence(target.occurrence) };
    }
```

`apps/api/src/notifications/notification-recipients.ts`:
- in `direct`, before `default:` add

```ts
      case 'run':
        // Spec decision 16: "assignees" is the executor; "creator" is whoever sent the run back.
        return [...(rule.notifyAssignees ? [target.executorUserId] : []), ...(rule.notifyCreator && target.sentBackByUserId ? [target.sentBackByUserId] : [])];
```

- in `sees`, before `default:` add

```ts
      case 'run': {
        if (!(['assignments.view', 'reports.view', 'audits.perform', 'executions.correct'] as const).some((k) => s.permissions.has(k))) return false;
        const [r] = await tx.select({ id: occurrences.id }).from(occurrences).where(and(eq(occurrences.id, target.occurrence.occurrenceId), this.scheduling.occurrences(s)));
        return r !== undefined;
      }
```

- [ ] **Step 5: The result filter in rules and fan-out**

`apps/api/src/notifications/notification-rules.ts`:
- add `type AuditResultFilter` to the contracts import;
- `RuleRow` gains `/** audit.finished only. */ resultFilter: string | null;`
- in the row branch of `effectiveRule`, the Task 2 line becomes

```ts
    resultFilter: NOTIFICATION_TYPE_META[type].hasResultFilter ? ((row.resultFilter as AuditResultFilter | null) ?? d.resultFilter) : null,
```

- in `ruleIssues`, before `return issues;` add

```ts
  if (!meta.hasResultFilter && input.resultFilter !== null) issues.resultFilter = 'notifications.issues.resultFilterNotApplicable';
```

`apps/api/src/notifications/rules.service.ts`, in `update`, `values` gains `resultFilter: input.resultFilter,` (after `leadMinutes`).

`apps/api/src/notifications/notification-fanout.ts`:
- `export const NOTIFICATION_OUTCOMES = ['fanned_out', 'disabled', 'no_recipients', 'target_gone', 'filtered'] as const;`
- after `if (!target) return finish('target_gone');` add

```ts
    // SP8: audit.finished with the failed-only filter is skipped for a passed audit, for the whole rule.
    if (rule?.resultFilter === 'failed' && target.kind === 'run' && target.auditResult !== 'failed') return finish('filtered');
```

and update the `outcome` column comment in `apps/api/src/db/schema.ts` (`notificationEvents`) to `// fanned_out | disabled | no_recipients | target_gone | filtered`.

`apps/api/src/notifications/notification-listeners.ts`, at the end of `onModuleInit` add:

```ts
    // SP8 spec §7.1. Dedupe keys make a replayed command's second event a no-op.
    this.events.on('execution.sent_back', (e) =>
      this.guarded('execution.sent_back', () =>
        this.notifications.record('run.correction_required', { occurrenceId: e.occurrenceId, executionId: e.executionId, round: e.round }, e.actorUserId, `run.correction_required:${e.executionId}:${e.round}`),
      ),
    );
    this.events.on('execution.resubmitted', (e) =>
      this.guarded('execution.resubmitted', () =>
        this.notifications.record('run.resubmitted', { occurrenceId: e.occurrenceId, executionId: e.executionId, round: e.round }, e.actorUserId, `run.resubmitted:${e.executionId}:${e.round}`),
      ),
    );
    this.events.on('audit.finished', (e) =>
      this.guarded('audit.finished', () =>
        this.notifications.record('audit.finished', { occurrenceId: e.occurrenceId, executionId: e.executionId, auditId: e.auditId }, e.actorUserId, `audit.finished:${e.auditId}`),
      ),
    );
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audit-notifications notification-rules notification-templates notification-fanout notification-recipients notification-events notification-rules-api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/notifications apps/api/src/db/schema.ts apps/api/test/audit-notifications.test.ts
git commit -m "feat(api): notify send-backs, resubmits and finished audits, with the result filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Reports and problems: sent-back runs, cleared problems, the audit column and filter

**Files:**
- Modify: `apps/api/src/reports/report-queries.ts`, `apps/api/src/reports/reports.service.ts`, `apps/api/src/reports/report-exporter.ts`, `apps/api/src/reports/export/report-tables.ts`, `apps/api/src/reports/export/report-tables.test.ts`, `apps/api/test/reports-export.test.ts`
- Test: `apps/api/test/audit-reports.test.ts`

**Interfaces:**
- Consumes: `COMPLETED_STATUSES` with `correction_required` (Task 2); `runAuditState`, `type RunAuditState` (Task 1); `reportRunsQuerySchema.auditState`, `reportExportQuerySchema.auditState` (Task 2); `audits` and `executions.original_captured_at` (Task 5); `az.audits.audit`, `az.audits.runAuditStates`, `az.corrections.corrected` (Task 3).
- Produces:
  - Every report count and list skips problems with `cleared_at` (Spec decision 18): `runsCte`'s problem counts (`withProblems`, `withCritical`, the run's `problemCount` / `criticalCount`), `ReportQueries.problems` and `problemCounts`.
  - `ReportRun.auditState` and `ReportRun.corrected` filled; `GET /reports/runs?auditState=` and `GET /reports/runs/export?auditState=` filter by them.
  - `ReportQueries.runs(f, scope, bucket, opts: { cursor?: string; limit: number | null; auditState?: RunAuditState })` and `ReportQueries.countRuns(f, scope, bucket, auditState?: RunAuditState)`.
  - `runsTable` gains the columns `Audit` (text) and `Düzəliş edilib` (bool) after `Saat şübhəli`.
  - A sent-back run counts as completed with its first `completed_at` and `late` (spec §3.1).

- [ ] **Step 1: Write the failing tests**

`apps/api/test/audit-reports.test.ts`:

```ts
import { parse } from 'csv-parse/sync';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { auditWorld, correct, markUploaded, sendBack, startAudit, verdictAll } from './audit-fixtures';
import { FakeClock } from './fake-clock';
import { staffAt } from './notification-fixtures';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';
import { closedRunWithProblems, insertTaskRow } from './task-fixtures';

const DAY = { from: '2026-11-02', to: '2026-11-02' };
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('reports after audits and corrections (spec §3.1, §8.3)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const runs = async (api: Api, extra: Record<string, string> = {}) => {
    const res = await api.get(`/api/v1/reports/runs?${q({ ...DAY, ...extra })}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items as { occurrenceId: string; status: string; auditState: string | null; corrected: boolean; completedAt: string; late: boolean }[];
  };

  it('counts a sent-back run as completed, with its first completion time', async () => {
    const a = await auditWorld(t, clock);
    clock.set('2026-11-02T05:00:00Z');
    await sendBack(a.manager.api, a.executionId, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    clock.set('2026-11-02T12:00:00Z');
    const summary = (await a.w.owner.get(`/api/v1/reports/summary?${q(DAY)}`)).body;
    expect(summary.counts).toMatchObject({ completed: 1 });
    expect(await runs(a.w.owner, { bucket: 'completed' })).toEqual([
      expect.objectContaining({ occurrenceId: a.w.occurrenceId, status: 'correction_required', completedAt: '2026-11-02T04:20:00.000Z', late: false }),
    ]);
  });

  it('report problem counts skip cleared problems', async () => {
    const { w, executionId, ruleProblemId, manualProblemId } = await closedRunWithProblems(t, clock);
    await insertTaskRow({ tenantId: w.s.tenantId, createdBy: w.s.ownerId, assigneeUserId: w.workers[1].id, problemId: ruleProblemId });
    const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer');
    const problems = async () => (await w.owner.get(`/api/v1/reports/problems?${q(DAY)}`)).body;
    expect((await problems()).counts).toMatchObject({ total: 2, critical: 1 });
    clock.set('2026-11-02T05:00:00Z');
    const fix = await correct(manager.api, executionId, { answersRev: 1, changes: [{ itemId: w.c.temp.id, answer: { number: 5, note: 'normal' } }], reason: 'Səhv' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    const after = await problems();
    expect(after.counts).toMatchObject({ total: 1, critical: 1, resolution: { none: 1, open: 0, resolved: 0, cancelled: 0 } });
    expect(after.items.map((p: { id: string }) => p.id)).toEqual([manualProblemId]);
    const [run] = await runs(w.owner);
    expect(run).toMatchObject({ problemCount: 1, criticalCount: 1, corrected: true });
    expect((await w.owner.get(`/api/v1/reports/summary?${q(DAY)}`)).body.counts).toMatchObject({ withProblems: 1, withCritical: 1 });
  });

  it('shows the audit state and the corrected marker on runs, filters by them and exports them', async () => {
    const a = await auditWorld(t, clock, { requiresAudit: true });
    expect((await runs(a.w.owner))[0]).toMatchObject({ auditState: 'waiting', corrected: false });
    clock.set('2026-11-02T05:00:00Z');
    await correct(a.manager.api, a.executionId, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'Hər şey qaydasındadır' } }], reason: 'Qeyd unudulmuşdu' });
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    expect((await runs(a.w.owner))[0]).toMatchObject({ auditState: 'in_progress', corrected: true });
    await markUploaded(a.executionId);
    await verdictAll(a.auditor.api, auditId, [a.w.c.problem.id, a.w.c.temp.id, a.w.c.photo.id, a.w.c.note.id], [a.w.c.temp.id]);
    expect((await a.auditor.api.post(`/api/v1/audits/${auditId}/finish`, { result: 'failed' })).status).toBe(200);
    expect((await runs(a.w.owner))[0]).toMatchObject({ status: 'audited', auditState: 'failed' });
    expect((await runs(a.w.owner, { auditState: 'failed' })).map((r) => r.occurrenceId)).toEqual([a.w.occurrenceId]);
    expect(await runs(a.w.owner, { auditState: 'passed' })).toEqual([]);
    expect(await runs(a.w.owner, { auditState: 'waiting' })).toEqual([]);

    const csv = await a.w.owner.get(`/api/v1/reports/runs/export?${q({ ...DAY, format: 'csv', auditState: 'failed' })}`).responseType('blob');
    expect(csv.status).toBe(200);
    const rows = parse((csv.body as Buffer).toString('utf8'), { bom: true }) as string[][];
    expect(rows[0]!.slice(-2)).toEqual(['Audit', 'Düzəliş edilib']);
    expect(rows[1]!.slice(-2)).toEqual(['Audit uğursuz', 'Bəli']);
  });
});
```

In `apps/api/src/reports/export/report-tables.test.ts`, in `writes run rows with Azerbaijani statuses…`:
- the run literal ends `…, clockSuspect: true, auditState: 'passed', corrected: true,` (instead of the Task 2 defaults);
- the expected labels end `…, 'Gecikmə ilə', 'Saat şübhəli', 'Audit', 'Düzəliş edilib',`;
- the expected row ends `…, 100, 1, 0, false, true, 'Audit uğurlu', true,`.

In `apps/api/test/reports-export.test.ts`, `exports runs as CSV…`: the expected header row ends `…, 'Gecikmə ilə', 'Saat şübhəli', 'Audit', 'Düzəliş edilib',` and the expected `r7` row ends `…, '0', '0', 'Bəli', 'Xeyr', '', 'Xeyr',` (no audit, not corrected; an empty cell prints as an empty CSV field).

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- audit-reports report-tables reports-export`
Expected: FAIL: `auditState` is always null, the cleared problem still counts, the CSV has 15 columns.

- [ ] **Step 3: Skip cleared problems and add the audit columns**

`apps/api/src/reports/report-queries.ts`:
- the contracts import gains `type AuditResult, type AuditStatus, type RunAuditState, runAuditState`; the drizzle import gains `isNull`;
- in `runsCte`, the problem subquery's `where` becomes

```ts
         where po.local_date between ${f.from}::date and ${f.to}::date and ep.cleared_at is null
```

- in `problemConditions`, after the `scope` / date / subtree list add `isNull(executionProblems.clearedAt),` (as the second element of `conds`);
- add after `bucketCondition`:

```ts
/** /reports/runs?auditState (SP8 spec §8.3) over `runs r` left-joined to its non-cancelled audit `au`; mirrors runAuditState. */
export function auditStateCondition(s: RunAuditState): SQL {
  switch (s) {
    case 'waiting':
      return sql`r.status = 'audit_pending' and au.id is null`;
    case 'in_progress':
      return sql`au.status = 'in_progress'`;
    case 'passed':
      return sql`au.status = 'finished' and au.result = 'passed'`;
    case 'failed':
      return sql`au.status = 'finished' and au.result = 'failed'`;
  }
}

/** The run's non-cancelled audit, for the column and the filter. */
const auditJoin = sql`left join audits au on au.execution_id = r.execution_id and au.status <> 'cancelled'`;
```

- `RunRow` gains

```ts
  audit_status: AuditStatus | null;
  audit_result: AuditResult | null;
  corrected: boolean;
```

- `toReportRun`'s Task 2 placeholders become

```ts
  auditState: runAuditState(r.status, r.audit_status ? { status: r.audit_status, result: r.audit_result } : null),
  corrected: r.corrected,
```

- `runs` becomes

```ts
  /** Spec §5.3: newest due first, keyset on (due_at, id) like /problems (Spec decision 7). `limit: null` reads every row. */
  async runs(
    f: ResolvedFilters,
    scope: SQL | undefined,
    bucket: RunBucket,
    opts: { cursor?: string; limit: number | null; auditState?: RunAuditState },
  ): Promise<Page<ReportRun>> {
    const conds = [bucketCondition(bucket)];
    if (opts.auditState) conds.push(auditStateCondition(opts.auditState));
    if (opts.cursor) conds.push(sql`(r.due_at, r.id) < (select c.due_at, c.id from occurrences c where c.id = ${opts.cursor})`);
    const rows = (
      await this.db.tx().execute<RunRow>(sql`
        with ${runsCte(f, scope)}
        select r.id, r.execution_id, r.local_date, r.due_at, r.status, r.checklist_id, c.name as checklist_name, r.site_id, s.name as site_name,
               coalesce((select json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by u.full_name, u.id)
                           from occurrence_assignees oa join users u on u.id = oa.user_id where oa.occurrence_id = r.id), '[]'::json) as assignees,
               x.executor_user_id, eu.full_name as executor_name, x.started_at, x.completed_at, x.completed_received_at, r.score_percent,
               coalesce(x.late, false) as late, coalesce(x.clock_suspect, false) as clock_suspect, r.problem_count, r.critical_count,
               au.status::text as audit_status, au.result::text as audit_result, coalesce(x.original_captured_at is not null, false) as corrected
          from runs r
          join checklists c on c.id = r.checklist_id
          join sites s on s.id = r.site_id
          left join executions x on x.id = r.execution_id
          left join users eu on eu.id = x.executor_user_id
          ${auditJoin}
         where ${sql.join(conds, sql` and `)}
         order by r.due_at desc, r.id desc
         ${opts.limit === null ? sql.empty() : sql`limit ${opts.limit + 1}`}`)
    ).rows;
    const items = opts.limit === null ? rows : rows.slice(0, opts.limit);
    const more = opts.limit !== null && rows.length > opts.limit;
    return { items: items.map(toReportRun), nextCursor: more ? items[items.length - 1]!.id : null };
  }
```

- `countRuns` becomes

```ts
  /** The export's count-first check (spec §5.4). */
  async countRuns(f: ResolvedFilters, scope: SQL | undefined, bucket: RunBucket, auditState?: RunAuditState): Promise<number> {
    const conds = [bucketCondition(bucket), ...(auditState ? [auditStateCondition(auditState)] : [])];
    const r = await this.db.tx().execute<{ n: number }>(sql`with ${runsCte(f, scope)} select count(*)::int as n from runs r ${auditJoin} where ${sql.join(conds, sql` and `)}`);
    return r.rows[0]!.n;
  }
```

`apps/api/src/reports/reports.service.ts`, `runs` becomes:

```ts
  runs(p: Principal, q: ReportRunsParams): Promise<Page<ReportRun>> {
    return this.guarded(q, (f) => this.queries.runs(f, this.scheduling.occurrences(p), q.bucket, { cursor: q.cursor, limit: REPORT_LIMITS.pageSize, auditState: q.auditState }));
  }
```

`apps/api/src/reports/report-exporter.ts`:
- the `runs` case becomes

```ts
      case 'runs': {
        const bucket = q.bucket ?? 'all';
        assertCap(await this.queries.countRuns(f, occ, bucket, q.auditState));
        return [runsTable((await this.queries.runs(f, occ, bucket, { limit: null, auditState: q.auditState })).items, runsTitle(bucket))];
      }
```

- in the audit entry's `filters`, after `bucket: …,` add `auditState: kind === 'runs' ? (q.auditState ?? null) : null,`
- in `filterLabels`, after the `bucket` line add

```ts
    if (kind === 'runs' && q.auditState) out.push(`${az.audits.audit}: ${az.audits.runAuditStates[q.auditState]}`);
```

`apps/api/src/reports/export/report-tables.ts`, in `runsTable`:
- after `{ label: C.clockSuspect, type: 'bool' },` add

```ts
      // SP8 spec §8.3.
      { label: az.audits.audit, type: 'text', width: 16 },
      { label: az.corrections.corrected, type: 'bool' },
```

- after `r.clockSuspect,` add

```ts
      r.auditState ? az.audits.runAuditStates[r.auditState] : null,
      r.corrected,
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- audit-reports report-tables reports-export reports-runs reports-summary reports-problems-tasks reports-scope`
Expected: PASS. `reports-summary`'s cross-check still agrees for every status, `correction_required` included.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reports apps/api/test/reports-export.test.ts apps/api/test/audit-reports.test.ts
git commit -m "feat(api): reports count sent-back runs, skip cleared problems and show the audit state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The scope and permission suite, platform admins, OpenAPI and the full run

**Files:**
- Test: `apps/api/test/audit-scope.test.ts`
- Modify: `apps/api/test/openapi.test.ts`

**Interfaces:**
- Consumes: every endpoint of Tasks 7–15; `auditWorld` and the helpers of `test/audit-fixtures.ts`.
- Produces: the spec §10 scope matrix (users out of scope get 404 on every new endpoint; Worker, Auditor and Manager permissions), platform-admin attribution (Spec decision 17), the new paths in the OpenAPI document, and a green run of every package this part touched. Part 1 does **not** change CI (`.github/workflows/ci.yml` belongs to Part 3).

- [ ] **Step 1: Write the tests**

`apps/api/test/audit-scope.test.ts`:

```ts
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { type AuditWorld, auditLogOf, auditWorld, correctionRows, markUploaded, startAudit } from './audit-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const AT = '2026-11-02T05:00:00.000Z';

describe('audit and correction scope, permissions and platform admins (spec §5, §10)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let platform: Api;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    const email = `${uniq('admin')}@taskop.az`;
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    platform = as(t, (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const world = async (): Promise<AuditWorld> => {
    const a = await auditWorld(t, clock);
    clock.set(AT);
    return a;
  };
  /** A staff user of a custom role with `permissions`, limited to `siteIds` (site_subtree) or the whole tenant. */
  const custom = async (a: AuditWorld, permissions: string[], siteIds: string[] | null): Promise<Api> => {
    const role = await a.w.owner.post('/api/v1/roles', { name: uniq('Rol'), dataScope: siteIds ? 'site_subtree' : 'all', permissions });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const u = await createUserDirect(t, a.w.s.tenantId, { kind: 'staff', roleId: role.body.id, emailVerified: true });
    if (siteIds) expect((await a.w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds })).status).toBe(200);
    return as(t, (await loginStaff(t, u.email!, u.secret, 'web')).accessToken);
  };
  /** Status codes of every new endpoint for one caller, against one run and its audit. */
  const statuses = async (api: Api, a: AuditWorld, auditId: string) => {
    const x = a.executionId;
    return {
      correct: (await api.post(`/api/v1/executions/${x}/corrections`, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'x' } }], reason: 'x' })).status,
      sendBack: (await api.post(`/api/v1/executions/${x}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }], dueAt: '2026-01-01T00:00:00.000Z' })).status,
      withdraw: (await api.post(`/api/v1/executions/${x}/send-back/cancel`)).status,
      history: (await api.get(`/api/v1/executions/${x}/corrections`)).status,
      start: (await api.post(`/api/v1/executions/${x}/audits`)).status,
      list: (await api.get('/api/v1/audits?queue=in_progress')).status,
      get: (await api.get(`/api/v1/audits/${auditId}`)).status,
      verdict: (await api.put(`/api/v1/audits/${auditId}/items/${a.w.c.photo.id}`, { verdict: 'approved' })).status,
      clear: (await api.delete(`/api/v1/audits/${auditId}/items/${a.w.c.note.id}`)).status,
      finish: (await api.post(`/api/v1/audits/${auditId}/finish`, { result: 'passed', extraEmails: ['not-an-address'] })).status,
      cancel: (await api.post(`/api/v1/audits/${auditId}/cancel`, { reason: '' })).status,
      pdf: (await api.get(`/api/v1/audits/${auditId}/report.pdf`)).status,
      send: (await api.post(`/api/v1/audits/${auditId}/report/send`, { emails: [] })).status,
    };
  };

  it('gives each built-in role exactly its keys, inside its scope', async () => {
    const a = await world();
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    // Bodies are invalid or the state refuses the change, so nothing is written: 400 / 409 mean "allowed in".
    expect(await statuses(a.worker.api, a, auditId)).toEqual({
      correct: 403, sendBack: 403, withdraw: 403, history: 200, start: 403, list: 403, get: 403, verdict: 403, clear: 403, finish: 403, cancel: 403, pdf: 403, send: 403,
    });
    expect(await statuses(a.manager.api, a, auditId)).toEqual({
      correct: 200, sendBack: 400, withdraw: 409, history: 200, start: 403, list: 403, get: 200, verdict: 403, clear: 403, finish: 403, cancel: 403, pdf: 409, send: 403,
    });
    expect(await statuses(a.auditor.api, a, auditId)).toEqual({
      correct: 403, sendBack: 403, withdraw: 403, history: 200, start: 409, list: 200, get: 200, verdict: 200, clear: 204, finish: 400, cancel: 400, pdf: 409, send: 400,
    });
  });

  it('answers 404 on every new endpoint to callers whose scope does not cover the run', async () => {
    const a = await world();
    const auditId = (await startAudit(a.auditor.api, a.executionId)).body.id as string;
    const everything = await custom(a, ['executions.correct', 'audits.perform', 'reports.view'], [a.w.otherSiteId]);
    const s = await statuses(everything, a, auditId);
    // Schema validation (finish, cancel, send) runs before the scope check, so those invalid bodies answer 400 first;
    // send-back's past due date is checked inside the service, after the scope.
    expect(s).toEqual({
      correct: 404, sendBack: 404, withdraw: 404, history: 404, start: 404, list: 200, get: 404, verdict: 404, clear: 404, finish: 400, cancel: 400, pdf: 404, send: 400,
    });
    expect((await everything.post(`/api/v1/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'x' }] })).status).toBe(404);
    expect((await everything.post(`/api/v1/audits/${auditId}/finish`, { result: 'passed' })).status).toBe(404);
    expect((await everything.post(`/api/v1/audits/${auditId}/cancel`, { reason: 'x' })).status).toBe(404);
    expect((await everything.post(`/api/v1/audits/${auditId}/report/send`, {})).status).toBe(404);
    expect((await everything.get('/api/v1/audits?queue=in_progress')).body.items).toEqual([]);
    expect((await a.outsider.api.get(`/api/v1/audits/${auditId}`)).status).toBe(404);
  });

  it('lets platform admins correct, send back and audit inside the tenant, attributed to them', async () => {
    const a = await world();
    const base = `/api/v1/platform/tenants/${a.w.s.tenantId}`;
    const fix = await platform.post(`${base}/executions/${a.executionId}/corrections`, { answersRev: 1, changes: [{ itemId: a.w.c.note.id, answer: { text: 'Taskop dəstəyi' } }], reason: 'Müştərinin xahişi' });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(await correctionRows(a.executionId)).toEqual([expect.objectContaining({ actor_user_id: null, actor_platform_admin_id: expect.any(String) })]);
    expect((await auditLogOf(a.executionId)).at(-1)).toMatchObject({ action: 'execution.corrected', actor_user_id: null, actor_platform_admin_id: expect.any(String) });
    const started = await platform.post(`${base}/executions/${a.executionId}/audits`);
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(started.body.auditor).toEqual({ kind: 'platform', id: null, name: null });
    expect((await platform.get(`${base}/audits/${started.body.id}`)).status).toBe(200);
    await markUploaded(a.executionId);
    const back = await platform.post(`${base}/executions/${a.executionId}/send-back`, { items: [{ itemId: a.w.c.temp.id, comment: 'Yenidən ölçün' }] });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.requestedBy).toBeNull();
    expect((await platform.post(`${base}/executions/${a.executionId}/send-back/cancel`)).body.withdrawnBy).toBeNull();
    // A platform admin of another tenant's id sees nothing.
    const other = await auditWorld(t, clock);
    expect((await platform.post(`/api/v1/platform/tenants/${other.w.s.tenantId}/executions/${a.executionId}/corrections`, { answersRev: 2, changes: [{ itemId: a.w.c.note.id, answer: null }], reason: 'x' })).status).toBe(404);
  });
});
```

The expected codes in the first two tests follow from the bodies: the invalid `sendBack` (`dueAt` in the past), `finish` (an invalid extra address), `cancel` (empty reason) and `send` (empty list) are refused with 400 before any state is read; the auditor's `start` hits `AUDIT_EXISTS` (409); `pdf` is 409 `REPORT_NOT_READY`; the manager's `withdraw` has nothing open (409); `correct` succeeds once for the manager and is not repeated in the same matrix.

In `apps/api/test/openapi.test.ts`, append inside `describe('OpenAPI', …)`:

```ts
  it('documents the audit and correction paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/audits',
        '/api/v1/audits/{id}',
        '/api/v1/audits/{id}/items/{itemId}',
        '/api/v1/audits/{id}/finish',
        '/api/v1/audits/{id}/cancel',
        '/api/v1/audits/{id}/report.pdf',
        '/api/v1/audits/{id}/report/send',
        '/api/v1/executions/{id}/audits',
        '/api/v1/executions/{id}/corrections',
        '/api/v1/executions/{id}/send-back',
        '/api/v1/executions/{id}/send-back/cancel',
        '/api/v1/executions/{id}/resubmit',
        '/api/v1/platform/tenants/{tenantId}/audits/{id}',
        '/api/v1/platform/tenants/{tenantId}/executions/{id}/corrections',
      ]),
    );
    expect(Object.keys(res.body.paths['/api/v1/audits/{id}/report.pdf'].get.responses['200'].content)).toContain('application/pdf');
  });
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @taskop/api test -- audit-scope openapi`
Expected: PASS. If a status in the matrix differs, read the body: a 400 where 404 is expected means a body that should be valid is not; fix the request in the test, never the expectation of 404 for out-of-scope callers.

- [ ] **Step 3: Run the full suite**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/mobile typecheck && pnpm lint`
Expected: PASS: every API test file, including `audit-db`, `corrections-recalculate`, `corrections`, `send-back`, `rework`, `corrections-read`, `audit-required`, `audits`, `audits-finish`, `audits-queue`, `audit-report-perf`, `audit-report-job`, `storage-objects`, `audit-notifications`, `audit-reports`, `audit-scope` and the extended SP4–SP7 tests; the web and mobile typechecks (this part only added contract fields, keys and fixture defaults).

- [ ] **Step 4: Try it locally**

```bash
docker compose up -d
pnpm --filter @taskop/api db:setup
pnpm --filter @taskop/api db:seed
pnpm --filter @taskop/api dev
```

In another terminal, as the seeded manager:

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login/staff -H 'content-type: application/json' \
  -d '{"email":"manager@demo.taskop.az","password":"DemoPassword123","client":"web"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s "localhost:3000/api/v1/me" -H "Authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).permissions.includes("executions.correct")'
```

Expected: `true` (the 0016 backfill gave the demo Manager the key). Starting an audit on a completed demo run with an Auditor account, finishing it and opening `GET /api/v1/audits/<id>/report.pdf` after a few seconds shows the PDF; Mailpit (`http://localhost:8025`) shows the report e-mail when the checklist has addresses.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/audit-scope.test.ts apps/api/test/openapi.test.ts
git commit -m "test(api): pin the audit and correction scope, permissions and platform access" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (spec section → task):

| Spec | Where |
|---|---|
| §1 decisions: which runs, entry into audit, result + audit score, what a correction can change, send-back, report, after-audit lock, storage model | Task 1 (`canCorrect`, `canStartAudit`, `auditScore`), Task 7 (correctable statuses, values only, media subset), Task 8 (send-back), Task 11 (per-checklist flag), Task 12 (on-demand audit), Task 13 (finish, lock), Tasks 14–15 (report), Tasks 5–7 (snapshot + log) |
| §2 goals 1–7 | 1: Task 11 + Task 13 queue; 2: Tasks 12–13; 3: Tasks 14–15; 4: Task 7 (and the platform route in Task 18); 5: Tasks 8–9; 6: Task 10; 7: Tasks 7, 8, 9, 12, 13, 15 (audit-log assertions in each) |
| §3.1 statuses and transitions | Task 2 (enum values), Task 5 (migration), Task 11 (completed → audit_pending with the system actor), Task 12 (start, cancel incl. required / sent back), Task 13 (finish → audited), Task 8 (send-back, withdraw to `status_before`, Spec decision 22), Task 9 (resubmit → `nextStatusAfterResubmit`), Task 17 (`correction_required` counted as completed) |
| §3.2 execution state `rework`, first completion kept, no `closes_at`, sweep ignores rework | Task 8 (state, round), Task 9 (saves after `closes_at`, `completed_at`/`late` unchanged, sweep test) |
| §3.3 audit status, paused audits, verdict reset | Task 12 (paused flag, verdicts while paused), Task 13 (`AUDIT_PAUSED`, resume after resubmit), Task 9 (verdict reset) |
| §4.1 changed tables, trigger, partial index, cleared problems | Task 5 (schema, trigger, index swap), Task 6 (clear instead of delete), Task 10 (problems page), Task 17 (reports) |
| §4.2 new tables and grants | Task 5 (tables, grants, RLS; append-only and column-UPDATE tests) |
| §4.3 shared logic | Task 1 (all rules; `reworkViolations` per Spec decision 28) |
| §5 permissions, scope, `reports.view` reads, backfill, platform admins | Task 2 (keys, defaults), Task 5 (backfill + version bump), Task 10 (`ExecutionAccess`), Task 12 (`permAny`), Task 18 (scope matrix, platform attribution) |
| §6.1 modules and boundary | Task 6 (`ExecutionRecalculator`), Tasks 7–10 (`CorrectionsService`, `ReworkService`, `AuditLookup` in executions), Tasks 12–15 (`audits` module importing executions and scheduling; nothing imports it) |
| §6.2 endpoints | `GET /audits` T13; `POST /executions/:id/audits` T12; `GET /audits/:id` T12; verdict PUT/DELETE T12; finish T13; cancel T12; report.pdf and report/send T15; corrections T7; send-back and cancel T8; `GET …/corrections` T10; answers/media in rework and resubmit T9; `/me/sync` T9 |
| §6.3 recalculation after close | Task 6 |
| §6.4 audit-log actions | Task 2 (`AUDIT_FLOW_AUDIT_ACTIONS`), Tasks 7, 8, 9, 12, 13, 15 (each entry asserted) |
| §6.5 error codes | Task 2 (codes, statuses, details), Task 3 (texts), Task 7 (`AppErrorDetails`, filter), each code asserted in Tasks 7–15; MEDIA_PENDING → `MEDIA_NOT_FOUND_IN_STORAGE` (Spec decision 29) |
| §7.1 notification types, `resultFilter`, listeners | Task 2 (catalogue), Task 3 (texts), Task 5 (column), Task 16 |
| §7.2 report job, PDF contents, email, performance | Task 13 (queue settings), Task 14 (builder, mail attachments, 200 items / 40 photos check), Task 15 (job, storage key, one mail per recipient, failure handling, resend) |
| §8 clients | Parts 2 and 3, against *Interfaces for Parts 2 and 3*; Task 2 updates their test fixtures only |
| §9 edge cases | concurrent corrections: Task 7; offline send-back: Task 9 (`/me/sync` days later); stale phone after resubmit/withdraw: Task 9; second send-back: Task 8; `requires_audit` changed later: Task 9 (resubmit to `audit_pending`); deactivated executor → withdraw: Task 8; archived version: pinned version used everywhere (`checklistVersionId`); timezone: Task 16 (due date in Baku time) and Task 14 (PDF times) |
| §10 API tests | contracts (Tasks 1–2), i18n (Task 3), api-client (Task 4), each API bullet in Tasks 5–18; web/mobile/e2e/device checklist → Parts 2 and 3 |

**Placeholder scan:** every code step carries its code and every test step real assertions. Two steps name a conditional action, each with its exact edit: Task 2 Step 13 (another app test literal typed with a changed output type gets the listed default fields) and Task 14 Step 5 (what to check if the PDF holds fewer images). Task 14's commit message takes the line the performance test prints.

**Type consistency:** `lockRun` / `LockedRun` / `assertCorrectable` / `snapshotColumns` (Task 7) are what Tasks 8, 12, 13 and 15 use; `lockOwnRun` (Task 9) is the executor variant. `ReworkRequests.open/latest/all/toDtos/openByExecution` and `AuditLookup.requiresAudit/openAudit/resetVerdicts/brief` are defined in Tasks 8–10 before Tasks 9–13 call them. `ExecutionRecalculator.recalculate(RecalcInput)` (Task 6) is called with the same shape in Tasks 7 and 9. `AUDIT_QUEUES`, `AUDIT_REPORT_JOB`, `AuditReportJobData` (Task 13) feed Task 15. `AuditReportData` / `ReportItem` / `ReportSection` (Task 14) are what `AuditReportLoader.load` returns (Task 15). `reworkViolations(content, before, after, flagged)` has the same signature in Task 1, Task 9 and the Interfaces. Fixture names (`auditWorld`, `correct`, `sendBack`, `withdraw`, `resubmit`, `startAudit`, `correctionRows`, `reworkRows`, `auditLogOf`, `problemRows`, `markUploaded`, `completeRunOn`, `verdictAll`, `MemoryStorage`, `noisePng`) are defined in Tasks 7, 13, 14 and 15 before later tests use them.

**Review Focus:** the five lines are pinned by named tests: withdrawn send-back + resubmit (Task 9), cleared problem with a task (Tasks 6 and 17), revealed required item / hidden verdicted item (Tasks 7, 12, 13), one failing recipient (Task 15), two managers at once (Task 7).

