# Taskop Audit and Corrections — Part 2: Mobile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement sub-project 8 spec §8.1 and §8.2 on the phone:
- a worker whose completed run was sent back sees it under "Düzəliş tələb olunur" on Home, fixes only the flagged items (values, notes, new photos and videos), offline if needed, and resubmits through the outbox;
- a manager or auditor on the Team tab's run screen can audit the run (verdict per item, finish with Passed or Failed), correct its answers with a reason, send it back with per-item comments and a due date, or withdraw a send-back, all online, and sees the run's corrections timeline;
- the three new notification types open the right screen.

**Architecture:**
- **Rework is local data, like any other run.**
  - Local database version 4 adds `executions.rework_round` and `executions.rework` (the open `ReworkRequest` as JSON, which carries the round's starting answers `answersBefore`). The pull stores them from `myExecutionSchema`; the run keeps the server's `state = 'rework'` and the occurrence's `status = 'correction_required'`.
  - `createExecutionStore` lets a `rework` run be edited past `closes_at`. It checks every change with Part 1's `reworkViolations(content, rework.answersBefore, next, flagged)`, the same rule the API applies. Only an unflagged item visible both at the round's start and after the change is locked, so follow-ups a flagged answer reveals (chains included) may be answered and hidden again. A locked change throws `ItemNotInReworkError` and queues nothing.
  - `store.resubmit()` turns the run read-only at once and queues a new outbox command `resubmit`, which `nextCommand` holds back while any answers revision or media registration of the same run is queued. The sync engine sends it to `POST /executions/:id/resubmit` and applies the result.
  - Refusals follow Part 1: `REQUIREMENTS_UNMET` reopens the run in rework (`reopenRefusedRework`); `EXECUTION_NOT_ACTIVE` on any rework command drops the local rework copy (`dropRework`). A rework run the server stops listing, with nothing queued, goes back to completed on the next pull (`settleLeftRework`).
- **Worker screens.**
  - `groupOccurrences` gains a first group, `rework`. `correction_required` is open for its executor (a `rework` execution on the phone) and closed for everyone else.
  - `ExecutionScreen` shows a rework banner (round, due date), the manager's comment on each flagged item, and dims and locks the others. Its progress bar counts the flagged items.
  - The finish route renders `ResubmitScreen` instead of `FinishScreen` for a rework run (`FinishOrResubmit`), so no route is added.
- **Team tab actions are online and pure-rule driven.**
  - `runActions` decides the buttons from `me.permissions` and Part 1's `canStartAudit`, `canCorrect`, `canSendBack` and `canWithdrawSendBack`.
  - `useRunCommand` runs one server action at a time and refreshes every `['team', viewerId]` query after a success.
  - Three mode components replace the run view while open: `AuditPanel` (verdicts, finish sheet), `CorrectMode` (the worker's `AnswerInput`, values and notes only, then a reason sheet) and `SendBackMode`. They keep their drafts when the connection drops and only disable their server buttons.
  - `CorrectionsTimeline` reads `GET /executions/:id/corrections` for runs that were corrected or sent back.
- **Notifications.** `routeForTarget` opens `run.correction_required`, `run.resubmitted` and `audit.finished` on the execution screen when the phone holds the run, else on the Team run screen for a viewer who can see the Team tab, else in the inbox.

**Tech Stack:** Expo SDK 57 (React Native 0.86, React 19.2.3, TypeScript 6 in `apps/mobile`), Expo Router, expo-sqlite (node:sqlite in Jest), `@tanstack/react-query` 5.104, i18next, Jest 29 (`jest-expo`) + React Native Testing Library 14. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-10-15-audit-corrections-design.md`. This plan covers §8.1, §8.2, the mobile lines of §9 (edge cases) and §10 (mobile Jest tests and the device checklist). The interface source is `docs/superpowers/plans/2026-10-15-audit-corrections-1-api.md` → **Interfaces for Parts 2 and 3**. Names from that section are used exactly; this plan invents no endpoint and no field.

**This plan is Part 2 of 3.** It depends on **Part 1 Tasks 1–4** being merged into the feature branch. They deliver `audit-logic.ts`, `corrections.ts` and `audits.ts` in `@taskop/contracts`, the changed existing contracts (`myExecutionSchema.rework`, `executionDetailSchema.{rework, reworkRound, corrected, audit}`, the new statuses, permission keys and error codes), `az.audits`, `az.corrections`, `az.errors.*`, the notification types, and `createAuditsApi` plus `executions.resubmit` in `@taskop/api-client`. Every Jest test here runs against a fake or mocked API. Part 3 (web) is independent of this part.

| This plan's task | Needs from Part 1, merged first |
|---|---|
| Tasks 1–13 | Tasks 1–4 (contracts, i18n, permissions and error codes, api-client). Part 1 Task 2 also adds the new defaulted fields to this app's existing test fixtures. |
| Task 14 Steps 2–4 (device run) | **All of Part 1**, Tasks 5–18: the migrations `0015`/`0016` with the Manager and Auditor permission backfill (Task 5); corrections, send-back, rework, resubmit and `/me/sync` (Tasks 6–10); audit-required runs (Task 11); the audits module (Tasks 12–13); the report job (Tasks 14–15); the three notification types (Task 16). |

---

## Global Constraints

- All Foundation Part 3, SP4–SP7 Part 2 mobile constraints still apply.
  - All text comes from `@taskop/i18n`. This part adds only `az.mobile.checklists.sections.rework`, `az.mobile.rework.*`, `az.mobile.sync.kinds.resubmit` and `az.mobile.team.{audit, correct, sendBack, history}.*`, with the exact Azerbaijani text in Task 1.
  - It reuses Part 1's `az.audits.*`, `az.corrections.*`, `az.errors.*`, `az.scheduling.statuses.correction_required` and `az.executions.states.rework`, and never renames them.
  - Touch targets are at least 44 pt. A network failure never logs the user out.
- **Tests look Part 1's strings up.** Part 1 Task 3 writes the Azerbaijani text of `az.audits.*` and `az.corrections.*`; this plan's Jest tests read them through `i18n.t` (`const tr = i18n.t.bind(i18n)`) instead of repeating literals. Only this part's own `az.mobile.*` strings are written out in tests.
- **Rework on the phone, exactly:**
  - `before` = `execution.rework.answersBefore` (the round's starting answers, from the server); `flagged` = `execution.rework.items[].itemId`.
  - Every change is checked with `reworkViolations(content, before, nextAnswers, flagged)`, where `content` is the run's pinned version. A non-empty result throws `ItemNotInReworkError` before anything is written.
  - Editable on screen = `reworkEditable(content, execution)` = the flagged items ∪ the items visible now that were not visible in `before`. Revealed follow-ups are editable, with no manager comment and the hint "Yeni sual". Newly hidden items stay hidden.
  - A photo, video or problem medium may be attached only to an editable item.
  - A `rework` run is never locked by `closes_at` and never becomes `partial` on the phone (spec §3.2).
  - The resubmit command's payload is `{ resubmittedAt }`, the device time of the tap; `deviceTime` and `clientOffsetMs` are stamped at send, as for every execution command (`resubmitCommandSchema`).
  - `completed_at` is never changed by rework or resubmit.
- **Outbox order:** a `resubmit` is sent only when no `answers` or `media` command of the same execution is queued, pending or failed, whatever its `seq` (Part 1 "answers → media → resubmit").
- **Refusals of rework commands, exactly:**

  | Command | Code | What the phone does |
  |---|---|---|
  | `resubmit` | `REQUIREMENTS_UNMET` | Back to `rework`; the command goes (`reopenRefusedRework`). |
  | `answers`, `media`, `resubmit` of a run holding `rework` | `EXECUTION_NOT_ACTIVE` | `dropRework`: every queued command of the run, its media never registered (and their files) and the request go; the run shows `completed` with the note `errors.EXECUTION_NOT_ACTIVE`; the next pull brings the server's copy. |
  | `resubmit` | anything else permanent | Parked as failed (red). "Sil" puts the run back into `rework` with the note. |
  | `answers` | anything permanent (e.g. `ITEM_NOT_IN_REWORK`) | Parked as failed, as today. It holds the `resubmit` back until it is retried or discarded. |
- **Local database:** version 4 appends one migration (`ALTER TABLE executions ADD COLUMN rework_round …`, `… ADD COLUMN rework TEXT`). Shipped entries of `MIGRATIONS` are never edited.
- **Team tab actions:**
  - They exist only on the Team tab run screen (`app/(app)/team/run/[id].tsx`), which already needs `reports.view` and a scope wider than `own` (`canSeeTeam`).
  - Buttons follow `runActions` (Task 7) and nothing else.
  - Every server action goes through `useRunCommand`: one at a time, and a success invalidates `['team', viewerId]`. A verdict is the one exception: it updates the cached audit instead of reloading it.
  - Offline: outside a mode, the run screen shows SP7's offline message (unchanged). Inside a mode, the drafts stay, every button that calls the server is disabled, and the existing hint `az.mobile.team.offline` ("Komandanı görmək üçün internetə qoşulun") is shown.
  - No PDF on mobile, no audit cancel and no report resend on mobile (web only, spec §8.2).
- **The worker flow stays the same.** `src/features/execution/execution-screen.test.tsx` and `finish-screen.test.tsx` are not edited, and they pass after every task.
- **The shared packages ship `dist/`.** Before any mobile test or typecheck, run `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build`.
- **Typed routes.** This part adds no route file. `apps/mobile/.expo/types/router.d.ts` is gitignored and generated by `expo start`; if `typecheck` reports an unknown route pathname (for example `/team/run/[id]`), the file predates a route that exists: delete `apps/mobile/.expo/types` and run `typecheck` again (`router.push` then takes the loose `Href` type).
- **Tests:**
  - The mobile tests are Jest (`jest-expo`), run with `pnpm --filter @taskop/mobile test -- <path>`. RNTL 14's `render`, `renderHook`, `rerender`, `fireEvent.*` and `act` are awaited.
  - Every test that renders `RemoteMediaStrip` or the execution components mocks `@/features/execution/capture` (or `./capture`), which imports the camera.
  - An `ApiError` carrying Part 1's new body fields is built as `Object.assign(new ApiError(status, code, key), { itemIds })` (or `{ auditId }`), so the tests do not depend on the constructor's parameter order.
  - `packages/i18n` tests are Vitest.
- Commits use explicit paths (`git add <paths>`, never `-A`). Messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Spec decisions this plan makes

1. **Local representation of rework.** Two new columns on `executions`:
   - `rework_round INTEGER NOT NULL DEFAULT 0`;
   - `rework TEXT`, the open request as verbatim JSON, including the server's `answersBefore` (the round's starting answers).

   The execution's local `state` is the server's (`rework`), and the occurrence's `status` is the server's (`correction_required`). No new table: everything else (answers, revisions, media, outbox) is the existing execution pipeline.
2. **Which items the worker may change** (Part 1's rule, the API guard's own function). The worker may change:
   - the flagged items;
   - every item not visible in `answersBefore`;
   - every item not visible in the new answers.

   Only an unflagged item visible both at the round's start and after the change is locked. So a follow-up that a flagged change reveals (and a chain of them) may be answered, and hidden again with its answer left in place.
   - **The check.** Every change is checked with `reworkViolations(content, rework.answersBefore, next, flagged)` against the round's start, not against the previous answers. A revealed follow-up therefore stays editable on later changes.
   - **Media.** The server registers a medium whose `itemId` is flagged or not visible in `answersBefore`, so registration order doesn't matter. The phone keeps the usual causal order: answers, then media, then resubmit.
   - **On screen.** `reworkEditable` = flagged ∪ visible now but not visible in `answersBefore`. Revealed follow-ups show "Yeni sual" and no manager comment. Newly hidden items stay hidden, as for any run.
3. **Resubmitting here** sets the local state to `completed` at once (the screens are read-only), keeps `rework` until the server answers (so the Resubmit screen still shows the round and a refusal can reopen it), and changes the occurrence's status only from the server's `ResubmitResult.status`.
4. **A run leaves rework on the phone** in three ways: the resubmit's result (`rework = NULL`, the server's state and status); a pull that lists it without `rework` (normal merge); or a pull that no longer lists it while nothing of it is queued (`settleLeftRework`: `completed`, request dropped, occurrence `completed` until the server says otherwise).
5. **Entering rework** (a pull turns a local `completed` copy into `rework`) clears the old `sync_note` and `finished_synced_at`; `markFinishedSynced` never marks a `rework` run.
6. **Home.** The `rework` group comes first and is hidden when empty. A card shows the round, the number of flagged items and the due date in the tenant's time zone (`formatDateTime`, `services.timeZone`), red with "Gecikir" once the due date has passed. Rework runs count in "Mənim tapşırıqlarım", and in "Gecikən" once overdue.
7. **Progress in rework** = the visible editable items (flagged items plus revealed follow-ups) that are answered and have nothing missing (`requirements`), out of the visible editable items ("1/2 qaytarılan bənd hazırdır").
8. **The Resubmit screen** lives on the existing route `/execution/[id]/finish`: `FinishOrResubmit` picks `ResubmitScreen` when the execution holds a rework request, and `FinishScreen` otherwise.
9. **Team actions are on the Team tab only.** A role with `audits.perform` or `executions.correct` but without `reports.view` (or with scope `own`) has no Team tab and gets no actions on the phone; the system Auditor and Manager roles have both.
10. **Audit on mobile:**
    - Approve is one tap. Reject opens a comment sheet, and the comment is required (`auditVerdictInputSchema`). A verdict can be cleared.
    - A verdict's answer replaces the one in the cached `AuditDetail` (no reload per tap).
    - Finish is offered only when the audit is in progress, not paused, and `missingVerdicts` is empty. The sheet takes the result, a comment and extra addresses separated by commas, spaces or semicolons (`finishAuditInputSchema`), and shows the checklist's report addresses read-only.
    - `AUDIT_INCOMPLETE` highlights `ApiError.itemIds`. `AUDIT_EXISTS` opens `ApiError.auditId`.
    - A finished audit is shown read-only, with its result, score and report status; the PDF is web-only.
11. **Corrections on mobile:**
    - Values and notes only, through the worker's `AnswerInput` (exported from `item-field.tsx`). Photos, videos and the manual problem are never edited and never sent (`correctionAnswer` strips `problem`).
    - The changes are `changedItemIds(base, draft)`. "Davam et" refuses with no change, and lists what the draft leaves missing (`requirements`) before asking for a reason.
    - `ANSWERS_CONFLICT` shows the error and "Yenidən yüklə", which refetches the run and restarts the draft from the server's answers and revision.
12. **Send-back on mobile:**
    - Any visible item can be picked, each needs a comment.
    - The optional due date is typed as on the task form (`İİİİ-AA-GG SS:DD`, device time, `toAnswerDatetime('datetime', …)`) and shown in the tenant's time zone.
    - Nothing is pre-filled from audit verdicts.
13. **Withdraw** asks for confirmation with the native alert.
14. **Corrections timeline:**
    - It is requested only when the run was corrected or sent back (`detail.corrected || detail.reworkRound > 0`).
    - Rework rounds and corrections are interleaved by time; each correction shows before and after as one line of text, with the reason.
    - The two-column original-versus-current diff is web-only.
    - Cleared problems keep their card with a "cleared" badge, and no longer count as the item's problem.
15. **Notification deep links.** The three new types target the run's occurrence (`targetKind: 'occurrence'`, `targetId` = occurrence id; Part 1 Interfaces, `notifications.ts`). Route: the execution screen when the phone holds an execution of it; else Home when it holds the occurrence only; else the Team run screen when the type is one of the three and the user can see the Team tab; else the inbox.
16. **Finish refusals.** Finish answers `MEDIA_NOT_FOUND_IN_STORAGE` while a medium of the run is still uploading (Part 1 Global Constraints). The audit panel shows it with `mobileErrorText`, like every other refusal, and the auditor tries again later.

## Review Focus

These are the five failure modes most likely to bite real users that no spec test names. Each line names the task and the test that pins it.

1. **The manager withdraws the send-back while the worker's phone is offline with edits and a resubmit queued.** On reconnect the phone must not keep a red row or a run it can never resubmit. It drops the rework copy (queued answers, unregistered photos, the resubmit), shows the run completed with a note, and takes the server's answers. Pinned in Task 5 (`a withdrawn send-back drops the queued rework …`) and Task 2 (`a rework run the server stopped listing goes back to completed when nothing of it is queued`).
2. **The resubmit overtakes the work it closes.** A resubmit sent before the last answers revision or a photo registration would make the server check stale answers. It must wait for every answers and media command of its run, even a revision re-queued after it, and wait while an answers revision is parked. Pinned in Task 5 (`waits for every answers revision and media registration of its run, even one queued after it` and `is held back while an answers revision of its run is parked …`).
3. **The worker changes something that was neither sent back nor revealed by a flagged change:** another item's answer, a ⚑ problem, or a photo on another item. It must be refused on the phone with nothing queued, so the server's `ITEM_NOT_IN_REWORK` never parks the outbox. The reverse matters as much: a follow-up the flagged change revealed must stay answerable on every later edit, and hiding it again must not be refused. Pinned in Task 4 (`refuses a change to an item that was not sent back and queues nothing`, `refuses a photo or a problem photo on an item that was not sent back`, `answers a follow-up a flagged change reveals, on every later edit` and `hides a revealed follow-up again without being refused`).
4. **The connection drops while a manager is mid-correction, mid-audit or mid-send-back.** The draft must survive, every server button must turn off with the offline hint, and nothing may be sent; when the connection is back, the manager carries on. Pinned in Task 9 (`keeps the draft and turns saving off while offline`), Task 10 (`offline the review stays on screen …`), Task 8 (`offline the send button is off …`) and Task 12 (`keeps an open correction and its draft when the connection drops`).
5. **Double taps and two managers at once.**
   - A second tap on "Yenidən təqdim et", Finish or "İcraçıya qaytar" while the first is in flight must send once.
   - When two managers correct the same run, the loser must reload and never re-send the stale draft with the old revision.

   Pinned in Task 5 (`queues one resubmit when two taps race`), Task 7 (`runs one action at a time …`), Task 8 (`a second tap while sending sends once`) and Task 9 (`after ANSWERS_CONFLICT it reloads and sends the next correction with the new revision`).

---

## File Structure

```
packages/i18n/src/az/mobile.ts                        + checklists.sections.rework, rework.*, sync.kinds.resubmit, team.{audit, correct, sendBack, history}.*
packages/i18n/src/i18n.test.ts                        + mobile audit and correction strings
apps/mobile/
  app/(app)/execution/[id]/finish.tsx                 renders FinishOrResubmit (Task 6)
  src/offline/
    db.ts                                             + MIGRATIONS[3] (version 4): executions.rework_round, executions.rework
    migration-v4.test.ts                              (new)
    local-model.ts                                    ExecutionRow/LocalExecution + reworkRound, rework
    sync-pull.ts (+ sync-pull.test.ts)                rework ingest, entering rework, settleLeftRework
    execution-store.ts                                FINISHED_STATUSES + correction_required; ItemNotInReworkError, flaggedItems,
                                                      reworkEditable, rework guard, resubmit()
    rework-store.test.ts                              (new) editing a rework run
    outbox.ts (+ outbox.test.ts)                      COMMAND_KINDS + 'resubmit'; nextCommand holds it behind answers/media
    sync-api.ts                                       executions: + 'resubmit'
    sync-engine.ts                                    send/apply 'resubmit'; markFinishedSynced skips rework
    refusals.ts                                       dropMedium keeps rework open; reopenRefusedRework, dropRework, discard 'resubmit'
    rework-sync.test.ts                               (new) resubmit end to end against the fake API
    testing/fixtures.ts                               myExecution + reworkRound/rework; REWORK_*, MANAGER_REF, reworkRequest,
                                                      completedAnswers, reworkSync
    testing/fake-api.ts                               + resubmit handler
  src/features/checklists/
    group-occurrences.ts (+ test)                     'rework' group first, ReworkCard, correction_required closed for others
    occurrence-card.tsx                               round, flagged count, due date (red when passed), "Düzəliş et"
  src/features/home/home-screen.tsx (+ test)          hides the empty rework group
  src/features/execution/
    use-execution.ts (+ use-execution.test.ts)        readOnlyReason: rework is editable
    rework.ts (+ rework.test.ts)                      reworkComments, reworkOverdue, reworkProgress
    execution-screen.tsx                              rework banner, comments, dimmed items, rework progress
    finish-screen.tsx                                 exports nextJump
    resubmit-screen.tsx                               (new) ResubmitScreen, FinishOrResubmit
    rework-screen.test.tsx                            (new)
    item-field.tsx                                    exports AnswerInput, needsNote (no behaviour change)
    answer-view.tsx (+ test)                          exports ReadOnlyItem; cleared problems badge, not counted as the item's problem
  src/features/team/
    team-format.ts (+ test)                           statusTone: correction_required → warning
    run-actions.ts (+ run-actions.test.ts)            RunActions, NO_ACTIONS, runActions
    queries.ts                                        teamKeys.audit/corrections, useTeamAudit, useTeamCorrections, CommandResult,
                                                      RunCommand, useRunCommand
    run-queries.test.tsx                              (new)
    send-back-mode.tsx (+ send-back-mode.test.tsx)    SendBackMode
    correct-mode.tsx (+ correct-mode.test.tsx)        correctionAnswer, CorrectMode (with its reason sheet)
    verdict-sheet.tsx                                 VerdictSheet (reject comment)
    finish-audit-sheet.tsx                            FinishAuditSheet, parseEmails
    audit-panel.tsx (+ audit-panel.test.tsx)          AuditPanel
    correction-format.ts                              answerSummary
    corrections-timeline.tsx (+ test)                 CorrectionsTimeline
    run-screen.tsx                                    modes, actions bar, rework summary, audit and corrected badges, timeline
    run-screen-actions.test.tsx                       (new)
    testing/fixtures.ts (+ fixtures.test.ts)          clearedAt, rework fields; AUDIT*, CORRECTION*, REQUEST, LEYLA, auditBrief,
                                                      auditVerdict, auditDetail, executionCorrections, correction, teamRework
    testing/with-command.tsx                          (new) WithCommand
  src/notifications/notification-router.ts (+ test)   TEAM_RUN_TYPES, /team/run/[id] route, canSeeTeam
  src/notifications/notifications-bridge.tsx          passes canSeeTeam
  src/features/notifications/inbox-screen.tsx         passes canSeeTeam
docs/superpowers/sp8-device-checklist.md              (new) manual device checklist for the user
```

---


### Task 1: Phone strings, rework fixtures and keeping the suite green after Part 1

**Files:**
- Modify: `packages/i18n/src/az/mobile.ts`
- Test: `packages/i18n/src/i18n.test.ts`
- Modify: `apps/mobile/src/offline/testing/fixtures.ts`, `apps/mobile/src/features/team/testing/fixtures.ts`
- Test: `apps/mobile/src/features/team/testing/fixtures.test.ts`
- Modify: `apps/mobile/src/features/team/team-format.ts`
- Test: `apps/mobile/src/features/team/team-format.test.ts`

**Interfaces:**
- Consumes (Part 1):
  - types `ReworkRequest`, `MyExecution` (with `reworkRound`, `rework`), `ExecutionDetail` (with `reworkRound`, `rework`, `corrected`, `audit`), `ExecutionProblem` (with `clearedAt`), `AuditBrief`, `AuditDetail`, `AuditItemVerdict`, `ExecutionCorrections`, `Correction`, `OccurrenceStatus` (with `correction_required`);
  - schemas `auditDetailSchema`, `executionCorrectionsSchema`, `executionDetailSchema`, `syncResponseSchema`;
  - strings `az.scheduling.statuses.correction_required`, `az.executions.states.rework`.

  Existing: the offline fixtures (`ME`, `OTHER`, `OCC`, `T`, `checklist()`, `occurrence()`, `myExecution()`, `syncResponse()`, `versionOf()`), the team fixtures and `statusTone`.
- Produces:
  - Strings (exact text in Step 3):
    - `az.mobile.checklists.sections.rework`;
    - `az.mobile.rework.{items, fix, managerComment, newQuestion, progress, notFlagged, title, flaggedTitle, ready, resubmit, resubmitted, sentBanner}`;
    - `az.mobile.sync.kinds.resubmit`;
    - `az.mobile.team.audit.{finishTitle, rejectTitle, emailsHint, invalidEmails, reportTo, noReportEmails, finished, reportOnWeb}`;
    - `az.mobile.team.correct.{title, next, mediaHint, noChanges, reasonRequired, saved, reload}`;
    - `az.mobile.team.sendBack.{title, pick, due, noItems, commentRequired, sent, withdrawTitle, withdrawBody, withdrawn}`;
    - `az.mobile.team.history.{requested, by, before, after, reason, media, resubmittedAt, withdrawnAt, platform}`.
  - `src/offline/testing/fixtures.ts`:
    - `myExecution()` sets `reworkRound: 0, rework: null` (Part 1 Task 2 adds them; this task checks);
    - ids `REWORK_EXECUTION`, `REWORK_PHOTO`, `REWORK_REQUEST`, the instant `REWORK_DUE`, and `MANAGER_REF: UserRef`;
    - `reworkRequest(over?: Partial<ReworkRequest>): ReworkRequest`;
    - `completedAnswers(c: Checklist): MyExecution['answers']`;
    - `reworkSync(c: Checklist, items: ReworkRequest['items'], o?: { request?: Partial<ReworkRequest>; execution?: Partial<MyExecution> }): SyncResponse`.
  - `src/features/team/testing/fixtures.ts`:
    - `executionProblem()` sets `clearedAt: null`; `executionDetail()` sets `reworkRound: 0, rework: null, corrected: false, audit: null` (Part 1 Task 2 adds them; this task checks);
    - ids `AUDIT`, `AUDIT2`, `CORRECTION`, `CORRECTION2`, `REQUEST`, and `LEYLA: UserRef` (the Team viewer, id `ME`);
    - builders `auditBrief(over?)`, `auditVerdict(itemId, over?)`, `executionCorrections(over?)`, `correction(over?)`, `teamRework(over?)` and `auditDetail(c, over?)`.
  - `statusTone('correction_required') === 'warning'`.

- [ ] **Step 1: Write the failing i18n test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('mobile audit and correction translations', () => {
  it('labels the rework flow on the worker’s phone', () => {
    expect(az.mobile.checklists.sections.rework).toBe('Düzəliş tələb olunur');
    expect(az.mobile.rework.items.replace('{{count}}', '2')).toBe('2 bənd düzəliş tələb edir');
    expect(az.mobile.rework.fix).toBe('Düzəliş et');
    expect(az.mobile.rework.managerComment.replace('{{comment}}', 'Yenidən ölçün')).toBe('Rəhbərin şərhi: Yenidən ölçün');
    expect(az.mobile.rework.progress.replace('{{done}}', '1').replace('{{total}}', '2')).toBe('1/2 qaytarılan bənd hazırdır');
    expect(az.mobile.rework.resubmit).toBe('Yenidən təqdim et');
    expect(az.mobile.rework.resubmitted).toBe('Düzəlişlər göndərildi.');
    expect(az.mobile.rework.newQuestion).toBe('Yeni sual');
    expect(az.mobile.sync.kinds.resubmit).toBe('Yenidən təqdim');
    for (const k of ['notFlagged', 'title', 'flaggedTitle', 'ready', 'sentBanner'] as const) expect(az.mobile.rework[k], k).toBeTypeOf('string');
  });

  it('labels the Team tab’s audit, correction, send-back and history screens', () => {
    expect(az.mobile.team.correct.next).toBe('Davam et');
    expect(az.mobile.team.correct.noChanges).toBe('Heç bir cavab dəyişməyib.');
    expect(az.mobile.team.sendBack.title).toBe('İcraçıya qaytar');
    expect(az.mobile.team.sendBack.noItems).toBe('Ən azı bir bənd seçin.');
    expect(az.mobile.team.history.requested.replace('{{name}}', 'Leyla').replace('{{count}}', '2')).toBe('Leyla 2 bəndi qaytarıb');
    expect(az.mobile.team.audit.reportTo.replace('{{emails}}', 'a@b.az')).toBe('Hesabat göndəriləcək: a@b.az');
    for (const group of ['audit', 'correct', 'sendBack', 'history'] as const) {
      for (const [k, v] of Object.entries(az.mobile.team[group])) expect(v, `${group}.${k}`).toBeTypeOf('string');
    }
  });

  it('uses Part 1’s wording for the new statuses', () => {
    expect(az.scheduling.statuses.correction_required).toBe('Düzəliş tələb olunur');
    expect(az.executions.states.rework).toBe('Düzəlişdə');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL in `labels the rework flow…` (`az.mobile.rework` is undefined) and `labels the Team tab’s…`. `uses Part 1’s wording…` passes.

- [ ] **Step 3: Add the strings**

In `packages/i18n/src/az/mobile.ts`, replace the `sections` line of `checklists`:

```ts
    sections: { now: 'İndi', inProgress: 'Davam edən', upcoming: 'Gələcək', done: 'Bitmiş' },
```

with:

```ts
    sections: { rework: 'Düzəliş tələb olunur', now: 'İndi', inProgress: 'Davam edən', upcoming: 'Gələcək', done: 'Bitmiş' },
```

Insert after the `finish: { … },` block (before `sync: {`):

```ts
  /** Spec §8.1: a run sent back to its executor for correction. */
  rework: {
    items: '{{count}} bənd düzəliş tələb edir',
    fix: 'Düzəliş et',
    managerComment: 'Rəhbərin şərhi: {{comment}}',
    progress: '{{done}}/{{total}} qaytarılan bənd hazırdır',
    /** A follow-up a flagged change revealed: editable, with no manager comment. */
    newQuestion: 'Yeni sual',
    notFlagged: 'Bu bənd düzəlişə qaytarılmayıb, onu dəyişmək olmaz.',
    title: 'Yenidən təqdim et',
    flaggedTitle: 'Qaytarılan bəndlər',
    ready: 'Hazırdır',
    resubmit: 'Yenidən təqdim et',
    resubmitted: 'Düzəlişlər göndərildi.',
    sentBanner: 'Düzəlişlər göndərilib. Cavablar artıq dəyişdirilə bilməz.',
  },
```

In `sync.kinds`, replace:

```ts
      complete: 'Tamamlama',
```

with:

```ts
      complete: 'Tamamlama',
      resubmit: 'Yenidən təqdim',
```

Replace the whole `team: { … },` block at the end with:

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
    /** SP8 spec §8.2: the run screen's audit. */
    audit: {
      finishTitle: 'Auditi bitir',
      rejectTitle: 'Rədd etmə səbəbi',
      emailsHint: 'Ünvanları vergül ilə ayırın',
      invalidEmails: 'E-poçt ünvanlarından biri düzgün deyil.',
      reportTo: 'Hesabat göndəriləcək: {{emails}}',
      noReportEmails: 'Checklistdə hesabat ünvanı yoxdur.',
      finished: 'Audit bitdi.',
      reportOnWeb: 'PDF hesabatı veb-də yükləmək olar.',
    },
    correct: {
      title: 'Cavabları düzəlt',
      next: 'Davam et',
      mediaHint: 'Foto və videolar dəyişdirilmir. Sübut səhvdirsə, icranı icraçıya qaytarın.',
      noChanges: 'Heç bir cavab dəyişməyib.',
      reasonRequired: 'Səbəb yazın.',
      saved: 'Düzəliş yadda saxlanıldı.',
      reload: 'Yenidən yüklə',
    },
    sendBack: {
      title: 'İcraçıya qaytar',
      pick: 'Düzəldilməli bəndləri seçin və hər biri üçün şərh yazın.',
      due: 'Son tarix (İİİİ-AA-GG SS:DD), istəyə görə',
      noItems: 'Ən azı bir bənd seçin.',
      commentRequired: 'Hər seçilmiş bənd üçün şərh yazın.',
      sent: 'İcra icraçıya qaytarıldı.',
      withdrawTitle: 'Qaytarma geri götürülsün?',
      withdrawBody: 'İcraçı bu bəndləri artıq düzəldə bilməyəcək. Göndərdiyi cavablar qalır.',
      withdrawn: 'Qaytarma geri götürüldü.',
    },
    history: {
      requested: '{{name}} {{count}} bəndi qaytarıb',
      by: '{{name}}, {{time}}',
      before: 'Əvvəl',
      after: 'Sonra',
      reason: 'Səbəb: {{reason}}',
      media: '{{count}} fayl',
      resubmittedAt: 'Yenidən təqdim edilib: {{time}}',
      withdrawnAt: 'Geri götürülüb: {{time}}',
      platform: 'Platforma administratoru',
    },
  },
```

- [ ] **Step 4: Run the i18n tests and build**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 5: Write the failing fixture and status-colour tests**

Append inside the `describe('team fixtures', …)` block of `apps/mobile/src/features/team/testing/fixtures.test.ts`, and extend its imports:

```ts
import {
  auditDetailSchema,
  employeeReportRowSchema,
  executionCorrectionsSchema,
  executionDetailSchema,
  meSchema,
  occurrenceDetailSchema,
  reportRunPageSchema,
  reportSummarySchema,
  syncResponseSchema,
} from '@taskop/contracts';
import { checklist, reworkSync } from '@/offline/testing/fixtures';
import {
  auditBrief,
  auditDetail,
  auditVerdict,
  correction,
  employeeRow,
  executionCorrections,
  executionDetail,
  missedOccurrence,
  occurrenceDetail,
  reportRun,
  reportSummary,
  RUN_CURSOR,
  runPage,
  teamMe,
  teamRework,
  unassignedRow,
} from './fixtures';
```

```ts
  it('match Part 1’s audit, correction and rework schemas', () => {
    const c = checklist();
    expect(issues(auditDetailSchema, auditDetail(c, { verdicts: [auditVerdict(c.problem.id)] }))).toEqual([]);
    expect(issues(executionCorrectionsSchema, executionCorrections({ corrections: [correction()], reworkRequests: [teamRework()] }))).toEqual([]);
    expect(issues(executionDetailSchema, executionDetail(c, { reworkRound: 1, rework: teamRework(), corrected: true, audit: auditBrief() }))).toEqual([]);
    expect(issues(syncResponseSchema, reworkSync(c, [{ itemId: c.temp.id, comment: 'Temperaturu yenidən ölçün' }]))).toEqual([]);
  });
```

In `apps/mobile/src/features/team/team-format.test.ts`, replace the whole `it('colours every status', …)` test (Part 1 Task 2 may already have added a `correction_required` line to it) with:

```ts
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
      correction_required: 'warning',
    });
  });
```

- [ ] **Step 6: Run them and check they fail**

Run: `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build && pnpm --filter @taskop/mobile test -- src/features/team/testing src/features/team/team-format`
Expected: FAIL. `fixtures.test.ts` cannot import `auditDetail`, `reworkSync` and the other new builders, and `colours every status` gets `neutral` for `correction_required`.

- [ ] **Step 7: Write the fixtures and the colour**

In `apps/mobile/src/offline/testing/fixtures.ts`, replace the `@taskop/contracts` import with:

```ts
import {
  blankContent,
  type ChecklistContent,
  type DeviceInfo,
  type MyExecution,
  newItem,
  newRule,
  newSection,
  type NotificationItem,
  type NumberItem,
  type PhotoItem,
  type PushData,
  type ReworkRequest,
  type SyncChecklistVersion,
  type SyncOccurrence,
  type SyncResponse,
  type SyncTask,
  type YesNoItem,
} from '@taskop/contracts';
```

Part 1 Task 2 has already given `myExecution` the defaulted fields `reworkRound: 0` and `rework: null`. Check with `grep -n "reworkRound\|rework: null" apps/mobile/src/offline/testing/fixtures.ts`; only if they are missing, replace in `myExecution`:

```ts
  mediaPending: 0,
  ...over,
});
```

with:

```ts
  mediaPending: 0,
  reworkRound: 0,
  rework: null,
  ...over,
});
```

Append to the end of the file:

```ts
export const REWORK_EXECUTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ec0';
export const REWORK_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ec1';
export const REWORK_REQUEST = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ec2';
/** 18:00 on Tuesday 3 Nov 2026 in Baku. */
export const REWORK_DUE = '2026-11-03T14:00:00.000Z';
/** The manager who sends runs back (SP8). */
export const MANAGER_REF = { id: OTHER, fullName: 'Murad Həsənov' };

/** An open send-back request of round 1 (Part 1 `ReworkRequest`); give it the flagged `items` and the starting answers. */
export const reworkRequest = (over: Partial<ReworkRequest> = {}): ReworkRequest => ({
  id: REWORK_REQUEST,
  round: 1,
  items: [],
  answersBefore: {},
  dueAt: REWORK_DUE,
  requestedBy: MANAGER_REF,
  requestedAt: '2026-11-02T08:00:00.000Z',
  resubmittedAt: null,
  withdrawnAt: null,
  withdrawnBy: null,
  ...over,
});

/** Answers of `checklist()` that meet every requirement: "Xeyr", 5 °C, one photo. */
export const completedAnswers = (c: Checklist): MyExecution['answers'] => ({
  [c.problem.id]: { optionIds: [c.no.id] },
  [c.temp.id]: { number: 5 },
  [c.photo.id]: { photos: [REWORK_PHOTO] },
});

/**
 * /me/sync with OCC completed by me and then sent back with `items` flagged (Part 1 decision 8): the occurrence is
 * correction_required, the execution is in rework with round 1 and the open request.
 */
export function reworkSync(
  c: Checklist,
  items: ReworkRequest['items'],
  o: { request?: Partial<ReworkRequest>; execution?: Partial<MyExecution> } = {},
): SyncResponse {
  return syncResponse({
    occurrences: [occurrence({ status: 'correction_required', claim: { executionId: REWORK_EXECUTION, executorUserId: ME, executorName: 'Aysel Əliyeva' } })],
    checklistVersions: [versionOf(c.content)],
    executions: [
      myExecution({
        id: REWORK_EXECUTION,
        state: 'rework',
        completedAt: T.due,
        answers: completedAnswers(c),
        answersRev: 3,
        progress: { answered: 3, total: 4, requiredMissing: 0 },
        reworkRound: 1,
        rework: reworkRequest({ items, answersBefore: completedAnswers(c), ...o.request }),
        ...o.execution,
      }),
    ],
  });
}
```

In `apps/mobile/src/features/team/testing/fixtures.ts`, replace the `@taskop/contracts` import with:

```ts
import {
  type AuditBrief,
  type AuditDetail,
  type AuditItemVerdict,
  type Correction,
  type DataScope,
  type EmployeeReportRow,
  type ExecutionCorrections,
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
  type ReworkRequest,
  RUN_COUNT_KEYS,
  type RunCounts,
} from '@taskop/contracts';
```

Part 1 Task 2 has already given `executionProblem` the field `clearedAt: null` and `executionDetail` the fields `reworkRound: 0`, `rework: null`, `corrected: false` and `audit: null`. Check with `grep -n "clearedAt\|corrected\|audit: null" apps/mobile/src/features/team/testing/fixtures.ts`; only for a field that is missing, make the matching edit below.

In `executionProblem`, replace:

```ts
  resolution: 'none',
  taskId: null,
  ...over,
});
```

with:

```ts
  resolution: 'none',
  taskId: null,
  clearedAt: null,
  ...over,
});
```

In `executionDetail`, replace:

```ts
      executionProblem({ id: PROBLEM2, itemId: c.temp.id, severity: 'normal', source: 'manual', note: 'Termometr sınıb', mediaIds: [PROBLEM_PHOTO], resolution: 'open', taskId: TASK }),
    ],
    ...over,
```

with:

```ts
      executionProblem({ id: PROBLEM2, itemId: c.temp.id, severity: 'normal', source: 'manual', note: 'Termometr sınıb', mediaIds: [PROBLEM_PHOTO], resolution: 'open', taskId: TASK }),
    ],
    reworkRound: 0,
    rework: null,
    corrected: false,
    audit: null,
    ...over,
```

Append to the end of the file:

```ts
export const AUDIT = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed0';
/** An audit another auditor started first (AUDIT_EXISTS). */
export const AUDIT2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed1';
export const CORRECTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed2';
export const CORRECTION2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed3';
export const REQUEST = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ed4';
/** The Team viewer (teamMe), as the API names her. */
export const LEYLA = { id: ME, fullName: 'Leyla Məmmədova' };

export const auditBrief = (over: Partial<AuditBrief> = {}): AuditBrief => ({ id: AUDIT, status: 'in_progress', result: null, percent: null, paused: false, ...over });

export const auditVerdict = (itemId: string, over: Partial<AuditItemVerdict> = {}): AuditItemVerdict => ({
  itemId,
  verdict: 'approved',
  comment: null,
  updatedBy: LEYLA,
  updatedAt: RUN_T.received,
  ...over,
});

export const executionCorrections = (over: Partial<ExecutionCorrections> = {}): ExecutionCorrections => ({
  original: null,
  corrections: [],
  reworkRequests: [],
  diff: [],
  ...over,
});

/** Leyla corrected ITEM from 10 to 5. */
export const correction = (over: Partial<Correction> = {}): Correction => ({
  id: CORRECTION,
  itemId: ITEM,
  kind: 'manual',
  round: 0,
  before: { number: 10 },
  after: { number: 5 },
  reason: 'Termometr səhv göstərirdi',
  actor: { kind: 'user', name: LEYLA.fullName },
  at: RUN_T.received,
  ...over,
});

/** Leyla's open send-back of round 1, due 18:00 on 3 Nov in Baku. */
export const teamRework = (over: Partial<ReworkRequest> = {}): ReworkRequest => ({
  id: REQUEST,
  round: 1,
  items: [{ itemId: ITEM, comment: 'Yenidən ölçün' }],
  answersBefore: {},
  dueAt: '2026-11-03T14:00:00.000Z',
  requestedBy: LEYLA,
  requestedAt: RUN_T.received,
  resubmittedAt: null,
  withdrawnAt: null,
  withdrawnBy: null,
  ...over,
});

/**
 * GET /audits/:id of Aynur's run (`executionDetail(c)`), in progress and nothing reviewed. The auditable items are the
 * visible ones in checklist order: the "Bəli" answer shows the follow-up comment.
 */
export function auditDetail(c: Checklist, over: Partial<AuditDetail> = {}): AuditDetail {
  return {
    id: AUDIT,
    executionId: EXECUTION,
    occurrenceId: OCC,
    status: 'in_progress',
    paused: false,
    auditor: { kind: 'user', id: ME, name: LEYLA.fullName },
    startedAt: RUN_T.received,
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
    execution: executionDetail(c),
    corrections: executionCorrections(),
    auditableItemIds: [c.problem.id, c.comment.id, c.temp.id, c.photo.id, c.note.id],
    checklistReportEmails: ['audit@demo.taskop.az'],
    requiresAudit: false,
    ...over,
  };
}
```

In `apps/mobile/src/features/team/team-format.ts`, replace:

```ts
    case 'partial':
      return 'warning';
```

with:

```ts
    case 'partial':
    case 'correction_required':
      return 'warning';
```

- [ ] **Step 8: Run the tests, then the whole mobile suite, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/testing src/features/team/team-format && pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. The existing suites are unchanged: Part 1 Task 2 kept their fixtures type-correct, and this task only added builders.

- [ ] **Step 9: Commit**

```bash
git add packages/i18n/src/az/mobile.ts packages/i18n/src/i18n.test.ts apps/mobile/src/offline/testing/fixtures.ts apps/mobile/src/features/team/testing apps/mobile/src/features/team/team-format.ts apps/mobile/src/features/team/team-format.test.ts
git commit -m "feat(mobile): audit and correction strings, rework fixtures, correction_required colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Local database version 4 and rework from /me/sync

**Files:**
- Modify: `apps/mobile/src/offline/db.ts`, `apps/mobile/src/offline/local-model.ts`, `apps/mobile/src/offline/sync-pull.ts`
- Modify: `apps/mobile/src/features/checklists/group-occurrences.test.ts` (its `LocalExecution` literal gains the two new fields)
- Create: `apps/mobile/src/offline/migration-v4.test.ts`
- Test: `apps/mobile/src/offline/sync-pull.test.ts`

**Interfaces:**
- Consumes (Part 1): `MyExecution.{reworkRound, rework}`, `type ReworkRequest`. Task 1: `reworkSync`, `reworkRequest`, `completedAnswers`, `REWORK_EXECUTION`.
- Produces:
  - `MIGRATIONS.length === 4`; `executions.rework_round INTEGER NOT NULL DEFAULT 0` and `executions.rework TEXT`.
  - `ExecutionRow.{rework_round: number; rework: string | null}`.
  - `LocalExecution.{reworkRound: number; rework: ReworkRequest | null}` (the request carries `answersBefore`).
  - `mergePull` stores both fields. On entering rework it clears `sync_note` and `finished_synced_at`. It settles rework runs the server no longer lists (Spec decision 4).

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/offline/migration-v4.test.ts`:

```ts
import { createDb, migrate, MIGRATIONS } from './db';
import { OCC, T, VERSION } from './testing/fixtures';
import { nodeDriver } from './testing/node-db';

describe('local database version 4', () => {
  it('adds the rework columns to existing executions, keeping their data', async () => {
    const db = createDb(nodeDriver());
    await migrate(db, MIGRATIONS.slice(0, 3));
    await db.run(
      `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, answers, rev, updated_at)
       VALUES ('e', ?, ?, 'completed', 'accepted', ?, '{"a":{"number":1}}', 2, ?)`,
      [OCC, VERSION, T.open, T.open],
    );
    expect(await migrate(db)).toBe(4);
    expect(MIGRATIONS).toHaveLength(4);
    expect(await db.first('SELECT id, state, rev, answers, rework_round, rework FROM executions')).toEqual({
      id: 'e', state: 'completed', rev: 2, answers: '{"a":{"number":1}}', rework_round: 0, rework: null,
    });
  });
});
```

Append to `apps/mobile/src/offline/sync-pull.test.ts`, and extend its imports:

```ts
import { type ExecutionRow, toExecution } from './local-model';
import {
  checklist,
  completedAnswers,
  myExecution,
  OCC,
  OCC2,
  occurrence,
  OTHER,
  OTHER_EXECUTION,
  REWORK_EXECUTION,
  reworkRequest,
  reworkSync,
  syncResponse,
  syncTask,
  T,
  TASK,
  TASK2,
  TEAM,
  VERSION,
  VERSION2,
  versionOf,
} from './testing/fixtures';
```

```ts
describe('rework runs (sub-project 8)', () => {
  const flagged = (c: ReturnType<typeof checklist>) => [{ itemId: c.temp.id, comment: 'Temperaturu yenidən ölçün' }];
  const stored = async (db: Awaited<ReturnType<typeof openTestDb>>) => toExecution((await db.first<ExecutionRow>('SELECT * FROM executions'))!);

  it('stores a run sent back for correction with its round and open request', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    expect(await stored(db)).toMatchObject({
      id: REWORK_EXECUTION, state: 'rework', reworkRound: 1, rework: reworkRequest({ items: flagged(c), answersBefore: completedAnswers(c) }),
      answers: completedAnswers(c), rev: 3, syncedRev: 3, completedAt: T.due,
    });
    expect(await db.first('SELECT status FROM occurrences')).toEqual({ status: 'correction_required' });
  });

  it('turns a completed copy into rework when the run is sent back, clearing its old note and finished mark', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c), { execution: { state: 'completed', reworkRound: 0, rework: null } }), 0, NOW);
    await db.run(`UPDATE executions SET finished_synced_at = ?, sync_note = 'errors.EXECUTION_NOT_ACTIVE'`, [T.due]);
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    expect(await db.first('SELECT state, rework_round, finished_synced_at, sync_note FROM executions')).toEqual({
      state: 'rework', rework_round: 1, finished_synced_at: null, sync_note: null,
    });
  });

  it('drops the request when the server lists the run as completed again', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    await applyPull(db, reworkSync(c, flagged(c), { execution: { state: 'completed', rework: null } }), 0, NOW);
    expect(await stored(db)).toMatchObject({ state: 'completed', reworkRound: 1, rework: null });
  });

  it('a rework run the server stopped listing goes back to completed when nothing of it is queued', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    await applyPull(db, syncResponse({ occurrences: [], executions: [] }), 0, NOW);
    expect(await stored(db)).toMatchObject({ state: 'completed', rework: null, answers: completedAnswers(c) });
    // The occurrence stays (it has an execution) and is no longer offered for correction.
    expect(await db.first('SELECT id, status FROM occurrences')).toEqual({ id: OCC, status: 'completed' });
  });

  it('keeps a rework run whose work is still queued, whatever the server lists', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, reworkSync(c, flagged(c)), 0, NOW);
    await appendCommand(db, { entityType: 'execution', entityId: REWORK_EXECUTION, kind: 'answers', rev: 4, payload: { rev: 4, answers: {} }, createdAt: T.open });
    await applyPull(db, syncResponse({ occurrences: [], executions: [] }), 0, NOW);
    expect(await stored(db)).toMatchObject({ state: 'rework', rework: { round: 1 } });
    expect(await db.first('SELECT status FROM occurrences')).toEqual({ status: 'correction_required' });
  });
});
```

In `apps/mobile/src/features/checklists/group-occurrences.test.ts`, replace the `execution` helper's object:

```ts
  startedAt: T.open, completedAt: null, lockedAt: null, answers: {}, rev: 0, syncedRev: 0, finishedSyncedAt: null, updatedAt: T.open, syncNote: null, ...over,
```

with:

```ts
  startedAt: T.open, completedAt: null, lockedAt: null, answers: {}, rev: 0, syncedRev: 0, finishedSyncedAt: null, updatedAt: T.open, syncNote: null,
  reworkRound: 0, rework: null, ...over,
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/migration-v4 src/offline/sync-pull`
Expected: FAIL. `migrate` returns 3 and `rework_round` is not a column; the rework tests fail on `no such column: rework_round` or a missing `reworkRound`.

- [ ] **Step 3: Add the migration and the local model fields**

In `apps/mobile/src/offline/db.ts`, append to `MIGRATIONS` (after the v3 entry, before the closing `];`):

```ts
  // v4 (sub-project 8): a run sent back for correction. `rework` is the open request as the server sent it (JSON),
  // with the round's starting answers (`answersBefore`) that Part 1's rework rule is checked against.
  `
  ALTER TABLE executions ADD COLUMN rework_round INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE executions ADD COLUMN rework TEXT;
  `,
```

In `apps/mobile/src/offline/local-model.ts`, replace the first import line with:

```ts
import type { Answers, ClaimRef, ClaimRejectionReason, ExecutionState, MediaKind, MediaSource, OccurrenceStatus, ReworkRequest, SyncTask, TaskMediaRole, TaskStatus } from '@taskop/contracts';
```

In `ExecutionRow`, replace:

```ts
  sync_note: string | null;
}

export interface LocalExecution {
```

with:

```ts
  sync_note: string | null;
  rework_round: number;
  rework: string | null;
}

export interface LocalExecution {
```

In `LocalExecution`, replace:

```ts
  /** The i18n key of why the server refused this execution's work for good ("Server qəbul etmədi: …"); null when none. */
  syncNote: string | null;
}

export const toExecution = (r: ExecutionRow): LocalExecution => ({
```

with:

```ts
  /** The i18n key of why the server refused this execution's work for good ("Server qəbul etmədi: …"); null when none. */
  syncNote: string | null;
  /** How many times the run was sent back for correction (0 = never). */
  reworkRound: number;
  /**
   * The open send-back request (spec §8.1) while the run is in rework, and after it was resubmitted here until the
   * server answers; null otherwise.
   */
  rework: ReworkRequest | null;
}

export const toExecution = (r: ExecutionRow): LocalExecution => ({
```

In `toExecution`, replace:

```ts
  syncNote: r.sync_note,
});
```

(the one ending the execution mapper) with:

```ts
  syncNote: r.sync_note,
  reworkRound: r.rework_round,
  rework: r.rework ? (JSON.parse(r.rework) as ReworkRequest) : null,
});
```

- [ ] **Step 4: Ingest rework in the pull**

In `apps/mobile/src/offline/sync-pull.ts`, replace:

```ts
  for (const x of res.executions) await mergeExecution(tx, x, now);
  for (const task of res.tasks) await mergeTask(tx, task, now);
```

with:

```ts
  for (const x of res.executions) await mergeExecution(tx, x, now);
  await settleLeftRework(tx, res.executions.map((x) => x.id), now);
  for (const task of res.tasks) await mergeTask(tx, task, now);
```

Replace the whole `mergeExecution` function with:

```ts
async function mergeExecution(tx: Db, x: MyExecution, now: number): Promise<void> {
  const claim = x.state === 'rejected' ? 'rejected' : 'accepted';
  const rework = x.rework ? JSON.stringify(x.rework) : null;
  const local = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [x.id]);
  if (!local) {
    await tx.run(
      `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, rejected_reason, started_at, completed_at, answers, rev, synced_rev,
         rework_round, rework, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [x.id, x.occurrenceId, x.checklistVersionId, x.state, claim, x.rejectedReason, normIso(x.startedAt), x.completedAt ? normIso(x.completedAt) : null,
        JSON.stringify(x.answers), x.answersRev, x.answersRev, x.reworkRound, rework, iso(now)],
    );
    return;
  }
  const queued = (await tx.first<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE entity_type = 'execution' AND entity_id = ?`, [x.id]))?.n ?? 0;
  if (queued > 0) return; // Local changes not sent yet win; the next pull sees their result.
  // The local lock at closes_at is sticky even before the server's sweep has run (decision 15).
  const state = local.state === 'partial' && x.state === 'active' ? 'partial' : x.state;
  // After a refusal was resolved (sync_note), local revisions the server never took are gone for good: the server's copy wins.
  const takeAnswers = x.answersRev > local.rev || local.sync_note !== null;
  // Spec decision 5: a run entering rework starts clean (no old refusal note, not "finished syncing").
  const entering = state === 'rework' && local.state !== 'rework';
  await tx.run(
    `UPDATE executions SET state = ?, claim = ?, rejected_reason = ?, completed_at = ?, answers = ?, rev = ?, synced_rev = ?, rework_round = ?, rework = ?,
       sync_note = ?, finished_synced_at = ?, updated_at = ?
     WHERE id = ?`,
    [state, claim, x.rejectedReason, x.completedAt ? normIso(x.completedAt) : local.completed_at,
      takeAnswers ? JSON.stringify(x.answers) : local.answers, takeAnswers ? x.answersRev : local.rev,
      takeAnswers ? x.answersRev : Math.max(local.synced_rev, x.answersRev), x.reworkRound, rework,
      entering ? null : local.sync_note, entering ? null : local.finished_synced_at, iso(now), x.id],
  );
}

/**
 * Spec decision 4: a run that left rework on the server (resubmitted from another install, or the send-back was
 * withdrawn) and that the server no longer lists. Nothing of it is queued here, so the phone stops offering it for
 * correction; a run still holding queued work is left to its commands' answers.
 */
async function settleLeftRework(tx: Db, returnedIds: string[], now: number): Promise<void> {
  const left = await tx.all<{ id: string; occurrence_id: string }>(
    `SELECT id, occurrence_id FROM executions
     WHERE rework IS NOT NULL AND id NOT IN (SELECT value FROM json_each(?))
       AND NOT EXISTS (SELECT 1 FROM outbox x WHERE x.entity_type = 'execution' AND x.entity_id = executions.id)`,
    [JSON.stringify(returnedIds)],
  );
  for (const e of left) {
    await tx.run(`UPDATE executions SET state = CASE WHEN state = 'rework' THEN 'completed' ELSE state END, rework = NULL, updated_at = ? WHERE id = ?`, [iso(now), e.id]);
    await tx.run(`UPDATE occurrences SET status = 'completed' WHERE id = ? AND status = 'correction_required'`, [e.occurrence_id]);
  }
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile test -- src/features/checklists && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. `db.test.ts` (`creates every table…`) and `migration-v3.test.ts` still pass: they compare with `MIGRATIONS.length`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/db.ts apps/mobile/src/offline/local-model.ts apps/mobile/src/offline/sync-pull.ts apps/mobile/src/offline/sync-pull.test.ts apps/mobile/src/offline/migration-v4.test.ts apps/mobile/src/features/checklists/group-occurrences.test.ts
git commit -m "feat(mobile): local database v4 keeps runs sent back for correction from /me/sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Rework is open for its executor: grouping, start block, read-only rule and the Home group

**Files:**
- Modify: `apps/mobile/src/features/checklists/group-occurrences.ts`, `apps/mobile/src/features/checklists/occurrence-card.tsx`, `apps/mobile/src/features/home/home-screen.tsx`
- Modify: `apps/mobile/src/offline/execution-store.ts` (`FINISHED_STATUSES` only), `apps/mobile/src/features/execution/use-execution.ts`
- Test: `apps/mobile/src/features/checklists/group-occurrences.test.ts`, `apps/mobile/src/features/home/home-screen.test.tsx`, `apps/mobile/src/offline/execution-store.test.ts`
- Create: `apps/mobile/src/features/execution/use-execution.test.ts`

**Interfaces:**
- Consumes: Task 2 `LocalExecution.{reworkRound, rework}`; Task 1 `reworkSync`, `reworkRequest`, `REWORK_DUE` and the strings `az.mobile.checklists.sections.rework`, `az.mobile.rework.{items, fix}`; Part 1 `az.corrections.{round, dueAt}`. Existing `formatDateTime` from `@taskop/i18n`.
- Produces:
  - `GROUP_KEYS = ['rework', 'now', 'inProgress', 'upcoming', 'done']`;
  - `interface ReworkCard { round: number; dueAt: string | null; items: number }`;
  - `CardModel.rework: ReworkCard | null`, set only on cards of the `rework` group. `CardModel.overdue` is true there once `dueAt` has passed.
  - `homeStats` counts rework cards as my tasks, and as overdue once past their due date.
  - `startBlock` treats `correction_required` as finished.
  - `readOnlyReason` returns `null` for a `rework` execution, whatever the clock.
  - Home hides the `rework` group when it is empty.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('groupOccurrences', …)` in `apps/mobile/src/features/checklists/group-occurrences.test.ts`, and extend the fixtures import to `import { ME, OCC, OTHER, OTHER_EXECUTION, REWORK_DUE, reworkRequest, T, VERSION } from '@/offline/testing/fixtures';`:

```ts
  it('puts a run sent back to me first, with its round, due date and flagged items, overdue once the due date passed', () => {
    const rework = reworkRequest({ items: [{ itemId: 'a', comment: 'x' }, { itemId: 'b', comment: 'y' }] });
    const o = view({ status: 'correction_required', localDate: '2026-10-30', execution: execution({ state: 'rework', completedAt: '2026-10-30T06:00:00.000Z', reworkRound: 1, rework }) });
    expect(place(o, T.open)).toMatchObject({ key: 'rework', card: { action: 'continue', overdue: false, claimedBy: null, rework: { round: 1, dueAt: REWORK_DUE, items: 2 } } });
    expect(place(o, REWORK_DUE)?.card.overdue).toBe(true);
    const noDue = view({ status: 'correction_required', execution: execution({ state: 'rework', reworkRound: 1, rework: reworkRequest({ dueAt: null }) }) });
    expect(place(noDue, '2026-12-01T00:00:00.000Z')?.card).toMatchObject({ overdue: false, rework: { dueAt: null } });
  });

  it('treats a run sent back to someone else as closed', () => {
    const o = view({ status: 'correction_required', claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad' } });
    expect(place(o, T.open)).toMatchObject({ key: 'done', card: { action: 'none', claimedBy: 'Murad', rework: null } });
  });

  it('keeps a run I resubmitted here among the finished ones until the server answers', () => {
    const o = view({
      status: 'correction_required', localDate: '2026-10-30', closesAt: '2026-10-30T07:00:00.000Z', unsynced: true,
      execution: execution({ state: 'completed', completedAt: '2026-10-30T06:00:00.000Z', reworkRound: 1, rework: reworkRequest() }),
    });
    expect(place(o, T.open)).toMatchObject({ key: 'done', card: { action: 'view', rework: null } });
  });

  it('counts runs to correct as my tasks, and as overdue once past their due date', () => {
    const list = [
      view({ id: 'r', status: 'correction_required', execution: execution({ id: 'er', occurrenceId: 'r', state: 'rework', reworkRound: 1, rework: reworkRequest({ dueAt: T.before }) }) }),
      view({ id: 'a' }),
    ];
    const g = groupOccurrences(list, ME, at('2026-11-02T06:30:00.000Z'), '2026-11-02');
    expect(homeStats(g, 0)).toEqual({ myTasks: 2, overdue: 2, completed: 0, issues: 0 });
  });
```

In `apps/mobile/src/offline/execution-store.test.ts`, add a row to the `startBlock` table after `['already completed', …]`:

```ts
    ['sent back for correction (only its executor holds an execution)', { ...base, status: 'correction_required' }, T.open, 'ok', 0, 'finished'],
```

`apps/mobile/src/features/execution/use-execution.test.ts`:

```ts
import type { LocalExecution, LocalOccurrence } from '@/offline/local-model';
import { ME, OCC, reworkRequest, T, VERSION } from '@/offline/testing/fixtures';
import { readOnlyReason } from './use-execution';

const occurrence: LocalOccurrence = {
  id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
  startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'correction_required', checklistVersionId: VERSION,
  claim: { executionId: 'e', executorUserId: ME, executorName: 'Aysel Əliyeva' },
};
const execution = (over: Partial<LocalExecution>): LocalExecution => ({
  id: 'e', occurrenceId: OCC, checklistVersionId: VERSION, state: 'rework', claim: 'accepted', rejectedReason: null, rejectedBy: null,
  startedAt: T.open, completedAt: T.due, lockedAt: null, answers: {}, rev: 3, syncedRev: 3, finishedSyncedAt: null, updatedAt: T.open,
  syncNote: null, reworkRound: 1, rework: reworkRequest(), ...over,
});

describe('readOnlyReason in rework (spec §8.1)', () => {
  it('lets me edit a run sent back to me, even days after its window closed', () => {
    expect(readOnlyReason(execution({}), occurrence, ME, Date.parse(T.closes) + 3 * 86_400_000)).toBeNull();
  });

  it('is completed once I resubmitted it here', () => {
    expect(readOnlyReason(execution({ state: 'completed' }), occurrence, ME, Date.parse(T.open))).toBe('completed');
  });
});
```

Append to `apps/mobile/src/features/home/home-screen.test.tsx`. Add `REWORK_DUE` and `reworkSync` to its existing `@/offline/testing/fixtures` import, `StyleSheet` to its `react-native` import, and these imports:

```ts
import { formatDateTime } from '@taskop/i18n';
import i18n from '@/lib/i18n';
import { colors } from '@/lib/theme';
```

```ts
describe('Needs correction (spec §8.1)', () => {
  const tr = i18n.t.bind(i18n);

  async function sentBack() {
    const t = await createTestServices();
    await t.seed(reworkSync(t.c, [{ itemId: t.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, { itemId: t.c.photo.id, comment: 'Şəkil bulanıqdır' }]));
    return t;
  }

  it('lists runs sent back to me above today’s runs, with the round, the flagged items and the due date in the tenant’s time', async () => {
    const t = await sentBack();
    await renderWithServices(t.services, <HomeScreen />);
    const card = within(await screen.findByTestId(`occurrence-${OCC}`));
    expect(screen.getAllByText(/^(Düzəliş tələb olunur|İndi)$/).map((n) => n.props.children)).toEqual(['Düzəliş tələb olunur', 'İndi']);
    expect(card.getByText(`${tr('corrections.round', { round: 1 })} · 2 bənd düzəliş tələb edir`)).toBeTruthy();
    const due = card.getByText(tr('corrections.dueAt', { date: formatDateTime(REWORK_DUE, { locale: 'az', timeZone: 'Asia/Baku' }) }));
    expect(StyleSheet.flatten(due.props.style).color).toBe(colors.muted);
    expect(card.queryByText('Gecikir')).toBeNull();
    await fireEvent.press(card.getByRole('button', { name: 'Düzəliş et: Açılış yoxlaması' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } });
  });

  it('turns the card red once the due date has passed', async () => {
    const t = await sentBack();
    t.clock.set(REWORK_DUE);
    await renderWithServices(t.services, <HomeScreen />);
    const card = within(await screen.findByTestId(`occurrence-${OCC}`));
    expect(card.getByText('Gecikir')).toBeTruthy();
    const due = card.getByText(tr('corrections.dueAt', { date: formatDateTime(REWORK_DUE, { locale: 'az', timeZone: 'Asia/Baku' }) }));
    expect(StyleSheet.flatten(due.props.style).color).toBe(colors.danger);
  });

  it('hides the group when nothing is sent back', async () => {
    const t = await world();
    await renderWithServices(t.services, <HomeScreen />);
    expect(await screen.findByText('İndi')).toBeTruthy();
    expect(screen.queryByText('Düzəliş tələb olunur')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/checklists src/features/home src/features/execution/use-execution src/offline/execution-store`
Expected: FAIL. The rework run lands in `done`, `rework` is undefined on cards, `startBlock` returns `null` for `correction_required`, `readOnlyReason` returns `locked`, and Home shows no "Düzəliş tələb olunur".

- [ ] **Step 3: Group the runs**

Replace `apps/mobile/src/features/checklists/group-occurrences.ts` with:

```ts
import type { OccurrenceView } from '@/offline/execution-store';
import type { LocalExecution } from '@/offline/local-model';

/** `rework` (spec §8.1, "Needs correction") sits above today's runs. */
export const GROUP_KEYS = ['rework', 'now', 'inProgress', 'upcoming', 'done'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export type CardAction = 'start' | 'continue' | 'view' | 'none';

/** A run sent back to me for correction (spec §8.1). */
export interface ReworkCard {
  round: number;
  /** The manager's due date; null when none was set. */
  dueAt: string | null;
  /** How many items were sent back. */
  items: number;
}

export interface CardModel {
  occurrence: OccurrenceView;
  /** Past due and not finished: shown in red (FR-10.02). For a run to correct: its due date has passed. */
  overdue: boolean;
  /** Finished at or after due_at. */
  late: boolean;
  /** "Murad icra edir" when someone else holds the claim. */
  claimedBy: string | null;
  action: CardAction;
  /** Set on the cards of the `rework` group only. */
  rework: ReworkCard | null;
}

export type Groups = Record<GroupKey, CardModel[]>;

/** Closed for everyone but the executor of a run sent back for correction, whose execution decides first (spec §3.1). */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'missed', 'cancelled', 'audit_pending', 'audited', 'correction_required']);
const RECENT_MS = 24 * 60 * 60 * 1000;

/** When my execution stopped being open: completed, locked at closes_at, or (refused, rejected) last changed. */
function finishedAt(e: LocalExecution): number {
  return Date.parse(e.completedAt ?? e.lockedAt ?? e.updatedAt);
}

/**
 * Spec §7.3: İndi (open; overdue in red), Davam edən (my open execution), Gələcək (not open yet), Bitmiş (finished
 * today). Bitmiş also keeps my executions that still have commands on the phone, or that finished within the last
 * 24 h whatever their date (a night shift's occurrence belongs to yesterday), so they stay reachable.
 * SP8 spec §8.1: runs sent back to me come first, whatever their date; they are not limited by closes_at.
 */
export function groupOccurrences(list: OccurrenceView[], userId: string, now: number, today: string): Groups {
  const groups: Groups = { rework: [], now: [], inProgress: [], upcoming: [], done: [] };
  for (const o of list) {
    const e = o.execution;
    const due = Date.parse(o.dueAt);
    const closes = Date.parse(o.closesAt);
    const claimedBy = o.claim && o.claim.executorUserId !== userId ? o.claim.executorName : null;
    if (e?.state === 'rework' && e.rework) {
      const dueAt = e.rework.dueAt;
      groups.rework.push({
        occurrence: o,
        overdue: dueAt !== null && now >= Date.parse(dueAt),
        late: false,
        claimedBy: null,
        action: 'continue',
        rework: { round: e.rework.round, dueAt, items: e.rework.items.length },
      });
    } else if (e?.state === 'active' && now < closes) {
      groups.inProgress.push({ occurrence: o, overdue: now >= due, late: false, claimedBy: null, action: 'continue', rework: null });
    } else if (e || CLOSED_STATUSES.has(o.status) || now >= closes) {
      const keep = o.localDate === today || (e !== null && (o.unsynced || now - finishedAt(e) < RECENT_MS));
      if (!keep) continue;
      const late = e?.completedAt ? Date.parse(e.completedAt) >= due : false;
      groups.done.push({ occurrence: o, overdue: false, late, claimedBy, action: e ? 'view' : 'none', rework: null });
    } else if (now < Date.parse(o.startsAt)) {
      groups.upcoming.push({ occurrence: o, overdue: false, late: false, claimedBy, action: 'none', rework: null });
    } else {
      groups.now.push({ occurrence: o, overdue: now >= due || o.status === 'overdue', late: false, claimedBy, action: claimedBy ? 'none' : 'start', rework: null });
    }
  }
  return groups;
}

export interface HomeStats {
  myTasks: number;
  overdue: number;
  completed: number;
  issues: number;
}

/** The home tiles, for today (decision 1). Occurrences someone else holds are not my tasks; runs to correct are (Spec decision 6). */
export function homeStats(groups: Groups, problemsToday: number): HomeStats {
  const mine = [...groups.rework, ...groups.now.filter((c) => !c.claimedBy), ...groups.inProgress];
  return {
    myTasks: mine.length,
    overdue: mine.filter((c) => c.overdue).length,
    completed: groups.done.filter((c) => (c.occurrence.execution?.state ?? c.occurrence.status) === 'completed').length,
    issues: problemsToday,
  };
}
```

- [ ] **Step 4: Draw the card and hide the empty group**

In `apps/mobile/src/features/checklists/occurrence-card.tsx`, add the import:

```ts
import { formatDateTime } from '@taskop/i18n';
```

Replace:

```tsx
      <Text style={styles.muted}>{t('mobile.checklists.window', { from: formatTime(o.startsAt, timeZone), to: formatTime(o.closesAt, timeZone) })}</Text>
```

with:

```tsx
      <Text style={styles.muted}>{t('mobile.checklists.window', { from: formatTime(o.startsAt, timeZone), to: formatTime(o.closesAt, timeZone) })}</Text>
      {card.rework ? (
        <Text style={styles.muted}>{`${t('corrections.round', { round: card.rework.round })} · ${t('mobile.rework.items', { count: card.rework.items })}`}</Text>
      ) : null}
      {card.rework?.dueAt ? (
        // Spec §8.1: the due date, red once it has passed; in the tenant's time zone (spec §9).
        <Text style={card.overdue ? styles.note : styles.muted}>{t('corrections.dueAt', { date: formatDateTime(card.rework.dueAt, { locale: 'az', timeZone }) })}</Text>
      ) : null}
```

Replace:

```tsx
      {card.action === 'continue' ? (
        <PrimaryButton title={t('mobile.checklists.continue')} accessibilityLabel={`${t('mobile.checklists.continue')}: ${o.checklistName}`} onPress={onOpen} />
      ) : null}
```

with:

```tsx
      {card.action === 'continue' ? (
        <PrimaryButton
          title={card.rework ? t('mobile.rework.fix') : t('mobile.checklists.continue')}
          accessibilityLabel={`${card.rework ? t('mobile.rework.fix') : t('mobile.checklists.continue')}: ${o.checklistName}`}
          onPress={onOpen}
        />
      ) : null}
```

In `apps/mobile/src/features/home/home-screen.tsx`, replace:

```tsx
        GROUP_KEYS.map((key) => (
          <View key={key} style={styles.group}>
            <Text style={styles.section}>{t(`mobile.checklists.sections.${key}`)}</Text>
            {groups[key].length === 0 ? (
              <Text style={styles.subtitle}>{t('mobile.checklists.emptySection')}</Text>
            ) : (
              groups[key].map((card) => (
                <OccurrenceCard
                  key={card.occurrence.id}
                  card={card}
                  group={key}
                  timeZone={services.timeZone}
                  onStart={() => void start(card.occurrence)}
                  onOpen={() => open(card.occurrence)}
                />
              ))
            )}
          </View>
        ))
```

with:

```tsx
        GROUP_KEYS.map((key) =>
          // Spec decision 6: "Düzəliş tələb olunur" only when something was sent back.
          key === 'rework' && groups.rework.length === 0 ? null : (
            <View key={key} style={styles.group}>
              <Text style={styles.section}>{t(`mobile.checklists.sections.${key}`)}</Text>
              {groups[key].length === 0 ? (
                <Text style={styles.subtitle}>{t('mobile.checklists.emptySection')}</Text>
              ) : (
                groups[key].map((card) => (
                  <OccurrenceCard
                    key={card.occurrence.id}
                    card={card}
                    group={key}
                    timeZone={services.timeZone}
                    onStart={() => void start(card.occurrence)}
                    onOpen={() => open(card.occurrence)}
                  />
                ))
              )}
            </View>
          ),
        )
```

- [ ] **Step 5: Close correction_required for new claims and open rework for its executor**

In `apps/mobile/src/offline/execution-store.ts`, replace:

```ts
const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'cancelled', 'audit_pending', 'audited']);
```

with:

```ts
/** A run sent back for correction is not open to a new claim: its executor resumes their own execution (spec §3.1). */
const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'cancelled', 'audit_pending', 'audited', 'correction_required']);
```

In `apps/mobile/src/features/execution/use-execution.ts`, replace:

```ts
  if (e.state === 'completed') return 'completed';
  if (e.state !== 'active' || now >= Date.parse(o.closesAt)) return 'locked';
  return null;
```

with:

```ts
  if (e.state === 'completed') return 'completed';
  // Spec §3.2: a run sent back for correction is not limited by closes_at. Which items may change is the store's rule.
  if (e.state === 'rework') return null;
  if (e.state !== 'active' || now >= Date.parse(o.closesAt)) return 'locked';
  return null;
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/checklists src/features/home src/features/execution src/offline/execution-store && pnpm --filter @taskop/mobile typecheck`
Expected: PASS, including the unchanged `execution-screen.test.tsx` and `finish-screen.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/checklists apps/mobile/src/features/home apps/mobile/src/offline/execution-store.ts apps/mobile/src/offline/execution-store.test.ts apps/mobile/src/features/execution/use-execution.ts apps/mobile/src/features/execution/use-execution.test.ts
git commit -m "feat(mobile): Needs-correction group on Home; correction_required is open only for its executor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Editing a run sent back for correction in the local store

**Files:**
- Modify: `apps/mobile/src/offline/execution-store.ts`, `apps/mobile/src/offline/refusals.ts`
- Create: `apps/mobile/src/offline/rework-store.test.ts`

**Interfaces:**
- Consumes (Part 1): `reworkViolations(content: ChecklistContent, before: Answers, after: Answers, flagged: ReadonlySet<string>): string[]` (allowed = flagged ∪ items not visible in `before` ∪ items not visible in `after`); `ReworkRequest.answersBefore`; `visibleItems`. Task 2 `LocalExecution.rework`; Task 1 `reworkSync`, `completedAnswers`, `REWORK_EXECUTION`, `REWORK_PHOTO`.
- Produces:
  - `class ItemNotInReworkError extends Error { readonly itemIds: string[] }`;
  - `flaggedItems(e: Pick<LocalExecution, 'rework'>): ReadonlySet<string>`;
  - `reworkEditable(content: ChecklistContent, e: Pick<LocalExecution, 'rework' | 'answers'>): ReadonlySet<string>` (flagged ∪ visible now but not visible in `answersBefore`).
  - The store's `guard` lets a `rework` run change past `closes_at`. Every change of a `rework` run is checked with `reworkViolations(content, rework.answersBefore, next, flagged)`.
  - `attachMedia` refuses any medium on an item outside `reworkEditable`.
  - `start(occurrenceId)` resumes a `rework` run instead of refusing it.
  - `dropMedium` treats a `rework` run as open: it queues a new answers revision.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/offline/rework-store.test.ts`:

```ts
import type { ReworkRequest } from '@taskop/contracts';
import { ExecutionLockedError, ItemNotInReworkError, reworkEditable } from './execution-store';
import { dropMedium } from './refusals';
import { capturedPhoto } from './testing/fake-transport';
import { type Checklist, completedAnswers, ME, OCC, REWORK_EXECUTION, REWORK_PHOTO, reworkSync } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

const outbox = (h: Harness) => h.db.all<{ kind: string; rev: number | null; payload: string }>('SELECT kind, rev, payload FROM outbox ORDER BY seq');
const kinds = async (h: Harness) => (await outbox(h)).map((c) => c.kind);
const execution = async (h: Harness) => (await h.store.execution(REWORK_EXECUTION))!;

/** OCC completed by me and sent back; Temperatur and the shelf photo flagged unless `items` says otherwise. */
async function reworking(items?: (c: Checklist) => ReworkRequest['items']): Promise<Harness> {
  const h = await createHarness();
  const flagged = items ? items(h.c) : [{ itemId: h.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, { itemId: h.c.photo.id, comment: 'Şəkil bulanıqdır' }];
  await h.seed(reworkSync(h.c, flagged));
  return h;
}
/** Only the yes/no question flagged: "Bəli" reveals the required follow-up comment and asks for a photo. */
const problemOnly = (c: Checklist) => [{ itemId: c.problem.id, comment: 'Yenidən baxın' }];

describe('editing a run sent back for correction (spec §8.1)', () => {
  it('saves a flagged item as a new answers revision, also long after the window closed', async () => {
    const h = await reworking();
    h.clock.set('2026-11-05T09:00:00.000Z');
    expect(await h.store.lockExpired()).toBe(0);
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    expect(await execution(h)).toMatchObject({ state: 'rework', rev: 4, answers: { ...completedAnswers(h.c), [h.c.temp.id]: { number: 6 } } });
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['answers', 4]]);
  });

  it('refuses a change to an item that was not sent back and queues nothing', async () => {
    const h = await reworking();
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.yes.id] })).rejects.toMatchObject({ itemIds: [h.c.problem.id] });
    await expect(h.store.setProblem(REWORK_EXECUTION, h.c.problem.id, { severity: 'normal', note: 'Qapı bağlanmır', mediaIds: [] })).rejects.toBeInstanceOf(ItemNotInReworkError);
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.note.id, { text: 'əlavə' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    expect(await kinds(h)).toEqual([]);
    expect(await execution(h)).toMatchObject({ rev: 3, answers: completedAnswers(h.c) });
  });

  it('refuses a photo or a problem photo on an item that was not sent back', async () => {
    const h = await reworking();
    await expect(h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.problem.id, field: 'evidence' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    await expect(h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.note.id, field: 'problem' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    expect(await h.store.media(REWORK_EXECUTION)).toEqual([]);
    expect(await kinds(h)).toEqual([]);
  });

  it('takes a new photo on a flagged item and lets the worker flag a problem there', async () => {
    const h = await reworking();
    const mediaId = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    expect((await execution(h)).answers[h.c.photo.id]).toEqual({ photos: [REWORK_PHOTO, mediaId] });
    await h.store.setProblem(REWORK_EXECUTION, h.c.temp.id, { severity: 'normal', note: 'Termometr köhnədir', mediaIds: [] });
    expect((await execution(h)).answers[h.c.temp.id]).toEqual({ number: 5, problem: { severity: 'normal', note: 'Termometr köhnədir', mediaIds: [] } });
    expect(await kinds(h)).toEqual(['media', 'answers']);
  });

  it('resumes the run instead of claiming it again', async () => {
    const h = await reworking();
    expect(await h.store.start(OCC, ME)).toBe(REWORK_EXECUTION);
    expect(await kinds(h)).toEqual([]);
  });

  it('a medium refused after its answers were sent is dropped under a new answers revision', async () => {
    const h = await reworking();
    const mediaId = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    // The registration and the answers were accepted; the upload then failed for good.
    await h.db.run('DELETE FROM outbox');
    await h.db.run(`UPDATE executions SET synced_rev = rev`);
    await h.db.transaction((tx) => dropMedium(tx, mediaId, h.clock.now(), 'mobile.sync.mediaErrors.UPLOAD_FAILED'));
    expect(await execution(h)).toMatchObject({ rev: 5, answers: { [h.c.photo.id]: { photos: [REWORK_PHOTO] } } });
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['answers', 5]]);
  });

  it('answers a follow-up a flagged change reveals, on every later edit', async () => {
    const h = await reworking(problemOnly);
    expect(reworkEditable(h.c.content, await execution(h))).toEqual(new Set([h.c.problem.id]));
    await expect(h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.comment.id, field: 'problem' })).rejects.toBeInstanceOf(ItemNotInReworkError);
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.yes.id] });
    expect(reworkEditable(h.c.content, await execution(h))).toEqual(new Set([h.c.problem.id, h.c.comment.id]));
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.comment.id, { text: 'Kompressor səs salır' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.comment.id, { text: 'Kompressor çox səs salır' });
    const photo = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.comment.id, field: 'problem' });
    expect(await h.store.media(REWORK_EXECUTION)).toMatchObject([{ id: photo, itemId: null }]);
    expect((await execution(h)).answers).toMatchObject({ [h.c.problem.id]: { optionIds: [h.c.yes.id] }, [h.c.comment.id]: { text: 'Kompressor çox səs salır' } });
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 })).rejects.toMatchObject({ itemIds: [h.c.temp.id] });
  });

  it('hides a revealed follow-up again without being refused, leaving its answer as it is', async () => {
    const h = await reworking(problemOnly);
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.yes.id] });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.comment.id, { text: 'Kompressor səs salır' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.problem.id, { optionIds: [h.c.no.id] });
    expect(await execution(h)).toMatchObject({ rev: 6, answers: { ...completedAnswers(h.c), [h.c.comment.id]: { text: 'Kompressor səs salır' } } });
    expect(reworkEditable(h.c.content, await execution(h))).toEqual(new Set([h.c.problem.id])); // hidden again: not on screen
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['answers', 6]]);
  });

  it('is locked once resubmitted here (state completed)', async () => {
    const h = await reworking();
    await h.db.run(`UPDATE executions SET state = 'completed'`);
    await expect(h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 })).rejects.toBeInstanceOf(ExecutionLockedError);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/offline/rework-store`
Expected: FAIL: `ItemNotInReworkError` is not exported, and the first edit throws `ExecutionLockedError('rework')`.

- [ ] **Step 3: Implement the rework guard**

In `apps/mobile/src/offline/execution-store.ts`, add `reworkViolations` to the `@taskop/contracts` import:

```ts
import {
  type Answer,
  type Answers,
  deriveProblems,
  type DeviceInfo,
  EXECUTION_LIMITS,
  type ManualProblem,
  MEDIA_LIMITS,
  type MediaKind,
  mediaLimitFor,
  type MediaSource,
  type Missing,
  type RegisterMediaCommand,
  requirements,
  reworkViolations,
  visibleItems,
} from '@taskop/contracts';
```

and add `type ChecklistContent,` to that import (between `type Answers,` and `deriveProblems,`).

After the `LiveOnlyError` class, add:

```ts
/** An edit outside the items the manager sent back (spec §8.1); the server would refuse it with ITEM_NOT_IN_REWORK. */
export class ItemNotInReworkError extends Error {
  constructor(readonly itemIds: string[]) {
    super(`Not sent back for correction: ${itemIds.join(', ')}`);
    this.name = 'ItemNotInReworkError';
  }
}

/** The items the manager sent back: those of the open request. */
export const flaggedItems = (e: Pick<LocalExecution, 'rework'>): ReadonlySet<string> => new Set(e.rework?.items.map((i) => i.itemId) ?? []);

/**
 * Spec decision 2: what a run in rework offers for editing now. The flagged items, and every item visible now that was
 * not visible in the round's starting answers (follow-ups a flagged change revealed, chains included).
 */
export function reworkEditable(content: ChecklistContent, e: Pick<LocalExecution, 'rework' | 'answers'>): ReadonlySet<string> {
  const editable = new Set(flaggedItems(e));
  const before = new Set(visibleItems(content, e.rework?.answersBefore ?? e.answers).map((v) => v.item.id));
  for (const v of visibleItems(content, e.answers)) if (!before.has(v.item.id)) editable.add(v.item.id);
  return editable;
}

```

In `guard`, replace:

```ts
    if (!row) throw new Error(`Unknown execution ${executionId}`);
    if (row.state !== 'active') return { locked: true, state: row.state };
```

with:

```ts
    if (!row) throw new Error(`Unknown execution ${executionId}`);
    // Spec §3.2: a run sent back for correction is not limited by closes_at.
    if (row.state === 'rework') return { locked: false, e: toExecution(row) };
    if (row.state !== 'active') return { locked: true, state: row.state };
```

In `change`, replace:

```ts
      if (next !== null) {
        const answers = compact(next);
        const rev = g.e.rev + 1;
```

with:

```ts
      if (next !== null) {
        const answers = compact(next);
        // The API's own rule (Part 1 `reworkViolations`), checked against the round's starting answers: throwing here
        // rolls back the whole edit, media rows included.
        if (g.e.state === 'rework') {
          const content = await usableContent(tx, g.e.checklistVersionId);
          const outside = reworkViolations(content, g.e.rework?.answersBefore ?? g.e.answers, answers, flaggedItems(g.e));
          if (outside.length > 0) throw new ItemNotInReworkError(outside);
        }
        const rev = g.e.rev + 1;
```

In `start`, replace:

```ts
      if (mine?.state === 'active') return mine.id; // a double tap resumes instead of claiming twice
```

with:

```ts
      // A double tap resumes instead of claiming twice; a run sent back to me resumes too.
      if (mine?.state === 'active' || mine?.state === 'rework') return mine.id;
```

In `attachMedia`, replace:

```ts
    await change(executionId, async (tx, e, now) => {
      const item = findItem(await usableContent(tx, e.checklistVersionId), target.itemId);
```

with:

```ts
    await change(executionId, async (tx, e, now) => {
      const content = await usableContent(tx, e.checklistVersionId);
      // A problem medium changes no answer until the problem is saved, so the answers check alone would miss it.
      if (e.state === 'rework' && !reworkEditable(content, e).has(target.itemId)) throw new ItemNotInReworkError([target.itemId]);
      const item = findItem(content, target.itemId);
```

In `apps/mobile/src/offline/refusals.ts`, inside `dropMedium`, replace:

```ts
  if ((await queuedRevisions(tx, e.id)).length === 0 && e.state !== 'active') {
```

with:

```ts
  // A run in rework is still open: the dropped medium leaves the server's answers through a new revision.
  if ((await queuedRevisions(tx, e.id)).length === 0 && e.state !== 'active' && e.state !== 'rework') {
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/offline/execution-store.ts apps/mobile/src/offline/refusals.ts apps/mobile/src/offline/rework-store.test.ts
git commit -m "feat(mobile): edit the flagged items of a run sent back, and the follow-ups they reveal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: The `resubmit` command: store action, outbox order, sync engine and refusals

**Files:**
- Modify: `apps/mobile/src/offline/outbox.ts`, `apps/mobile/src/offline/execution-store.ts`, `apps/mobile/src/offline/sync-api.ts`, `apps/mobile/src/offline/sync-engine.ts`, `apps/mobile/src/offline/refusals.ts`, `apps/mobile/src/offline/testing/fake-api.ts`
- Test: `apps/mobile/src/offline/outbox.test.ts`
- Create: `apps/mobile/src/offline/rework-sync.test.ts`

**Interfaces:**
- Consumes (Part 1): `api.executions.resubmit(executionId: string, body: ResubmitCommand): Promise<ResubmitResult>`; `ResubmitCommand = { resubmittedAt; deviceTime; clientOffsetMs }`; `ResubmitResult = { executionId; state; status; progress; score }`. Task 4 `ItemNotInReworkError`, `flaggedItems`; Task 2 `LocalExecution.rework`.
- Produces:
  - `COMMAND_KINDS` gains `'resubmit'` (payload `{ resubmittedAt }`).
  - `nextCommand` never hands out a `resubmit` while an `answers` or `media` command of the same execution is queued.
  - `store.resubmit(executionId): Promise<{ ok: true } | { ok: false; missing: Missing[] }>`. It throws `ExecutionLockedError` unless the run is in `rework`.
  - `SyncApi.executions` includes `resubmit`; `FakeApi` handles `resubmit`, and its default answers `{ state: 'completed', status: 'completed' }`.
  - The engine sends `resubmit`. On success it sets the execution's `state`, `rework = NULL`, and the occurrence's `status` from the result.
  - `markFinishedSynced` skips `rework` runs.
  - `refusals.ts`:
    - `reopenRefusedRework(tx, cmd: Pick<OutboxCommand, 'seq' | 'entityId'>, now, note?): Promise<boolean>`;
    - `dropRework(tx, executionId, now, note): Promise<string[]>`;
    - `resolveExecutionRefusal` and `discardFailedCommand` apply the refusal table in Global Constraints.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/src/offline/outbox.test.ts`:

```ts
describe('the resubmit command (sub-project 8)', () => {
  /** Hands out and acknowledges every command, in the order nextCommand gives them. */
  async function drain(db: Db): Promise<string[]> {
    const order: string[] = [];
    for (let c = await nextCommand(db); c; c = await nextCommand(db)) {
      order.push(`${c.entityId}:${c.kind}`);
      await ackCommand(db, c.seq);
    }
    return order;
  }

  it('waits for every answers revision and media registration of its run, even one queued after it', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'media', { refId: 'm1' });
    await add(db, 'e1', 'resubmit');
    await add(db, 'e1', 'answers', { rev: 5 });
    await add(db, 'e2', 'answers', { rev: 1 });
    expect(await drain(db)).toEqual(['e1:media', 'e1:answers', 'e1:resubmit', 'e2:answers']);
  });

  it('is held back while an answers revision of its run is parked, and goes once that is resolved', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'answers', { rev: 4 });
    await add(db, 'e1', 'resubmit');
    await add(db, 'e2', 'claim');
    const answers = (await nextCommand(db))!;
    await failCommand(db, answers.seq, 'ITEM_NOT_IN_REWORK', 'errors.ITEM_NOT_IN_REWORK');
    expect(await drain(db)).toEqual(['e2:claim']);
    await ackCommand(db, answers.seq); // "Sil" removed it
    expect(await nextCommand(db)).toMatchObject({ entityId: 'e1', kind: 'resubmit' });
  });
});
```

`apps/mobile/src/offline/rework-sync.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { ExecutionLockedError } from './execution-store';
import { listCommands, outboxCounts } from './outbox';
import { indicatorOf } from './sync-engine';
import { capturedPhoto } from './testing/fake-transport';
import { completedAnswers, myExecution, OCC, occurrence, REWORK_EXECUTION, REWORK_PHOTO, reworkSync, syncResponse, T } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

const methods = (h: Harness) => h.api.calls.map((c) => c.method);
const bodyOf = (h: Harness, method: string) => h.api.calls.find((c) => c.method === method)!.body as Record<string, unknown>;
const execution = async (h: Harness) => (await h.store.execution(REWORK_EXECUTION))!;
const progress = { answered: 3, total: 4, requiredMissing: 0 };
const refuse = (code: string, status = 409) => async (): Promise<never> => {
  throw new ApiError(status, code as never, `errors.${code}`);
};

/** OCC sent back with Temperatur and the shelf photo flagged; the server keeps listing it until it leaves rework. */
async function reworking(): Promise<Harness> {
  const h = await createHarness();
  const res = reworkSync(h.c, [{ itemId: h.c.temp.id, comment: 'Temperaturu yenidən ölçün' }, { itemId: h.c.photo.id, comment: 'Şəkil bulanıqdır' }]);
  await h.seed(res);
  h.api.sync = res;
  return h;
}

describe('resubmitting a run sent back for correction (spec §8.1)', () => {
  it('lists what is still missing and queues no resubmit', async () => {
    const h = await reworking();
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 10 }); // outside 2–8: the rule asks for a note
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: false, missing: [{ itemId: h.c.temp.id, kind: 'note' }] });
    expect((await listCommands(h.db)).map((c) => c.kind)).toEqual(['answers']);
    expect(await execution(h)).toMatchObject({ state: 'rework' });
  });

  it('sends the new photo and the answers before the resubmit, then takes the server’s state and status', async () => {
    const h = await reworking();
    await h.engine.run('manual');
    expect((await execution(h)).finishedSyncedAt).toBeNull(); // a run in rework is never "finished syncing"
    h.api.calls.length = 0;
    const photo = await h.store.attachMedia(REWORK_EXECUTION, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
    expect(await execution(h)).toMatchObject({ state: 'completed', completedAt: T.due, rework: { round: 1 } });
    const answers = { ...completedAnswers(h.c), [h.c.temp.id]: { number: 6 }, [h.c.photo.id]: { photos: [REWORK_PHOTO, photo] } };
    h.api.on('resubmit', async (id) => {
      h.api.sync = syncResponse({
        occurrences: [occurrence({ status: 'audit_pending' })],
        executions: [myExecution({ id, state: 'completed', completedAt: T.due, answers, answersRev: 5, reworkRound: 1, rework: null })],
      });
      return { executionId: id, state: 'completed', status: 'audit_pending', progress, score: null };
    });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['registerMedia', 'saveAnswers', 'resubmit', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(bodyOf(h, 'resubmit')).toEqual({ resubmittedAt: T.open, deviceTime: T.open, clientOffsetMs: 0 });
    expect(await execution(h)).toMatchObject({ state: 'completed', completedAt: T.due, rework: null, reworkRound: 1, answers, syncedRev: 5 });
    expect((await execution(h)).finishedSyncedAt).not.toBeNull();
    expect((await h.store.occurrence(OCC))?.status).toBe('audit_pending');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
  });

  it('queues one resubmit when two taps race', async () => {
    const h = await reworking();
    const [first, second] = await Promise.allSettled([h.store.resubmit(REWORK_EXECUTION), h.store.resubmit(REWORK_EXECUTION)]);
    expect(first).toEqual({ status: 'fulfilled', value: { ok: true } });
    expect(second).toMatchObject({ status: 'rejected', reason: expect.any(ExecutionLockedError) });
    expect((await listCommands(h.db)).filter((c) => c.kind === 'resubmit')).toHaveLength(1);
  });

  it('a resubmit refused for unmet requirements puts the run back into rework, with nothing left in the queue', async () => {
    const h = await reworking();
    h.api.on('resubmit', refuse('REQUIREMENTS_UNMET', 422));
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
    await h.engine.run('manual');
    expect(await listCommands(h.db)).toEqual([]);
    expect(indicatorOf(h.engine.status())).toBe('synced');
    expect(await execution(h)).toMatchObject({ state: 'rework', rework: { round: 1 }, finishedSyncedAt: null });
    expect(await h.store.resubmit(REWORK_EXECUTION)).toEqual({ ok: true });
  });

  it('a withdrawn send-back drops the queued rework (answers, an unregistered photo, the resubmit); the run shows completed with a note', async () => {
    const h = await reworking();
    h.net.online = false;
    const photo = capturedPhoto(h.transport);
    await h.store.attachMedia(REWORK_EXECUTION, photo, { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.patchAnswer(REWORK_EXECUTION, h.c.temp.id, { number: 6 });
    await h.store.resubmit(REWORK_EXECUTION);
    // Meanwhile the manager withdrew the send-back: rework commands are refused, and the run is completed again.
    h.api.on('registerMedia', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.on('saveAnswers', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.on('resubmit', refuse('EXECUTION_NOT_ACTIVE'));
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'completed' })],
      executions: [myExecution({ id: REWORK_EXECUTION, state: 'completed', completedAt: T.due, answers: completedAnswers(h.c), answersRev: 3, reworkRound: 1, rework: null })],
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(methods(h)).toEqual(['registerMedia', 'pull']);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await h.store.media(REWORK_EXECUTION)).toEqual([]);
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(await execution(h)).toMatchObject({ state: 'completed', rework: null, answers: completedAnswers(h.c), rev: 3, syncNote: 'errors.EXECUTION_NOT_ACTIVE' });
    expect((await h.store.occurrence(OCC))?.status).toBe('completed');
    expect(indicatorOf(h.engine.status())).toBe('synced');
  });

  it('"Sil" on a parked resubmit puts the run back into rework with the note', async () => {
    const h = await reworking();
    h.api.on('resubmit', refuse('CLOCK_INVALID', 422));
    await h.store.resubmit(REWORK_EXECUTION);
    await h.engine.run('manual');
    expect(indicatorOf(h.engine.status())).toBe('failed');
    const [parked] = await listCommands(h.db);
    expect(parked).toMatchObject({ kind: 'resubmit', status: 'failed', errorCode: 'CLOCK_INVALID' });
    await h.engine.discardCommand(parked!.seq);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await execution(h)).toMatchObject({ state: 'rework', syncNote: 'errors.CLOCK_INVALID' });
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/outbox src/offline/rework-sync`
Expected: FAIL: `'resubmit'` is not a `CommandKind` (ts-jest is not used, so the run fails on the outbox order instead: the resubmit goes before the answers), `store.resubmit` is not a function, and `h.api.on('resubmit', …)` has no handler to replace.

- [ ] **Step 3: The command kind and its place in the queue**

In `apps/mobile/src/offline/outbox.ts`, replace:

```ts
export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete', 'task.accept', 'task.start', 'task.media', 'task.submit'] as const;
```

with:

```ts
export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete', 'resubmit', 'task.accept', 'task.start', 'task.media', 'task.submit'] as const;
```

Replace the whole `nextCommand` function (with its comment) with:

```ts
/**
 * The oldest pending command, so each execution's and each task's commands go in order (a medium's registration before
 * the submission that lists it). A failed claim, task accept or task start holds back the later commands of its entity:
 * without it they could only fail. So does a parked task photo registration for the task's submission, which would name an unknown medium.
 * A resubmit (SP8) goes only once no answers revision or media registration of its run is left, whatever their order:
 * an answers revision can be re-queued after it (a refused medium), and the server checks the answers it holds.
 */
export async function nextCommand(db: Db): Promise<OutboxCommand | null> {
  const row = await db.first<OutboxRow>(
    `SELECT * FROM outbox o
     WHERE o.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM outbox c WHERE c.entity_type = o.entity_type AND c.entity_id = o.entity_id AND c.kind IN ('claim', 'task.accept', 'task.start') AND c.status = 'failed' AND c.seq < o.seq)
       AND NOT (o.kind = 'task.submit' AND EXISTS (SELECT 1 FROM outbox c WHERE c.entity_type = 'task' AND c.entity_id = o.entity_id AND c.kind = 'task.media' AND c.status = 'failed' AND c.seq < o.seq))
       AND NOT (o.kind = 'resubmit' AND EXISTS (SELECT 1 FROM outbox c WHERE c.entity_type = 'execution' AND c.entity_id = o.entity_id AND c.kind IN ('answers', 'media')))
     ORDER BY o.seq LIMIT 1`,
  );
  return row ? toCommand(row) : null;
}
```

