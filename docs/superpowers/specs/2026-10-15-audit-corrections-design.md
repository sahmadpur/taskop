# Taskop — Sub-project 8: Audit and Corrections — Design Spec

- **Date:** 2026-10-15
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf`:
  - FR-19.01–08: audit of completed checklists and the audit report.
  - FR-19.09–15: on-site checks by managers, corrections, and "Düzəliş tələb olunur".
  - FR-11.01–02: the `Audit gözləyir` / `Audit olunub` statuses and status history.
  - FR-26.01–03: audit results in the audit log.
  - NFR-07.04–05: changes to completed checklists are logged, and the original and corrected results can be compared.
  - BR-14: a correction never deletes the original result.
  - FR-10.13–14: the actual completion time is kept.
- **Builds on:**
  - `2026-10-07-foundation-design.md`: RLS, roles, data scopes, `audit_log`, the mail module.
  - `2026-10-08-checklist-builder-design.md`: checklists, versions, `computeScore`.
  - `2026-10-09-scheduling-assignment-design.md`: occurrences, `occurrence_status`, `OccurrenceWriter`, `SchedulingScope`.
  - `2026-10-09-mobile-execution-design.md`: executions, the answers JSON, `execution_problems`, outbox and sync.
  - `2026-10-12-tasks-design.md`: tasks created from problems (`tasks.problem_id`).
  - `2026-10-13-notifications-design.md`: the notification catalogue, rules and pg-boss workers.
  - `2026-10-14-reports-design.md`: the run buckets, the runs table, and pdfmake with Noto Sans.

## 1. Context and decisions

Sub-projects 3–7 schedule runs, execute them on the phone and report on them. Once a run is closed, nothing about it can change. Sub-project 8 adds three ways to review and fix completed runs:

- a **formal audit**: an auditor approves or rejects each item and gives a final result, and a PDF report goes out by email;
- **direct corrections** by a manager, keeping the original values;
- **send-back**: the manager returns the run to the worker, who fixes the flagged items on the phone.

The enum values `audit_pending` and `audited` already exist (SP3), but no code sets them yet. Reports (SP7) already count both as completed.

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| Which runs | Only runs with status **`completed`**, plus runs already in the audit or correction flow. `partial` runs are excluded, because FR-19 talks about completed checklists and SP7 counts `audit_pending`/`audited` as completed. |
| Entry into audit | **A per-checklist flag, plus on demand.** If a checklist has `requires_audit`, its completed runs move to `audit_pending` and appear in the audit queue. Auditors can also start an audit on any other completed run. |
| Audit result | **Passed or Failed, plus an audit score** (approved ÷ reviewed items). The run's own score changes only through corrections. |
| What a manager can correct | **Answer values only:** choices, number, text, date/time, and the item note. Photos and videos stay as captured. If the evidence is wrong, the manager sends the run back. Score and problems are recalculated. |
| Send-back | **Only the flagged items reopen.** Each item gets a comment, and there is an optional due date. The run reopens on the worker's phone and works offline. Resubmitting returns it to `completed`, or to `audit_pending`. |
| Audit report | **An automatic PDF when the audit finishes.** It is emailed to the checklist's address list plus any extra addresses from the auditor, and can be downloaded on the web at any time. |
| Platforms | **Web has the full experience. Mobile works online**, through the Team tab run screen, for on-site checks. The worker's rework on mobile works offline. |
| After audit | **Locked.** An `audited` run can't be corrected, sent back or audited again. |
| Storage model | **Current answers, plus a one-time snapshot of the original, plus an append-only correction log.** `executions.answers` still means "current answers", so existing readers keep working. |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A run of a checklist that requires audit moves to `audit_pending` when it completes, and appears in the web audit queue (FR-19.01).
2. A holder of `audits.perform` can:
   - open a completed run in scope;
   - review its answers, photos and videos (FR-19.02–03);
   - approve or reject each item with a comment (FR-19.04–05);
   - finish with Passed or Failed and a comment, which moves the run to `audited` (FR-19.06).
3. Finishing an audit builds a PDF report and emails it to the configured addresses (FR-19.07–08).
4. A holder of `executions.correct` can correct the answers of a completed run in scope, on the web or the phone, with a reason. Each change records the actor, time, item, old value, new value and reason, and the original stays readable (FR-19.09–14, BR-14).
5. The same holder can send the run back as `correction_required`. The worker fixes the flagged items on the phone, offline if needed, and resubmits (FR-19.15).
6. Anyone who can read the run sees a timeline of corrections and a comparison of original and current values (NFR-07.05).
7. Each manual action writes an audit-log entry (FR-26.02, NFR-07.04).

**Non-goals:**

- Audits, corrections or send-back on `partial`, `missed` or `cancelled` runs.
- Correcting photos, videos, start and finish times, the executor, or the checklist version.
- Reopening a run after its audit is finished. Re-audits.
- Audit sampling rules (for example "audit 10% of runs"), audit scheduling, or assigning auditors.
- Periodic audit digests. Audit analytics beyond the new runs-table column.
- Viewing the PDF on mobile. Starting a send-back or correction offline.
- Changing the checklist builder's scoring rules.

## 3. Lifecycle

### 3.1 Occurrence status

`occurrence_status` gets one new value, **`correction_required`** (`ALTER TYPE ... ADD VALUE`). The allowed manual transitions:

| From | To | Trigger | Actor |
|---|---|---|---|
| `completed` | `audit_pending` | The run completes and its checklist has `requires_audit` | system |
| `completed` | `audit_pending` | An audit is started on demand | auditor |
| `audit_pending` | `audited` | An audit is finished | auditor |
| `audit_pending` | `completed` | An on-demand audit is cancelled and the checklist doesn't require audit | auditor |
| `completed`, `audit_pending` | `correction_required` | Send-back | manager |
| `correction_required` | `completed` or `audit_pending` | The worker resubmits | worker |
| `correction_required` | the request's `status_before` | The manager withdraws the send-back | manager |

Rules:

- **When `requires_audit` is set,** the transition happens in the same transaction as `complete()`. History records two rows: `in_progress → completed` (worker), then `completed → audit_pending` (system).
- **On resubmit,** the run goes to `audit_pending` if the checklist requires audit **or** a non-cancelled audit exists for it. Otherwise it goes to `completed`.
- **Cancelling an audit** of a run whose checklist requires audit leaves the run in `audit_pending`. The run goes back to the "waiting" queue.
- **Direct corrections don't change the status.** They are allowed in `completed` and `audit_pending`.
- **`audited` is final.** Corrections, send-back and new audits are refused with `EXECUTION_LOCKED`.
- All changes go through `OccurrenceWriter.recordTransitions`, so `occurrence_status_history` and `occurrence.status_changed` work as today.
- **Reports and mobile:**
  - `correction_required` is added to `COMPLETED_STATUSES` in `report-logic.ts`. The run was executed, and its `completed_at` and `late` keep their original values.
  - The mobile "closed" sets treat it as open for the executor (§8.1) and as closed for everyone else.

### 3.2 Execution state

`execution_state` gets one new value, **`rework`**.

- **Send-back** sets `state = 'rework'` and increments `rework_round`.
- **Resubmit** sets `state = 'completed'` again.
- `completed_at`, `completed_received_at` and `late` are never overwritten. A resubmit sets `resubmitted_at` on the rework request instead.
- Rework isn't limited by `closes_at`, and the partial sweep ignores `rework` runs. The due date is informational: it is shown, and the notification mentions it. Nothing happens automatically when it passes.

### 3.3 Audit status

An `audits` row moves `in_progress → finished` or `in_progress → cancelled`. A run has at most one non-cancelled audit.

- A finished audit locks the run.
- While the run is `correction_required`, its in-progress audit is **paused**:
  - verdicts can still be edited;
  - `finish` is refused with `AUDIT_PAUSED`.
- After the worker resubmits, the auditor reviews the new answers and finishes.
- Verdicts on items that the rework changed are **reset to unreviewed**, so the auditor looks at them again.

## 4. Data model

The migrations are `0015_audit_corrections.sql` (schema) and `0016_audit_corrections_security.sql` (grants, RLS policies, permission backfill). Every new table has `tenant_id`, forced RLS, and composite foreign keys `(tenant_id, …)`, as in earlier sub-projects.

### 4.1 Changed tables

- **`checklists`:**
  - `requires_audit boolean not null default false`
  - `audit_report_emails text[] not null default '{}'`: up to 10 addresses, validated in contracts.
  - Both are checklist settings, not versioned content. They are edited on the checklist settings form under `checklists.manage`, and the existing `checklist.updated` audit action covers them.
- **`executions`:**
  - `original_answers jsonb`, `original_score jsonb` and `original_captured_at timestamptz`. They are null until the first correction or send-back, written once in that transaction, and never changed afterwards. A `BEFORE UPDATE` trigger rejects any change to them once they are non-null.
  - `rework_round int not null default 0`.
- **`execution_problems`:**
  - `cleared_at timestamptz` and `cleared_by_correction_id uuid`.
  - After a run closes, `problem-writer.ts` no longer deletes rule problems. A problem that a correction removes is cleared, and a problem that a correction adds is inserted. Rows from before the close keep their ids, so `tasks.problem_id` stays valid.
  - The partial unique index on `(execution_id, item_id, source)` becomes `WHERE cleared_at IS NULL`, so an item can have a cleared row and a new active row.
  - The problems page and report queries count only rows where `cleared_at IS NULL`.
- **`occurrence_status`:** adds `correction_required`.
- **`execution_state`:** adds `rework`.

### 4.2 New tables

**`execution_corrections`** (append-only: `taskop_app` gets `INSERT, SELECT`):

| Column | Notes |
|---|---|
| `id`, `tenant_id` | |
| `execution_id` | |
| `item_id` | the changed checklist item |
| `kind` | `manual` (direct correction) or `rework` (worker resubmit) |
| `round` | `rework_round` at the time; 0 for manual corrections before any send-back |
| `before`, `after` | the item's full `answerSchema` value, or null |
| `reason` | manual: the manager's reason. Rework: the manager's comment for that item. |
| `actor_user_id`, `actor_platform_admin_id` | |
| `at` | |

There is one row per item that actually changed; an unchanged submitted value writes nothing. These columns are the FR-19.13 field list.

**`execution_rework_requests`:**

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `execution_id`, `round` | unique `(execution_id, round)` |
| `items` | jsonb `[{itemId, comment}]`, 1–200 items, comment 1–1000 characters |
| `due_at` | nullable |
| `requested_by_user_id`, `requested_at` | |
| `answers_before` | the answers as they were when the run was sent back, used to build the rework diff |
| `status_before` | `completed` or `audit_pending`, restored if the send-back is withdrawn |
| `resubmitted_at` | null while open |
| `withdrawn_at`, `withdrawn_by_user_id` | null unless the manager withdrew the send-back |

`taskop_app` gets `INSERT, SELECT, UPDATE(resubmitted_at, withdrawn_at, withdrawn_by_user_id)`. A request is **open** while both `resubmitted_at` and `withdrawn_at` are null.

**`audits`:**

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `execution_id`, `occurrence_id` | |
| `status` | `in_progress`, `finished` or `cancelled` |
| `auditor_user_id`, `auditor_platform_admin_id` | |
| `started_at`, `finished_at`, `cancelled_at`, `cancel_reason` | |
| `result` | `passed` or `failed`, set at finish |
| `audit_score` | jsonb `{approved, rejected, reviewed, percent}`, set at finish |
| `comment` | final comment, up to 4000 characters |
| `report_status` | `none`, `pending`, `ready` or `failed` |
| `report_storage_key` | |
| `report_recipients text[]`, `report_sent_at` | |

Unique partial index on `(execution_id) WHERE status <> 'cancelled'`.

**`audit_item_verdicts`:** `audit_id`, `item_id`, `verdict` (`approved` or `rejected`), `comment` (required for `rejected`), `updated_by_user_id`, `updated_at`. Primary key `(audit_id, item_id)`. Rows can be edited while the audit is in progress and are read-only afterwards. RLS joins through `audits`.

### 4.3 Shared logic (contracts)

`packages/contracts/src/audit-logic.ts` holds pure functions used by the API, web and mobile:

- `canAudit(status)`, `canCorrect(status, state)`, `canSendBack(status, state)` and `nextStatusAfterResubmit(requiresAudit, hasOpenAudit)`.
- `auditableItems(versionContent)`: every answerable item. Section headers and info blocks are excluded.
- `auditScore(verdicts, items)`: `percent = approved ÷ (approved + rejected)`. Unreviewed items don't count.
- `diffAnswers(before, after)`: the list of item ids that changed, using a deep-equal on normalised answer values.
- `reworkGuard(answers, prevAnswers, reworkItemIds)`: rejects changes outside the flagged items.

## 5. Permissions and access

| Key | Group | Allows | System role defaults |
|---|---|---|---|
| `audits.perform` | Audit | List audits, start, review, finish and cancel them, send and download the report | Owner, Admin (all permissions), **Auditor** |
| `executions.correct` | Executions | Correct answers directly, send runs back | Owner, Admin, **Manager** |

- Both keys follow the holder's data scope through `SchedulingScope.occurrences()`. A run outside scope returns 404.
- `ExecutionAccess.assertCanRead` also accepts either key.
- `GET /audits/:id` and `GET /audits/:id/report.pdf` can also be read by holders of `reports.view` in scope, so managers can see audit outcomes.
- `audit.view` (Foundation) stays the key for browsing `audit_log`.
- `0016` backfills both keys into the existing Auditor, Manager and Admin system roles in every tenant, and bumps `roles.version`, following `0014`. Custom roles get them only when an admin adds them.
- The worker's rework commands use the existing executor checks (`NOT_EXECUTOR`). No new key is needed.
- Platform admins working inside a tenant can use these endpoints, with platform-admin attribution, as in SP2.

## 6. API

### 6.1 Modules

- **`audits` (new):**
  - `AuditsController`, `AuditsService`, `AuditQueueQuery`.
  - `AuditReportBuilder`, which builds the PDF.
  - `AuditReportJob`, a pg-boss job that builds the report and sends the email.
  - It depends on `executions`, `scheduling`, `media`, `mail` and `notifications`. Nothing depends on it, as NFR-15.02 asks.
- **`executions` (extended):**
  - `CorrectionsService`: direct corrections, send-back, resubmit, and the correction history read.
  - The recalculation helper shared by correction and resubmit: run `computeScore`, write the problems after close, and update `score`.

### 6.2 Endpoints

| Method and path | Permission | Behaviour |
|---|---|---|
| `GET /audits` | `audits.perform` | `queue=waiting\|in_progress\|finished` plus site, checklist, auditor, result and a date range on run completion. Cursor-paged. **Waiting** means status `audit_pending` with no non-cancelled audit. Rows contain run, checklist, site, executor, `completed_at`, audit status, auditor, result and percent. |
| `POST /executions/:id/audits` | `audits.perform` | Starts an audit. Needs status `completed` or `audit_pending` and no existing non-cancelled audit (`AUDIT_EXISTS`, which returns the existing id). Moves `completed` to `audit_pending`. Audit log `audit.started`. |
| `GET /audits/:id` | `audits.perform` or `reports.view` | The audit, its verdicts, the run's current answers, the pinned version content, media references, and correction history (§6.4). |
| `PUT /audits/:id/items/:itemId` | `audits.perform` | `{verdict, comment?}`. Comment required when rejecting. Only while in progress; paused audits accept it too. The item must be auditable. No audit-log entry for each verdict; the finish entry carries them all. |
| `DELETE /audits/:id/items/:itemId` | `audits.perform` | Clears a verdict. |
| `POST /audits/:id/finish` | `audits.perform` | `{result, comment?, extraEmails?}`. Refusals: `AUDIT_PAUSED` while `correction_required`; `AUDIT_INCOMPLETE` (with item ids) unless every auditable item has a verdict; `MEDIA_PENDING` if any of the run's media is still uploading. Sets `audit_score`, `finished_at` and `report_status=pending`, moves the run to `audited`, queues `audit.report` and emits `audit.finished`. Audit log `audit.finished` with result, score and the rejected item ids. |
| `POST /audits/:id/cancel` | `audits.perform` | `{reason}`. Status transition as in §3.1. Audit log `audit.cancelled`. |
| `GET /audits/:id/report.pdf` | `audits.perform` or `reports.view` | Streams the stored PDF. Returns `REPORT_NOT_READY` (409) while pending; a failed report can be rebuilt with the next endpoint. |
| `POST /audits/:id/report/send` | `audits.perform` | `{emails?}`. Rebuilds the report if it failed and sends it to the given addresses, or to the stored recipients. Audit log `audit.report_sent`. |
| `POST /executions/:id/corrections` | `executions.correct` | `{answersRev, changes: [{itemId, answer}], reason}`. Reason is 1–1000 characters. `ANSWERS_CONFLICT` (409) if `answersRev` is stale (§9). Needs status `completed` or `audit_pending` and state `completed` (`EXECUTION_LOCKED` / `EXECUTION_NOT_CORRECTABLE`). Media references in `answer` must be a subset of that item's existing media (`MEDIA_NOT_CORRECTABLE`). Writes the snapshot on the first change, one correction row per changed item, recalculates, and stores the answers with `answers_rev + 1`. Audit log `execution.corrected` with before and after for the changed items. If no item changed, it returns 200 and writes nothing. |
| `POST /executions/:id/send-back` | `executions.correct` | `{items: [{itemId, comment}], dueAt?}`. Same status checks. Writes the snapshot on the first change, the rework request with `answers_before`, `state=rework`, `rework_round+1`, and the status change. Emits `run.correction_required`. Audit log `execution.sent_back`. |
| `POST /executions/:id/send-back/cancel` | `executions.correct` | Withdraws the open request. Sets `withdrawn_at`, `state=completed`, and the status back to `status_before`. Answers the worker already synced stay in place; they aren't counted as corrections unless the manager corrects them. The next pull drops the run from the worker's phone. Audit log `execution.send_back_withdrawn`. |
| `GET /executions/:id/corrections` | read access to the run | `{original: {answers, score, capturedAt} \| null, corrections[], reworkRequests[], diff: [{itemId, original, current}]}`. |
| `PUT /executions/:id/answers` | executor | Existing endpoint. In `rework` state it is also accepted, and runs `reworkGuard` against the open request's `answers_before` (`ITEM_NOT_IN_REWORK`). |
| `POST /executions/:id/media` | executor | Existing endpoint, also accepted in `rework` state for flagged items. |
| `POST /executions/:id/resubmit` | executor | `{resubmittedAt}` (device time, checked with the existing clock bounds). Needs state `rework`. Runs the required-answer check (`REQUIREMENTS_UNMET`). Writes `rework` correction rows (diff of `answers_before` against the current answers, using each item's comment as the reason), recalculates, sets `resubmitted_at`, `state=completed`, and the status from §3.1. Resets verdicts on changed items if an audit is open. Emits `run.resubmitted`. Audit log `execution.resubmitted`. Idempotent: if state is already `completed` and the latest request is resubmitted, it returns 200. |

**`/me/sync`:**
- It returns the executor's `rework` runs with their answers and the open rework request (`items`, `dueAt`, `round`).
- Runs that leave `rework` are dropped on the next pull, as closed runs are today.
- The outbox order is `answers` → `media` → `resubmit`, using the same causal ordering as `complete`.

### 6.3 Recalculation after close

`recalculate(executionId)` runs in the caller's transaction:

1. Compute `computeScore(versionContent, answers)` and update `executions.score`.
2. Compare the problems derived from the answers with the active rule problems:
   - a problem that disappeared gets `cleared_at`/`cleared_by_correction_id`, pointing at the correction row for that item;
   - a new problem is inserted;
   - an unchanged problem whose severity or note changed is updated.
   - Manual problems (`source = manual`) are never touched.
3. Nothing changes on `occurrences`. Reports read the new score and the problems that aren't cleared.

The existing SP5 problem-to-task rule still applies to a cleared problem that has a task: the task stays. The problems page shows the problem as "cleared by correction".

### 6.4 Audit log actions

The new list `AUDIT_FLOW_AUDIT_ACTIONS` in `packages/contracts/src/audit.ts`:

- `audit.started`, `audit.finished`, `audit.cancelled` and `audit.report_sent`, with entity type `audit`.
- `execution.corrected`, `execution.sent_back`, `execution.send_back_withdrawn` and `execution.resubmitted`, with entity type `execution`.

`before` and `after` contain only the changed items. Verdict edits and the system's `completed → audit_pending` move are recorded only in their own tables and in the status history.

### 6.5 Error codes

New codes:
- `EXECUTION_LOCKED`, `EXECUTION_NOT_CORRECTABLE`, `ANSWERS_CONFLICT`
- `ITEM_NOT_IN_REWORK`, `MEDIA_NOT_CORRECTABLE`
- `AUDIT_EXISTS`, `AUDIT_PAUSED`, `AUDIT_INCOMPLETE`, `AUDIT_NOT_IN_PROGRESS`
- `REPORT_NOT_READY`

Each gets an Azerbaijani message in `packages/i18n`.

## 7. Notifications and the audit report

### 7.1 Notification types

Three types are added to `NOTIFICATION_TYPES`, `NOTIFICATION_TYPE_META` and `DEFAULT_RULES`, with templates in `packages/i18n/src/az/notifications.ts`:

| Type | Recipients | Channels (default) | Content |
|---|---|---|---|
| `run.correction_required` | the executor | push and inbox | checklist, site, number of flagged items, due date |
| `run.resubmitted` | the user who sent it back | inbox | checklist, executor, round |
| `audit.finished` | the executor, plus the rule's roles in scope (default: Manager) | inbox; email off | result and percent. The default rule notifies managers only on `failed` (a `resultFilter` rule option). |

`resultFilter` (`any` or `failed`) is a new optional field on the notification rule. It is used only by `audit.finished`, and the web rules editor shows it only for that type.

`DomainEvents` gets `execution.sent_back`, `execution.resubmitted` and `audit.finished`. The listeners call `NotificationsService.record` in a savepoint, as SP6 does.

### 7.2 Audit report job

- **The job:** `audit.report` runs as a pg-boss job with the SP6 worker settings (retry delay 15 s, up to 240 retries, localConcurrency 2). Steps:
  1. Load the audit, the run, the version content, the corrections and the media.
  2. Build the PDF with `AuditReportBuilder` (pdfmake and Noto Sans from SP7).
  3. Upload it to SeaweedFS under `tenants/{tenantId}/audits/{auditId}/report.pdf` and set `report_status=ready`.
  4. Send the email if there are recipients.
- **Failure:** after the retries run out, `report_status=failed`. The web shows "Report failed — Retry", which calls the send endpoint.
- **PDF contents:**
  - Header: tenant, checklist name and version, site, executor, scheduled window, actual start and finish time (device), sync time (FR-10.14), auditor, finish time, result, audit score, run score (current, plus original if corrected), and the final comment.
  - Items, by section: question, current answer, verdict and comment. If the item was corrected, the original value and the latest correction's actor and reason. Its problem, if there is one.
  - Up to 3 photos per item and 40 per report, fetched from storage and embedded at their stored size. Videos are listed as "N video(s)". Photos beyond the limits are counted, not embedded.
  - Footer: generation time and the audit id.
- **Email:**
  - `MailMessage` gets an optional `attachments: [{filename, content: Buffer, contentType}]`, which `SmtpMailer` passes to nodemailer.
  - Subject and body are Azerbaijani templates in `mail/templates.ts`.
  - Recipients are the checklist's `audit_report_emails` plus `extraEmails`: lower-cased, de-duplicated, at most 20. The extra addresses are stored on the audit.
  - One message per recipient, so one bad address doesn't block the rest. `report_sent_at` is set after the first successful send.
  - A run with no recipients still gets its PDF built.
- **Performance check:** a report with 200 items and 40 photos of 1.5 MB must build in under 10 s and under 300 MB of heap on the test machine. This is checked in the API test suite like SP7's export check.

## 8. Clients

### 8.1 Mobile (worker, offline)

- **Home:**
  - A "Needs correction" group sits above today's runs. It lists `rework` runs from local SQLite with the due date (red if passed) and the number of flagged items.
  - Runs in `correction_required` are no longer treated as closed for their executor.
- **Execution screen in rework mode:**
  - A banner shows the round and the due date.
  - Flagged items show the manager's comment and can be edited: values, notes, and new photos or videos.
  - All other items are read-only and dimmed.
  - The progress bar counts the flagged items.
  - Finishing goes to a "Resubmit" screen, not the normal finish screen, and the button queues `resubmit`.
- **Outbox:**
  - New command kind `resubmit`.
  - A server refusal (for example `REQUIREMENTS_UNMET`) reopens the run locally in rework mode, through a variant of `reopenRefusedCompletion`.
  - The existing offline badge applies.

### 8.2 Mobile (manager and auditor, online)

The Team tab run screen (`team/run/[id].tsx`) adds actions, depending on permission and status:

- **Audit** (`audits.perform`): starts or opens the audit. Shows an item list with Approve and Reject buttons and a comment sheet, and a Finish sheet with result, comment and extra emails.
- **Correct** (`executions.correct`): an edit mode that reuses the execution item editors for values only, then a reason sheet, then submit.
- **Send back** (`executions.correct`): select items, add a comment for each, an optional due date, then submit.
- **Corrections:** a read-only timeline section.

All of these need a connection. With no connection, the buttons are disabled and show the existing offline hint. There is no PDF on mobile.

### 8.3 Web

- **`/audits` page:**
  - Shown in the sidebar for `audits.perform`.
  - Tabs: Waiting, In progress, Finished. Filters for site, checklist, auditor, result and dates. Paged table.
  - Clicking a row opens the audit screen. In the Waiting tab, the row action is "Start audit".
- **Audit screen at `/audits/:id`:**
  - The left column lists items by section, with verdict chips and a progress bar of reviewed against auditable items.
  - The right panel shows the selected item: question, answer (a corrected item has an "Original" toggle), photos and videos in the existing media viewer, the problem, Approve and Reject buttons, and the comment.
  - Keyboard: ↑/↓ move between items, A approves, R rejects.
  - A paused audit shows a banner: "Sent back to the worker — waiting for resubmit".
  - The Finish dialog has result, comment, the checklist's read-only email list and extra addresses.
  - A finished audit is read-only, with PDF download, the report status, and Resend.
- **Run dialog (`occurrence-dialog.tsx`):**
  - A new **Audit** tab: summary and a link to the audit, or "Start audit".
  - A new **Corrections** tab: a timeline of manual corrections and rework rounds, and a two-column diff of original against current values for the changed items.
  - The execution tab gets **Correct answers** (inline edit, then a reason dialog) and **Send back** (item picker, a comment for each, optional due date), both behind `executions.correct` and the status rules.
- **Checklist settings:** the "Requires audit" switch and the "Audit report emails" tag input.
- **Reports runs tab (SP7):** an **Audit** column (Waiting, In progress, Passed or Failed), a "corrected" marker beside the score, and an audit-status filter. The export gains the same two columns.
- **Problems page:** cleared problems are hidden by default, with a "Show cleared" toggle.

## 9. Edge cases

- **Two managers correct the same run at once:** corrections take a row lock (`SELECT … FOR UPDATE`) on the execution. Each request sends the `answersRev` it was based on, and a mismatch returns `ANSWERS_CONFLICT` (409), so the client reloads.
- **Send-back while the worker's phone is offline:** the run reopens on the next pull. The push notification arrives when the phone is online.
- **A worker edits a stale local copy after resubmit:** rework answers after resubmit get `EXECUTION_NOT_ACTIVE`. The phone treats it as the existing closed-run refusal.
- **A second send-back before resubmit:** refused with `EXECUTION_NOT_CORRECTABLE`, because the state is `rework`.
- **The checklist's `requires_audit` changes later:** this affects only runs that complete afterwards, and resubmits.
- **The executor is deactivated or can't do the rework:**
  - The run stays `correction_required`, and direct corrections are refused because they need state `completed`.
  - The manager withdraws the send-back with `POST /executions/:id/send-back/cancel` (§6.2). The run returns to the status it had before, so the manager can then correct it directly.
- **The checklist version is archived or deactivated:** this has no effect, because the run's pinned version is used.
- **Tenant timezone:** due dates are shown in the tenant timezone, using the existing helpers.

## 10. Testing

- **contracts (Vitest):** `audit-logic` transition helpers, `auditScore`, `diffAnswers` normalisation (option order, empty vs missing), `reworkGuard`, email list validation.
- **API (Vitest on a real Postgres):**
  - Every transition in §3.1, including the system move to `audit_pending` on completion, and each refusal code in §6.5.
  - Scope: users out of scope get 404 for every new endpoint. Worker, Auditor and Manager permission matrix.
  - Snapshot written exactly once, with the trigger rejecting later changes. `UPDATE` and `DELETE` on `execution_corrections` fail for `taskop_app`.
  - Recalculation: score changes; a problem is cleared rather than deleted; a problem with a task keeps the task; a new problem is inserted; manual problems are untouched; reports totals reflect the corrected score.
  - Rework: guard, media on flagged items, resubmit idempotency, correction rows with comments as reasons, verdicts reset on changed items, paused audit refuses finish, send-back cancel.
  - `/me/sync` includes `rework` runs with their requests.
  - Audit report job: PDF built, stored and emailed with the mailer mocked; one recipient fails and the others still send; a failed report can be retried; the performance check (§7.2).
  - Notifications: the three types fan out to the expected recipients, and the failed-only filter works.
  - Audit-log entries for each action in §6.4.
  - Permission backfill for existing roles.
- **web (Vitest and Testing Library):** audit queue tabs and filters, the audit screen (verdicts, keyboard, paused banner, finish validation), the Correct and Send back dialogs, the Corrections tab diff, the checklist settings fields, and the reports column.
- **mobile (Jest):** home "Needs correction" group, rework mode editing guard, the `resubmit` outbox command and refusal reopen, and the Team tab actions with offline-disabled state.
- **e2e (Playwright, disposable PG):**
  1. A checklist requires audit. A run is completed through the API. The auditor reviews and finishes on the web. The PDF downloads.
  2. A manager sends a run back. The worker resubmits through the API. The audit resumes, the changed verdict is reset, and the auditor finishes.
- **Device checklist** (`docs/superpowers/sp8-device-checklist.md`, for the user): rework offline and resubmit, push on send-back, the on-site audit and correction from the Team tab.

## 11. Implementation plans

Three plans, following SP5–SP7:

1. **`2026-10-15-audit-corrections-1-api.md`:**
   - Contracts: statuses, `audit-logic`, schemas, permissions, error codes, notification types, i18n.
   - Migrations 0015 and 0016, and the api-client.
   - The corrections service and recalculation, the rework flow and sync, the audits module, the report builder and job, the mailer attachments, notifications, the audit log, reports and problems changes, and the API tests.
   - Its first tasks (contracts, migrations, api-client) unblock plans 2 and 3.
2. **`2026-10-15-audit-corrections-2-mobile.md`:** the rework mode and outbox `resubmit`, the home group, and the Team tab audit, correct and send-back actions.
3. **`2026-10-15-audit-corrections-3-web.md`:** the `/audits` page and audit screen, the run dialog tabs and actions, the checklist settings, the reports column, the problems toggle, and e2e.

New dependencies: none. The work reuses pdfmake, Noto Sans, nodemailer and pg-boss.

## 12. Later

- Audit sampling rules and assigning audits to specific auditors.
- Re-audit or reopening audited runs, with versioned reports.
- Correcting media and times, if customers ask.
- Audit analytics: failure rate per site, checklist or item.
- Periodic audit digests by email.
