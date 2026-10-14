# Notifications — follow-ups

Items found while building sub-project 6 that are out of its scope or were left for later. ⚑ marks the ones to look at first.

- ⚑ **Device checklist not run yet.** `docs/superpowers/sp6-device-checklist.md` needs your accounts: an APNs key and an FCM V1 key uploaded to Expo, `google-services.json` (EAS file variable or the gitignored local file), and `eas init` with the `projectId` pasted into `apps/mobile/app.json`. Cold-start taps (items 5–6) can only be checked on a device.
- ⚑ **Deployment plan additions.** `EXPO_ACCESS_TOKEN` (optional secret) and `NOTIFICATIONS_PUSH_ENABLED` (defaults on outside tests) in the server env; the notification workers poll every 0.5 s with 4 workers on each of `notifications.fanout` and `notifications.deliver` (~16 idle polls/s) — size the pg-boss pool for it; `problem.critical` emails add Resend volume.
- ⚑ **Given-up events.** A fan-out that fails 5 times is dead-lettered and only logged; a manual message whose fan-out gave up stays `processed: false`, so the Mesajlar history keeps polling and shows "Göndərilir…" while the page is open. Expose a failed outcome in `MessageSummary` and alert on `notifications.dead`.
- ⚑ **Manual-message pickers are capped.** `GET /notifications/messages/options` returns at most 50 users, 50 teams and 200 sites, and ignores `q` for sites, so sites past the 200th can't be picked (the web says so). Filter sites by `q` on the server and move the caps into `@taskop/contracts` (the web copies them in `OPTION_CAPS`).
- **Token claim by design.** Any signed-in user who knows another phone's Expo token can claim it and stop that phone's pushes (spec §6.4). Low risk; revisit if tokens ever leak.
- **Role audiences check one holder at a time.** Fan-out runs one scope query per role holder (decision 2). Fine at pilot scale; skip the query for `all`-scope holders or batch it if a big role (e.g. Worker) is added to a rule.
- **Web tests under heavy load.** At load average ~25 some web tests hit Vitest's 5 s default. Add a package-wide `testTimeout` in `apps/web/vite.config.ts` if CI flakes.
- **Session refresh after logout (mobile).** An in-flight request that triggers a token refresh just before sign-out could in theory save tokens after `tokenStore.clear()`; the final review found `auth.logout()` joins the single-flight refresh, so the window is negligible.

## Deferred from reviews

Small items noticed while reviewing each piece and left for later.

### API

- **Task 1:** LEAD_MINUTES duplicated in z.literal([15,30,60,120]) — use z.literal(LEAD_MINUTES) if zod allows
- **Task 1:** no behavioural test pins default invariants (email only problem.critical, push off only checklist.missed, due_soon 30)
- **Task 1:** pushData/notificationItem don't enforce targetId/targetDate vs targetKind consistency (producers must)
- **Task 2:** constant-restating audit-actions test (plan-mandated, negligible); import order cosmetic
- **Task 3+4:** api-client schema-rejection test uses rejects.toBeDefined() (loose); i18n leadMinutes test restates constant; tooManyRecipients hardcodes 1000 (plan-mandated)
- **Task 5:** RLS isolation test partly vacuous (seed one row per table); platform grants / WITH CHECK / rules+cleanup deletes not exercised; backfill version bump/idempotency not asserted; queued idx is (status, created_at) while P2 sweep uses coalesce(claimed_at, created_at) (bounded by partial predicate)
- **Task 6:** destroy during startup leaks boss; no test for destroy-before-ready; send returns true even if boss.send returns null; defineWorker/define don't reject duplicate names; test queues accumulate
- **Task 7:** no test for mixed add+remove update; no test for re-derived problem new id/event (decision 7) or task-linked problem kept
- **Task 8:** guarded savepoint not tested with a real SQL failure; duplicate sp1 savepoint names fragile if guarded body ever does work after record (comment/rule: record is last step); test "surrounding tx still commits" asserts only false; occurrence.status_changed opens savepoint for every change (check e.to first); two pg-error detectors (postgresErrorOf vs pgErrorOf; sanitiseForLog drops EAUTH msgs)
- **Task 9:** update() runs effective() twice + catalog reloads; ParseRuleTypePipe lives in controller; rule unit loop near-constant; prettier --check warns on new notifications files (repo-wide prettier drift)
- **Task 10:** per-holder sequential sees() query (N+1; skip when dataScope='all' later); team membership joined by hand twice instead of activeTeamMember (plan-mandated duplication of R6 predicate — final review to triage); tenant timezone read duplicated with silent 'Asia/Baku' fallback (plan-mandated); NotificationTargets.load not exhaustive (falls to task()); coverage gaps (tasks.manage-only holder, owner via role, inactive team, forUser inactive role, forMessage direct); deactivated sender's message still fans out (undocumented); prettier drift
- **Task 11:** WEB_URL trailing slash → '//' in links (strip in notificationLink); subject from manual title may contain CRLF (nodemailer folds it; sanitise in template for other mailers); cut() may split surrogate pair; missing link tests (trailing slash, null targetId fallback); overdue shows localDate not dueAt date for midnight-crossing windows; new Intl formatter per call
- **Task 11:** mismatch error grammar "a occurrence"; taskBody takes wide NotificationType
- **Task 12:** manual push-always and email:false not tested; run() must not be called inside a tenant tx (countFailure separation) — document/guard; recipients×devices nested loop
- **Task 13:** results dropped after lost claim are silent (warn when record updates fewer rows); untested: deleted device row, no-email user, 4xx SMTP retry, mixed ok/error ticket batch; FakePushSender.sent unbounded in long-running dev process (plan-mandated); LOUD ticket errors log per row; unread helpers live in delivery module; InvalidCredentials/MessageTooBig error-log not asserted (tests silent logger)
- **Task 14:** "5th attempt → failed" CASE duplicated in sweep and record() (export a fragment); receipts LOUD log + status='sent' write guard untested; "logs a failed send" test loose; fan-out sweep keys on created_at (extra concurrent run possible, harmless)
- **Task 15:** untested edges due_at−lead==starts_at, exactly due_at, cancelled due_soon, mixed enablement; discovery OR may scan more pending rows
- **Task 16:** concurrent same-token registration race (add userId to upsert set; cross-tenant conflict → RLS 500); no test that claim leaves other tokens' rows; cursor of another user/deleted untested; platform delete commits outside request tx (comment it); token theft by design (security pass); prettier on new files
- **Task 17:** team memberCount/options count the sender (team with only sender offered → noRecipients); status order duplicated in SQL vs AGGREGATE_ORDER; memberCount fix relies on unaliased teams; detail re-reads payload; tests miss own/subordinates sender, inactive team dropped, permission on preview/:id, audit after pinned loosely; options caps (50/200) truncate silently — web picker
- **Task 18:** wiring test two 20s polls vs 30s testTimeout; seed idempotency guard is "any manual event"; seeded event bypasses outbox (no deliveries)

