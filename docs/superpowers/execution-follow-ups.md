# Mobile execution & offline sync — follow-ups

Items found while building sub-project 4 that are out of its scope. ⚑ marks the ones to look at first.

- ⚑ **Platform-admin reads.** `GET /executions/:id`, `GET /problems` and `GET /media/:id/url` are tenant-only. Platform admins see execution summaries in the occurrence drawer through the existing platform routes, but cannot open the detail or media yet. Add `platform/tenants/:tenantId/...` variants with the `route-mode` pattern if support needs them.
- ⚑ **Merge PR #2's deployment plan edits** listed in `docs/superpowers/plans/2026-10-09-mobile-execution-1-api.md` ("Deployment plan note").
- **A failed completion rolls back its answers.** `REQUIREMENTS_UNMET` discards the answers sent with the completion; the phone still has them and the earlier answers commands stored them. Store them first in a separate transaction if workers report lost edits.
- **Concurrent duplicate claims** (the same `id` sent twice in parallel) can produce one `500` from the primary-key race; the retry returns the stored result. Map `executions_pkey` to a replay if it shows up in logs.
- **Problem media cap at registration** is `5 × item count` per execution for `itemId: null` media; the exact "≤ 5 per manual problem" is enforced on the answers.
- **Problem lifecycle** (owner, due date, resolution: FR-13.07–09) → sub-project 5. **Alerts** on new problems and status changes (FR-13.04) → sub-project 6.
- **Media retention per plan** (NFR-10.03) → sub-project 9. `media.cleanup` only removes never-uploaded objects.

## Deferred review findings (Part 1)

Minor review findings left open, and rulings made while building Part 1.

- Ruling: F1 (T10/T13) media registration allowed on state='partial' with completed_at null and capturedAt < occurrence closes_at (also on rejected executions, per spec); T13 adds a test registering after the sweep then reviving — spec §6.4 revival + NFR-06.04 — cost if wrong: late evidence accepted after close.
- Ruling: F2 (T9) claim test count is 12, plan text says 13 — text slip — none.
- Ruling: F3 (T15) extract a shared per-tenant runner instead of copying OccurrenceJobs.perTenant/tenantsWith — DRY — small refactor of scheduling jobs.
- Ruling: F4 helpers repeated across test files go in test/execution-fixtures.ts and are imported — DRY — none.
- Ruling: F5 (T15) real-clock test window chosen relative to now, not fixed 00:00–23:59 — avoid daily flake — none.
- Ruling: F6 (T6) SeaweedFS container readiness polling is allowed (exception to no-poll rule) — readiness isn't clock-driven — none.
- Ruling: F7 (T12) →partial history row at closes_at kept — that is when the window closed — cost: history time differs from device completedAt.
- Ruling: F8 (T9) do not pin checklist version for rejected claims — spec §5.1 pin on download by assignee or claim — none.
- Ruling: F9 (T6) S3_* stay required; .env.example + README tell devs to add them — prod safety — local .env must be updated once.
- Ruling: F10 (T18) seed occurrence yesterday with assignment starting today accepted as harmless demo data — cost: demo data slightly inconsistent.
- Ruling: F11 (T15) dead-letter worker log message made generic ("Job … failed") — accuracy — none.
- Ruling: F12 (T5) client test also calls executions.get — coverage — none.
- Ruling: commit trailer = whatever each subagent's harness specifies — harness attribution rules bind subagents — cost: mixed model names in trailers.
- Task 1: MISSING_KINDS lacks exhaustiveness check vs MissingKind.
- Task 1: manual problem note not trimmed in deriveProblems (check answerSchema trims).
- Task 2: answerIssues accepts duplicate media IDs in one array — resolved in the final fix wave.
- Task 2: media registered for a different item accepted by answerIssues (media map holds kind only) — resolved in the final fix wave.
- Task 2: date/datetime regex format-only (2026-13-45 passes).
- Task 3: syncQuerySchema knownVersionIds max(200) untested.
- Task 4: rangeTooLong string hardcodes 92 (duplicates EXECUTION_LIMITS).
- Task 5: path test checks method+path only, not bodies.
- Ruling: Parts 2/3 execute sequentially after Part 1 in this worktree (no parallel implementer tracks) — SDD forbids parallel implementers in one tree and the session guard blocks other worktrees — cost: longer wall-clock.
- Task 6: seaweedfs test helper retries permanent errors for 60s.
- Task 6: MaxListenersExceededWarning in API test output (check if pre-existing).
- Task 7: no RED run recorded (process).
- Task 7: execution_problems_item_uq and problems RLS isolation untested.
- Task 7: no index on occurrences.checklist_version_id.
- Task 8: applyTransitions doesn't assert single occurrence.
- Task 8: allowMissed NOT_YET_OPEN/NOT_ON_SHIFT cases untested.
- Task 9: replay with mismatched occurrenceId not checked.
- Task 9: ALREADY_CLAIMED precedence over NOT_ASSIGNED undocumented.
- Task 9: visibleVersion fallback orders by nullable number DESC (may pick draft); untested branch.
- Ruling: media register replay must NOT issue a fresh PUT URL once the medium is `uploaded` (return 409 EXECUTION_NOT_ACTIVE-style refusal or the row without URL) — prevents overwriting stored evidence — carried into Task 15 dispatch — cost if wrong: client must handle refusal on replay after upload.
- Task 10: video without durationMs/width/height skips duration/resolution checks.
- Task 11: swept-partial answers test leaves occurrence 'started' (unrealistic), no progress/problems assertion.
- Task 11: device-time check before stale check → stale replay with bad clock gets 422 not stale:true.
- Task 12: stale-rev completion path untested — resolved in the final fix wave.
- Task 12: completion replay checks device time before replay → bad clock replay 422 (same pattern as T11).
- Task 13: late completion after sweep test doesn't assert completedAt/late/row completed_at.
- Task 14: cancelled-occurrence exclusion in sync untested.
- Task 14: rejected executions included in sync's 24h finished list (phone shows rejection — likely intended).
- Ruling: replay register of an uploaded medium → 409 EXECUTION_NOT_ACTIVE (no generic conflict code exists) — reuse over new code — cost: slightly misleading code; phone never re-registers uploaded media.
- Ruling (final review, supersedes the two replay rulings above): a register replay of an uploaded medium returns `200` with `status: 'uploaded'`, `uploadUrl: null`, `headers: {}`, `expiresAt: null` — the phone's media queue replays after upload — still no fresh PUT URL.
- Task 15: confirmUploaded update not guarded by status='pending' (concurrent confirms overwrite uploadedAt).
- Task 15: media.cleanup select lacks FOR UPDATE SKIP LOCKED (race with confirm) — resolved in the final fix wave.
- Task 15: presigned PUT valid 15 min after confirm (overwrite window).
- Task 15: tests missing: confirm-after-purge clears storage_purged_at; mime mismatch; cross-tenant GET url.
- Task 15: defined jobs dead-letter into 'occurrences.dead' queue name.
- Task 16: problems cursor is a bare id — deleted problem row ends paging early.
- Task 16: non-null assertions occurrence!/version!.number! in execution-queries.
- Task 17: isolation tests don't assert tenant A state unchanged after foreign 404.
- Task 18: seed assumes the first yes_no option and rules[0].
- Final review minor 6 (accepted): an offline `started → in_progress` is stamped with the deviceTime of the collapsed latest answers command, not of the first edit.