- [ ] **Step 4: The store action**

In `apps/mobile/src/offline/execution-store.ts`, after the `complete` function, add:

```ts
  /**
   * Spec §8.1 "Yenidən təqdim et": the run turns read-only at once and `resubmit` is queued behind its answers and
   * media (`nextCommand`). Its completion times stay the first completion's (spec §3.2); the request stays until the
   * server answers (Spec decision 3).
   */
  async function resubmit(executionId: string): Promise<{ ok: true } | { ok: false; missing: Missing[] }> {
    const now = clock.now();
    type Outcome = { kind: 'locked'; state: string } | { kind: 'missing'; missing: Missing[] } | { kind: 'done' };
    const out = await db.transaction(async (tx): Promise<Outcome> => {
      const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [executionId]);
      if (!row) throw new Error(`Unknown execution ${executionId}`);
      if (row.state !== 'rework') return { kind: 'locked', state: row.state };
      const e = toExecution(row);
      const missing = requirements(await usableContent(tx, e.checklistVersionId), e.answers);
      if (missing.length) return { kind: 'missing', missing };
      await tx.run(`UPDATE executions SET state = 'completed', updated_at = ? WHERE id = ?`, [iso(now), executionId]);
      await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'resubmit', payload: { resubmittedAt: iso(now) }, createdAt: iso(now) });
      return { kind: 'done' };
    });
    changed('change');
    if (out.kind === 'locked') throw new ExecutionLockedError(out.state);
    return out.kind === 'missing' ? { ok: false, missing: out.missing } : { ok: true };
  }
```