### Mobile

- **Task 1:** old-cache default only tested via network-failure path; no corrupt emailNotifications case
- **Task 2:** eas development Debug settings + no expo-dev-client not asserted; _layout configureNotifications wiring untested; withGoogleServices always emits android:{}
- **Task 3:** console.warn spy not restored in unread.test.ts:79; second !stopped guard untested alone; logout test name overstates; stop() JSDoc should say in-flight results are dropped
- **Task 4:** stale attempts from a previous closure may overlap (two prompts) / pendingRegistration only tracks newest; tokens.set failure after register leaves server device unremovable until retry heals; test gaps (pendingRegistration live→null, startPushRegistration cancels held attempt, module block state order-dependent, Bridge unmount)
- **Task 5:** SecureStore get/clear outside the 3 s budget; timed-out registration may re-store token after clear (accepted by constraints); failure test doesn't assert remove called/token cleared (plan gap); unregisterPush takes unused push dep; block with null recorded user liftable by same user
- **Task 6:** lastResponse() unguarded in effect; launch tap arriving on login screen replays on next sign-in (clear on logout / ignore older than session); clear-before-route drops tap under StrictMode double effect; no test for rejected sync still routing / bridge listener removal; occurrenceOnPhone loads all rows; handled set never pruned
- **Task 7:** loadMore during in-flight reload can append an older page/overwrite cursor (skip rows) — guard with reloading ref; markRead network/5xx failure not reverted/refreshed; markAll disabled based on loaded rows only (use unread count); loadMore error not cleared; dedupe filter untested; focus re-run only mocked
- **Task 8:** patchUser doesn't check the patched user (logout+other sign-in during 30 s PATCH); permission test starts at denied only; at(-1) AppState listener order-dependent

### Web

- **Task 1:** i18n test dropped the brief's exact toBe text assertions (typo in Azerbaijani text not caught by this test)
- **Task 2:** labels.ts doc example uses wrong labels; link edge tests (none+id, problem null date), five-status order, negative badge untested; useMessage(id) lacks enabled guard (check in Task 7); invalidating messages prefix also refetches options
- **Task 3:** filter-resets-paging untested; markAll failure has no UI feedback and test doesn't assert unread refetch; `void openNotification` leaves navigate rejection unhandled; ul may lose list semantics in Safari (role="list"); double click sends two markRead
- **Task 4:** focus-refetch test uses default client (would pass without staleTime 0 / refetchOnWindowFocus) — test with app defaults; mark-all failure silent; w-96 fixed width on narrow screens; focus return untested
- **Task 5:** no test for cross-row dirty state / error placed in its row / password card under Təşkilat; stale row error lingers; edits during in-flight save overwritten; unsaved drafts lost on tab switch; background refetch leaves draft behind (dirty true); roles button counts only listed roles; "use client" in switch.tsx
- **Task 6:** no test for 200-per-kind limit or debounce; confirm shows only title (not body/targets/email); fail() with unknown field keys shows nothing (fallback to errorText); field errors not role=alert / not cleared on edit; edits during in-flight preview discarded; OPTION_CAPS duplicate; counter counts raw length
- **Task 8:** disabled switch drops keyboard focus while saving; pending override could show on new user's switch mid-save (unreachable); test gaps (toast skipped on user change, role in trigger, Çıxış after close); ResizeObserver stub not restored
- **Task 9:** find(...)! bare TypeError; 6th signup trips local per-IP signup limit on persisted DB reruns; hard-coded Azerbaijani strings beside i18n labels in e2e
