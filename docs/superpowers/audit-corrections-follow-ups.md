# Sub-project 8 (audit and corrections): follow-ups and rulings

Branch `claude/sub-project-8-44d44c`, implemented 2026-10-15 (subagent-driven; web tasks 5-15 batched without per-task review at the user's request, then one whole-branch review and one fix wave).

## ⚑ Decide before deploy

- **Audit report PDF memory (Ruling R9c).** One build of a 200-item / 40-photo report peaks at about 0.33–0.55 GB (maxRSS growth), above spec §7.2's 300 MB estimate. Fine on the 6 GB server at `localConcurrency: 2`, but together with an SP7 PDF export it could reach ~1.5 GB. The regular suite only checks time (< 10 s); `pnpm --filter @taskop/api perf:audit-report` (RUN_PERF=1) asserts < 600 MB. Joins the SP7 PDF-memory follow-up.
- **e2e at default Playwright workers is flaky locally** (foundation.spec sometimes never sends POST /sites; per-IP login limit 20/min). Passes 9/9 with `--workers=2`. CI sets `RL_SIGNUP_IP_PER_HOUR=100`.

## Deferred (from the final whole-branch review)

- Task 15: "final 'sent' update overwrites report_sent_at": **should fix now**, as item 5.
- Task 15: "S3 stream opened before filename query (leak on throw)": **should fix now**. Move the checklist/occurrence query in `audits.service.ts:197-204` above `getStream`. It's a two-line swap.
- Batch 9-12 / final batch: `EXECUTION_LOCKED`/`NOT_CORRECTABLE` don't refresh: **should fix now**, as item 6.
- Final batch: no UI hint that `resultFilter` applies to roles only: **should fix now**, as item 7.
- Task 3 / web Task 1 copy: the `AUDIT_PAUSED` subject and withdraw worded two ways ("Geri qaytarmanı ləğv et" / "Qaytarmanı geri götür"): **should fix now**. These are i18n-only edits; pick one withdraw wording.
- Task 2 (web): `refreshRunViews` doesn't invalidate `taskKeys`: **should fix now**. Once item 3 lands, a task view can still show a problem as not cleared; it's a one-line invalidation.
- R9c (report memory ~0.33–0.55 GB peak against the spec's 300 MB): not a code fix, but **must be surfaced to the user** before merge, as the ruling says.

### Defer (follow-up list)
- Orphaned `execution_media` from a withdrawn rework round (API Task 8 and mobile Task 5 `dropRework`): add to the media purge.
- `execution_rework_requests` has no `withdrawn_by_platform_admin_id`, so a platform withdrawal shows `withdrawnBy: null` (the audit log has the actor).
- `executions_original_guard` keyed per column (Task 5); the current trigger covers every path the code uses.
- A failed report whose PDF is stored (every mail failed) blocks the download until Resend rebuilds it; it could stay downloadable.
- `GET /audits` filters the date on `local_date`, not on run completion as spec §6.2 says; document or align.
- The web "Start audit" with `AUDIT_EXISTS` only shows a toast; it could open `details.auditId` as mobile does.
- The Corrections tab diff during an open rework includes the worker's unsubmitted answers; consider labelling them "in rework".
- A parked `ITEM_NOT_IN_REWORK` answers command blocks `resubmit` until it is discarded, and after the discard the local answers diverge (the local guard makes this unlikely).
- CI and docker-compose use `:latest` for seaweedfs and mailpit; pin them for reproducible e2e.
- Playwright is flaky locally with 5 workers; consider `workers: 2`. CI defaults to 2.
- Report-volume seed has no audits (perf:reports blind to the audit join); no `auditState`+cursor test; no cancelled-audit report test.
- Audit-queue cursor edge cases (Task 13); the in-progress cursor goes stale if its audit is cancelled between pages.
- Mobile: back arrow inside a team mode discards drafts; `staleRun` predicate duplicated; `inbox-screen.test.tsx:203` uses an invalid dataScope.
- Mobile M5: the send-back due date uses device-local time, not the tenant zone.
- Notification percent not locale-formatted; `run()` target loader reads the rework request at fan-out time.
- Remaining per-task test-gap minors in final-review-notes.md (Tasks 2, 6-14, 16-18; mobile 1-14; web 1-3).
- MaxListenersExceededWarning in the API suite.

- The audit PDF shows an "original score" for a run that was sent back but never corrected (`audit-report-loader.ts` ~199).
- `PROBLEM_NOT_CLOSED` text reads oddly for a cleared problem (only reachable through a race; the button is hidden).
- `expo install --check` wants Expo patch bumps (expo 57.0.27 etc.); left for a separate change (Ruling M9).

## Rulings made during implementation

Each line: what was decided — why — what it costs if wrong.

- Ruling R1: Task 1 also adds 'correction_required' to OCCURRENCE_STATUSES and 'rework' to EXECUTION_STATES, plus the Drizzle pgEnum values and the 0015 ADD VALUE migration (moved from Task 5 Step 3), and fixes the API typecheck sites (occurrence-writer.ts:190, occurrences.service.ts:100) so contracts, DB and API stay green after Task 1 — plan order made Task 1/2 uncompilable — cost if wrong: Task 5 implementer must skip its Step 3 (told in dispatch).
- Ruling R2: Task 2 `uniqueItems` made generic over the key — plan code has TS2345 — none.
- Ruling R3: Task 5 `auditRow` helper uses explicit casts ($5::audit_status / ::text) — Postgres "inconsistent types deduced" — none.
- Ruling R4: Keep plan migration names (0015 enum values only, 0016_audit_corrections_tables = tables+grants+RLS+backfill) instead of spec §4's 0016_..._security — the enum split forces a different cut; content matches spec — cost: cosmetic naming drift from spec.
- Ruling R5: Task 5 adds an upgrade-path migration test: migrate a fresh DB to 0014 and commit, then apply 0015+0016 — catches unsafe use of the new enum values that a single-transaction fresh migrate hides — cost: one slower test.
- Ruling R6: Task 9 correction rows (and Task 7) are written in checklist order, not jsonb key order — flaky test otherwise — none.
- Ruling R7: Withdraw (Task 8) restores answers to the request's answers_before (answers_rev+1) instead of leaving the worker's partial rework answers in place — spec §6.2 said they stay, but that leaves answers changed with no correction rows and score/problems stale (BR-14 trail) — cost if wrong: a worker's half-done rework is discarded on withdraw.
- Ruling R8: recalculate() (Task 6) syncs manual problems too (clear removed, insert new), not only rule problems — rework can change a flagged item's manual problem and plan never wrote it; direct corrections cannot change `problem`, so they are unaffected — cost: a manual problem removed in rework is cleared rather than kept.
- Ruling R9: Task 14 performance check measures heapUsed+external+arrayBuffers growth (before/after build) < 300 MB and wall time < 10 s, and logs RSS — heapUsed alone excludes Buffers — none.
- Ruling R10: Task 15 adds a test pinning the audit.report queue options (retryLimit 5, retryDelay 15, retryDelayMax 240, localConcurrency 2) — none.
- Ruling R11: Task 16 resultFilter applies to ROLE recipients only; the executor (assignees audience) is always notified of audit.finished — spec §7.1 says the default rule notifies managers only on failed; plan decision 16 filtered the whole rule — cost: executors get a notification for passed audits too.
- Ruling R12: Fix the existing tests the scan named in the task that breaks them: notification-rules.test.ts:37 (Task 2/16), notification-templates.test targetFor (Task 16), reports-export.test.ts:92 auditState (Task 17) — none.
- Ruling R13: "add `type X`" inside an existing `import type {…}` means add `X` (no inner `type`) — TS2206 — none.
- Ruling R14: Accept mobile team-format.test.ts red from P1 Task 2 until P2 Task 1 (scan C16) — execution is sequential and P2 T1 owns statusTone — cost: none unless P1 is merged alone.
- Ruling R15: COMPLETED_STATUSES gets correction_required in Task 1 (TS rule) while report-queries SQL mirror updates in Task 17 — classifyRun test requires every status classified — cost: TS/SQL differ until Task 17. Stale gitignored apps/mobile/.expo/types blocks mobile typecheck on /team routes — regenerate or delete it (not a code issue).
- Ruling R16 (supersedes R14): Task 1 adds correction_required: 'neutral' to the expected map in apps/mobile/src/features/team/team-format.test.ts so the mobile suite stays green; P2 Task 1 sets the real tone — one-line fix beats a red suite across 30+ tasks — cost: none.
- Ruling R17: Task 2 drops the expectTypeOf "exported types" block in audits.test.ts — vitest run doesn't typecheck tests, so it asserts nothing; Task 4's typechecked api-client consumes every type — cost: none.
- Ruling R18: Task 2's emailList reuses auditReportEmailsSchema's element/dedupe logic (one shared helper) instead of a second copy — DRY — none.
- Ruling R19: Task 2 makes notification-templates.test.ts it.each skip the three new types (isAuditType) until Task 16 adds their templates and removes the skip — the test throws since T2 otherwise — cost: none.
- Ruling R20: A problem cleared indirectly (its item hidden by a parent answer change) gets cleared_by_correction_id = null; only directly corrected items link their correction row — the correction log already records the parent change — cost: the cleared problem's link doesn't name the parent correction.
- Ruling R6a (clarifies R6): checklist order binds correction rows and changedItemIds only; the audit_log before/after keyed-object order (jsonb reorders keys) is not ordered and need not be — the audit viewer diffs by key; Task 7 reviewer's Important on this is resolved by the clarification — cost: none.
- Ruling R21: resubmitCommandSchema gains required `round: int ≥ 1`; resubmit looks up the request for cmd.round — resubmitted → idempotent 200 with current result; withdrawn or not the open request → 409 EXECUTION_NOT_ACTIVE — a replayed round-1 resubmit after a lost response would otherwise close the manager's round 2 silently — cost: mobile plan's resubmit command must send rework.round (carry into P2 dispatches).
- Ruling R22: Task 13's API-local pg-boss queue constant is named AUDIT_JOB_QUEUES (not AUDIT_QUEUES, which collides with the contracts queue-tab enum) — scan C5 — cost: none.
- Ruling R23: finish and report/send refuse a merged recipient list (checklist emails + extra) larger than 20 with 400 VALIDATION_FAILED fields.extraEmails (or fields.emails) = 'audits.issues.tooManyEmails' instead of silently truncating — silently dropping addresses an auditor typed is worse than a refusal — cost: auditor must remove addresses; done in Task 15 dispatch.
- Ruling R9a (corrects R9): the §7.2 memory metric is growth of heapUsed + external (< 300 MB); arrayBuffers is already inside external, so R9 double-counted Buffers — measured ≈190 MB, 57 MB PDF, ~600 ms — cost: none.
- Ruling R9b (supersedes R9a): heap-delta measures are GC-timing dependent (passes 60-80%); true peak while building the 200-item/40-photo report is ≈375-410 MB (heapUsed+external with garbage), above spec §7.2's 300 MB estimate. Test now measures peak RSS growth via process.resourceUsage().maxRSS (high-water mark, deterministic per fork) and asserts < 512 MB plus time < 10 s; logs components. SURFACE TO USER: spec's 300 MB not met (~400 MB peak); fine on the 6 GB server at localConcurrency 2, joins the SP7 PDF-memory follow-up — cost if wrong: two concurrent report builds plus an SP7 PDF export could reach ~1.5 GB.
- Ruling R9c (supersedes R9b): peak memory of one 200-item/40-photo report build is 330-545 MB maxRSS growth depending on GC timing — no stable CI threshold exists. The regular suite asserts only wall time < 10 s (and the 40-image count); memory assertion (maxRSS growth < 600 MB, logged components) runs only when RUN_PERF=1, like SP7's perf scripts. SURFACE TO USER: spec §7.2's 300 MB estimate is exceeded (~0.33-0.55 GB peak per build). Cost if wrong: memory regressions in the report builder go unnoticed unless someone runs the perf check.
- Ruling R24: audit report table drops dontBreakRows (plan-mandated) — pdfmake silently omits any row taller than a page, so 3000-5000-char answers vanished from the report — cost: short rows may now split across pages.
- Ruling R25 (Task 15 review): (a) audit.dead handler sets report_status='failed' (withTenant) when still pending, give-up path forwards to audit.dead like SP6 fanout, and the job gets an explicit expireInSeconds covering 20 sends × 120 s SMTP budget; (b) photos are validated by opening them in a throwaway pdfkit doc (try/catch), invalid → skipped & counted; (c) give-up keeps report_status='ready' when report_sent_at is set and the PDF is stored (a failed resend no longer hides a delivered report) — overrides "after last retry status=failed" for that case; (d) download streams from S3 (getStream + StreamableFile) per spec §6.2; (e) reuse-on-retry test spies putObject; minors: report_sent_at = coalesce(report_sent_at, now) set after first success, report_attempts reset on every sendReport and on 'stored', subject variables collapse \s+ to one space with a newline-name test, doc comment notes at-least-once mail — cost if wrong: a stale 'ready' after an undelivered resend shows the old PDF (still correct content).
- Ruling R26: accept direct dependency pdfkit ^0.19.1 (+@types/pdfkit) in apps/api for photo validation — same version pdfmake already resolves, so no new code ships — cost: one more direct dep to keep in step with pdfmake.
- Ruling R27: Task 18 Step 4 (manual run against the shared dev stack) skipped — it would migrate the user's shared dev DB; e2e in Plan 3 covers the live path — cost: no manual smoke on the dev DB until the user runs it. Report-volume seed has no audits (perf:reports blind to the audit join) — deferred follow-up.
- Ruling M1: Task 1 updates i18n.test.ts:153 (sections key list) for the new `rework` section — existing test asserts exactly four keys — none.
- Ruling M2: Task 2 adds rework_round/rework to the ExecutionRow literal in local-model.test.ts — typecheck — none.
- Ruling M3: Task 7 Step 4 keeps a single `@/lib/session` import (merge, no duplicate) — none.
- Ruling M4: Task 11 timeline test includes the mandatory `capture` mock — none.
- Ruling M5: send-back due date is read as device-local wall-clock time, like the existing task form (create-task-screen) — consistent UX across the phone — cost: off by the zone difference if the phone's zone ≠ tenant's.
- Ruling M6: Task 9 adds `refreshOnError?: (e: ApiError) => boolean` (or equivalent) to useRunCommand.run, invalidating ['team', viewerId] on matching refusals; SendBackMode switches to it and drops its hard-coded ['team'] invalidation; tighten unknown-item match to /^items\.\d+\.itemId$/ — keep the viewer key factory in one place — cost: none.
- Ruling M7: VerdictSheet/FinishAuditSheet onSave now returns Promise<string|null> (sheet owns its error) instead of the brief's serverError prop — keeps typed drafts on refusal — cost: Task 12 must use AuditPanel (which wires the sheets), not the sheets directly.
- Ruling M8: for TEAM_RUN_TYPES, a viewer with canSeeTeam() whose phone holds no execution of the run routes to /team/run/[id] before the HOME fallback (overrides decision 15's order for these types) — a manager holding the occurrence with someone else's claim was sent Home — cost: none.
- Ruling M9: expo install --check patch drift (expo 57.0.27 etc.) is left for a separate change — package.json is unchanged on this branch and the bump rewrites the lockfile — cost: none for SP8.
- Ruling W1: Task 3 email list input handles paste with an onPaste handler that splits on newlines/commas — single-line inputs strip newlines in browsers and jsdom — none.
- Ruling W2: Task 4 keyboard R/A handlers call preventDefault before deciding — otherwise "r" is typed into the comment box — none.
- Ruling W3: Task 4 item-panel.tsx must not read refs during render (react-hooks/refs lint) — use a callback/effect — none.
- Ruling W4: Task 12 TS2206 as Ruling R13 in plan 1 — none.
- Ruling W5 (user decision 2026-10-15, "it's taking so long"): remaining web tasks run in batches (5-8, 9-12, 13-15) by one implementer per batch, committing per task, with NO per-task reviews; one whole-branch review + one fix wave at the end — cost: issues surface later, in the final review.
- Ruling W6: ItemPanel `commentRef` prop replaced by `focusComment: number` counter (react-hooks/refs) — cost: none.
- Ruling F1: mobile mergeExecution takes server answers+rev whenever the rework copy changes hands (entering, leaving, or a different rework.id) — withdraw's rev+1 collides with the phone's next local rev, so the stale-ack path kept abandoned answers and could block round 2 — cost: none (merge is skipped while anything is queued).
- Ruling F2: an in-progress audit's verdicts are reset for items changed by a direct correction or reverted by a withdraw (spec §3.3 only names resubmit) — auditor must not pass values they never saw — cost: auditor re-reviews those items.
- Ruling F3: tasks cannot be created from a cleared problem (API refuses, web hides Create task) — cost: none.
- Ruling F4: `corrected` = exists(execution_corrections) instead of original_captured_at — send-back alone isn't a correction — cost: none.

## Per-task minor findings (not fixed)

### Plan 1-api
- Task 1: minor (deferred): audits.issues.tooManyEmails key must exist after Task 3; executions.states.rework/correction_required labels already added in Task 1 (Task 3 must not duplicate).
- Task 2: minor (deferred): audits.test.ts — pin send-back duplicate path items.1.itemId; execution-views.ts import order; queue from-without-to message not asserted.
- Task 3: minor (deferred): AUDIT_PAUSED message subject ambiguous (suggest 'İcra düzəlişə qaytarılıb. İcra yenidən təqdim olunandan sonra audit bitirilə bilər.'); tooManyEmails wording; 'Ləğv etmə səbəbi' spelling; Checklist vs Yoxlama vərəqəsi mix; {{percent}} format must be consistent in Task 16 (pass number, template adds %?).
- Task 4: minor (deferred): endpoints.ts import order; sendReport explicit-body test missing.
- Task 5: minor (deferred): executions_original_guard keyed on captured_at/answers, not per column (recommend per-column OLD.x IS NOT NULL AND NEW.x IS DISTINCT FROM OLD.x — migration unreleased, fix in place); tenant-isolation test covers 2 of 4 tables, no WITH CHECK cross-tenant insert test; backfill test replays on shared DB (flake risk); upgrade test seeds no data. MaxListenersExceededWarning in full API suite — source unknown, likely pre-existing.
- Task 6: minor (deferred): upsert always bumps updated_at on kept problems; per-row clearing UPDATE (N+1, bounded); tests miss no-duplicate-event for kept problems and manual problem with task cleared.
- Task 7: minor (deferred): refusal test lacks missed/cancelled/correction_required rows and audit_pending positive; no answer:null 200 test; no test refusing a `problem` key; no platform-route attribution test (Task 18 should cover platform admin on corrections/send-back/audits); inChecklistOrder walks content twice.
- Task 8: minor (deferred): no test of original_score in snapshot; no API test for duplicate itemId / dueAt==now boundary; "keeps audit_pending" withdraw branch untested; withdraw recalculates even when unchanged. Cross-task: rework_requests has no withdrawn_by_platform_admin column (platform withdraw shows withdrawnBy null; audit log has actor); media registered in rework then withdrawn stays orphaned in execution_media (check purge).
- Task 9: minor (deferred): media guard "hidden in answers_before" branch untested; verdict reset with cancelled/no audit untested.
- Task 10: minor (deferred): rework-round and diff-order assertions don't discriminate (order coincides with insertion/uuidv7); corrections() calls summaryRow just for two columns; executor sees ExecutionDetail.audit result (intended per spec notifications).
- Task 11: minor (deferred): partial-run test doesn't assert no audit_pending history row; late-sync test lacks final status/late asserts; no in-window-past-due + requiresAudit test. Note: occurrence.status_changed to audit_pending carries null (system) actor.
- Task 12: minor (deferred): no platform-admin route tests for audits (Task 18 must add: start/verdict/cancel as platform admin, attribution); write-route 404/403 cases only on GET; clearVerdict unknown item 204 vs setVerdict 404; tx declared early.
- Task 13: minor (deferred): Waiting/In-progress cursor branches + tie-break untested; in-progress cursor stale if its audit is cancelled between pages; MEDIA/PAUSED tests don't assert HTTP status; siteId subtree descendant untested; platform finish/queue untested (Task 18).
- Task 14: minor (deferred): photo-cap test doesn't guard per-item cap of 3 (add 1 item × 5 photos → 3 images, "+2 foto"); perf test line 45 claims maxRSS is GC-independent (false); RUN_PERF=1 script POSIX-only; photo/video answer repeats "N video" in extras line; option-id fallback prints UUID.
- Task 15: minor (deferred): final 'sent' update overwrites report_sent_at with latest send; S3 stream opened before filename query (leak on throw); per-photo PDFDocument without autoFirstPage:false; openImage doesn't catch corrupt IDAT (builds fine anyway); MaxListenersExceededWarning noise in API suite.
- Task 16: minor (deferred): role-trim logic named `filtered` in generic fanout; no test for platform-admin send-back → no resubmitted creator recipient, nor actor self-exclusion on new types; run() loader reads rework request at fan-out time; percent not locale-formatted (66.7%).
- Task 17: minor (deferred): perf:reports not re-run with audit join (Task 18 re-runs); no auditState+cursor paging test; no cancelled-audit report test; 17-column PDF cramped.
- Task 18: minor (deferred): unchanged() doesn't check report-send/status-history side effects; openapi lacks platform items/cancel paths; report-volume seed has no audits.

### Plan 2-mobile
- Task 1: minor (deferred): team.audit.reportOnWeb "veb-də" → "veb-dən" wording; reworkSync hardcodes executor name.
- Task 2: minor (deferred): no idempotent second migrate() assert; no test that queued answers block incoming rework merge; toMatchObject on rework is subset. Cross-task: resubmit-result handling (Task 5) must clear rework in the same tx that removes the acked resubmit row.
- Task 3: minor (deferred): rework branch ignores claimedBy; rework state with null request falls to done/view silently; Home problem tile excludes rework runs; occurrence-card ternary duplicated.
- Task 4: minor (deferred): no removeMedia-on-rework test; evidence media on revealed follow-up untested; UI caller of complete() on rework must route to Resubmit (Task 6).
- Task 5: minor (deferred): dropRework keeps registered media/uploads of a withdrawn round (check media cleanup); REQUIREMENTS_UNMET reopen stores no note (UI shows missing via local requirements).
- Task 6: minor (deferred): unrelated Prettier rewrap churn in execution-screen.tsx/rework-screen.test.tsx; Resubmit row accessibilityLabel hides comment/status from screen readers; overdue-red not asserted on screens; hidden flagged items still listed on Resubmit; "0/0" progress text when nothing editable visible.
- Task 7: minor (deferred): invalidate awaited inside lock (busy until refetch); refresh test asserts call only; useTeamAudit('') not defended. Cross-task: Tasks 8-10 must gate every server button on online status and handle ANSWERS_CONFLICT (reload) / AUDIT_EXISTS (open auditId).
- Task 8: minor (deferred): dueAt ISO assertion tautological; no >1000-char / whitespace-only comment test; Task 12 must mount modes fresh per open and not double-render command.error.
- Task 9: minor (deferred): staleRun predicate duplicated in correct-mode/send-back-mode (export one from queries.ts); no non-matching items.* key test; no clear-to-null / multi-item correction test; reloadNow silent on undefined.
- Task 10: minor (deferred): >20 raw extras collapsing to ≤20 merged shows invalidEmails not tooManyEmails (keep raw check too); Finish onPress indentation; a11y label always "unreviewed".
- Task 11: minor (deferred): unmatched optionIds push '' into summary; problem-only answer renders "Cavab yoxdur"; answerSummary direct cases missing (text/datetime/multi/videos/{}).
- Task 12: minor (deferred): back arrow / Android back inside a mode leaves the run and discards drafts (ScreenHeader onBack); staleMode closes silently on any refresh; cancel/close keeps last refusal visible; dead offline prop in ActionsBar; viewer-with-no-keys test anchors only on occurrence; jest.requireMock mutation of sendBack leaks across tests.
- Task 13: minor (deferred): inbox-screen.test.tsx:203 uses invalid dataScope 'tenant' (use 'site_subtree'); routing-order test not run against old code.
- Task 14: minor (deferred): checklist item 13 "otherwise" branch needs an unlisted 6th assignment; line 57 invariant wrong for item 2; item 11 send-back on audit-pending run steps thin; second auditor account not listed; items 5/6/8 send-backs give no due date.

### Plan 3-web
- Task 1: minor (deferred): audits-web header comment claims no repeats but repeats Part 1 strings; emails.placeholder non-ASCII 'ad@nümunə.az'; web i18n test spot-checks only; withdraw worded two ways ('Geri qaytarmanı ləğv et' vs 'Qaytarmanı geri götür').
- Task 2: minor (deferred): refreshRunViews untested; useAuditDetail polling untested; refreshRunViews doesn't invalidate taskKeys (task view may show stale cleared problem); auditFixture leaves execution.audit null. Cross-task: Tasks 7/10 must not pass null requestedBy through actorName (map to scheduling.schedule.actorPlatform); report panel must call restartPolling on resend/retry.
- Task 3: minor (deferred): use contracts emailSchema instead of z.email(); focus lost after chip remove; error <p> not announced (role=alert); orphan label when disabled; comma commits whole text; missing paste edge tests. Placeholder non-ASCII in i18n (Task 1 file).