and in the returned object, replace:

```ts
    complete,
    lockExpired,
```

with:

```ts
    complete,
    resubmit,
    lockExpired,
```

- [ ] **Step 5: The API slice and the fake server**

In `apps/mobile/src/offline/sync-api.ts`, replace:

```ts
  executions: Pick<ExecutionsApi['executions'], 'claim' | 'saveAnswers' | 'complete' | 'registerMedia'>;
```

with:

```ts
  executions: Pick<ExecutionsApi['executions'], 'claim' | 'saveAnswers' | 'complete' | 'registerMedia' | 'resubmit'>;
```

In `apps/mobile/src/offline/testing/fake-api.ts`, replace the `@taskop/contracts` import with:

```ts
import type {
  ClaimCommand,
  ClaimResult,
  CompleteCommand,
  CompleteResult,
  MediaConfirmResult,
  MediaUploadTicket,
  RegisterMediaCommand,
  ResubmitCommand,
  ResubmitResult,
  SaveAnswersCommand,
  SaveAnswersResult,
  SubmissionInput,
  SyncResponse,
  SyncTask,
  TaskActionCommand,
  TaskDetail,
  TaskMediaRegisterInput,
} from '@taskop/contracts';
```

In `ApiHandlers`, replace:

```ts
  complete(id: string, body: CompleteCommand): Promise<CompleteResult>;
```

with:

```ts
  complete(id: string, body: CompleteCommand): Promise<CompleteResult>;
  resubmit(id: string, body: ResubmitCommand): Promise<ResubmitResult>;
```

In `defaults`, replace:

```ts
      complete: async (id, b) => ({ executionId: id, state: 'completed', completedAt: b.completedAt, late: false, progress, score: null }),
```

with:

```ts
      complete: async (id, b) => ({ executionId: id, state: 'completed', completedAt: b.completedAt, late: false, progress, score: null }),
      resubmit: async (id) => ({ executionId: id, state: 'completed', status: 'completed', progress, score: null }),
```

In `api.executions`, replace:

```ts
        complete: async (id, b) => call('complete', id, b)(id, b),
```

with:

```ts
        complete: async (id, b) => call('complete', id, b)(id, b),
        resubmit: async (id, b) => call('resubmit', id, b)(id, b),
```

- [ ] **Step 6: Send it and apply its result**

In `apps/mobile/src/offline/sync-engine.ts`, add `type ResubmitCommand,` and `type ResubmitResult,` to the `@taskop/contracts` import (after `type RegisterMediaCommand,`).

Replace the `markFinishedSynced` function with:

```ts
/** An execution has finished syncing when it left `active` (and `rework`, SP8) and none of its commands is left (decision 8). */
export async function markFinishedSynced(db: Db, now: number): Promise<void> {
  await db.run(
    `UPDATE executions SET finished_synced_at = ?
     WHERE state NOT IN ('active', 'rework') AND finished_synced_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.entity_type = 'execution' AND outbox.entity_id = executions.id)`,
    [iso(now)],
  );
}
```

In `send`, replace:

```ts
      case 'complete':
        return api.executions.complete(cmd.entityId, body as CompleteCommand);
```

with:

```ts
      case 'complete':
        return api.executions.complete(cmd.entityId, body as CompleteCommand);
      case 'resubmit':
        return api.executions.resubmit(cmd.entityId, body as ResubmitCommand);
```

In `applyResult`, after the `case 'complete': { … }` block, add:

```ts
      case 'resubmit': {
        // Spec decision 3: the run leaves rework; the occurrence takes the server's status (completed or audit_pending).
        const r = result as ResubmitResult;
        await tx.run('UPDATE executions SET state = ?, rework = NULL, updated_at = ? WHERE id = ?', [r.state, iso(now), cmd.entityId]);
        await tx.run('UPDATE occurrences SET status = ? WHERE id = (SELECT occurrence_id FROM executions WHERE id = ?)', [r.status, cmd.entityId]);
        return null;
      }
```

- [ ] **Step 7: The refusals**

In `apps/mobile/src/offline/refusals.ts`, after `reopenRefusedCompletion`, add:

```ts
/** Whether this phone holds a rework copy of the run: in rework, or resubmitted here and not yet answered. */
async function holdsRework(tx: Db, executionId: string): Promise<boolean> {
  return (await tx.first('SELECT 1 AS one FROM executions WHERE id = ? AND rework IS NOT NULL', [executionId])) !== null;
}

/**
 * A resubmit refused for unmet requirements, or one the worker discards after it failed: the run is back in rework to
 * fix and resubmit again (not limited by closes_at, spec §3.2). The command goes. Returns whether it reopened.
 */
export async function reopenRefusedRework(tx: Db, cmd: Pick<OutboxCommand, 'seq' | 'entityId'>, now: number, note: string | null = null): Promise<boolean> {
  const reopened = await tx.run(
    `UPDATE executions SET state = 'rework', finished_synced_at = NULL, sync_note = coalesce(?, sync_note), updated_at = ?
     WHERE id = ? AND state = 'completed' AND rework IS NOT NULL`,
    [note, iso(now), cmd.entityId],
  );
  await tx.run('DELETE FROM outbox WHERE seq = ?', [cmd.seq]);
  return reopened > 0;
}

/**
 * Part 1 "Rework on the phone": EXECUTION_NOT_ACTIVE on a rework command means the send-back was withdrawn or the run
 * was resubmitted elsewhere. The rework copy goes: every queued command of the run, its media never registered (their
 * files are returned for deletion), and the request. The run shows completed with the note; the note makes the next
 * pull take the server's answers (`mergeExecution`).
 */
export async function dropRework(tx: Db, executionId: string, now: number, note: string): Promise<string[]> {
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'execution' AND entity_id = ?`, [executionId]);
  const unregistered = await tx.all<{ id: string; local_uri: string; file_deleted_at: string | null }>(
    `SELECT id, local_uri, file_deleted_at FROM media WHERE owner_type = 'execution' AND owner_id = ? AND registered_at IS NULL`,
    [executionId],
  );
  for (const m of unregistered) await tx.run('DELETE FROM media WHERE id = ?', [m.id]);
  await tx.run(`UPDATE executions SET state = 'completed', rework = NULL, synced_rev = rev, sync_note = ?, updated_at = ? WHERE id = ?`, [note, iso(now), executionId]);
  await tx.run(
    `UPDATE occurrences SET status = 'completed' WHERE status = 'correction_required' AND id = (SELECT occurrence_id FROM executions WHERE id = ?)`,
    [executionId],
  );
  return unregistered.filter((m) => m.file_deleted_at === null).map((m) => m.local_uri);
}
```

In `discardFailedCommand`, after the `case 'complete': { … }` block, add:

```ts
    case 'resubmit':
      await reopenRefusedRework(tx, { seq, entityId: row.entity_id }, now, note);
      return [];
```

Replace the whole `resolveExecutionRefusal` function with:

```ts
/** SP4's permanent-refusal path for an execution command: resolved when no retry can fix it, otherwise parked as failed. Returns files to delete. */
export async function resolveExecutionRefusal(tx: Db, cmd: OutboxCommand, code: string, messageKey: string, now: number): Promise<string[]> {
  if (code === 'EXECUTION_NOT_ACTIVE' && (cmd.kind === 'answers' || cmd.kind === 'media' || cmd.kind === 'resubmit') && (await holdsRework(tx, cmd.entityId))) {
    return dropRework(tx, cmd.entityId, now, messageKey);
  }
  if (cmd.kind === 'media') {
    await ackCommand(tx, cmd.seq);
    const uri = cmd.refId ? await dropMedium(tx, cmd.refId, now, messageKey) : null;
    return uri ? [uri] : [];
  }
  if (cmd.kind === 'complete' && code === 'REQUIREMENTS_UNMET' && (await reopenRefusedCompletion(tx, cmd, now))) return [];
  if (cmd.kind === 'resubmit' && code === 'REQUIREMENTS_UNMET') {
    await reopenRefusedRework(tx, cmd, now);
    return [];
  }
  const resolved = await resolveTerminalRefusal(tx, cmd, code, messageKey, now);
  if (resolved) return resolved;
  await failCommand(tx, cmd.seq, code, messageKey);
  return [];
}
```

- [ ] **Step 8: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile test -- src/features/sync && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. The sync screen shows a queued resubmit as "Yenidən təqdim · Açılış yoxlaması" through `mobile.sync.kinds.resubmit` (Task 1).

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/offline/outbox.ts apps/mobile/src/offline/outbox.test.ts apps/mobile/src/offline/execution-store.ts apps/mobile/src/offline/sync-api.ts apps/mobile/src/offline/sync-engine.ts apps/mobile/src/offline/refusals.ts apps/mobile/src/offline/testing/fake-api.ts apps/mobile/src/offline/rework-sync.test.ts
git commit -m "feat(mobile): queue and sync resubmit after a run's answers and media, with its refusals" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: The execution screen in rework mode and the Resubmit screen

**Files:**
- Create: `apps/mobile/src/features/execution/rework.ts`, `apps/mobile/src/features/execution/resubmit-screen.tsx`
- Modify: `apps/mobile/src/features/execution/execution-screen.tsx`, `apps/mobile/src/features/execution/finish-screen.tsx` (export `nextJump` only), `apps/mobile/app/(app)/execution/[id]/finish.tsx`
- Test: `apps/mobile/src/features/execution/rework.test.ts`, `apps/mobile/src/features/execution/rework-screen.test.tsx`

**Interfaces:**
- Consumes: Task 5 `store.resubmit`; Task 4 `ItemNotInReworkError`, `flaggedItems`, `reworkEditable`; Task 3 `readOnlyReason`; Task 1 strings `az.mobile.rework.*`; Part 1 `az.corrections.{reworkBanner, round, dueAt}`. Existing `useExecution`, `ItemField`, `FinishScreen`, `Screen`, `formatDateTime`, `requirements`, `visibleItems`, `isAnswered`, `walkItems`.
- Produces:
  - `rework.ts`:
    - `reworkComments(rework: ReworkRequest | null): ReadonlyMap<string, string>`;
    - `reworkOverdue(rework: Pick<ReworkRequest, 'dueAt'>, now: number): boolean`;
    - `reworkProgress(content, answers, editable: ReadonlySet<string>): { done: number; total: number }` (called with `reworkEditable`).
  - `ExecutionScreen` in rework:
    - testIDs `rework-banner` and `wrap-<itemId>` (each item's wrapper; opacity 0.5 when not editable in rework);
    - the comment line "Rəhbərin şərhi: …" on flagged items, and "Yeni sual" on follow-ups a flagged change revealed;
    - the last section's button is "Yenidən təqdim et".
  - `export const nextJump: () => string` from `finish-screen.tsx`.
  - `ResubmitScreen({ occurrenceId })` (testID `rework-item-<itemId>` per flagged item and per revealed follow-up) and `FinishOrResubmit({ occurrenceId })`, used by the finish route.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/features/execution/rework.test.ts`:

```ts
import { checklist, completedAnswers, REWORK_DUE, reworkRequest } from '@/offline/testing/fixtures';
import { reworkComments, reworkOverdue, reworkProgress } from './rework';

describe('rework helpers (spec §8.1)', () => {
  it('maps each flagged item to the manager’s comment', () => {
    const r = reworkRequest({ items: [{ itemId: 'a', comment: 'Yenidən ölçün' }, { itemId: 'b', comment: 'Şəkil bulanıqdır' }] });
    expect([...reworkComments(r)]).toEqual([['a', 'Yenidən ölçün'], ['b', 'Şəkil bulanıqdır']]);
    expect(reworkComments(null).size).toBe(0);
  });

  it('is overdue from the due date on, and never without one', () => {
    expect(reworkOverdue({ dueAt: REWORK_DUE }, Date.parse(REWORK_DUE) - 1)).toBe(false);
    expect(reworkOverdue({ dueAt: REWORK_DUE }, Date.parse(REWORK_DUE))).toBe(true);
    expect(reworkOverdue({ dueAt: null }, Date.parse('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('counts the visible editable items that are answered with nothing missing', () => {
    const c = checklist();
    // Two flagged items, plus the follow-up a "Bəli" reveals (hidden, so not counted, while the answer is "Xeyr").
    const editable = new Set([c.temp.id, c.photo.id, c.comment.id]);
    expect(reworkProgress(c.content, completedAnswers(c), editable)).toEqual({ done: 2, total: 2 });
    expect(reworkProgress(c.content, { ...completedAnswers(c), [c.temp.id]: { number: 10 } }, editable)).toEqual({ done: 1, total: 2 });
    expect(reworkProgress(c.content, { ...completedAnswers(c), [c.problem.id]: { optionIds: [c.yes.id] } }, editable)).toEqual({ done: 2, total: 3 });
  });
});
```

`apps/mobile/src/features/execution/rework-screen.test.tsx`:

```tsx
import { formatDateTime } from '@taskop/i18n';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import i18n from '@/lib/i18n';
import { ItemNotInReworkError } from '@/offline/execution-store';
import { listCommands } from '@/offline/outbox';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, OCC, REWORK_DUE, REWORK_EXECUTION, reworkSync } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { ExecutionScreen } from './execution-screen';
import { FinishOrResubmit } from './resubmit-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() } }));
jest.mock('./capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));

const tr = i18n.t.bind(i18n);
const COMMENTS = { temp: 'Temperaturu yenidən ölçün', photo: 'Şəkil bulanıqdır' };
const opacity = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).opacity;

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
});

/** OCC sent back (offline, so nothing syncs behind the test's back); Temperatur and the shelf photo flagged unless `items` says otherwise. */
async function sentBack(items?: (t: TestServices) => { itemId: string; comment: string }[]): Promise<TestServices> {
  const t = await createTestServices();
  await t.seed(reworkSync(t.c, items ? items(t) : [{ itemId: t.c.temp.id, comment: COMMENTS.temp }, { itemId: t.c.photo.id, comment: COMMENTS.photo }]));
  return t;
}
const answersOf = async (t: TestServices) => (await t.services.store.execution(REWORK_EXECUTION))!.answers;

describe('the execution screen in rework mode (spec §8.1)', () => {
  it('shows the round and the due date, the manager’s comment on each flagged item, and dims and locks the others', async () => {
    const t = await sentBack();
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    const banner = within(await screen.findByTestId('rework-banner'));
    expect(banner.getByText(`${tr('corrections.reworkBanner')} · ${tr('corrections.round', { round: 1 })}`)).toBeTruthy();
    expect(banner.getByText(tr('corrections.dueAt', { date: formatDateTime(REWORK_DUE, { locale: 'az', timeZone: 'Asia/Baku' }) }))).toBeTruthy();
    expect(screen.getByText(`Rəhbərin şərhi: ${COMMENTS.temp}`)).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.editable).toBe(true);
    expect(screen.getByRole('button', { name: 'Problem qeyd et: Temperatur' }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByRole('radio', { name: 'Xeyr' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: 'Problem qeyd et: Soyuducuda problem varmı?' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(opacity(`wrap-${t.c.problem.id}`)).toBe(0.5);
    expect(opacity(`wrap-${t.c.temp.id}`)).toBeUndefined();
    expect(screen.getByText('2/2 qaytarılan bənd hazırdır')).toBeTruthy();
  });

  it('saves a flagged item, follows the progress, and ends on "Yenidən təqdim et"', async () => {
    const t = await sentBack();
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    const input = await screen.findByLabelText('Temperatur');
    await fireEvent.changeText(input, '10');
    await fireEvent(input, 'blur');
    await eventually(async () => expect((await answersOf(t))[t.c.temp.id]).toEqual({ number: 10 }));
    expect(await screen.findByText('1/2 qaytarılan bənd hazırdır')).toBeTruthy(); // 10 °C now asks for a note
    await fireEvent.press(screen.getByRole('button', { name: 'Növbəti bölmə' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yenidən təqdim et' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]/finish', params: { id: OCC } });
  });

  it('shows a follow-up a flagged change reveals as a new question the worker can answer', async () => {
    const t = await sentBack((s) => [{ itemId: s.c.problem.id, comment: 'Yenidən baxın' }]);
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Bəli' }));
    const followUp = await screen.findByTestId(`wrap-${t.c.comment.id}`);
    expect(within(followUp).getByText('Yeni sual')).toBeTruthy();
    expect(within(followUp).queryByText(/^Rəhbərin şərhi/)).toBeNull();
    expect(screen.getByLabelText('Problemi təsvir edin').props.editable).toBe(true);
    expect(opacity(`wrap-${t.c.comment.id}`)).toBeUndefined();
    expect(screen.getByText('0/2 qaytarılan bənd hazırdır')).toBeTruthy(); // the photo "Bəli" asks for, and the new question
  });

  it('says so when the store refuses an item that was not sent back', async () => {
    const t = await sentBack();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(t.services.store, 'patchAnswer').mockRejectedValueOnce(new ItemNotInReworkError([t.c.temp.id]));
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    const input = await screen.findByLabelText('Temperatur');
    await fireEvent.changeText(input, '6');
    await fireEvent(input, 'blur');
    await eventually(async () => expect(alert).toHaveBeenCalledWith('Bu bənd düzəlişə qaytarılmayıb, onu dəyişmək olmaz.'));
    alert.mockRestore();
  });

  it('is read-only once resubmitted here', async () => {
    const t = await sentBack();
    await t.services.store.resubmit(REWORK_EXECUTION);
    await renderWithServices(t.services, <ExecutionScreen occurrenceId={OCC} />);
    expect(await screen.findByText('Düzəlişlər göndərilib. Cavablar artıq dəyişdirilə bilməz.')).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.editable).toBe(false);
    expect(screen.queryByTestId('rework-banner')).toBeNull();
  });
});

describe('the Resubmit screen (spec §8.1)', () => {
  it('lists the flagged items with what is missing, keeps resubmitting off until they are fixed, and jumps to an item', async () => {
    const t = await sentBack();
    await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.temp.id, { number: 10 });
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    const temp = within(await screen.findByTestId(`rework-item-${t.c.temp.id}`));
    expect(temp.getByText(`Rəhbərin şərhi: ${COMMENTS.temp}`)).toBeTruthy();
    expect(temp.getByText('Qeyd lazımdır')).toBeTruthy();
    expect(within(screen.getByTestId(`rework-item-${t.c.photo.id}`)).getByText('Hazırdır')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId(`rework-item-${t.c.temp.id}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: expect.objectContaining({ id: OCC, itemId: t.c.temp.id }) });
    await act(async () => {
      await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.temp.id, { note: 'İsti idi' });
    });
    await eventually(async () => expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({ disabled: false }));
  });

  it('resubmits once, says so and goes home; the screen is then read-only', async () => {
    const t = await sentBack();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    const button = await screen.findByRole('button', { name: 'Yenidən təqdim et' });
    await fireEvent.press(button);
    await fireEvent.press(button);
    await eventually(async () => expect(await t.services.store.execution(REWORK_EXECUTION)).toMatchObject({ state: 'completed' }));
    expect(alert).toHaveBeenCalledWith('Düzəlişlər göndərildi.');
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect((await listCommands(t.db)).filter((c) => c.kind === 'resubmit')).toHaveLength(1);
    expect(await screen.findByText('Düzəlişlər göndərilib. Cavablar artıq dəyişdirilə bilməz.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({ disabled: true });
    alert.mockRestore();
  });

  it('answers a required follow-up that a flagged change reveals, and resubmits', async () => {
    const t = await sentBack((s) => [{ itemId: s.c.problem.id, comment: 'Yenidən baxın' }]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.problem.id, { optionIds: [t.c.yes.id] });
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    const followUp = () => within(screen.getByTestId(`rework-item-${t.c.comment.id}`));
    await screen.findByTestId(`rework-item-${t.c.comment.id}`);
    expect(followUp().getByText('Yeni sual')).toBeTruthy();
    expect(followUp().getByText('Cavab verilməyib')).toBeTruthy();
    expect(within(screen.getByTestId(`rework-item-${t.c.problem.id}`)).getByText('Foto lazımdır')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      await t.services.store.patchAnswer(REWORK_EXECUTION, t.c.comment.id, { text: 'Kompressor səs salır' });
      await t.services.store.attachMedia(REWORK_EXECUTION, capturedPhoto(t.transport), { itemId: t.c.problem.id, field: 'evidence' });
    });
    await eventually(async () => expect(followUp().getByText('Hazırdır')).toBeTruthy());
    await eventually(async () => expect(screen.getByRole('button', { name: 'Yenidən təqdim et' }).props.accessibilityState).toMatchObject({ disabled: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən təqdim et' }));
    await eventually(async () => expect(await t.services.store.execution(REWORK_EXECUTION)).toMatchObject({ state: 'completed' }));
    expect(alert).toHaveBeenCalledWith('Düzəlişlər göndərildi.');
    expect((await listCommands(t.db)).filter((c) => c.kind === 'resubmit')).toHaveLength(1);
    alert.mockRestore();
  });

  it('shows the normal finish screen for a run that was never sent back', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    await renderWithServices(t.services, <FinishOrResubmit occurrenceId={OCC} />);
    expect(await screen.findByRole('button', { name: 'Tamamla' })).toBeTruthy();
    expect(screen.queryByText('Qaytarılan bəndlər')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution/rework`
Expected: FAIL with `Cannot find module './rework'` and `Cannot find module './resubmit-screen'`.

- [ ] **Step 3: Write the helpers**

`apps/mobile/src/features/execution/rework.ts`:

```ts
import { type Answers, type ChecklistContent, isAnswered, requirements, type ReworkRequest, visibleItems } from '@taskop/contracts';

/** The manager's comment per flagged item (spec §8.1). */
export function reworkComments(rework: ReworkRequest | null): ReadonlyMap<string, string> {
  return new Map((rework?.items ?? []).map((i) => [i.itemId, i.comment]));
}

/** Whether a round's due date has passed: it turns red, and nothing else happens (spec §3.2). */
export function reworkOverdue(rework: Pick<ReworkRequest, 'dueAt'>, now: number): boolean {
  return rework.dueAt !== null && now >= Date.parse(rework.dueAt);
}

/** Spec decision 7: the visible editable items (flagged and revealed), and how many of them are answered with nothing missing. */
export function reworkProgress(content: ChecklistContent, answers: Answers, editable: ReadonlySet<string>): { done: number; total: number } {
  const missing = new Set(requirements(content, answers).map((m) => m.itemId));
  const shown = visibleItems(content, answers).filter((v) => editable.has(v.item.id));
  return { total: shown.length, done: shown.filter((v) => isAnswered(v.item, answers[v.item.id]) && !missing.has(v.item.id)).length };
}
```

- [ ] **Step 4: Rework mode on the execution screen**

In `apps/mobile/src/features/execution/execution-screen.tsx`:

Add the imports:

```ts
import { formatDateTime } from '@taskop/i18n';
```

and replace:

```ts
import { type CapturedMedia, ExecutionLockedError, LiveOnlyError, MediaLimitError, type MediaTarget } from '@/offline/execution-store';
```

with:

```ts
import {
  type CapturedMedia,
  ExecutionLockedError,
  flaggedItems,
  ItemNotInReworkError,
  LiveOnlyError,
  MediaLimitError,
  type MediaTarget,
  reworkEditable,
} from '@/offline/execution-store';
```

and after `import { type ProblemDraft, ProblemSheet } from './problem-sheet';` add:

```ts
import { reworkComments, reworkOverdue, reworkProgress } from './rework';
```

Replace:

```ts
  const { store, userId } = useOffline();
```

with:

```ts
  const { store, userId, timeZone } = useOffline();
```

Replace:

```ts
  const lock = readOnlyReason(execution, occurrence, userId, now);
  const readOnly = lock !== null;
```

with:

```ts
  const lock = readOnlyReason(execution, occurrence, userId, now);
  const readOnly = lock !== null;
  // Spec §8.1 and decision 2: a run sent back for correction. The flagged items and the follow-ups their changes revealed
  // can change; the others are dimmed and locked.
  const rework = execution.state === 'rework' ? execution.rework : null;
  const flagged = flaggedItems(execution);
  const editableItems = rework ? reworkEditable(content, execution) : null;
  const comments = reworkComments(rework);
  const fixed = editableItems ? reworkProgress(content, current, editableItems) : null;
  const bar = fixed ?? { done: prog.answered, total: prog.total };
```

Replace:

```ts
        : lock === 'completed'
          ? t('mobile.execution.completedBanner')
```

with:

```ts
        : lock === 'completed'
          ? t(execution.rework ? 'mobile.rework.sentBanner' : 'mobile.execution.completedBanner')
```

Replace:

```ts
    if (e instanceof ExecutionLockedError) return; // the banner already says why
```

with:

```ts
    if (e instanceof ExecutionLockedError) return; // the banner already says why
    if (e instanceof ItemNotInReworkError) return void Alert.alert(t('mobile.rework.notFlagged'));
```

Replace:

```tsx
      <View style={styles.progressWrap}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${prog.total ? Math.round((prog.answered / prog.total) * 100) : 0}%` }]} />
        </View>
        <Text style={styles.muted}>{t('mobile.execution.progress', { answered: prog.answered, total: prog.total })}</Text>
      </View>
```

with:

```tsx
      <View style={styles.progressWrap}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${bar.total ? Math.round((bar.done / bar.total) * 100) : 0}%` }]} />
        </View>
        <Text style={styles.muted}>
          {fixed ? t('mobile.rework.progress', { done: fixed.done, total: fixed.total }) : t('mobile.execution.progress', { answered: prog.answered, total: prog.total })}
        </Text>
      </View>
      {rework ? (
        <View testID="rework-banner" style={styles.reworkBanner}>
          <Text style={styles.reworkTitle}>{`${t('corrections.reworkBanner')} · ${t('corrections.round', { round: rework.round })}`}</Text>
          {rework.dueAt ? (
            <Text style={reworkOverdue(rework, now) ? styles.noteText : styles.bannerText}>
              {t('corrections.dueAt', { date: formatDateTime(rework.dueAt, { locale: 'az', timeZone }) })}
            </Text>
          ) : null}
        </View>
      ) : null}
```

Replace the item list:

```tsx
            {visible
              .filter((v) => v.sectionId === section.id)
              .map(({ item, depth }) => (
                <View
                  key={item.id}
                  style={{ marginLeft: depth * spacing.md }}
                  onLayout={(e) => {
```

with:

```tsx
            {visible
              .filter((v) => v.sectionId === section.id)
              .map(({ item, depth }) => {
                const editable = editableItems === null || editableItems.has(item.id);
                const comment = comments.get(item.id);
                const revealed = editableItems !== null && editable && !flagged.has(item.id);
                return (
                <View
                  key={item.id}
                  testID={`wrap-${item.id}`}
                  style={[{ marginLeft: depth * spacing.md }, editable ? null : styles.dimmed]}
                  onLayout={(e) => {
```

then, inside the same element, replace:

```tsx
                  <ItemField
                    item={item}
                    answer={current[item.id]}
                    missing={missing.filter((m) => m.itemId === item.id)}
                    hasProblem={problemItems.has(item.id)}
                    refused={refusedOn(item.id)}
                    readOnly={readOnly}
```

with:

```tsx
                  {comment ? <Text style={styles.comment}>{t('mobile.rework.managerComment', { comment })}</Text> : null}
                  {revealed ? <Text style={styles.comment}>{t('mobile.rework.newQuestion')}</Text> : null}
                  <ItemField
                    item={item}
                    answer={current[item.id]}
                    missing={missing.filter((m) => m.itemId === item.id)}
                    hasProblem={problemItems.has(item.id)}
                    refused={refusedOn(item.id)}
                    readOnly={readOnly || !editable}
```

and close the new block body: replace

```tsx
                  />
                </View>
              ))}
          </>
```

with:

```tsx
                  />
                </View>
                );
              })}
          </>
```

Replace:

```tsx
            <PrimaryButton title={t('mobile.execution.finish')} onPress={() => router.push({ pathname: '/execution/[id]/finish', params: { id: occurrenceId } })} />
```

with:

```tsx
            <PrimaryButton
              title={rework ? t('mobile.rework.resubmit') : t('mobile.execution.finish')}
              onPress={() => router.push({ pathname: '/execution/[id]/finish', params: { id: occurrenceId } })}
            />
```

Add to `styles`:

```ts
  reworkBanner: { marginHorizontal: spacing.md, marginBottom: spacing.sm, borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7', gap: spacing.xs },
  reworkTitle: { color: '#92400E', fontWeight: '700' },
  comment: { color: '#92400E', fontWeight: '600', marginBottom: spacing.xs },
  dimmed: { opacity: 0.5 },
```

- [ ] **Step 5: The Resubmit screen and the finish route**

In `apps/mobile/src/features/execution/finish-screen.tsx`, replace:

```ts
const nextJump = () => `${Date.now()}-${++jumps}`;
```

with:

```ts
export const nextJump = () => `${Date.now()}-${++jumps}`;
```

`apps/mobile/src/features/execution/resubmit-screen.tsx`:

```tsx
import { type Missing, requirements, visibleItems, walkItems } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { ExecutionLockedError, flaggedItems, reworkEditable } from '@/offline/execution-store';
import { useNow } from '@/offline/hooks';
import { FinishScreen, nextJump } from './finish-screen';
import { reworkOverdue } from './rework';
import { readOnlyReason, useExecution } from './use-execution';

/**
 * Spec §8.1: the end of a rework round instead of the finish screen. It lists the flagged items with the manager's
 * comment, then the follow-ups their changes revealed ("Yeni sual", Spec decision 2), each with what still blocks
 * resubmitting (tap to jump), and queues `resubmit`.
 */
export function ResubmitScreen({ occurrenceId }: { occurrenceId: string }) {
  const { t } = useTranslation();
  const { store, userId, timeZone } = useOffline();
  const data = useExecution(occurrenceId);
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // What the store refused resubmitting for, in case it disagrees with the list computed here.
  const [refused, setRefused] = useState<Missing[]>([]);
  const answers = data?.execution.answers;
  useEffect(() => setRefused([]), [answers]);

  if (data === undefined) return <ActivityIndicator color={colors.primary} />;
  if (data === null || !data.execution.rework) return <Text style={styles.muted}>{t('mobile.execution.notFound')}</Text>;
  if (data.content.kind !== 'ok') return <Text style={styles.title}>{t('mobile.execution.needsUpdate')}</Text>;

  const { execution, occurrence } = data;
  const rework = data.execution.rework;
  const content = data.content.content;
  const flagged = flaggedItems(execution);
  const editable = reworkEditable(content, execution);
  const rows = [
    ...rework.items.map((i) => ({ itemId: i.itemId, comment: i.comment as string | null })),
    ...visibleItems(content, execution.answers)
      .filter((v) => editable.has(v.item.id) && !flagged.has(v.item.id))
      .map((v) => ({ itemId: v.item.id, comment: null })),
  ];
  const listed = new Set(rows.map((r) => r.itemId));
  const computed = requirements(content, execution.answers);
  const missing = computed.length ? computed : refused;
  const labels = new Map<string, string>();
  walkItems(content, (item) => labels.set(item.id, item.label));
  const open = execution.state === 'rework' && readOnlyReason(execution, occurrence, userId, now) === null;
  const jump = (itemId: string) => router.push({ pathname: '/execution/[id]', params: { id: occurrenceId, itemId, focus: nextJump() } });

  const resubmit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await store.resubmit(execution.id);
      if (result.ok) {
        Alert.alert(t('mobile.rework.resubmitted'));
        router.replace('/');
      } else setRefused(result.missing);
    } catch (e) {
      // A second tap that lost the race, or a run that left rework meanwhile: the screen already shows its state.
      if (!(e instanceof ExecutionLockedError)) Alert.alert(t('errors.INTERNAL', { requestId: '—' }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.push({ pathname: '/execution/[id]', params: { id: occurrenceId } })}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>{t('mobile.rework.title')}</Text>
          <Text style={styles.muted}>{occurrence.checklistName}</Text>
        </View>
      </View>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>{`${t('corrections.reworkBanner')} · ${t('corrections.round', { round: rework.round })}`}</Text>
        {rework.dueAt ? (
          <Text style={reworkOverdue(rework, now) ? styles.missing : styles.bannerText}>
            {t('corrections.dueAt', { date: formatDateTime(rework.dueAt, { locale: 'az', timeZone }) })}
          </Text>
        ) : null}
      </View>
      {execution.state !== 'rework' ? <Text style={styles.sent}>{t('mobile.rework.sentBanner')}</Text> : null}
      <Text style={styles.section}>{t('mobile.rework.flaggedTitle')}</Text>
      {rows.map(({ itemId, comment }) => {
        const itemMissing = missing.filter((m) => m.itemId === itemId);
        return (
          <Pressable
            key={itemId}
            testID={`rework-item-${itemId}`}
            accessibilityRole="button"
            accessibilityLabel={labels.get(itemId) ?? ''}
            onPress={() => jump(itemId)}
            style={[styles.row, itemMissing.length > 0 ? styles.rowMissing : null]}
          >
            <Text style={styles.rowLabel}>{labels.get(itemId) ?? ''}</Text>
            <Text style={styles.muted}>{comment !== null ? t('mobile.rework.managerComment', { comment }) : t('mobile.rework.newQuestion')}</Text>
            {itemMissing.length > 0 ? (
              itemMissing.map((m) => (
                <Text key={m.kind} style={styles.missing}>
                  {t(`mobile.finish.missingKinds.${m.kind}`)}
                </Text>
              ))
            ) : (
              <Text style={styles.ready}>{t('mobile.rework.ready')}</Text>
            )}
          </Pressable>
        );
      })}
      {/* Anything else the store reports missing (it cannot change, but the button must not be off without a reason). */}
      {missing
        .filter((m) => !listed.has(m.itemId))
        .map((m) => (
          <Pressable
            key={`${m.itemId}-${m.kind}`}
            accessibilityRole="button"
            accessibilityLabel={`${labels.get(m.itemId) ?? ''}: ${t(`mobile.finish.missingKinds.${m.kind}`)}`}
            onPress={() => jump(m.itemId)}
            style={[styles.row, styles.rowMissing]}
          >
            <Text style={styles.rowLabel}>{`${labels.get(m.itemId) ?? ''}: ${t(`mobile.finish.missingKinds.${m.kind}`)}`}</Text>
          </Pressable>
        ))}
      <PrimaryButton title={t('mobile.rework.resubmit')} disabled={busy || !open || missing.length > 0} onPress={() => void resubmit()} />
    </Screen>
  );
}

/** The finish route (Spec decision 8): a run sent back for correction ends on the Resubmit screen, any other on the finish screen. */
export function FinishOrResubmit({ occurrenceId }: { occurrenceId: string }) {
  const data = useExecution(occurrenceId);
  if (data === undefined) return <ActivityIndicator color={colors.primary} />;
  return data?.execution.rework ? <ResubmitScreen occurrenceId={occurrenceId} /> : <FinishScreen occurrenceId={occurrenceId} />;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  section: { fontSize: 16, fontWeight: '600', color: colors.text },
  banner: { borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7', gap: spacing.xs },
  bannerTitle: { color: '#92400E', fontWeight: '700' },
  bannerText: { color: '#92400E' },
  sent: { color: colors.text, fontWeight: '600' },
  row: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  rowMissing: { borderColor: colors.warning },
  rowLabel: { color: colors.text, fontWeight: '500' },
  missing: { color: colors.danger },
  ready: { color: colors.success, fontWeight: '600' },
});
```

Replace `apps/mobile/app/(app)/execution/[id]/finish.tsx` with:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { FinishOrResubmit } from '@/features/execution/resubmit-screen';

/** `id` is the OCCURRENCE id; the screen resolves the occurrence's current execution itself. A run sent back ends on the Resubmit screen. */
export default function FinishRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FinishOrResubmit key={id} occurrenceId={id} />;
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS, with `execution-screen.test.tsx` and `finish-screen.test.tsx` unchanged and green.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/execution apps/mobile/app/\(app\)/execution/\[id\]/finish.tsx
git commit -m "feat(mobile): rework mode on the execution screen and the Resubmit screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Team run actions: the rule, the audit and corrections queries, and one command at a time

**Files:**
- Create: `apps/mobile/src/features/team/run-actions.ts`, `apps/mobile/src/features/team/testing/with-command.tsx`
- Modify: `apps/mobile/src/features/team/queries.ts`
- Test: `apps/mobile/src/features/team/run-actions.test.ts`, `apps/mobile/src/features/team/run-queries.test.tsx`

**Interfaces:**
- Consumes (Part 1):
  - `canStartAudit(run, hasOpenAudit)`, `canCorrect(run)`, `canSendBack(run)`, `canWithdrawSendBack(run)` over `RunState = { status, executionState }`;
  - `type AuditBrief`, the permission keys `audits.perform` and `executions.correct`;
  - `api.audits.get(id): Promise<AuditDetail>`, `api.corrections.history(executionId): Promise<ExecutionCorrections>`.

  Existing: `teamKeys`, `TEAM_STALE_MS`, `api` from `@/lib/session`. Task 1 fixtures.
- Produces:
  - `run-actions.ts`:
    - `interface RunActions { audit: 'start' | 'open' | null; correct: boolean; sendBack: boolean; withdraw: boolean }`;
    - `NO_ACTIONS: RunActions`;
    - `runActions(permissions: Me['permissions'], status: OccurrenceStatus, executionState: ExecutionState | null, audit: AuditBrief | null): RunActions`.
  - `queries.ts`:
    - `teamKeys.audit(viewerId, auditId)` = `['team', viewerId, 'run', 'audit', auditId]`;
    - `teamKeys.corrections(viewerId, executionId)` = `['team', viewerId, 'run', 'corrections', executionId]`;
    - `useTeamAudit(viewerId, auditId: string, enabled: boolean)`;
    - `useTeamCorrections(viewerId, executionId: string | null, enabled: boolean)` (asks only with an execution id);
    - `type CommandResult<T> = { ok: true; value: T } | { ok: false; error: unknown }`;
    - `interface RunCommand { run<T>(job: () => Promise<T>, o?: { refresh?: boolean }): Promise<CommandResult<T> | null>; busy: boolean; error: unknown; clearError(): void }`;
    - `useRunCommand(viewerId: string): RunCommand`. `run` returns `null` when another action is in flight. A success invalidates `teamKeys.all(viewerId)` unless `refresh: false`.
  - `testing/with-command.tsx`: `WithCommand({ viewerId, children: (command: RunCommand) => ReactElement })` for the mode tests (Tasks 8–10).

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/features/team/run-actions.test.ts`:

```ts
import type { AuditBrief, ExecutionState, OccurrenceStatus, PermissionKey } from '@taskop/contracts';
import { NO_ACTIONS, type RunActions, runActions } from './run-actions';
import { auditBrief } from './testing/fixtures';

const BOTH: PermissionKey[] = ['reports.view', 'audits.perform', 'executions.correct'];
const AUDITOR: PermissionKey[] = ['reports.view', 'audits.perform'];
const MANAGER: PermissionKey[] = ['reports.view', 'executions.correct'];

describe('runActions (spec §8.2, Part 1 "What the UI may offer")', () => {
  it.each<[string, PermissionKey[], OccurrenceStatus, ExecutionState | null, AuditBrief | null, RunActions]>([
    ['a completed run, both keys', BOTH, 'completed', 'completed', null, { audit: 'start', correct: true, sendBack: true, withdraw: false }],
    ['a run waiting in the audit queue', AUDITOR, 'audit_pending', 'completed', null, { ...NO_ACTIONS, audit: 'start' }],
    ['a run whose audit is in progress', BOTH, 'audit_pending', 'completed', auditBrief(), { audit: 'open', correct: true, sendBack: true, withdraw: false }],
    ['a run whose audit was cancelled', AUDITOR, 'completed', 'completed', auditBrief({ status: 'cancelled' }), { ...NO_ACTIONS, audit: 'start' }],
    ['an audited run is locked: its audit only opens', BOTH, 'audited', 'completed', auditBrief({ status: 'finished', result: 'passed', percent: 100 }), { ...NO_ACTIONS, audit: 'open' }],
    ['a run sent back: withdraw, and the paused audit opens', BOTH, 'correction_required', 'rework', auditBrief({ paused: true }), { ...NO_ACTIONS, audit: 'open', withdraw: true }],
    ['a run sent back, manager only', MANAGER, 'correction_required', 'rework', null, { ...NO_ACTIONS, withdraw: true }],
    ['a partial run', BOTH, 'partial', 'partial', null, NO_ACTIONS],
    ['a run still being done', BOTH, 'in_progress', 'active', null, NO_ACTIONS],
    ['a run nobody executed', BOTH, 'missed', null, null, NO_ACTIONS],
    ['a viewer with neither key', ['reports.view'], 'completed', 'completed', null, NO_ACTIONS],
    ['an auditor cannot correct', AUDITOR, 'completed', 'completed', null, { ...NO_ACTIONS, audit: 'start' }],
    ['a manager cannot audit', MANAGER, 'completed', 'completed', null, { ...NO_ACTIONS, correct: true, sendBack: true }],
  ])('%s', (_name, permissions, status, state, audit, expected) => {
    expect(runActions(permissions, status, state, audit)).toEqual(expected);
  });
});
```

`apps/mobile/src/features/team/run-queries.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { checklist, ME } from '@/offline/testing/fixtures';
import { teamKeys, useRunCommand, useTeamAudit, useTeamCorrections } from './queries';
import { AUDIT, auditDetail, EXECUTION, executionCorrections, VIEWER2 } from './testing/fixtures';
import { gate, testQueryClient } from './testing/render';

const mockAudit = jest.fn();
const mockHistory = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    audits: { get: (...a: unknown[]) => mockAudit(...a) },
    corrections: { history: (...a: unknown[]) => mockHistory(...a) },
  },
  session: { refreshMe: jest.fn() },
}));

async function hook<R>(fn: () => R, client: QueryClient = testQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...(await renderHook(fn, { wrapper })), client };
}

beforeEach(() => jest.clearAllMocks());

describe('run commands (Global Constraints: one at a time, then refresh)', () => {
  it('runs one action at a time: a second tap while the first is in flight does nothing', async () => {
    const { result } = await hook(() => useRunCommand(ME));
    const g = gate();
    const job = jest.fn(async () => {
      await g.opened;
      return 'done';
    });
    let first: Promise<unknown> = Promise.resolve();
    let second: unknown = 'not run';
    await act(async () => {
      first = result.current.run(job);
      second = await result.current.run(job);
    });
    expect(second).toBeNull();
    expect(result.current.busy).toBe(true);
    await act(async () => {
      g.open();
      expect(await first).toEqual({ ok: true, value: 'done' });
    });
    expect(job).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it('refreshes every team query of the viewer after a success, and keeps a failure to show', async () => {
    const client = testQueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const { result } = await hook(() => useRunCommand(ME), client);
    await act(async () => {
      await result.current.run(async () => 1);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['team', ME] });
    invalidate.mockClear();
    const error = new ApiError(409, 'EXECUTION_LOCKED', 'errors.EXECUTION_LOCKED');
    let failed: unknown;
    await act(async () => {
      failed = await result.current.run(async () => {
        throw error;
      });
    });
    expect(failed).toEqual({ ok: false, error });
    expect(result.current.error).toBe(error);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.run(async () => 2, { refresh: false });
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});

describe('audit and corrections queries', () => {
  it('loads an audit and a run’s corrections under the viewer’s keys', async () => {
    const c = checklist();
    mockAudit.mockResolvedValue(auditDetail(c));
    mockHistory.mockResolvedValue(executionCorrections());
    const { result, client } = await hook(() => ({ audit: useTeamAudit(ME, AUDIT, true), history: useTeamCorrections(ME, EXECUTION, true) }));
    await waitFor(() => expect(result.current.audit.data?.id).toBe(AUDIT));
    await waitFor(() => expect(result.current.history.data).toEqual(executionCorrections()));
    expect(mockAudit).toHaveBeenCalledWith(AUDIT);
    expect(mockHistory).toHaveBeenCalledWith(EXECUTION);
    expect(client.getQueryData(teamKeys.audit(ME, AUDIT))).toBeTruthy();
    expect(client.getQueryData(teamKeys.audit(VIEWER2, AUDIT))).toBeUndefined();
  });

  it('asks for nothing while disabled or without an execution', async () => {
    await hook(() => ({ audit: useTeamAudit(ME, AUDIT, false), history: useTeamCorrections(ME, null, true) }));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/run-actions src/features/team/run-queries`
Expected: FAIL with `Cannot find module './run-actions'`, and `useRunCommand` is not exported.

- [ ] **Step 3: The rule**

`apps/mobile/src/features/team/run-actions.ts`:

```ts
import { type AuditBrief, canCorrect, canSendBack, canStartAudit, canWithdrawSendBack, type ExecutionState, type Me, type OccurrenceStatus } from '@taskop/contracts';

/** What the Team tab's run screen offers (spec §8.2). */
export interface RunActions {
  /** 'start' a new audit, 'open' the run's audit (in progress, paused or finished), or nothing. */
  audit: 'start' | 'open' | null;
  correct: boolean;
  sendBack: boolean;
  withdraw: boolean;
}

export const NO_ACTIONS: RunActions = { audit: null, correct: false, sendBack: false, withdraw: false };

/**
 * Each action needs its permission and the audit-logic rule the API applies (Part 1 "What the UI may offer"). A run
 * without a counted execution offers nothing. An audit that was cancelled counts as none.
 */
export function runActions(permissions: Me['permissions'], status: OccurrenceStatus, executionState: ExecutionState | null, audit: AuditBrief | null): RunActions {
  if (executionState === null) return NO_ACTIONS;
  const run = { status, executionState };
  const auditor = permissions.includes('audits.perform');
  const corrector = permissions.includes('executions.correct');
  const hasOpenAudit = audit !== null && audit.status !== 'cancelled';
  return {
    audit: !auditor ? null : hasOpenAudit ? 'open' : canStartAudit(run, false) ? 'start' : null,
    correct: corrector && canCorrect(run),
    sendBack: corrector && canSendBack(run),
    withdraw: corrector && canWithdrawSendBack(run),
  };
}
```

- [ ] **Step 4: The queries and the command hook**

In `apps/mobile/src/features/team/queries.ts`, replace the first four lines (imports) with:

```ts
import { ApiError } from '@taskop/api-client';
import type { LocalDate, ReportFiltersQuery, RunBucket } from '@taskop/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, session } from '@/lib/session';
```

In `teamKeys`, replace:

```ts
  execution: (viewerId: string, id: string) => ['team', viewerId, 'run', 'execution', id] as const,
};
```

with:

```ts
  execution: (viewerId: string, id: string) => ['team', viewerId, 'run', 'execution', id] as const,
  audit: (viewerId: string, id: string) => ['team', viewerId, 'run', 'audit', id] as const,
  corrections: (viewerId: string, executionId: string) => ['team', viewerId, 'run', 'corrections', executionId] as const,
};
```

After `useTeamExecution`, add:

```ts
/** GET /audits/:id (SP8): the audit with its verdicts and the run as it is now. */
export const useTeamAudit = (viewerId: string, auditId: string, enabled: boolean) =>
  useQuery({ queryKey: teamKeys.audit(viewerId, auditId), queryFn: () => api.audits.get(auditId), enabled, ...common });

/** GET /executions/:id/corrections (SP8): the corrections timeline, only for a run that has an execution. */
export const useTeamCorrections = (viewerId: string, executionId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: teamKeys.corrections(viewerId, executionId ?? ''),
    queryFn: () => api.corrections.history(executionId!),
    enabled: enabled && executionId !== null,
    ...common,
  });

export type CommandResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface RunCommand {
  /** Null when another action of this screen is still in flight (a second tap does nothing). */
  run<T>(job: () => Promise<T>, o?: { refresh?: boolean }): Promise<CommandResult<T> | null>;
  busy: boolean;
  /** The last failure, for the screen to show; cleared by the next action. */
  error: unknown;
  clearError(): void;
}

/**
 * The Team run screen's server actions (audit, verdict, correction, send-back, withdraw): one at a time. A success
 * refreshes every team query of the viewer (the run's status, its execution and audit, the list's buckets) unless
 * `refresh: false` (a verdict updates the cached audit itself).
 */
export function useRunCommand(viewerId: string): RunCommand {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async <T>(job: () => Promise<T>, o: { refresh?: boolean } = {}): Promise<CommandResult<T> | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const value = await job();
        if (o.refresh !== false) await client.invalidateQueries({ queryKey: teamKeys.all(viewerId) });
        return { ok: true, value };
      } catch (e) {
        setError(e);
        return { ok: false, error: e };
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client, viewerId],
  );
  const clearError = useCallback(() => setError(null), []);
  return { run, busy, error, clearError };
}
```

`apps/mobile/src/features/team/testing/with-command.tsx`:

```tsx
import type { ReactElement } from 'react';
import { type RunCommand, useRunCommand } from '../queries';

/** Renders a run-screen mode with a real `useRunCommand`, as the run screen does (Tasks 8–10). */
export function WithCommand({ viewerId, children }: { viewerId: string; children: (command: RunCommand) => ReactElement }) {
  const command = useRunCommand(viewerId);
  return children(command);
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. The existing team tests are untouched: they never call the new hooks.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/team/run-actions.ts apps/mobile/src/features/team/run-actions.test.ts apps/mobile/src/features/team/queries.ts apps/mobile/src/features/team/run-queries.test.tsx apps/mobile/src/features/team/testing/with-command.tsx
git commit -m "feat(mobile): Team run actions rule, audit and corrections queries, one command at a time" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Send back from the Team tab

**Files:**
- Create: `apps/mobile/src/features/team/send-back-mode.tsx`
- Test: `apps/mobile/src/features/team/send-back-mode.test.tsx`

**Interfaces:**
- Consumes (Part 1): `sendBackInputSchema`, `AUDIT_LIMITS.reason`, `api.corrections.sendBack(executionId, body: SendBackInput): Promise<ReworkRequest>`, `ApiError.fields.dueAt` (`corrections.issues.dueInPast`), `az.corrections.{fields.itemComment, actions.sendBack}`. Task 7 `RunCommand`, `WithCommand`. Existing `Choice`, `Field`, `FormError`, `mobileErrorText`, `toAnswerDatetime`, `visibleItems`.
- Produces: `SendBackMode({ detail: ExecutionDetail; online: boolean; command: RunCommand; onDone(): void; onCancel(): void })`, with testIDs `send-back-<itemId>`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/send-back-mode.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@/lib/i18n';
import { toAnswerDatetime } from '@/features/execution/datetime-format';
import { checklist, ME } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { SendBackMode } from './send-back-mode';
import { EXECUTION, executionDetail, teamRework } from './testing/fixtures';
import { gate, renderTeam } from './testing/render';
import { WithCommand } from './testing/with-command';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockSendBack = jest.fn();
jest.mock('@/lib/session', () => ({ api: { corrections: { sendBack: (...a: unknown[]) => mockSendBack(...a) } }, session: { refreshMe: jest.fn() } }));

const tr = i18n.t.bind(i18n);
const c = checklist();
const onDone = jest.fn();
const onCancel = jest.fn();
const sendButton = () => screen.getByRole('button', { name: tr('corrections.actions.sendBack') });

async function open(online = true) {
  const t = await createTestServices({ online });
  return renderTeam(
    t.services,
    <WithCommand viewerId={ME}>{(command) => <SendBackMode detail={executionDetail(c)} online={online} command={command} onDone={onDone} onCancel={onCancel} />}</WithCommand>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendBack.mockResolvedValue(teamRework());
});

describe('Send back (spec §8.2)', () => {
  it('sends the picked items with their comments and the due date', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    expect(screen.getByRole('checkbox', { name: 'Problemi təsvir edin' })).toBeTruthy(); // a visible follow-up can be sent back too
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), '  Yenidən ölçün ');
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD), istəyə görə'), '2026-11-03 18:00');
    await fireEvent.press(sendButton());
    await eventually(async () =>
      expect(mockSendBack).toHaveBeenCalledWith(EXECUTION, {
        items: [{ itemId: c.temp.id, comment: 'Yenidən ölçün' }],
        dueAt: toAnswerDatetime('datetime', '2026-11-03 18:00'),
      }),
    );
    expect(alert).toHaveBeenCalledWith('İcra icraçıya qaytarıldı.');
    expect(onDone).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('asks for at least one item, a comment for each, and a valid date', async () => {
    await open();
    await fireEvent.press(sendButton());
    expect(await screen.findByText('Ən azı bir bənd seçin.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.press(sendButton());
    expect(await screen.findByText('Hər seçilmiş bənd üçün şərh yazın.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD), istəyə görə'), 'sabah');
    await fireEvent.press(sendButton());
    expect(await screen.findByText('Format düzgün deyil.')).toBeTruthy();
    expect(mockSendBack).not.toHaveBeenCalled();
  });

  it('shows the server’s due-date refusal under the field', async () => {
    mockSendBack.mockRejectedValue(new ApiError(422, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { dueAt: 'corrections.issues.dueInPast' }));
    await open();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD), istəyə görə'), '2020-01-01 10:00');
    await fireEvent.press(sendButton());
    expect(await screen.findByText(tr('corrections.issues.dueInPast'))).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a second tap while sending sends once', async () => {
    const g = gate();
    mockSendBack.mockImplementation(async () => {
      await g.opened;
      return teamRework();
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    await fireEvent.changeText(screen.getByLabelText(`${tr('corrections.fields.itemComment')}: Temperatur`), 'Yenidən ölçün');
    await fireEvent.press(sendButton());
    await fireEvent.press(sendButton());
    g.open();
    await eventually(async () => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockSendBack).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('offline the send button is off and the hint shows, and the picks stay', async () => {
    await open(false);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Temperatur' }));
    expect(screen.getByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(sendButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('checkbox', { name: 'Temperatur' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('button', { name: tr('common.cancel') }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/send-back-mode`
Expected: FAIL with `Cannot find module './send-back-mode'`.

- [ ] **Step 3: Write the mode**

`apps/mobile/src/features/team/send-back-mode.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { AUDIT_LIMITS, type ExecutionDetail, sendBackInputSchema, visibleItems } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { toAnswerDatetime } from '@/features/execution/datetime-format';
import { Choice } from '@/features/execution/parts';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import type { RunCommand } from './queries';

interface Props {
  detail: ExecutionDetail;
  online: boolean;
  command: RunCommand;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Spec §8.2 "Send back": pick the items to fix, a comment for each, an optional due date (typed in the phone's time
 * as on the task form, Spec decision 12), then send. The picks stay while offline; only sending needs the connection.
 */
export function SendBackMode({ detail, online, command, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  /** Picked items and their comments. */
  const [comments, setComments] = useState<ReadonlyMap<string, string>>(new Map());
  const [due, setDue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const items = visibleItems(detail.content, detail.answers);

  const toggle = (itemId: string) =>
    setComments((m) => {
      const next = new Map(m);
      if (next.has(itemId)) next.delete(itemId);
      else next.set(itemId, '');
      return next;
    });

  const send = async () => {
    setProblem(null);
    setDueError(null);
    const picked = items.filter((v) => comments.has(v.item.id)).map((v) => ({ itemId: v.item.id, comment: (comments.get(v.item.id) ?? '').trim() }));
    if (picked.length === 0) return setProblem(t('mobile.team.sendBack.noItems'));
    if (picked.some((i) => i.comment === '')) return setProblem(t('mobile.team.sendBack.commentRequired'));
    const dueAt = due.trim() ? toAnswerDatetime('datetime', due) : null;
    if (due.trim() && !dueAt) return setDueError(t('mobile.execution.invalidDate'));
    const body = sendBackInputSchema.safeParse({ items: picked, dueAt });
    if (!body.success) return setProblem(t('errors.VALIDATION_FAILED'));
    const r = await command.run(() => api.corrections.sendBack(detail.id, body.data));
    if (!r) return;
    if (r.ok) {
      Alert.alert(t('mobile.team.sendBack.sent'));
      onDone();
      return;
    }
    if (r.error instanceof ApiError && r.error.fields?.dueAt) setDueError(t(r.error.fields.dueAt));
    else setProblem(mobileErrorText(t, r.error));
  };

  return (
    <View style={styles.block}>
      <Text style={styles.title}>{t('mobile.team.sendBack.title')}</Text>
      <Text style={styles.muted}>{t('mobile.team.sendBack.pick')}</Text>
      {items.map(({ item, depth }) => {
        const picked = comments.has(item.id);
        return (
          <View key={item.id} testID={`send-back-${item.id}`} style={[styles.card, { marginLeft: depth * spacing.md }]}>
            <Choice role="checkbox" label={item.label} selected={picked} onPress={() => toggle(item.id)} />
            {picked ? (
              <TextInput
                accessibilityLabel={`${t('corrections.fields.itemComment')}: ${item.label}`}
                value={comments.get(item.id)}
                onChangeText={(text) => setComments((m) => new Map(m).set(item.id, text))}
                multiline
                maxLength={AUDIT_LIMITS.reason}
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            ) : null}
          </View>
        );
      })}
      <Field label={t('mobile.team.sendBack.due')} value={due} onChangeText={setDue} error={dueError} autoCapitalize="none" />
      <FormError message={problem} />
      {!online ? <Text style={styles.offline}>{t('mobile.team.offline')}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onCancel} />
        <PrimaryButton title={t('corrections.actions.sendBack')} disabled={!online || command.busy} onPress={() => void send()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  offline: { color: colors.muted, fontSize: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  input: { minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/send-back-mode && pnpm --filter @taskop/mobile typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/team/send-back-mode.tsx apps/mobile/src/features/team/send-back-mode.test.tsx
git commit -m "feat(mobile): send a run back from the Team tab with per-item comments and a due date" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Correct answers from the Team tab

**Files:**
- Modify: `apps/mobile/src/features/execution/item-field.tsx` (export `AnswerInput` and `needsNote`; no behaviour change)
- Create: `apps/mobile/src/features/team/correct-mode.tsx`
- Test: `apps/mobile/src/features/team/correct-mode.test.tsx`

**Interfaces:**
- Consumes (Part 1):
  - `changedItemIds(before, after)`, `type CorrectAnswersInput`, `AUDIT_LIMITS.reason`;
  - `api.corrections.correct(executionId, body: CorrectAnswersInput): Promise<CorrectionResult>`;
  - the errors `ANSWERS_CONFLICT` and `REQUIREMENTS_UNMET` (`ApiError.missing`);
  - `az.corrections.{fields.reason, actions.correct}`.

  Task 7 `RunCommand`, `WithCommand`. Existing `requirements`, `visibleItems`, `CommitInput`, `EXECUTION_LIMITS.answerNote`.
- Produces:
  - `item-field.tsx`: `type AnswerInputProps = Pick<ItemFieldProps, 'item' | 'answer' | 'readOnly' | 'onPatch'>`, `AnswerInput(p: AnswerInputProps)`, `needsNote(item: Item, answer: Answer | undefined): boolean`.
  - `correct-mode.tsx`:
    - `correctionAnswer(a: Answer | undefined): CorrectionAnswer | null`, where `CorrectionAnswer = NonNullable<CorrectAnswersInput['changes'][number]['answer']>`;
    - `CorrectMode({ detail: ExecutionDetail; online: boolean; command: RunCommand; reload(): Promise<ExecutionDetail | undefined>; onDone(): void; onCancel(): void })`, with testIDs `correct-<itemId>` and `reason-sheet`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/correct-mode.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import type { ExecutionDetail } from '@taskop/contracts';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@/lib/i18n';
import { checklist, ME } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { CorrectMode, correctionAnswer } from './correct-mode';
import { EXECUTION, executionDetail, PHOTO, PROBLEM_PHOTO } from './testing/fixtures';
import { renderTeam, TeamProviders } from './testing/render';
import { WithCommand } from './testing/with-command';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
const mockCorrect = jest.fn();
jest.mock('@/lib/session', () => ({ api: { corrections: { correct: (...a: unknown[]) => mockCorrect(...a) } }, session: { refreshMe: jest.fn() } }));

const tr = i18n.t.bind(i18n);
const c = checklist();
const MANUAL = { severity: 'normal' as const, note: 'Termometr sınıb', mediaIds: [] };
/** Aynur's run, complete: "Bəli" with its photo and comment, 10 °C with a note and a manual problem, the shelf photo. */
const run = (over: Partial<ExecutionDetail> = {}) =>
  executionDetail(c, {
    answers: {
      [c.problem.id]: { optionIds: [c.yes.id], photos: [PHOTO] },
      [c.comment.id]: { text: 'Kompressor səs salır' },
      [c.temp.id]: { number: 10, note: 'Kondisioner xarabdır', problem: MANUAL },
      [c.photo.id]: { photos: [PROBLEM_PHOTO] },
    },
    ...over,
  });
const onDone = jest.fn();
const onCancel = jest.fn();
const reload = jest.fn<Promise<ExecutionDetail | undefined>, []>();
const result = { executionId: EXECUTION, answersRev: 4, changedItemIds: [c.temp.id], score: null };

const ui = (online: boolean) => (
  <WithCommand viewerId={ME}>
    {(command) => <CorrectMode detail={run()} online={online} command={command} reload={reload} onDone={onDone} onCancel={onCancel} />}
  </WithCommand>
);
async function open() {
  const t = await createTestServices({ online: true });
  return { t, view: await renderTeam(t.services, ui(true)) };
}
async function setTemperature(value: string) {
  const input = screen.getByLabelText('Temperatur');
  await fireEvent.changeText(input, value);
  await fireEvent(input, 'blur');
}
const next = () => fireEvent.press(screen.getByRole('button', { name: 'Davam et' }));
const sheet = () => within(screen.getByTestId('reason-sheet'));
async function save(reason: string) {
  await fireEvent.changeText(sheet().getByLabelText(tr('corrections.fields.reason')), reason);
  await fireEvent.press(sheet().getByRole('button', { name: tr('corrections.actions.correct') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCorrect.mockResolvedValue(result);
});

describe('correctionAnswer (Spec decision 11)', () => {
  it('keeps the values and the note, never the manual problem, and is null when nothing is left', () => {
    expect(correctionAnswer({ number: 5, note: 'İsti', problem: MANUAL })).toEqual({ number: 5, note: 'İsti' });
    expect(correctionAnswer({ optionIds: [c.no.id], photos: [PHOTO], text: '  ' })).toEqual({ optionIds: [c.no.id], photos: [PHOTO] });
    expect(correctionAnswer({ problem: MANUAL })).toBeNull();
    expect(correctionAnswer(undefined)).toBeNull();
  });
});

describe('Correct answers (spec §8.2)', () => {
  it('sends only the changed values with the reason and the revision it was based on', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    expect(screen.getByText('Foto və videolar dəyişdirilmir. Sübut səhvdirsə, icranı icraçıya qaytarın.')).toBeTruthy();
    await setTemperature('5');
    await next();
    await save('  Termometr səhv göstərirdi ');
    await eventually(async () =>
      expect(mockCorrect).toHaveBeenCalledWith(EXECUTION, {
        answersRev: 3,
        changes: [{ itemId: c.temp.id, answer: { number: 5, note: 'Kondisioner xarabdır' } }],
        reason: 'Termometr səhv göstərirdi',
      }),
    );
    expect(alert).toHaveBeenCalledWith('Düzəliş yadda saxlanıldı.');
    expect(onDone).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('says when nothing changed, and lists what a change leaves missing before asking for a reason', async () => {
    await open();
    await next();
    expect(await screen.findByText('Heç bir cavab dəyişməyib.')).toBeTruthy();
    const note = screen.getByLabelText('Qeyd: Temperatur');
    await fireEvent.changeText(note, '');
    await fireEvent(note, 'blur');
    await next();
    expect(await screen.findByText(tr('errors.REQUIREMENTS_UNMET'))).toBeTruthy();
    expect(within(screen.getByTestId(`correct-${c.temp.id}`)).getByText('Qeyd lazımdır')).toBeTruthy();
    expect(screen.queryByTestId('reason-sheet')).toBeNull();
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it('asks for a reason', async () => {
    await open();
    await setTemperature('5');
    await next();
    await save('   ');
    expect(await sheet().findByText('Səbəb yazın.')).toBeTruthy();
    expect(mockCorrect).not.toHaveBeenCalled();
  });

  it('after ANSWERS_CONFLICT it reloads and sends the next correction with the new revision', async () => {
    mockCorrect.mockRejectedValueOnce(new ApiError(409, 'ANSWERS_CONFLICT', 'errors.ANSWERS_CONFLICT')).mockResolvedValue(result);
    reload.mockResolvedValue(run({ answersRev: 4, answers: { ...run().answers, [c.temp.id]: { number: 7, note: 'Kondisioner xarabdır', problem: MANUAL } } }));
    await open();
    await setTemperature('5');
    await next();
    await save('Səhv idi');
    expect(await screen.findByText(tr('errors.ANSWERS_CONFLICT'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Davam et' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən yüklə' }));
    await eventually(async () => expect(screen.getByLabelText('Temperatur').props.value).toBe('7'));
    await setTemperature('6');
    await next();
    await save('Yenidən yoxlandı');
    await eventually(async () =>
      expect(mockCorrect).toHaveBeenLastCalledWith(EXECUTION, {
        answersRev: 4,
        changes: [{ itemId: c.temp.id, answer: { number: 6, note: 'Kondisioner xarabdır' } }],
        reason: 'Yenidən yoxlandı',
      }),
    );
    expect(mockCorrect).toHaveBeenCalledTimes(2);
  });

  it('highlights what the server says a correction leaves missing', async () => {
    mockCorrect.mockRejectedValue(Object.assign(new ApiError(422, 'REQUIREMENTS_UNMET', 'errors.REQUIREMENTS_UNMET'), { missing: [{ itemId: c.photo.id, kind: 'mediaCount' }] }));
    await open();
    await setTemperature('5');
    await next();
    await save('Səhv idi');
    expect(await within(screen.getByTestId(`correct-${c.photo.id}`)).findByText('Kifayət qədər fayl yoxdur')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('keeps the draft and turns saving off while offline', async () => {
    const { t, view } = await open();
    await setTemperature('5');
    await view.rerender(<TeamProviders services={t.services} client={view.client}>{ui(false)}</TeamProviders>);
    expect(screen.getByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.value).toBe('5');
    await next();
    await fireEvent.changeText(sheet().getByLabelText(tr('corrections.fields.reason')), 'Termometr səhv göstərirdi');
    expect(sheet().getByRole('button', { name: tr('corrections.actions.correct') }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockCorrect).not.toHaveBeenCalled();
    await view.rerender(<TeamProviders services={t.services} client={view.client}>{ui(true)}</TeamProviders>);
    await fireEvent.press(sheet().getByRole('button', { name: tr('corrections.actions.correct') }));
    await eventually(async () =>
      expect(mockCorrect).toHaveBeenCalledWith(EXECUTION, expect.objectContaining({ changes: [{ itemId: c.temp.id, answer: { number: 5, note: 'Kondisioner xarabdır' } }] })),
    );
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/correct-mode`
Expected: FAIL with `Cannot find module './correct-mode'`.

- [ ] **Step 3: Share the worker's value editors**

In `apps/mobile/src/features/execution/item-field.tsx`, replace:

```ts
function AnswerInput(p: ItemFieldProps) {
```

with:

```ts
/** The value editors alone (no evidence, note or ⚑): the worker's field and the manager's correction (SP8) share them. */
export type AnswerInputProps = Pick<ItemFieldProps, 'item' | 'answer' | 'readOnly' | 'onPatch'>;

export function AnswerInput(p: AnswerInputProps) {
```

Replace:

```ts
/** One item: its input, evidence, the note its rule asks for, what is still missing, and the ⚑ problem flag. */
export function ItemField(p: ItemFieldProps) {
  const { t } = useTranslation();
  const { item, answer } = p;
  const needsNote = (hasRules(item) && item.rules.some((r) => r.then.requireNote && ruleMatches(r, item, answer))) || Boolean(answer?.note);
```

with:

```ts
/** Whether an item shows its note field: a matching rule asks for a note, or one was written. */
export const needsNote = (item: Item, answer: Answer | undefined): boolean =>
  (hasRules(item) && item.rules.some((r) => r.then.requireNote && ruleMatches(r, item, answer))) || Boolean(answer?.note);

/** One item: its input, evidence, the note its rule asks for, what is still missing, and the ⚑ problem flag. */
export function ItemField(p: ItemFieldProps) {
  const { t } = useTranslation();
  const { item, answer } = p;
  const showNote = needsNote(item, answer);
```

and replace:

```tsx
      {needsNote ? (
```

with:

```tsx
      {showNote ? (
```

Run: `pnpm --filter @taskop/mobile test -- src/features/execution`
Expected: PASS (no behaviour change).

- [ ] **Step 4: Write the mode**

`apps/mobile/src/features/team/correct-mode.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import {
  type Answer,
  type Answers,
  AUDIT_LIMITS,
  changedItemIds,
  type CorrectAnswersInput,
  EXECUTION_LIMITS,
  type ExecutionDetail,
  type Missing,
  requirements,
  visibleItems,
} from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { CommitInput } from '@/components/commit-input';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { AnswerInput, needsNote } from '@/features/execution/item-field';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import type { RunCommand } from './queries';

type CorrectionAnswer = NonNullable<CorrectAnswersInput['changes'][number]['answer']>;

/**
 * Spec decision 11: what a correction sends for an item. The values and the note as the draft holds them; the manual
 * problem never (Part 1 decision 2 copies it over); photos and videos as they were. Null when nothing is left.
 */
export function correctionAnswer(a: Answer | undefined): CorrectionAnswer | null {
  if (!a) return null;
  const out: CorrectionAnswer = {};
  if (a.optionIds?.length) out.optionIds = a.optionIds;
  if (typeof a.number === 'number') out.number = a.number;
  if (a.text?.trim()) out.text = a.text;
  if (a.datetime) out.datetime = a.datetime;
  if (a.photos?.length) out.photos = a.photos;
  if (a.videos?.length) out.videos = a.videos;
  if (a.note?.trim()) out.note = a.note;
  return Object.keys(out).length > 0 ? out : null;
}

interface Props {
  detail: ExecutionDetail;
  online: boolean;
  command: RunCommand;
  /** Loads the run again after ANSWERS_CONFLICT; resolves with the fresh copy. */
  reload: () => Promise<ExecutionDetail | undefined>;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Spec §8.2 "Correct": the worker's value editors on a draft of the answers, then a reason, then one request with the
 * revision the draft was based on (spec §9). The draft lives here, so it survives the connection dropping.
 */
export function CorrectMode({ detail, online, command, reload, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const [base, setBase] = useState<{ answers: Answers; rev: number }>({ answers: detail.answers, rev: detail.answersRev });
  const [draft, setDraft] = useState<Answers>(detail.answers);
  const [missing, setMissing] = useState<Missing[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const content = detail.content;
  const visible = visibleItems(content, draft);
  const changed = changedItemIds(base.answers, draft);

  const patch = (itemId: string, p: Partial<Answer>) => {
    setMissing([]);
    setProblem(null);
    setDraft((d) => ({ ...d, [itemId]: { ...d[itemId], ...p } }));
  };

  const next = () => {
    setProblem(null);
    if (changed.length === 0) return setProblem(t('mobile.team.correct.noChanges'));
    const m = requirements(content, draft);
    setMissing(m);
    if (m.length > 0) return setProblem(t('errors.REQUIREMENTS_UNMET'));
    setReasonError(null);
    setAsking(true);
  };

  const save = async () => {
    if (!reason.trim()) return setReasonError(t('mobile.team.correct.reasonRequired'));
    const body: CorrectAnswersInput = {
      answersRev: base.rev,
      changes: changed.map((itemId) => ({ itemId, answer: correctionAnswer(draft[itemId]) })),
      reason: reason.trim(),
    };
    const r = await command.run(() => api.corrections.correct(detail.id, body));
    if (!r) return;
    setAsking(false);
    if (r.ok) {
      Alert.alert(t('mobile.team.correct.saved'));
      onDone();
      return;
    }
    if (r.error instanceof ApiError && r.error.code === 'ANSWERS_CONFLICT') setConflict(true);
    if (r.error instanceof ApiError && r.error.code === 'REQUIREMENTS_UNMET' && r.error.missing) setMissing(r.error.missing);
    setProblem(mobileErrorText(t, r.error));
  };

  /** Spec §9: someone else changed the run first. The draft restarts from the server's answers and revision. */
  const reloadNow = async () => {
    const fresh = await reload();
    if (!fresh) return;
    setBase({ answers: fresh.answers, rev: fresh.answersRev });
    setDraft(fresh.answers);
    setConflict(false);
    setProblem(null);
    setMissing([]);
  };

  return (
    <View style={styles.block}>
      <Text style={styles.title}>{t('mobile.team.correct.title')}</Text>
      <Text style={styles.muted}>{t('mobile.team.correct.mediaHint')}</Text>
      {content.sections.map((section) => {
        const rows = visible.filter((v) => v.sectionId === section.id);
        if (rows.length === 0) return null;
        return (
          <View key={section.id} style={styles.block}>
            <Text style={styles.section}>{section.title}</Text>
            {rows.map(({ item, depth }) => {
              const itemMissing = missing.filter((m) => m.itemId === item.id);
              return (
                <View
                  key={item.id}
                  testID={`correct-${item.id}`}
                  style={[styles.card, { marginLeft: depth * spacing.md }, itemMissing.length > 0 ? styles.cardMissing : null, changed.includes(item.id) ? styles.cardChanged : null]}
                >
                  <Text style={styles.label}>{item.label}</Text>
                  <AnswerInput item={item} answer={draft[item.id]} readOnly={false} onPatch={(p) => patch(item.id, p)} />
                  {needsNote(item, draft[item.id]) ? (
                    <CommitInput
                      accessibilityLabel={`${t('mobile.execution.note')}: ${item.label}`}
                      value={draft[item.id]?.note ?? ''}
                      multiline
                      maxLength={EXECUTION_LIMITS.answerNote}
                      onCommit={(note) => patch(item.id, { note: note.trim() ? note : undefined })}
                    />
                  ) : null}
                  {itemMissing.map((m) => (
                    <Text key={m.kind} style={styles.missing}>
                      {t(`mobile.finish.missingKinds.${m.kind}`)}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>
        );
      })}
      <FormError message={problem} />
      {conflict ? <PrimaryButton variant="outline" title={t('mobile.team.correct.reload')} disabled={!online} onPress={() => void reloadNow()} /> : null}
      {!online ? <Text style={styles.offline}>{t('mobile.team.offline')}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onCancel} />
        <PrimaryButton title={t('mobile.team.correct.next')} disabled={conflict} onPress={next} />
      </View>
      {asking ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setAsking(false)}>
          <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View testID="reason-sheet" style={styles.sheet}>
              <Text style={styles.title}>{t('corrections.fields.reason')}</Text>
              <TextInput
                accessibilityLabel={t('corrections.fields.reason')}
                value={reason}
                onChangeText={(text) => {
                  setReasonError(null);
                  setReason(text);
                }}
                multiline
                maxLength={AUDIT_LIMITS.reason}
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <FormError message={reasonError} />
              {!online ? <Text style={styles.offline}>{t('mobile.team.offline')}</Text> : null}
              <View style={styles.actions}>
                <PrimaryButton variant="outline" title={t('common.cancel')} onPress={() => setAsking(false)} />
                <PrimaryButton title={t('corrections.actions.correct')} disabled={!online || command.busy} onPress={() => void save()} />
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  section: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
  offline: { color: colors.muted, fontSize: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  cardMissing: { borderColor: colors.warning },
  cardChanged: { borderColor: colors.primary },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  missing: { color: colors.danger, fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, gap: spacing.sm },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
});
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/correct-mode src/features/execution && pnpm --filter @taskop/mobile typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/execution/item-field.tsx apps/mobile/src/features/team/correct-mode.tsx apps/mobile/src/features/team/correct-mode.test.tsx
git commit -m "feat(mobile): correct a run's answers from the Team tab with a reason, reloading on conflicts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Audit a run from the Team tab

**Files:**
- Modify: `apps/mobile/src/features/execution/answer-view.tsx` (export `ReadOnlyItem` only)
- Create: `apps/mobile/src/features/team/verdict-sheet.tsx`, `apps/mobile/src/features/team/finish-audit-sheet.tsx`, `apps/mobile/src/features/team/audit-panel.tsx`
- Test: `apps/mobile/src/features/team/audit-panel.test.tsx`

**Interfaces:**
- Consumes (Part 1):
  - logic and schemas: `missingVerdicts`, `auditVerdictInputSchema`, `finishAuditInputSchema`, `AUDIT_RESULTS`, `AUDIT_LIMITS.{verdictComment, finalComment, recipients}`;
  - types: `AuditDetail`, `AuditItemVerdict`, `AuditVerdictInput`, `FinishAuditInput`, `AuditResult`;
  - `api.audits.{get, setVerdict, clearVerdict, finish}`, `ApiError.itemIds`;
  - strings: `az.audits.{audit, paused, progress, score, statuses.*, results.*, verdicts.*, reportStatuses.*, actions.{approve, reject, clearVerdict, finish}, fields.{result, comment, extraEmails}, issues.{commentRequired, tooManyEmails}}` and `az.errors.AUDIT_*`.

  Task 7 `useTeamAudit`, `teamKeys.audit`, `RunCommand`, `WithCommand`. Existing `ReadOnlyItem` (exported here), `Badge`, `percentText`, `api.media.url`.
- Produces:
  - `VerdictSheet({ itemLabel, initial, online, busy, onSave(comment: string), onClose })`, testID `verdict-sheet`;
  - `parseEmails(text: string): string[]` and `FinishAuditSheet({ reportEmails, online, busy, onSave(body: FinishAuditInput), onClose })`, testID `finish-sheet`;
  - `AuditPanel({ viewerId, auditId, online, command, onClose })`, with testIDs `audit-item-<itemId>`, `audit-paused` and `audit-result`. Its buttons are named `<action>: <item label>`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/audit-panel.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import i18n from '@/lib/i18n';
import { colors } from '@/lib/theme';
import { checklist, ME } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { AuditPanel } from './audit-panel';
import { parseEmails } from './finish-audit-sheet';
import { AUDIT, auditDetail, auditVerdict, RUN_T } from './testing/fixtures';
import { renderTeam, TeamProviders } from './testing/render';
import { WithCommand } from './testing/with-command';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockGet = jest.fn();
const mockSetVerdict = jest.fn();
const mockClearVerdict = jest.fn();
const mockFinish = jest.fn();
const mockUrl = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    audits: {
      get: (...a: unknown[]) => mockGet(...a),
      setVerdict: (...a: unknown[]) => mockSetVerdict(...a),
      clearVerdict: (...a: unknown[]) => mockClearVerdict(...a),
      finish: (...a: unknown[]) => mockFinish(...a),
    },
    media: { url: (...a: unknown[]) => mockUrl(...a) },
  },
  session: { refreshMe: jest.fn() },
}));

const tr = i18n.t.bind(i18n);
const c = checklist();
const ALL = [c.problem.id, c.comment.id, c.temp.id, c.photo.id, c.note.id];
const allApproved = () => ALL.map((id) => auditVerdict(id));
const onClose = jest.fn();
const ui = (online: boolean) => (
  <WithCommand viewerId={ME}>{(command) => <AuditPanel viewerId={ME} auditId={AUDIT} online={online} command={command} onClose={onClose} />}</WithCommand>
);
async function open() {
  const t = await createTestServices({ online: true });
  return { t, view: await renderTeam(t.services, ui(true)) };
}
const card = (itemId: string) => within(screen.getByTestId(`audit-item-${itemId}`));
const finishButton = () => screen.getByRole('button', { name: tr('audits.actions.finish') });
const border = (itemId: string) => StyleSheet.flatten(screen.getByTestId(`audit-item-${itemId}`).props.style).borderColor;

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));
});

describe('parseEmails', () => {
  it('splits on commas, semicolons and spaces', () => {
    expect(parseEmails(' a@b.az, c@d.az;e@f.az  g@h.az ')).toEqual(['a@b.az', 'c@d.az', 'e@f.az', 'g@h.az']);
    expect(parseEmails('   ')).toEqual([]);
  });
});

describe('Audit (spec §8.2, FR-19.02–06)', () => {
  it('approves in one tap, rejects with a required comment, and counts the progress without reloading the audit', async () => {
    mockGet.mockResolvedValue(auditDetail(c));
    mockSetVerdict.mockImplementation(async (_id: string, itemId: string, body: { verdict: 'approved' | 'rejected'; comment?: string }) =>
      auditVerdict(itemId, { verdict: body.verdict, comment: body.comment ?? null }),
    );
    await open();
    expect(await screen.findByText(tr('audits.progress', { reviewed: 0, total: 5 }))).toBeTruthy();
    expect(card(c.problem.id).getByText(tr('audits.verdicts.unreviewed'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: `${tr('audits.actions.approve')}: Soyuducuda problem varmı?` }));
    expect(await card(c.problem.id).findByText(tr('audits.verdicts.approved'))).toBeTruthy();
    expect(mockSetVerdict).toHaveBeenCalledWith(AUDIT, c.problem.id, { verdict: 'approved' });
    expect(screen.getByText(tr('audits.progress', { reviewed: 1, total: 5 }))).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }));
    const sheet = within(screen.getByTestId('verdict-sheet'));
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    expect(await sheet.findByText(tr('audits.issues.commentRequired'))).toBeTruthy();
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), '  Termometr yoxlanmayıb ');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.reject') }));
    await eventually(async () => expect(screen.queryByTestId('verdict-sheet')).toBeNull());
    expect(mockSetVerdict).toHaveBeenLastCalledWith(AUDIT, c.temp.id, { verdict: 'rejected', comment: 'Termometr yoxlanmayıb' });
    expect(card(c.temp.id).getByText(tr('audits.verdicts.rejected'))).toBeTruthy();
    expect(card(c.temp.id).getByText('Termometr yoxlanmayıb')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('clears a verdict', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: [auditVerdict(c.temp.id, { verdict: 'rejected', comment: 'Yoxlanmayıb' })] }));
    mockClearVerdict.mockResolvedValue(undefined);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: `${tr('audits.actions.clearVerdict')}: Temperatur` }));
    expect(await card(c.temp.id).findByText(tr('audits.verdicts.unreviewed'))).toBeTruthy();
    expect(mockClearVerdict).toHaveBeenCalledWith(AUDIT, c.temp.id);
  });

  it('finishes when every item has a verdict, with the result, a comment and extra addresses, then shows the result', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const finished = auditDetail(c, {
      status: 'finished', result: 'failed', score: { approved: 5, rejected: 0, reviewed: 5, percent: 100 }, comment: 'İki bənd uyğun deyil',
      finishedAt: RUN_T.received, reportStatus: 'pending', verdicts: allApproved(),
    });
    mockGet.mockResolvedValueOnce(auditDetail(c, { verdicts: allApproved() })).mockResolvedValue(finished);
    mockFinish.mockResolvedValue(finished);
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    expect(sheet.getByText('Hesabat göndəriləcək: audit@demo.taskop.az')).toBeTruthy();
    await fireEvent.press(sheet.getByRole('radio', { name: tr('audits.results.failed') }));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.comment')), 'İki bənd uyğun deyil');
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), 'Boss@Demo.az, qa@demo.az;boss@demo.az');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    await eventually(async () =>
      expect(mockFinish).toHaveBeenCalledWith(AUDIT, { result: 'failed', comment: 'İki bənd uyğun deyil', extraEmails: ['boss@demo.az', 'qa@demo.az'] }),
    );
    expect(alert).toHaveBeenCalledWith('Audit bitdi.');
    const result = within(await screen.findByTestId('audit-result'));
    expect(result.getByText(tr('audits.results.failed'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: `${tr('audits.actions.approve')}: Temperatur` })).toBeNull();
    alert.mockRestore();
  });

  it('refuses an invalid extra address in the sheet', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    const sheet = within(screen.getByTestId('finish-sheet'));
    await fireEvent.changeText(sheet.getByLabelText(tr('audits.fields.extraEmails')), 'boss@demo');
    await fireEvent.press(sheet.getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await sheet.findByText('E-poçt ünvanlarından biri düzgün deyil.')).toBeTruthy();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it('keeps Finish off while an item has no verdict', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved().slice(0, 4) }));
    await open();
    expect(await screen.findByText(tr('audits.progress', { reviewed: 4, total: 5 }))).toBeTruthy();
    expect(finishButton().props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('highlights the items AUDIT_INCOMPLETE names', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    mockFinish.mockRejectedValue(Object.assign(new ApiError(422, 'AUDIT_INCOMPLETE', 'errors.AUDIT_INCOMPLETE'), { itemIds: [c.note.id] }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.finish') }));
    await fireEvent.press(within(screen.getByTestId('finish-sheet')).getByRole('button', { name: tr('audits.actions.finish') }));
    expect(await screen.findByText(tr('errors.AUDIT_INCOMPLETE'))).toBeTruthy();
    expect(border(c.note.id)).toBe(colors.warning);
    expect(border(c.temp.id)).toBe(colors.border);
  });

  it('a paused audit says the run was sent back, still takes verdicts, and cannot finish', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { paused: true, verdicts: allApproved() }));
    await open();
    expect(within(await screen.findByTestId('audit-paused')).getByText(tr('audits.paused'))).toBeTruthy();
    expect(finishButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: `${tr('audits.actions.reject')}: Temperatur` }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('shows a finished audit read-only with its result, score and report status', async () => {
    mockGet.mockResolvedValue(
      auditDetail(c, { status: 'finished', result: 'passed', score: { approved: 5, rejected: 0, reviewed: 5, percent: 100 }, finishedAt: RUN_T.received, reportStatus: 'ready', verdicts: allApproved() }),
    );
    await open();
    const result = within(await screen.findByTestId('audit-result'));
    expect(result.getByText(tr('audits.results.passed'))).toBeTruthy();
    expect(result.getByText('100%')).toBeTruthy();
    expect(result.getByText(`${tr('audits.reportStatuses.ready')} · PDF hesabatı veb-də yükləmək olar.`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: tr('audits.actions.finish') })).toBeNull();
    expect(screen.queryByRole('button', { name: `${tr('audits.actions.approve')}: Temperatur` })).toBeNull();
  });

  it('offline the review stays on screen; verdicts and Finish are off with the hint', async () => {
    mockGet.mockResolvedValue(auditDetail(c, { verdicts: allApproved() }));
    const { t, view } = await open();
    expect(await screen.findByText(tr('audits.progress', { reviewed: 5, total: 5 }))).toBeTruthy();
    await view.rerender(<TeamProviders services={t.services} client={view.client}>{ui(false)}</TeamProviders>);
    expect(screen.getByText('Komandanı görmək üçün internetə qoşulun')).toBeTruthy();
    expect(screen.getByText(tr('audits.progress', { reviewed: 5, total: 5 }))).toBeTruthy();
    expect(finishButton().props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole('button', { name: `${tr('audits.actions.approve')}: Temperatur` }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/audit-panel`
Expected: FAIL with `Cannot find module './audit-panel'`.

- [ ] **Step 3: Export the read-only item**

In `apps/mobile/src/features/execution/answer-view.tsx`, replace:

```tsx
function ReadOnlyItem({ item, answer, media, flagged, load }: { item: Item; answer: Answer | undefined; media: readonly ExecutionMediaDto[]; flagged: boolean; load: LoadUrl }) {
```

with:

```tsx
/** One item's answer, read-only (SP7); the audit (SP8) draws each item with it. */
export function ReadOnlyItem({ item, answer, media, flagged, load }: { item: Item; answer: Answer | undefined; media: readonly ExecutionMediaDto[]; flagged: boolean; load: LoadUrl }) {
```

- [ ] **Step 4: The two sheets**

`apps/mobile/src/features/team/verdict-sheet.tsx`:

```tsx
import { AUDIT_LIMITS, auditVerdictInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormError } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';

interface Props {
  itemLabel: string;
  initial: string;
  online: boolean;
  busy: boolean;
  onSave: (comment: string) => void;
  onClose: () => void;
}

/** FR-19.05: rejecting an item needs a comment (`auditVerdictInputSchema`). */
export function VerdictSheet({ itemLabel, initial, online, busy, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [comment, setComment] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const parsed = auditVerdictInputSchema.safeParse({ verdict: 'rejected', comment });
    if (!parsed.success || !parsed.data.comment) return setError(t('audits.issues.commentRequired'));
    onSave(parsed.data.comment);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View testID="verdict-sheet" style={styles.sheet}>
          <Text style={styles.title}>{t('mobile.team.audit.rejectTitle')}</Text>
          <Text style={styles.muted}>{itemLabel}</Text>
          <TextInput
            accessibilityLabel={t('audits.fields.comment')}
            value={comment}
            onChangeText={(text) => {
              setError(null);
              setComment(text);
            }}
            multiline
            maxLength={AUDIT_LIMITS.verdictComment}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <FormError message={error} />
          {!online ? <Text style={styles.muted}>{t('mobile.team.offline')}</Text> : null}
          <View style={styles.actions}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} />
            <PrimaryButton title={t('audits.actions.reject')} disabled={!online || busy} onPress={save} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
```

`apps/mobile/src/features/team/finish-audit-sheet.tsx`:

```tsx
import { AUDIT_LIMITS, AUDIT_RESULTS, type AuditResult, type FinishAuditInput, finishAuditInputSchema } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormError } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Choice } from '@/features/execution/parts';
import { colors, spacing } from '@/lib/theme';

/** Extra report addresses as typed: separated by commas, semicolons or spaces. */
export const parseEmails = (text: string): string[] => text.split(/[\s,;]+/).filter(Boolean);

interface Props {
  /** The checklist's own report addresses, shown read-only. */
  reportEmails: readonly string[];
  online: boolean;
  busy: boolean;
  onSave: (body: FinishAuditInput) => void;
  onClose: () => void;
}

/** FR-19.06–08: the result, a final comment and extra report addresses (`finishAuditInputSchema` lower-cases and de-duplicates them). */
export function FinishAuditSheet({ reportEmails, online, busy, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [result, setResult] = useState<AuditResult>('passed');
  const [comment, setComment] = useState('');
  const [emails, setEmails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const extraEmails = parseEmails(emails);
    if (extraEmails.length > AUDIT_LIMITS.recipients) return setError(t('audits.issues.tooManyEmails'));
    const parsed = finishAuditInputSchema.safeParse({ result, comment: comment.trim() ? comment : null, extraEmails });
    if (!parsed.success) return setError(t('mobile.team.audit.invalidEmails'));
    onSave(parsed.data);
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView testID="finish-sheet" style={styles.sheet} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{t('mobile.team.audit.finishTitle')}</Text>
          <Text style={styles.label}>{t('audits.fields.result')}</Text>
          <View style={styles.row}>
            {AUDIT_RESULTS.map((r) => (
              <Choice key={r} role="radio" label={t(`audits.results.${r}`)} selected={result === r} onPress={() => setResult(r)} />
            ))}
          </View>
          <Text style={styles.label}>{t('audits.fields.comment')}</Text>
          <TextInput
            accessibilityLabel={t('audits.fields.comment')}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={AUDIT_LIMITS.finalComment}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <Text style={styles.muted}>
            {reportEmails.length > 0 ? t('mobile.team.audit.reportTo', { emails: reportEmails.join(', ') }) : t('mobile.team.audit.noReportEmails')}
          </Text>
          <Text style={styles.label}>{t('audits.fields.extraEmails')}</Text>
          <TextInput
            accessibilityLabel={t('audits.fields.extraEmails')}
            value={emails}
            onChangeText={(text) => {
              setError(null);
              setEmails(text);
            }}
            placeholder={t('mobile.team.audit.emailsHint')}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={colors.muted}
            style={styles.line}
          />
          <FormError message={error} />
          {!online ? <Text style={styles.muted}>{t('mobile.team.offline')}</Text> : null}
          <View style={styles.actions}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} />
            <PrimaryButton title={t('audits.actions.finish')} disabled={!online || busy} onPress={save} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.4)' },
  sheet: { flexGrow: 0, maxHeight: '90%', backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  content: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  line: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
});
```

- [ ] **Step 5: The audit panel**

`apps/mobile/src/features/team/audit-panel.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { type AuditDetail, type AuditItemVerdict, type AuditVerdictInput, type FinishAuditInput, missingVerdicts, visibleItems } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { ReadOnlyItem } from '@/features/execution/answer-view';
import { Badge } from '@/features/tasks/task-row';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { FinishAuditSheet } from './finish-audit-sheet';
import { type RunCommand, teamKeys, useTeamAudit } from './queries';
import { percentText } from './team-format';
import { VerdictSheet } from './verdict-sheet';

interface Props {
  viewerId: string;
  auditId: string;
  online: boolean;
  command: RunCommand;
  onClose: () => void;
}

const loadMedia = (id: string) => api.media.url(id);

/**
 * Spec §8.2 "Audit" (FR-19.02–06): each auditable item with its answer and media, Approve in one tap, Reject with a
 * comment, the progress, and Finish once every item has a verdict (Spec decision 10). A paused audit (the run was sent
 * back) takes verdicts but cannot finish. A finished one is read-only. Offline the review stays and the buttons turn off.
 */
export function AuditPanel({ viewerId, auditId, online, command, onClose }: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const audit = useTeamAudit(viewerId, auditId, online);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const a = audit.data;

  if (!a) {
    return audit.error ? (
      <View style={styles.block}>
        <FormError message={mobileErrorText(t, audit.error)} />
        <PrimaryButton variant="outline" title={t('common.retry')} disabled={!online} onPress={() => void audit.refetch()} />
      </View>
    ) : (
      <ActivityIndicator color={colors.primary} />
    );
  }

  const content = a.execution.content;
  const verdicts = new Map(a.verdicts.map((v) => [v.itemId, v]));
  const missing = missingVerdicts(new Map(a.verdicts.map((v) => [v.itemId, v.verdict])), a.auditableItemIds);
  const editable = a.status === 'in_progress'; // a paused audit still takes verdicts (spec §3.3)
  const canFinish = editable && !a.paused && missing.length === 0;
  const auditable = new Set(a.auditableItemIds);
  const items = visibleItems(content, a.execution.answers).filter((v) => auditable.has(v.item.id));
  const problemItems = new Set(a.execution.problems.filter((p) => p.clearedAt === null).map((p) => p.itemId));
  const off = !online || command.busy;

  /** A verdict's answer goes into the cached audit: no reload per tap (Spec decision 10). */
  const store = (itemId: string, v: AuditItemVerdict | null) =>
    client.setQueryData<AuditDetail>(teamKeys.audit(viewerId, auditId), (old) =>
      old ? { ...old, verdicts: [...old.verdicts.filter((x) => x.itemId !== itemId), ...(v ? [v] : [])] } : old,
    );
  const unhighlight = (itemId: string) =>
    setHighlight((h) => {
      const next = new Set(h);
      next.delete(itemId);
      return next;
    });

  const decide = async (itemId: string, body: AuditVerdictInput): Promise<boolean> => {
    setProblem(null);
    const r = await command.run(() => api.audits.setVerdict(auditId, itemId, body), { refresh: false });
    if (!r) return false;
    if (!r.ok) {
      setProblem(mobileErrorText(t, r.error));
      return false;
    }
    store(itemId, r.value);
    unhighlight(itemId);
    return true;
  };
  const clear = async (itemId: string) => {
    setProblem(null);
    const r = await command.run(() => api.audits.clearVerdict(auditId, itemId), { refresh: false });
    if (!r) return;
    if (r.ok) store(itemId, null);
    else setProblem(mobileErrorText(t, r.error));
  };
  const finish = async (body: FinishAuditInput) => {
    setProblem(null);
    const r = await command.run(() => api.audits.finish(auditId, body));
    if (!r) return;
    setFinishing(false);
    if (r.ok) {
      Alert.alert(t('mobile.team.audit.finished')); // the refresh brings the finished audit
      return;
    }
    if (r.error instanceof ApiError && r.error.code === 'AUDIT_INCOMPLETE') setHighlight(new Set(r.error.itemIds ?? []));
    setProblem(mobileErrorText(t, r.error));
  };

  return (
    <View style={styles.block}>
      <View style={styles.badges}>
        <Text style={styles.title}>{t('audits.audit')}</Text>
        <Badge text={t(`audits.statuses.${a.status}`)} tone={a.status === 'finished' ? 'success' : 'neutral'} />
      </View>
      {a.paused ? (
        <View testID="audit-paused" style={styles.paused}>
          <Text style={styles.pausedText}>{t('audits.paused')}</Text>
        </View>
      ) : null}
      {a.status === 'finished' ? (
        <View testID="audit-result" style={styles.card}>
          <Line label={t('audits.fields.result')} value={a.result ? t(`audits.results.${a.result}`) : '—'} />
          <Line label={t('audits.score')} value={percentText(t, a.score?.percent ?? null)} />
          {a.comment ? <Line label={t('audits.fields.comment')} value={a.comment} /> : null}
          <Text style={styles.muted}>{`${t(`audits.reportStatuses.${a.reportStatus}`)} · ${t('mobile.team.audit.reportOnWeb')}`}</Text>
        </View>
      ) : (
        <Text style={styles.muted}>{t('audits.progress', { reviewed: a.auditableItemIds.length - missing.length, total: a.auditableItemIds.length })}</Text>
      )}
      {items.map(({ item, depth }) => {
        const v = verdicts.get(item.id);
        return (
          <View key={item.id} testID={`audit-item-${item.id}`} style={[styles.item, { marginLeft: depth * spacing.md }, highlight.has(item.id) ? styles.itemMissing : null]}>
            <ReadOnlyItem item={item} answer={a.execution.answers[item.id]} media={a.execution.media} flagged={problemItems.has(item.id)} load={loadMedia} />
            <View style={styles.badges}>
              <Badge
                text={v ? t(`audits.verdicts.${v.verdict}`) : t('audits.verdicts.unreviewed')}
                tone={v?.verdict === 'approved' ? 'success' : v?.verdict === 'rejected' ? 'danger' : 'neutral'}
              />
            </View>
            {v?.comment ? <Text style={styles.value}>{v.comment}</Text> : null}
            {editable ? (
              <View style={styles.actions}>
                <PrimaryButton
                  variant={v?.verdict === 'approved' ? 'primary' : 'outline'}
                  title={t('audits.actions.approve')}
                  accessibilityLabel={`${t('audits.actions.approve')}: ${item.label}`}
                  disabled={off}
                  onPress={() => void decide(item.id, { verdict: 'approved' })}
                />
                <PrimaryButton
                  variant={v?.verdict === 'rejected' ? 'primary' : 'outline'}
                  title={t('audits.actions.reject')}
                  accessibilityLabel={`${t('audits.actions.reject')}: ${item.label}`}
                  disabled={off}
                  onPress={() => setRejecting(item.id)}
                />
                {v ? (
                  <PrimaryButton
                    variant="outline"
                    title={t('audits.actions.clearVerdict')}
                    accessibilityLabel={`${t('audits.actions.clearVerdict')}: ${item.label}`}
                    disabled={off}
                    onPress={() => void clear(item.id)}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      <FormError message={problem} />
      {!online ? <Text style={styles.offline}>{t('mobile.team.offline')}</Text> : null}
      <View style={styles.actions}>
        <PrimaryButton variant="outline" title={t('common.close')} onPress={onClose} />
        {editable ? <PrimaryButton title={t('audits.actions.finish')} disabled={off || !canFinish} onPress={() => setFinishing(true)} /> : null}
      </View>
      {rejecting ? (
        <VerdictSheet
          itemLabel={items.find((x) => x.item.id === rejecting)?.item.label ?? ''}
          initial={verdicts.get(rejecting)?.comment ?? ''}
          online={online}
          busy={command.busy}
          onSave={(comment) =>
            void decide(rejecting, { verdict: 'rejected', comment }).then((ok) => {
              if (ok) setRejecting(null);
            })
          }
          onClose={() => setRejecting(null)}
        />
      ) : null}
      {finishing ? (
        <FinishAuditSheet reportEmails={a.checklistReportEmails} online={online} busy={command.busy} onSave={(body) => void finish(body)} onClose={() => setFinishing(false)} />
      ) : null}
    </View>
  );
}

/** A label and its value, read out as one. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.line}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  offline: { color: colors.muted, fontSize: 16 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  paused: { borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7' },
  pausedText: { color: '#92400E', fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  item: { borderRadius: 14, borderWidth: 2, borderColor: colors.border, padding: spacing.xs, gap: spacing.sm },
  itemMissing: { borderColor: colors.warning },
  line: { gap: 2 },
  label: { fontWeight: '600', color: colors.text },
  value: { color: colors.text, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
});
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/audit-panel src/features/execution/answer-view && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/execution/answer-view.tsx apps/mobile/src/features/team/verdict-sheet.tsx apps/mobile/src/features/team/finish-audit-sheet.tsx apps/mobile/src/features/team/audit-panel.tsx apps/mobile/src/features/team/audit-panel.test.tsx
git commit -m "feat(mobile): audit a run on the Team tab: verdicts, comments, finish with result and report addresses" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: The corrections timeline and cleared problems

**Files:**
- Create: `apps/mobile/src/features/team/correction-format.ts`, `apps/mobile/src/features/team/corrections-timeline.tsx`
- Modify: `apps/mobile/src/features/execution/answer-view.tsx`
- Test: `apps/mobile/src/features/team/corrections-timeline.test.tsx`, `apps/mobile/src/features/execution/answer-view.test.tsx`

**Interfaces:**
- Consumes (Part 1):
  - types `ExecutionCorrections`, `Correction`, `ReworkRequest` (its `requestedBy` is null for a platform admin), and `ExecutionProblem.clearedAt`;
  - strings `az.corrections.{noCorrections, kinds.*, round, dueAt, emptyAnswer, cleared}`.

  Task 1 strings `az.mobile.team.history.*` and the fixtures `correction`, `executionCorrections`, `teamRework`. Existing `answerText`, `choiceOptions`, `walkItems`, `formatDateTime`.
- Produces:
  - `answerSummary(t: TFunction, item: Item | undefined, a: Answer | null): string`: the chosen options, the value, "N fayl", then the note, joined with " · "; `corrections.emptyAnswer` when there is nothing.
  - `CorrectionsTimeline({ content: ChecklistContent; history: ExecutionCorrections; timeZone: string })`, with testIDs `rework-<round>` and `correction-<id>`, interleaved by time.
  - `ReadOnlyProblems` marks a cleared problem with `corrections.cleared`. `ReadOnlyAnswers` no longer marks an item whose only problem was cleared.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/features/team/corrections-timeline.test.tsx`:

```tsx
import { formatDateTime } from '@taskop/i18n';
import { screen, within } from '@testing-library/react-native';
import i18n from '@/lib/i18n';
import { checklist } from '@/offline/testing/fixtures';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { answerSummary } from './correction-format';
import { CorrectionsTimeline } from './corrections-timeline';
import { correction, CORRECTION, CORRECTION2, executionCorrections, PHOTO, RUN_T, teamRework } from './testing/fixtures';

const tr = i18n.t.bind(i18n);
const c = checklist();
const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone: 'Asia/Baku' });
const RESUBMITTED = '2026-11-03T10:00:00.000Z';

describe('answerSummary', () => {
  it('writes an answer as one line: options, value, media and note', () => {
    expect(answerSummary(tr, c.temp, { number: 10, note: 'İsti' })).toBe('10 °C · Qeyd: İsti');
    expect(answerSummary(tr, c.problem, { optionIds: [c.yes.id], photos: [PHOTO] })).toBe('Bəli · 1 fayl');
    expect(answerSummary(tr, c.temp, null)).toBe(tr('corrections.emptyAnswer'));
    expect(answerSummary(tr, undefined, { number: 1 })).toBe(tr('corrections.emptyAnswer'));
  });
});

describe('the corrections timeline (spec §8.2, NFR-07.05)', () => {
  it('interleaves send-backs and corrections by time, each with who, when, before, after and why', async () => {
    const t = await createTestServices();
    const history = executionCorrections({
      reworkRequests: [teamRework({ items: [{ itemId: c.problem.id, comment: 'Yenidən baxın' }], resubmittedAt: RESUBMITTED })],
      corrections: [
        correction({ itemId: c.temp.id, before: { number: 10, note: 'İsti' }, after: { number: 5 } }),
        correction({
          id: CORRECTION2, itemId: c.problem.id, kind: 'rework', round: 1, before: { optionIds: [c.yes.id], photos: [PHOTO] }, after: { optionIds: [c.no.id] },
          reason: 'Yenidən baxın', actor: { kind: 'user', name: 'Aynur Quliyeva' }, at: RESUBMITTED,
        }),
      ],
    });
    await renderWithServices(t.services, <CorrectionsTimeline content={c.content} history={history} timeZone="Asia/Baku" />);
    expect(screen.getAllByTestId(/^(rework|correction)-/).map((n) => n.props.testID)).toEqual(['rework-1', `correction-${CORRECTION}`, `correction-${CORRECTION2}`]);

    const round = within(screen.getByTestId('rework-1'));
    expect(round.getByText(`${tr('corrections.round', { round: 1 })} · Leyla Məmmədova 1 bəndi qaytarıb`)).toBeTruthy();
    expect(round.getByText(tr('corrections.dueAt', { date: at('2026-11-03T14:00:00.000Z') }))).toBeTruthy();
    expect(round.getByText('Soyuducuda problem varmı?: Yenidən baxın')).toBeTruthy();
    expect(round.getByText(`Yenidən təqdim edilib: ${at(RESUBMITTED)}`)).toBeTruthy();

    const manual = within(screen.getByTestId(`correction-${CORRECTION}`));
    expect(manual.getByText('Temperatur')).toBeTruthy();
    expect(manual.getByText(`${tr('corrections.kinds.manual')} · Leyla Məmmədova, ${at(RUN_T.received)}`)).toBeTruthy();
    expect(manual.getByText('Əvvəl: 10 °C · Qeyd: İsti')).toBeTruthy();
    expect(manual.getByText('Sonra: 5 °C')).toBeTruthy();
    expect(manual.getByText('Səbəb: Termometr səhv göstərirdi')).toBeTruthy();

    const rework = within(screen.getByTestId(`correction-${CORRECTION2}`));
    expect(rework.getByText(`${tr('corrections.kinds.rework')} · ${tr('corrections.round', { round: 1 })} · Aynur Quliyeva, ${at(RESUBMITTED)}`)).toBeTruthy();
    expect(rework.getByText('Əvvəl: Bəli · 1 fayl')).toBeTruthy();
    expect(rework.getByText('Sonra: Xeyr')).toBeTruthy();
  });

  it('names a platform admin and says when nothing was corrected', async () => {
    const t = await createTestServices();
    const view = await renderWithServices(t.services, <CorrectionsTimeline content={c.content} history={executionCorrections()} timeZone="Asia/Baku" />);
    expect(screen.getByText(tr('corrections.noCorrections'))).toBeTruthy();
    await view.rerender(
      <CorrectionsTimeline
        content={c.content}
        history={executionCorrections({
          reworkRequests: [teamRework({ requestedBy: null, dueAt: null })],
          corrections: [correction({ itemId: c.temp.id, actor: { kind: 'platform', name: null } })],
        })}
        timeZone="Asia/Baku"
      />,
    );
    expect(screen.getByText(`${tr('corrections.round', { round: 1 })} · Platforma administratoru 1 bəndi qaytarıb`)).toBeTruthy();
    expect(screen.getByText(`${tr('corrections.kinds.manual')} · Platforma administratoru, ${at(RUN_T.received)}`)).toBeTruthy();
  });
});
```

In `apps/mobile/src/features/execution/answer-view.test.tsx`, add `RUN_T` and `executionProblem` to the team fixtures import, add `import i18n from '@/lib/i18n';`, and append inside `describe('read-only answers', …)`:

```tsx
  it('marks a problem a correction cleared, and no longer counts it as the item’s problem', async () => {
    const c = checklist();
    await show(c, { problems: [executionProblem({ id: PROBLEM, itemId: c.problem.id, mediaIds: [PHOTO], clearedAt: RUN_T.received })] });
    expect(within(screen.getByTestId(`problem-${PROBLEM}`)).getByText(i18n.t('corrections.cleared'))).toBeTruthy();
    expect(within(screen.getByTestId(`answer-${c.problem.id}`)).queryByText('Problem qeyd olunub')).toBeNull();
  });
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/corrections-timeline src/features/execution/answer-view`
Expected: FAIL with `Cannot find module './correction-format'`; the answer-view test finds no cleared badge and still finds "Problem qeyd olunub".

- [ ] **Step 3: Write the formatter and the timeline**

`apps/mobile/src/features/team/correction-format.ts`:

```ts
import type { Answer, Item } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { answerText } from '@/features/execution/answer-view';
import { choiceOptions } from '@/features/execution/parts';

/** An answer as one line for the corrections timeline: the chosen options, the value, how many files, then the note. */
export function answerSummary(t: TFunction, item: Item | undefined, a: Answer | null): string {
  if (!item || !a) return t('corrections.emptyAnswer');
  const parts: string[] = [];
  const options = choiceOptions(item, t);
  if (options && a.optionIds?.length) parts.push(options.filter((o) => a.optionIds!.includes(o.id)).map((o) => o.label).join(', '));
  const text = answerText(item, a);
  if (text !== null) parts.push(text);
  const files = (a.photos?.length ?? 0) + (a.videos?.length ?? 0);
  if (files > 0) parts.push(t('mobile.team.history.media', { count: files }));
  if (a.note?.trim()) parts.push(t('executions.note', { note: a.note.trim() }));
  return parts.length > 0 ? parts.join(' · ') : t('corrections.emptyAnswer');
}
```

`apps/mobile/src/features/team/corrections-timeline.tsx`:

```tsx
import { type ChecklistContent, type Correction, type ExecutionCorrections, type Item, type ReworkRequest, walkItems } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { answerSummary } from './correction-format';

type Entry = { at: number; request: ReworkRequest; correction?: undefined } | { at: number; correction: Correction; request?: undefined };

/**
 * Spec §8.2 "Corrections" (NFR-07.05, FR-19.13): send-back rounds and corrections in the order they happened. Each
 * correction shows who, when, the round, the value before and after, and the reason. The original-versus-current
 * comparison is on the web (Spec decision 14).
 */
export function CorrectionsTimeline({ content, history, timeZone }: { content: ChecklistContent; history: ExecutionCorrections; timeZone: string }) {
  const { t } = useTranslation();
  const items = new Map<string, Item>();
  walkItems(content, (item) => items.set(item.id, item));
  const at = (iso: string) => formatDateTime(iso, { locale: 'az', timeZone });
  const label = (itemId: string) => items.get(itemId)?.label ?? t('executions.problemsPage.unknownItem');
  // Rounds first at equal times: a round's request comes before the corrections it caused (stable sort).
  const entries: Entry[] = [
    ...history.reworkRequests.map((request) => ({ at: Date.parse(request.requestedAt), request })),
    ...history.corrections.map((correction) => ({ at: Date.parse(correction.at), correction })),
  ].sort((a, b) => a.at - b.at);
  if (entries.length === 0) return <Text style={styles.muted}>{t('corrections.noCorrections')}</Text>;
  return (
    <View style={styles.list}>
      {entries.map((e) =>
        e.request ? (
          <View key={e.request.id} testID={`rework-${e.request.round}`} style={styles.card}>
            <Text style={styles.label}>
              {`${t('corrections.round', { round: e.request.round })} · ${t('mobile.team.history.requested', {
                // A null requester is a platform admin (Taskop support, Part 1 `reworkRequestSchema`).
                name: e.request.requestedBy?.fullName ?? t('mobile.team.history.platform'),
                count: e.request.items.length,
              })}`}
            </Text>
            <Text style={styles.muted}>{at(e.request.requestedAt)}</Text>
            {e.request.dueAt ? <Text style={styles.muted}>{t('corrections.dueAt', { date: at(e.request.dueAt) })}</Text> : null}
            {e.request.items.map((i) => (
              <Text key={i.itemId} style={styles.value}>{`${label(i.itemId)}: ${i.comment}`}</Text>
            ))}
            {e.request.resubmittedAt ? <Text style={styles.muted}>{t('mobile.team.history.resubmittedAt', { time: at(e.request.resubmittedAt) })}</Text> : null}
            {e.request.withdrawnAt ? <Text style={styles.muted}>{t('mobile.team.history.withdrawnAt', { time: at(e.request.withdrawnAt) })}</Text> : null}
          </View>
        ) : (
          <View key={e.correction.id} testID={`correction-${e.correction.id}`} style={styles.card}>
            <Text style={styles.label}>{label(e.correction.itemId)}</Text>
            <Text style={styles.muted}>
              {[
                t(`corrections.kinds.${e.correction.kind}`),
                ...(e.correction.round > 0 ? [t('corrections.round', { round: e.correction.round })] : []),
                t('mobile.team.history.by', { name: e.correction.actor.name ?? t('mobile.team.history.platform'), time: at(e.correction.at) }),
              ].join(' · ')}
            </Text>
            <Text style={styles.value}>{`${t('mobile.team.history.before')}: ${answerSummary(t, items.get(e.correction.itemId), e.correction.before)}`}</Text>
            <Text style={styles.value}>{`${t('mobile.team.history.after')}: ${answerSummary(t, items.get(e.correction.itemId), e.correction.after)}`}</Text>
            <Text style={styles.muted}>{t('mobile.team.history.reason', { reason: e.correction.reason })}</Text>
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  value: { fontSize: 16, color: colors.text },
  muted: { color: colors.muted },
});
```

- [ ] **Step 4: Cleared problems in the read-only display**

In `apps/mobile/src/features/execution/answer-view.tsx`, inside `ReadOnlyAnswers`, replace:

```tsx
  const flagged = new Set(p.problems.map((x) => x.itemId));
```

with:

```tsx
  // A problem a correction cleared (SP8) no longer marks its item.
  const flagged = new Set(p.problems.filter((x) => x.clearedAt === null).map((x) => x.itemId));
```

Inside `ReadOnlyProblems`, replace:

```tsx
            <Badge text={t(`tasks.resolutions.${x.resolution}`)} tone={x.resolution === 'resolved' ? 'success' : 'neutral'} />
          </View>
```

with:

```tsx
            <Badge text={t(`tasks.resolutions.${x.resolution}`)} tone={x.resolution === 'resolved' ? 'success' : 'neutral'} />
            {x.clearedAt ? <Badge text={t('corrections.cleared')} tone="success" /> : null}
          </View>
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team src/features/execution && pnpm --filter @taskop/mobile typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/team/correction-format.ts apps/mobile/src/features/team/corrections-timeline.tsx apps/mobile/src/features/team/corrections-timeline.test.tsx apps/mobile/src/features/execution/answer-view.tsx apps/mobile/src/features/execution/answer-view.test.tsx
git commit -m "feat(mobile): corrections timeline and cleared problems on the Team run screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: The Team run screen: actions bar, modes, rework summary, badges and timeline

**Files:**
- Modify: `apps/mobile/src/features/team/run-screen.tsx` (given in full)
- Create: `apps/mobile/src/features/team/run-screen-actions.test.tsx`
- Test (unchanged, must stay green): `apps/mobile/src/features/team/run-screen.test.tsx`

**Interfaces:**
- Consumes (Part 1): `runAuditState(status, audit)`, `api.audits.start(executionId): Promise<AuditDto>`, `api.corrections.withdraw(executionId)`, `ApiError.auditId`, `ExecutionDetail.{rework, reworkRound, corrected, audit}`, `az.audits.{actions.{start, open}, audit, runAuditStates.*}`, `az.corrections.{actions.*, reworkBanner, round, dueAt, corrected, title}`. Tasks 7–11: `runActions`, `NO_ACTIONS`, `useRunCommand`, `useTeamCorrections`, `SendBackMode`, `CorrectMode`, `AuditPanel`, `CorrectionsTimeline`. SP7: everything already on the run screen.
- Produces: `TeamRunScreen` (same props). It offers the actions of `runActions` in a bar (testID `run-actions`). Each mode replaces the run view. The screen also shows the open request (testID `run-rework`), the audit and "corrected" badges, and the corrections timeline. An open mode survives the connection dropping (Global Constraints, Review Focus 4).

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/team/run-screen-actions.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import type { PermissionKey } from '@taskop/contracts';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import i18n from '@/lib/i18n';
import { checklist, OCC } from '@/offline/testing/fixtures';
import { eventually } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TeamRunScreen } from './run-screen';
import {
  AUDIT,
  AUDIT2,
  auditBrief,
  auditDetail,
  correction,
  CORRECTION,
  EXECUTION,
  executionCorrections,
  executionDetail,
  executionSummary,
  LEYLA,
  occurrenceDetail,
  RUN_T,
  teamMe,
  teamRework,
} from './testing/fixtures';
import { renderTeam } from './testing/render';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
let mockMe = teamMe();
const mockOccurrence = jest.fn();
const mockExecution = jest.fn();
const mockUrl = jest.fn();
const mockStart = jest.fn();
const mockAudit = jest.fn();
const mockHistory = jest.fn();
const mockWithdraw = jest.fn();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: mockMe }),
  session: { refreshMe: jest.fn(async () => undefined) },
  api: {
    occurrences: { get: (...a: unknown[]) => mockOccurrence(...a) },
    executions: { get: (...a: unknown[]) => mockExecution(...a) },
    media: { url: (...a: unknown[]) => mockUrl(...a) },
    audits: { start: (...a: unknown[]) => mockStart(...a), get: (...a: unknown[]) => mockAudit(...a) },
    corrections: { history: (...a: unknown[]) => mockHistory(...a), withdraw: (...a: unknown[]) => mockWithdraw(...a) },
  },
}));

const tr = i18n.t.bind(i18n);
const c = checklist();
const BOTH: PermissionKey[] = ['reports.view', 'audits.perform', 'executions.correct'];
const OFFLINE = 'Komandanı görmək üçün internetə qoşulun';
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));

async function open(permissions?: PermissionKey[]) {
  mockMe = teamMe(permissions ? { permissions } : {});
  const t = await createTestServices({ online: true });
  await renderTeam(t.services, <TeamRunScreen occurrenceId={OCC} />);
  return t;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUrl.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}.jpg?X-Amz-Signature=x`, expiresAt: '2026-11-02T10:00:00.000Z' }));
  mockOccurrence.mockResolvedValue(occurrenceDetail());
  mockExecution.mockResolvedValue(executionDetail(c));
});

describe('Team run screen actions (spec §8.2)', () => {
  it('offers Audit, Correct and Send back on a completed run to a holder of both keys', async () => {
    await open(BOTH);
    const bar = within(await screen.findByTestId('run-actions'));
    for (const name of [tr('audits.actions.start'), tr('corrections.actions.correct'), tr('corrections.actions.sendBack')]) expect(bar.getByRole('button', { name })).toBeTruthy();
    expect(bar.queryByRole('button', { name: tr('corrections.actions.withdraw') })).toBeNull();
    await settle();
    expect(mockHistory).not.toHaveBeenCalled(); // never corrected nor sent back (Spec decision 14)
  });

  it('offers nothing to a viewer with neither key', async () => {
    await open();
    expect(await screen.findByLabelText('İcraçı: Aynur Quliyeva')).toBeTruthy();
    await settle();
    expect(screen.queryByTestId('run-actions')).toBeNull();
  });

  it('starts an audit and opens it; when one exists already it opens that one instead', async () => {
    mockStart.mockResolvedValueOnce(auditDetail(c)).mockRejectedValueOnce(Object.assign(new ApiError(409, 'AUDIT_EXISTS', 'errors.AUDIT_EXISTS'), { auditId: AUDIT2 }));
    mockAudit.mockImplementation(async (id: string) => auditDetail(c, { id }));
    await open(['reports.view', 'audits.perform']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.start') }));
    expect(await screen.findByText(tr('audits.progress', { reviewed: 0, total: 5 }))).toBeTruthy();
    expect(mockStart).toHaveBeenCalledWith(EXECUTION);
    expect(mockAudit).toHaveBeenCalledWith(AUDIT);
    await fireEvent.press(screen.getByRole('button', { name: tr('common.close') }));
    await fireEvent.press(await screen.findByRole('button', { name: tr('audits.actions.start') }));
    await eventually(async () => expect(mockAudit).toHaveBeenCalledWith(AUDIT2));
    expect(screen.queryByText(tr('errors.AUDIT_EXISTS'))).toBeNull();
  });

  it('opens Send back, and Cancel returns to the run', async () => {
    await open(['reports.view', 'executions.correct']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('corrections.actions.sendBack') }));
    expect(await screen.findByText('Düzəldilməli bəndləri seçin və hər biri üçün şərh yazın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: tr('common.cancel') }));
    expect(await screen.findByTestId('run-actions')).toBeTruthy();
  });

  it('keeps an open correction and its draft when the connection drops', async () => {
    const t = await open(['reports.view', 'executions.correct']);
    await fireEvent.press(await screen.findByRole('button', { name: tr('corrections.actions.correct') }));
    const input = await screen.findByLabelText('Temperatur');
    await fireEvent.changeText(input, '5');
    await fireEvent(input, 'blur');
    await act(async () => {
      t.net.online = false;
      await t.services.engine.refresh();
    });
    expect(screen.getByText(OFFLINE)).toBeTruthy();
    expect(screen.getByLabelText('Temperatur').props.value).toBe('5');
    await act(async () => {
      t.net.online = true;
      await t.services.engine.refresh();
    });
    expect(screen.queryByText(OFFLINE)).toBeNull();
    expect(screen.getByLabelText('Temperatur').props.value).toBe('5');
  });

  it('shows the open request of a run sent back, its round in the timeline, and withdraws it after confirming', async () => {
    const request = teamRework({ items: [{ itemId: c.temp.id, comment: 'Yenidən ölçün' }] });
    mockOccurrence.mockResolvedValue(occurrenceDetail({ status: 'correction_required', execution: executionSummary({ state: 'rework' }) }));
    mockExecution.mockResolvedValue(executionDetail(c, { state: 'rework', reworkRound: 1, rework: request }));
    mockHistory.mockResolvedValue(executionCorrections({ reworkRequests: [request] }));
    mockWithdraw.mockResolvedValue(teamRework({ withdrawnAt: RUN_T.received, withdrawnBy: LEYLA }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open(BOTH);
    const rework = within(await screen.findByTestId('run-rework'));
    expect(rework.getByText(`${tr('corrections.reworkBanner')} · ${tr('corrections.round', { round: 1 })}`)).toBeTruthy();
    expect(rework.getByText('Temperatur: Yenidən ölçün')).toBeTruthy();
    expect(await screen.findByTestId('rework-1')).toBeTruthy();
    const bar = within(screen.getByTestId('run-actions'));
    expect(bar.queryByRole('button', { name: tr('corrections.actions.correct') })).toBeNull();
    const before = mockOccurrence.mock.calls.length;
    await fireEvent.press(bar.getByRole('button', { name: tr('corrections.actions.withdraw') }));
    expect(alert.mock.calls[0]![0]).toBe('Qaytarma geri götürülsün?');
    await act(async () => {
      alert.mock.calls[0]![2]![1]!.onPress!();
    });
    await eventually(async () => expect(mockWithdraw).toHaveBeenCalledWith(EXECUTION));
    await eventually(async () => expect(alert).toHaveBeenCalledWith('Qaytarma geri götürüldü.'));
    expect(mockOccurrence.mock.calls.length).toBeGreaterThan(before); // the run was refreshed
    alert.mockRestore();
  });

  it('shows the audit result and the corrected marker, and the corrections of a corrected run', async () => {
    mockOccurrence.mockResolvedValue(occurrenceDetail({ status: 'audited' }));
    mockExecution.mockResolvedValue(executionDetail(c, { corrected: true, audit: auditBrief({ status: 'finished', result: 'failed', percent: 60 }) }));
    mockHistory.mockResolvedValue(executionCorrections({ corrections: [correction({ itemId: c.temp.id })] }));
    await open();
    expect(await screen.findByText(`${tr('audits.audit')}: ${tr('audits.runAuditStates.failed')} · 60%`)).toBeTruthy();
    expect(screen.getByText(tr('corrections.corrected'))).toBeTruthy();
    expect(await screen.findByTestId(`correction-${CORRECTION}`)).toBeTruthy();
    expect(mockHistory).toHaveBeenCalledWith(EXECUTION);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/team/run-screen-actions`
Expected: FAIL: no `run-actions` bar, no `run-rework`, no badges.

- [ ] **Step 3: Write the screen**

Replace `apps/mobile/src/features/team/run-screen.tsx` with:

```tsx
import { ApiError } from '@taskop/api-client';
import { type ChecklistContent, type ExecutionSummary, type OccurrenceDetail, type ReworkRequest, runAuditState, walkItems } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
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
import { AuditPanel } from './audit-panel';
import { CorrectMode } from './correct-mode';
import { CorrectionsTimeline } from './corrections-timeline';
import { useRefreshMeOnForbidden, useRunCommand, useTeamCorrections, useTeamExecution, useTeamOccurrence } from './queries';
import { NO_ACTIONS, type RunActions, runActions } from './run-actions';
import { SendBackMode } from './send-back-mode';
import { cancelReasonText, formatLocalDay, percentText, receiptDiffers, statusTone } from './team-format';
import { TeamOffline } from './team-offline';

/** Spec §7.2: media are signed through GET /media/:id/url (Part 1 Task 7 lets reports.view do it). */
const loadMedia = (id: string) => api.media.url(id);

/** What replaces the run view while it is open (SP8 spec §8.2). */
type RunMode = { kind: 'audit'; auditId: string } | { kind: 'correct' } | { kind: 'sendBack' } | null;

/**
 * Spec §7.2: one run, read-only, online only. The header comes from GET /occurrences/:id. The answers and problems come
 * from GET /executions/:id, requested only when the run has an execution (decision 10).
 * SP8 spec §8.2: the actions the viewer may take (Task 7's rule), each opening a mode that replaces the run view. A mode
 * stays open, with its draft, when the connection drops; only its server buttons turn off.
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
  const d = detail.data;
  const corrections = useTeamCorrections(viewerId, d && (d.corrected || d.reworkRound > 0) ? d.id : null, live);
  const command = useRunCommand(viewerId);
  const [mode, setMode] = useState<RunMode>(null);
  useRefreshMeOnForbidden([occurrence.error, detail.error, corrections.error]);

  if (!me) return null;
  const o = occurrence.data;
  const title = o?.checklistName ?? t('mobile.team.run.title');
  const close = () => setMode(null);
  if (!online && mode === null) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <TeamOffline />
      </Screen>
    );
  }
  if (mode?.kind === 'audit') {
    return (
      <Screen>
        <ScreenHeader title={title} />
        <AuditPanel viewerId={viewerId} auditId={mode.auditId} online={online} command={command} onClose={close} />
      </Screen>
    );
  }
  if (mode && d) {
    return (
      <Screen>
        <ScreenHeader title={title} />
        {mode.kind === 'correct' ? (
          <CorrectMode detail={d} online={online} command={command} reload={async () => (await detail.refetch()).data} onDone={close} onCancel={close} />
        ) : (
          <SendBackMode detail={d} online={online} command={command} onDone={close} onCancel={close} />
        )}
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

  const actions = d ? runActions(me.permissions, o.status, d.state, d.audit) : NO_ACTIONS;
  const auditState = d?.audit ? runAuditState(o.status, d.audit) : null;
  const auditPercent = d?.audit && (auditState === 'passed' || auditState === 'failed') && d.audit.percent !== null ? ` · ${percentText(t, d.audit.percent)}` : '';
  const open = (next: RunMode) => {
    command.clearError();
    setMode(next);
  };
  const startAudit = async (executionId: string) => {
    const r = await command.run(() => api.audits.start(executionId));
    if (!r) return;
    if (r.ok) return open({ kind: 'audit', auditId: r.value.id });
    // Another auditor started one first: open theirs (Part 1 decision 14).
    if (r.error instanceof ApiError && r.error.code === 'AUDIT_EXISTS' && r.error.auditId) open({ kind: 'audit', auditId: r.error.auditId });
  };
  const withdraw = (executionId: string) =>
    Alert.alert(t('mobile.team.sendBack.withdrawTitle'), t('mobile.team.sendBack.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('corrections.actions.withdraw'),
        style: 'destructive',
        onPress: () =>
          void command.run(() => api.corrections.withdraw(executionId)).then((r) => {
            if (r?.ok) Alert.alert(t('mobile.team.sendBack.withdrawn'));
          }),
      },
    ]);

  return (
    <Screen>
      <ScreenHeader title={o.checklistName} />
      <Text style={styles.muted}>{o.siteName}</Text>
      <Field label={t('reports.columns.date')} value={formatLocalDay(o.localDate)} />
      <View style={styles.badges}>
        <Badge text={t(`scheduling.statuses.${o.status}`)} tone={statusTone(o.status)} />
        {execution?.late ? <Badge text={t('executions.flags.late')} tone="warning" /> : null}
        {execution?.clockSuspect ? <Badge text={t('executions.flags.clockSuspect')} tone="warning" /> : null}
        {auditState ? (
          <Badge
            text={`${t('audits.audit')}: ${t(`audits.runAuditStates.${auditState}`)}${auditPercent}`}
            tone={auditState === 'failed' ? 'danger' : auditState === 'passed' ? 'success' : 'neutral'}
          />
        ) : null}
        {d?.corrected ? <Badge text={t('corrections.corrected')} tone="warning" /> : null}
      </View>
      {execution ? <ExecutionTimes execution={execution} timeZone={timeZone} /> : <NotExecuted occurrence={o} />}
      {d ? (
        <ActionsBar
          actions={actions}
          busy={command.busy}
          onStartAudit={() => void startAudit(d.id)}
          onOpenAudit={() => (d.audit ? open({ kind: 'audit', auditId: d.audit.id }) : undefined)}
          onCorrect={() => open({ kind: 'correct' })}
          onSendBack={() => open({ kind: 'sendBack' })}
          onWithdraw={() => withdraw(d.id)}
        />
      ) : null}
      <FormError message={command.error ? mobileErrorText(t, command.error) : null} />
      {d?.rework ? <ReworkSummary rework={d.rework} content={d.content} timeZone={timeZone} /> : null}
      {execution ? (
        d ? (
          <>
            <Text style={styles.section}>{t('mobile.team.run.answers')}</Text>
            <ReadOnlyAnswers content={d.content} answers={d.answers} media={d.media} problems={d.problems} load={loadMedia} />
            <ReadOnlyProblems content={d.content} problems={d.problems} media={d.media} load={loadMedia} />
            {corrections.data ? (
              <>
                <Text style={styles.section}>{t('corrections.title')}</Text>
                <CorrectionsTimeline content={d.content} history={corrections.data} timeZone={timeZone} />
              </>
            ) : null}
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

/** Spec §8.2: Audit (audits.perform), Correct and Send back, or Withdraw (executions.correct), as `runActions` allows. */
function ActionsBar(p: {
  actions: RunActions;
  busy: boolean;
  onStartAudit: () => void;
  onOpenAudit: () => void;
  onCorrect: () => void;
  onSendBack: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  const a = p.actions;
  if (!a.audit && !a.correct && !a.sendBack && !a.withdraw) return null;
  return (
    <View testID="run-actions" style={styles.actions}>
      {a.audit === 'start' ? <PrimaryButton title={t('audits.actions.start')} disabled={p.busy} onPress={p.onStartAudit} /> : null}
      {a.audit === 'open' ? <PrimaryButton variant="outline" title={t('audits.actions.open')} onPress={p.onOpenAudit} /> : null}
      {a.correct ? <PrimaryButton variant="outline" title={t('corrections.actions.correct')} onPress={p.onCorrect} /> : null}
      {a.sendBack ? <PrimaryButton variant="outline" title={t('corrections.actions.sendBack')} onPress={p.onSendBack} /> : null}
      {a.withdraw ? <PrimaryButton variant="outline" title={t('corrections.actions.withdraw')} disabled={p.busy} onPress={p.onWithdraw} /> : null}
    </View>
  );
}

/** The open send-back request: round, due date in the tenant's time zone, and each item with its comment. */
function ReworkSummary({ rework, content, timeZone }: { rework: ReworkRequest; content: ChecklistContent; timeZone: string }) {
  const { t } = useTranslation();
  const labels = new Map<string, string>();
  walkItems(content, (item) => labels.set(item.id, item.label));
  return (
    <View testID="run-rework" style={styles.rework}>
      <Text style={styles.reworkTitle}>{`${t('corrections.reworkBanner')} · ${t('corrections.round', { round: rework.round })}`}</Text>
      {rework.dueAt ? <Text style={styles.reworkText}>{t('corrections.dueAt', { date: formatDateTime(rework.dueAt, { locale: 'az', timeZone }) })}</Text> : null}
      {rework.items.map((i) => (
        <Text key={i.itemId} style={styles.reworkText}>{`${labels.get(i.itemId) ?? t('executions.problemsPage.unknownItem')}: ${i.comment}`}</Text>
      ))}
    </View>
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
  actions: { gap: spacing.sm },
  rework: { borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7', gap: spacing.xs },
  reworkTitle: { color: '#92400E', fontWeight: '700' },
  reworkText: { color: '#92400E' },
});
```

- [ ] **Step 4: Run every Team test and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/team && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS, including SP7's `run-screen.test.tsx`: its viewer holds neither new key and its run was never corrected, so no action, request or timeline appears and no new endpoint is called.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/team/run-screen.tsx apps/mobile/src/features/team/run-screen-actions.test.tsx
git commit -m "feat(mobile): audit, correct, send back and withdraw from the Team run screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Notification taps for the three new types

**Files:**
- Modify: `apps/mobile/src/notifications/notification-router.ts`, `apps/mobile/src/notifications/notifications-bridge.tsx`, `apps/mobile/src/features/notifications/inbox-screen.tsx`
- Test: `apps/mobile/src/notifications/notification-router.test.ts`

**Interfaces:**
- Consumes (Part 1): `NOTIFICATION_TYPES` with `run.correction_required`, `run.resubmitted` and `audit.finished`, which target the run's occurrence (`targetKind: 'occurrence'`, `targetId` = occurrence id). Task 1 `reworkSync`; SP7 `canSeeTeam`.
- Produces:
  - `NotificationRoute` gains `{ pathname: '/team/run/[id]'; params: { id: string } }`;
  - `TEAM_RUN_TYPES: ReadonlySet<string>` (the three types);
  - `NotificationTarget.type?: string`;
  - `RouteContext.canSeeTeam?(): boolean`;
  - `createRouteContext(services, canManageTasks, canSeeTeam = () => false)`;
  - `routeForTarget` follows Spec decision 15.

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/src/notifications/notification-router.test.ts`, and extend its imports with `import { NOTIFICATION_TYPES } from '@taskop/contracts';`, `reworkSync` from `@/offline/testing/fixtures`, and `TEAM_RUN_TYPES` from `./notification-router`:

```ts
describe('sub-project 8 run notifications (Spec decision 15)', () => {
  const notOnPhone = { occurrenceOnPhone: jest.fn(async () => null) };

  it('opens a run sent back to me on the execution screen once the tap’s sync brought it', async () => {
    const t = await createTestServices({ online: true });
    t.api.sync = reworkSync(t.c, [{ itemId: t.c.temp.id, comment: 'Temperaturu yenidən ölçün' }]);
    const ctx = createRouteContext(t.services, () => false, () => false);
    expect(await routeForPush(pushData({ type: 'run.correction_required', targetId: OCC }), ctx)).toEqual({ pathname: '/execution/[id]', params: { id: OCC } });
  });

  it('opens an audit result on a run the worker still holds on the execution screen', async () => {
    expect(await routeForPush(pushData({ type: 'audit.finished', targetId: OCC }), stubCtx({ canSeeTeam: () => true }))).toEqual({
      pathname: '/execution/[id]',
      params: { id: OCC },
    });
  });

  it('opens the run on the Team tab for a viewer who does not hold it', async () => {
    const ctx = stubCtx({ ...notOnPhone, canSeeTeam: () => true });
    for (const type of ['run.resubmitted', 'audit.finished', 'run.correction_required'] as const) {
      expect(await routeForPush(pushData({ type, targetId: OCC3 }), ctx)).toEqual({ pathname: '/team/run/[id]', params: { id: OCC3 } });
    }
    // An inbox row carries its type too.
    expect(await routeForTarget({ targetKind: 'occurrence', targetId: OCC3, type: 'run.resubmitted' }, ctx)).toEqual({ pathname: '/team/run/[id]', params: { id: OCC3 } });
  });

  it('keeps other run notifications, and viewers without the Team tab, in the inbox', async () => {
    expect(await routeForTarget({ targetKind: 'occurrence', targetId: OCC3, type: 'problem.critical' }, stubCtx({ ...notOnPhone, canSeeTeam: () => true }))).toEqual(INBOX);
    expect(await routeForPush(pushData({ type: 'audit.finished', targetId: OCC3 }), stubCtx(notOnPhone))).toEqual(INBOX);
    expect(await routeForPush(pushData({ type: 'audit.finished', targetId: OCC3 }), stubCtx({ ...notOnPhone, canSeeTeam: () => false }))).toEqual(INBOX);
  });

  it('names only notification types that exist', () => {
    expect([...TEAM_RUN_TYPES]).toHaveLength(3);
    for (const type of TEAM_RUN_TYPES) expect(NOTIFICATION_TYPES).toContain(type);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/notification-router`
Expected: FAIL: `TEAM_RUN_TYPES` is undefined and a not-held run opens the inbox.

- [ ] **Step 3: Route the taps**

In `apps/mobile/src/notifications/notification-router.ts`, replace:

```ts
  | { pathname: '/review/[id]'; params: { id: string; n: string } };
```

with:

```ts
  | { pathname: '/review/[id]'; params: { id: string; n: string } }
  | { pathname: '/team/run/[id]'; params: { id: string } };
```

Replace:

```ts
export interface NotificationTarget {
  targetKind: NotificationTargetKind;
  targetId: string | null;
}
```

with:

```ts
/** SP8: run notifications that open the run on the Team tab when the phone does not hold it (Spec decision 15). */
export const TEAM_RUN_TYPES: ReadonlySet<string> = new Set(['run.correction_required', 'run.resubmitted', 'audit.finished']);

export interface NotificationTarget {
  targetKind: NotificationTargetKind;
  targetId: string | null;
  /** The notification type; pushes and inbox rows both carry it. */
  type?: string;
}
```

In `RouteContext`, replace:

```ts
  canManageTasks(): boolean;
```

with:

```ts
  canManageTasks(): boolean;
  /** Whether the user can see the Team tab (`canSeeTeam`); absent means no. */
  canSeeTeam?(): boolean;
```

Replace:

```ts
export function createRouteContext(services: Pick<OfflineServices, 'userId' | 'syncNow' | 'store' | 'tasks' | 'newId'>, canManageTasks: () => boolean): RouteContext {
  return {
    userId: services.userId,
    canManageTasks,
```

with:

```ts
export function createRouteContext(
  services: Pick<OfflineServices, 'userId' | 'syncNow' | 'store' | 'tasks' | 'newId'>,
  canManageTasks: () => boolean,
  canSeeTeam: () => boolean = () => false,
): RouteContext {
  return {
    userId: services.userId,
    canManageTasks,
    canSeeTeam,
```

Replace:

```ts
  if (target.targetKind === 'occurrence') {
    const where = await ctx.occurrenceOnPhone(id);
    if (where === 'execution') return { pathname: '/execution/[id]', params: { id } };
    return where === 'notStarted' ? HOME : INBOX;
  }
```

with:

```ts
  if (target.targetKind === 'occurrence') {
    const where = await ctx.occurrenceOnPhone(id);
    if (where === 'execution') return { pathname: '/execution/[id]', params: { id } };
    if (where === 'notStarted') return HOME;
    // SP8: a manager's (or auditor's) run notification opens the run on the Team tab.
    return target.type !== undefined && TEAM_RUN_TYPES.has(target.type) && ctx.canSeeTeam?.() ? { pathname: '/team/run/[id]', params: { id } } : INBOX;
  }
```

In `apps/mobile/src/notifications/notifications-bridge.tsx`, add `import { canSeeTeam } from '@/features/team/team-rules';`, then replace:

```ts
  canManageTasks.current = s.status === 'authenticated' && s.me.permissions.includes('tasks.manage');
```

with:

```ts
  canManageTasks.current = s.status === 'authenticated' && s.me.permissions.includes('tasks.manage');
  const seesTeam = useRef(false);
  seesTeam.current = s.status === 'authenticated' && canSeeTeam(s.me);
```

and replace:

```ts
        ctx: createRouteContext(services, () => canManageTasks.current),
```

with:

```ts
        ctx: createRouteContext(services, () => canManageTasks.current, () => seesTeam.current),
```

In `apps/mobile/src/features/notifications/inbox-screen.tsx`, add `import { canSeeTeam } from '@/features/team/team-rules';`, then replace:

```ts
  canManageTasks.current = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
```

with:

```ts
  canManageTasks.current = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
  const seesTeam = useRef(false);
  seesTeam.current = session.status === 'authenticated' && canSeeTeam(session.me);
```

and replace:

```ts
      const route = await routeForTarget(item, createRouteContext(services, () => canManageTasks.current));
```

with:

```ts
      const route = await routeForTarget(item, createRouteContext(services, () => canManageTasks.current, () => seesTeam.current));
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/notifications src/features/notifications && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. SP6's router, bridge and inbox tests are unchanged and green: `canSeeTeam` defaults to no.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/notifications/notification-router.ts apps/mobile/src/notifications/notification-router.test.ts apps/mobile/src/notifications/notifications-bridge.tsx apps/mobile/src/features/notifications/inbox-screen.tsx
git commit -m "feat(mobile): open send-back, resubmit and audit notifications on the run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Full verification and the manual device checklist

**Files:**
- Create: `docs/superpowers/sp8-device-checklist.md`
- No source file. A real defect found on a device becomes a fix in the task that owns the file, with its own test and commit.

**Interfaces:**
- Consumes: everything above. Also:
  - for Steps 2–4, a running API with **all of Part 1** merged (see the dependency table in the header);
  - its seed: `pnpm db:seed` creates the demo tenant `demo` with Leyla `manager@demo.taskop.az` / `DemoPassword123` (Manager, `site_subtree`; `0016` gives the Manager role `executions.correct`), the owner `owner@demo.taskop.az` / `DemoPassword123` (every key), and the workers `elvin` and `nigar` with PIN `482915`. elvin has a daily "Səhər təmizliyi" assignment of the checklist "Gündəlik təmizlik yoxlaması" at "Anbar №1" (09:00 start, due 11:00, closes 12:00, Baku);
  - Mailpit at `http://localhost:8025` for the audit report email.
- Produces: `docs/superpowers/sp8-device-checklist.md`, and verified builds on the iOS simulator and one real phone. Airplane mode and push need the real phone.

- [ ] **Step 1: Run every automated check**

```bash
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
pnpm --filter @taskop/i18n test
pnpm --filter @taskop/mobile test
pnpm --filter @taskop/mobile typecheck
pnpm --filter @taskop/mobile lint
pnpm --filter @taskop/mobile exec expo install --check
grep -rln "api\.\(audits\|corrections\)\." apps/mobile/src apps/mobile/app | grep -v '\.test\.tsx\?$' | sort
grep -rn "\.db\b\|\.store\.\|\.tasks\." apps/mobile/src/features/team | grep -v '\.test\.tsx\?$'
git log --format=%s -- apps/mobile/src/features/execution/execution-screen.test.tsx apps/mobile/src/features/execution/finish-screen.test.tsx | head -3
```

Expected:
- All suites pass with none skipped, and Jest reports no open handles.
- `expo install --check` reports up-to-date dependencies; this part adds none.
- The first `grep` prints exactly `apps/mobile/src/features/team/audit-panel.tsx`, `correct-mode.tsx`, `queries.ts`, `run-screen.tsx` and `send-back-mode.tsx`: the worker's offline code never calls the online audit and correction endpoints.
- The second `grep` prints nothing: the Team tab still stores nothing on the phone.
- `git log` shows no commit from this plan: the worker's execution tests were not edited.

- [ ] **Step 2: Write the device checklist for the user**

Create `docs/superpowers/sp8-device-checklist.md`:

````markdown
# SP8 audit and corrections: manual device checklist (mobile)

Everything here needs a simulator, a real phone or the web admin, so Jest and the agents cannot run it. Spec: `docs/superpowers/specs/2026-10-15-audit-corrections-design.md` (§8.1, §8.2, §9, §10). Tick each item in the pull request description, with the phone model and OS version for the items that need the real phone (2: push; 3 and 6: airplane mode).

**Run this after Part 1 (API) is merged on this branch.** The phone reads `/me/sync` with rework runs, sends `POST /executions/:id/resubmit`, and the Team tab calls `/audits/*`, `/executions/:id/corrections`, `/executions/:id/send-back` and `/executions/:id/send-back/cancel`. The web app (Part 3) is optional: it shows the original-versus-current comparison (item 8) and downloads the audit PDF (item 10).

Never commit device notes or credentials.

## A. Start the stack against the demo database

```bash
docker compose -p foundation start         # the existing demo Postgres (5432), S3 (8333) and Mailpit (8025)
ipconfig getifaddr en0                     # e.g. 192.168.1.20 (needed for a real phone; the simulator can use localhost)
cp -n apps/api/.env.example apps/api/.env
cp -n apps/mobile/.env.example apps/mobile/.env
```

Edit the two gitignored files:

- `apps/api/.env`: `JOBS_ENABLED=true` (occurrences come from the cron, the audit report is a job); for a real phone `S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333`.
- `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=http://localhost:3000` for the simulator, `http://192.168.1.20:3000` for a real phone.

```bash
pnpm db:setup && pnpm db:seed              # applies 0015_audit_corrections and 0016_audit_corrections_tables
pnpm --filter @taskop/api dev              # API on http://localhost:3000
pnpm --filter @taskop/web dev              # optional web admin on http://localhost:5173
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios
# real phone: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
```

`0016` gives the Manager role `executions.correct` and the Auditor role `audits.perform`. A profile cached before the migration lacks them until the app refreshes it, so kill and reopen the app once after `db:setup`.

Push (item 2) needs the SP6 push setup (EAS project, APNs key, a development build signed by the paid team): `docs/superpowers/sp6-device-checklist.md`, section A.

### Accounts (the repo's dev seed)

| Who | Sign in | Credentials |
|---|---|---|
| Leyla, Manager (`executions.correct`), scope `site_subtree` | Rəhbər tab, email | `manager@demo.taskop.az` / `DemoPassword123` |
| Owner (every key, scope `all`): the auditor below | Rəhbər tab, email | `owner@demo.taskop.az` / `DemoPassword123` |
| Worker elvin | Worker tab, org code `demo` | PIN `482915` |

Use two devices: elvin on the real phone, Leyla or the owner on the simulator.

### Getting `<token>` and making the checklist require audit (item 10)

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login/staff -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.taskop.az","password":"DemoPassword123","client":"web"}'          # read accessToken
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/api/v1/checklists" | grep -o '"id":"[^"]*","name":"Gündəlik təmizlik yoxlaması"'
curl -s -X PATCH -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  "http://localhost:3000/api/v1/checklists/<checklist id>" -d '{"requiresAudit":true,"auditReportEmails":["qa@demo.taskop.az"]}'
```

## B. Checklist

1. **A completed run to work with.** As elvin, between 09:00 and 12:00 Baku time, start today's "Gündəlik təmizlik yoxlaması", answer everything, add one photo and complete it. Wait for the sync indicator to turn green.
2. **Send back, with a push (real phone for elvin).**
   - Lock elvin's phone. As Leyla: Komanda → "Bu gün" → the run.
   - Expected: the actions Correct and Send back; no Audit (Leyla has no `audits.perform`).
   - Tap Send back. Expected: "Düzəldilməli bəndləri seçin və hər biri üçün şərh yazın."
   - Pick two items, one of them the photo item. Write a comment for each. Due date: tomorrow `18:00` as `İİİİ-AA-GG SS:DD`. Send.
   - Expected: "İcra icraçıya qaytarıldı." The run shows the badge "Düzəliş tələb olunur" and the request block (round, due date in Baku time, both comments).
   - Expected on elvin's phone: a push about the correction. Tapping it opens the run's execution screen in rework mode.
3. **Rework offline (real phone).**
   - elvin, Home. Expected: a "Düzəliş tələb olunur" group above "İndi", whose card says "Raund 1 · 2 bənd düzəliş tələb edir", the due date and "Düzəliş et".
   - Turn on airplane mode and tap "Düzəliş et". Expected: the banner with the round and the due date; "Rəhbərin şərhi: …" on each flagged item; every other item dimmed, with its inputs and ⚑ disabled; the progress line "2/2 qaytarılan bənd hazırdır".
   - Change the flagged value. Long-press the old photo on the flagged photo item to remove it, and take a new one.
   - Go to the last section and tap "Yenidən təqdim et". The Resubmit screen lists both items as "Hazırdır". Tap "Yenidən təqdim et".
   - Expected: "Düzəlişlər göndərildi." and Home; the card is now under "Bitmiş", and the sync indicator is amber. On the Sync screen, "Fayl qeydiyyatı" and "Cavablar" come before "Yenidən təqdim".
   - Turn airplane mode off. Expected: the indicator turns green within seconds, the Sync screen is empty, and the photo uploads.
   - As Leyla, open the run again (pull to refresh the list). Expected: "Tamamlanıb" (or "Audit gözləyir" once item 10 made the checklist require audit), the "Düzəliş edilib" marker, and in "Düzəlişlər": round 1 with its comments and "Yenidən təqdim edilib: …", then one rework correction per changed item with elvin's before and after values.
   - Leyla's inbox (bell) has the resubmit notification. Tapping it opens the run on the Komanda tab.
4. **A passed due date.** Send another run back with a due date two minutes ahead. Wait. Expected: elvin's card turns red with "Gecikir" and a red due date. Nothing else happens: the run can still be fixed and resubmitted.
5. **Only flagged items, and the requirements.** Send a run back with only the photo item flagged. As elvin, remove its only photo. Expected: the progress shows "0/1", and the Resubmit screen shows "Kifayət qədər fayl yoxdur" (or "Foto lazımdır") with the button disabled. Add a photo; the button turns on.
   - **A follow-up the fix reveals.** Send a run back with only a yes/no question flagged whose other answer opens a follow-up ("Pis qoxu var?" in the seed checklist). As elvin, change the answer. Expected: the follow-up appears with "Yeni sual", editable, with no manager comment, and the progress counts it. Answer it and resubmit: the server accepts it. Change the answer back before resubmitting instead: the follow-up disappears, and the resubmit is still accepted.
6. **Withdraw while the worker is offline (real phone).**
   - Send a run back. As elvin, open it, turn on airplane mode, change a flagged value and resubmit.
   - As Leyla, open the run → Withdraw → confirm. Expected: "Qaytarma geri götürüldü." and the run's status from before the send-back.
   - Turn elvin's airplane mode off. Expected within seconds: no red row on the Sync screen; the card shows "Server qəbul etmədi: Bu icra artıq bağlanıb və dəyişdirilə bilməz."; opening the run shows the server's answers, read-only.
7. **Correct from the Team tab.**
   - As Leyla, open a completed run → Correct. Expected: "Foto və videolar dəyişdirilmir. …" and the item editors (choices, numbers, text, dates, notes).
   - Change one value and tap "Davam et". Write a reason and save. Expected: "Düzəliş yadda saxlanıldı.", the "Düzəliş edilib" marker, and a manual correction in "Düzəlişlər" with the reason.
   - Tap Correct again and "Davam et" without changing anything. Expected: "Heç bir cavab dəyişməyib."
8. **Two managers at once.** Open the same run's Correct mode as Leyla on the phone and as the owner on the web (or a second phone). Save on the web first, then on the phone. Expected on the phone: the conflict message and "Yenidən yüklə". Tapping it shows the web's values; a new correction saves. On the web, the run dialog's Corrections tab lists both.
9. **Offline in a mode.** In Correct mode, change a value, then turn on airplane mode (or Wi-Fi off on the simulator's Mac). Expected: "Komandanı görmək üçün internetə qoşulun", the changed value still there, and saving disabled. Reconnect: saving works with the same value.
10. **Audit on the phone (owner).**
    - Make the checklist require audit (section A), and let elvin complete a new run. As the owner: Komanda → the run. Expected: the status "Audit gözləyir" and the Audit start button.
    - Start it. Expected: the items with their answers and photos, the progress "0 / N bənd yoxlanılıb", and Finish disabled.
    - Approve all but one item. Reject the last: without a comment the sheet refuses; with a comment it saves. Expected: the progress "N / N" and Finish enabled.
    - Finish with "failed", a comment and `boss@demo.taskop.az` as an extra address. Expected: "Audit bitdi.", the result read-only with the score, and the report status turning ready on a reload.
    - Mailpit (`http://localhost:8025`) has one message for `qa@demo.taskop.az` and one for `boss@demo.taskop.az`, each with the PDF. On the web the PDF downloads (no PDF on the phone).
    - The run is now locked: the run screen offers only opening the audit. elvin and Leyla get the audit result in their inboxes (Leyla only because it failed).
11. **A paused audit.** Start an audit on a completed run and approve some items. As Leyla, send the run back. As the owner, open the audit. Expected: "İcraçıya düzəlişə qaytarılıb — yenidən təqdim gözlənilir", verdicts still editable, and Finish disabled. After elvin resubmits, the verdicts of the changed items are cleared, and Finish becomes possible once they are reviewed again.
12. **Somebody else's audit.** Start an audit on the web as the owner, then tap the Audit start button on the phone as a second auditor (a custom role with `reports.view` and `audits.perform`, created on the web). Expected: the phone opens the existing audit instead of an error.
13. **Workers see no Team actions, and the worker flow is unchanged.** elvin has no Komanda tab. Start and complete a normal run: options, numbers, notes, dates with "İndi", photos, ⚑ problems and the finish screen behave as before this part.
````

- [ ] **Step 3: Start the stack and run the checklist**

Follow `docs/superpowers/sp8-device-checklist.md` sections A and B on the simulator and on one real phone.
Expected: every item as written. Record the phone model and OS version for items 2, 3 and 6.

- [ ] **Step 4: Commit the checklist and record the results**

```bash
git add docs/superpowers/sp8-device-checklist.md
git commit -m "docs: SP8 manual device checklist for the mobile audit and correction flows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Add the checklist results to the pull request description. For each failed item, open a fix in the owning task's files, with a regression test where Jest can express it, and commit it as `fix(mobile): …`. Do not commit device-only notes or credentials.

---
## Self-review

**Spec coverage (§8.1, §8.2, the mobile lines of §6.2, §9 and §10)**

| Spec | Where |
|---|---|
| §8.1 Home: "Needs correction" above today's runs; `rework` runs from SQLite with the due date (red when passed) and the flagged count | Task 3 (`groupOccurrences`, `OccurrenceCard`, `HomeScreen`, tests `lists runs sent back…`, `turns the card red…`) |
| §8.1 / §3.1 `correction_required` is open for its executor and closed for everyone else | Task 3 (`CLOSED_STATUSES`, `FINISHED_STATUSES`, `readOnlyReason`), Task 1 (`statusTone`) |
| §8.1 rework banner with round and due date | Task 6 (`rework-banner`), Task 1 strings, Part 1 `corrections.{reworkBanner, round, dueAt}` |
| §8.1 flagged items editable with the manager's comment: values, notes, new photos and videos | Task 4 (store guard), Task 6 (screen) |
| §8.1 every other item read-only and dimmed | Task 6 (`wrap-<id>` opacity, `readOnly || !editable`) |
| §8.1 the progress bar counts the flagged items (and revealed follow-ups, Part 1's rule) | Task 6 (`reworkProgress` over `reworkEditable`) |
| Part 1's rework rule: follow-ups a flagged change reveals (chains included) may be answered, newly hidden items may be cleared | Task 4 (`reworkEditable`, `reworkViolations(content, rework.answersBefore, …)`), Task 2 (the request with `answersBefore`), Task 6 (`Yeni sual`, test `answers a required follow-up that a flagged change reveals, and resubmits`) |
| §8.1 finishing goes to a "Resubmit" screen whose button queues `resubmit` | Task 6 (`ResubmitScreen`, `FinishOrResubmit`), Task 5 (`store.resubmit`) |
| §8.1 outbox kind `resubmit`; a refusal reopens the run in rework (`reopenRefusedCompletion` variant); the offline badge | Task 5 (`reopenRefusedRework`, `dropRework`, sync indicator through `outboxCounts`), Task 1 (`mobile.sync.kinds.resubmit`) |
| §6.2 `/me/sync` carries rework runs and their request; runs leaving rework drop on the next pull | Task 2 (`mergeExecution`, `settleLeftRework`) |
| §6.2 outbox order answers → media → resubmit | Task 5 (`nextCommand`, outbox tests) |
| §3.2 rework is not limited by `closes_at`; the partial sweep ignores it | Task 4 (`guard`, `lockExpired` test), Task 3 (`readOnlyReason`) |
| §8.2 Audit (`audits.perform`): start or open; item list with Approve, Reject and a comment sheet; Finish sheet with result, comment and extra emails | Task 10 (`AuditPanel`, `VerdictSheet`, `FinishAuditSheet`), Task 12 (start, `AUDIT_EXISTS`, open) |
| §8.2 Correct (`executions.correct`): values-only edit mode reusing the item editors, reason sheet, submit | Task 9 (`AnswerInput`, `CorrectMode`), Task 12 |
| §8.2 Send back: select items, a comment each, an optional due date | Task 8 (`SendBackMode`), Task 12 |
| §8.2 Corrections: a read-only timeline section | Task 11 (`CorrectionsTimeline`), Task 12 |
| §8.2 actions depend on permission and status | Task 7 (`runActions`, table test), Task 12 |
| §8.2 all actions need a connection: disabled with the existing offline hint; no PDF on mobile | Tasks 8, 9, 10 (offline tests), Task 12 (`keeps an open correction…`), Task 10 (`reportOnWeb`) |
| §4.1 / Part 1 decision 18: cleared problems shown as cleared | Task 11 (`ReadOnlyProblems` badge, `ReadOnlyAnswers` flag) |
| §7.1 the three notification types reach the right screen | Task 13 |
| §9 two managers correct at once → `ANSWERS_CONFLICT`, the client reloads | Task 9 (`after ANSWERS_CONFLICT it reloads…`) |
| §9 send-back while the worker is offline: the run reopens on the next pull; the push comes when online | Task 2 (`turns a completed copy into rework…`), Task 14 item 2 |
| §9 a stale local copy after resubmit gets `EXECUTION_NOT_ACTIVE`, treated as a closed-run refusal | Task 5 (`a withdrawn send-back drops the queued rework…`) |
| §9 a second send-back before resubmit is refused | Task 7 (`runActions` offers no Send back on a `rework` run), the API enforces it |
| §9 the executor cannot do the rework → withdraw | Task 12 (`…withdraws it after confirming`) |
| §9 due dates in the tenant time zone | Tasks 3, 6, 11, 12 (`formatDateTime(…, { timeZone })` with `services.timeZone` / `me.tenant.timezone`) |
| §10 mobile Jest: Home group, rework editing guard, the `resubmit` command and refusal reopen, Team actions with the offline-disabled state | Task 3, Task 4, Task 5, Tasks 8–12 |
| §10 device checklist (`docs/superpowers/sp8-device-checklist.md`) | Task 14 |

**Placeholder scan.** There is no "TBD", "TODO", "add validation" or "similar to Task N". Every edit to an existing file names the exact text it replaces or the anchor it follows. `run-screen.tsx`, `group-occurrences.ts` and the route `finish.tsx` are given in full. Task 1 Step 7's fixture edits are conditional on purpose: Part 1 Task 2 adds the same defaulted fields first, so this task checks with `grep` and adds only what is missing. `<token>`, `<checklist id>` and the device steps in Task 14 are values the user reads off their own running stack.

**Type consistency.** These names are the same in every task that uses them:
- `ReworkCard`, `CardModel.rework`, `GROUP_KEYS` with `'rework'` (Task 3, used by `OccurrenceCard` and `HomeScreen`);
- `ItemNotInReworkError`, `flaggedItems`, `reworkEditable` (Task 4, used in Tasks 5, 6); `store.resubmit` (Task 5, used in Task 6);
- `reopenRefusedRework`, `dropRework` (Task 5); `settleLeftRework` (Task 2);
- `LocalExecution.{reworkRound, rework}` and `ExecutionRow.{rework_round, rework}` (Task 2, used in Tasks 3–6);
- `reworkComments`, `reworkOverdue`, `reworkProgress`, `ResubmitScreen`, `FinishOrResubmit`, `nextJump` (Task 6);
- `RunActions`, `NO_ACTIONS`, `runActions` (Task 7, used in Task 12);
- `teamKeys.{audit, corrections}`, `useTeamAudit`, `useTeamCorrections`, `CommandResult`, `RunCommand`, `useRunCommand`, `WithCommand` (Task 7, used in Tasks 8–12);
- `SendBackMode` (Task 8), `AnswerInput`, `AnswerInputProps`, `needsNote`, `correctionAnswer`, `CorrectMode` (Task 9), `ReadOnlyItem`, `VerdictSheet`, `parseEmails`, `FinishAuditSheet`, `AuditPanel` (Task 10), `answerSummary`, `CorrectionsTimeline` (Task 11), all used in Task 12;
- `TEAM_RUN_TYPES`, `NotificationTarget.type`, `RouteContext.canSeeTeam` (Task 13);
- fixtures: `REWORK_EXECUTION`, `REWORK_PHOTO`, `REWORK_REQUEST`, `REWORK_DUE`, `MANAGER_REF`, `reworkRequest`, `completedAnswers`, `reworkSync` (offline), and `AUDIT`, `AUDIT2`, `CORRECTION`, `CORRECTION2`, `REQUEST`, `LEYLA`, `auditBrief`, `auditVerdict`, `executionCorrections`, `correction`, `teamRework`, `auditDetail` (team), all from Task 1;
- testIDs `rework-banner`, `wrap-<itemId>`, `rework-item-<itemId>`, `send-back-<itemId>`, `correct-<itemId>`, `reason-sheet`, `verdict-sheet`, `finish-sheet`, `audit-item-<itemId>`, `audit-paused`, `audit-result`, `rework-<round>`, `correction-<id>`, `run-actions`, `run-rework`.

**Names used from Part 1's "Interfaces for Parts 2 and 3".**
- Contracts:
  - `reworkViolations(content, before, after, flagged)`, `changedItemIds`, `missingVerdicts`, `runAuditState`;
  - `canStartAudit`, `canCorrect`, `canSendBack`, `canWithdrawSendBack`;
  - `AUDIT_LIMITS`, `AUDIT_RESULTS`;
  - `sendBackInputSchema`, `auditVerdictInputSchema`, `finishAuditInputSchema`, `auditDetailSchema`, `executionCorrectionsSchema`;
  - the types `ReworkRequest`, `MyExecution.{reworkRound, rework}`, `ExecutionDetail.{reworkRound, rework, corrected, audit}`, `ExecutionProblem.clearedAt`, `AuditBrief`, `AuditDetail`, `AuditDto`, `AuditItemVerdict`, `AuditVerdictInput`, `FinishAuditInput`, `AuditResult`, `CorrectAnswersInput`, `ExecutionCorrections`, `Correction`, `ResubmitCommand`, `ResubmitResult`;
  - the values `correction_required` and `rework`, the permission keys `audits.perform` and `executions.correct`, and the three notification types.
- i18n:
  - `az.scheduling.statuses.correction_required`, `az.executions.states.rework`;
  - `az.audits.{audit, score, paused, progress, statuses, results, verdicts, reportStatuses, runAuditStates, actions.{start, open, finish, approve, reject, clearVerdict}, fields.{result, comment, extraEmails}, issues.{commentRequired, tooManyEmails}}`;
  - `az.corrections.{title, kinds, corrected, cleared, round, reworkBanner, dueAt, noCorrections, emptyAnswer, actions.{correct, sendBack, withdraw}, fields.{reason, itemComment}, issues.dueInPast}`;
  - `az.errors.{ANSWERS_CONFLICT, AUDIT_EXISTS, AUDIT_INCOMPLETE, REQUIREMENTS_UNMET, EXECUTION_NOT_ACTIVE, …}`.
- API client: `api.executions.resubmit`; `api.audits.{start, get, setVerdict, clearVerdict, finish}`; `api.corrections.{correct, sendBack, withdraw, history}`; `ApiError.{auditId, itemIds}`.
- Server behaviour relied on: the refusal codes in Global Constraints; `/me/sync` listing every `rework` run with its request (Part 1 decision 8); `POST …/media` accepting `itemId: null` in rework (decision 5); the three notification types targeting the occurrence; `GET /executions/:id` and the corrections history readable with `reports.view`.
- Existing repo names: `createExecutionStore`, `guard`, `change`, `appendCommand`, `nextCommand`, `resolveExecutionRefusal`, `discardFailedCommand`, `dropMedium`, `reopenRefusedCompletion`, `mergePull`, `markFinishedSynced`, `groupOccurrences`, `homeStats`, `OccurrenceCard`, `readOnlyReason`, `useExecution`, `ItemField`, `FinishScreen`, `ReadOnlyAnswers`, `ReadOnlyProblems`, `RemoteMediaStrip`, `TeamRunScreen`, `TeamOffline`, `useTeamOccurrence`, `useTeamExecution`, `useRefreshMeOnForbidden`, `canSeeTeam`, `routeForTarget`, `createRouteContext`, `Badge`, `Choice`, `Field`, `FormError`, `mobileErrorText`, `PrimaryButton`, `CommitInput`, `toAnswerDatetime`, `percentText`, `statusTone`.

**Gaps against Part 1 (reported to its author).**
None. Part 1 exports `AuditVerdictInput`, `FinishAuditInput`, `CancelAuditInput`, `SendAuditReportInput`, `AuditItemVerdict`, `AuditScore` and `Score` as types. This plan uses `AuditVerdictInput`, `FinishAuditInput` and `AuditItemVerdict` (Task 10); the mobile app neither cancels audits nor sends reports.

Assumptions about the server that go beyond the section, for Part 1 to confirm:
- `409 EXECUTION_NOT_ACTIVE` on a rework answers or media command after a withdraw.
- `ResubmitResult.status` is the occurrence's new status.
- A run that left rework drops out of `/me/sync` once outside the normal windows.
- `ExecutionDetail.audit` may be a cancelled audit.
- `setVerdict` returns the stored verdict.

**Review Focus check.** Five uncovered input classes are listed, each with its pinning tests in the owning tasks:
- a send-back withdrawn while the worker is offline with queued work (Tasks 5, 2);
- a resubmit overtaking its answers or media (Task 5);
- an edit of a locked item (unflagged, visible before and after), including problems and photos; and answering, then hiding again, a revealed follow-up (Task 4);
- the connection dropping inside a Team mode (Tasks 8, 9, 10, 12);
- double taps and two managers correcting at once (Tasks 5, 7, 8, 9).
