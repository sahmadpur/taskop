# Tasks — follow-ups

Items found while building sub-project 5 that are out of its scope. ⚑ marks the ones to look at first.

- ⚑ **Notifications (SP6).** `task.assigned`, `task.accepted`, `task.submitted`, `task.rejected`, `task.completed`, `task.cancelled` and `task.overdue` are emitted with no listeners. SP6 subscribes for FR-14.10 (completion to the creator) and FR-15.03 (overdue).
- ⚑ **Production bucket CORS.** Apply the "Deployment plan note" of `docs/superpowers/plans/2026-10-12-tasks-1-api.md` to the deployment plan: the `taskop-media` bucket on `files.taskop.app` must allow origin `https://admin.taskop.app` (`GET`, `PUT`, `HEAD`; `Content-Type`, `Content-Length`; expose `ETag`), or web uploads fail in the browser while the phone keeps working.
- ⚑ **Platform-admin reads.** The task endpoints are tenant-only. Add `platform/tenants/:tenantId/tasks…` variants with the `route-mode` pattern if support needs them.
- **Permission backfill.** `0010_tasks_security.sql` gave the task keys to the existing Admin, Manager and Auditor roles (SP2–SP4 backfilled Admin only). Nothing was deployed then; revisit the rule before the first production migration of a later sub-project.
- **Overdue in the timeline.** `overdue_at` is a flag with a timestamp, not a `task_status_history` row. If reports (SP7, FR-18.12) need it in the status timeline, add an event-type column to the history table.
- **Sync size.** `/me/sync` returns the open tasks assigned to the user, the unaccepted open tasks of the user's active teams, and the user's tasks closed in the last 7 days, and `knownTaskIds` is capped at 100 (to keep the sync URL short). If a user ever holds more tasks, move tasks to a change cursor on `(updated_at, id)` (the `tasks_sync_idx` index is already there).
- **Client-id primary-key collisions answer `500`.** A concurrent create with the same task id (two requests in parallel) and a cross-tenant collision on a client-chosen id both reach `tasks_pkey` and fail with `500` instead of a replay or a `409`. The retry of the first returns the stored task. Map `tasks_pkey` (a replay within the tenant, `409` across tenants) if it shows up in logs.
- **Confirm and register replays answer differently for a non-uploader.** Confirming a medium someone else uploaded answers `403`, while registering the same medium id again answers `404`. An ex-manager replaying an instruction-medium registration still gets a `PUT` URL for a medium that is still pending (harmless). Align the codes if clients ever branch on them.
- **Rare create-from-problem race.** A late answers sync on a partial run and a create-from-problem for the same problem can collide on the `RESTRICT` foreign key and answer `500`; the retry succeeds. Serialise the two paths on the problem if it shows up in logs.
- **Evidence rules edited after media registration are not re-applied at submit.** If a manager changes a task's evidence rules after media was registered, the new rules are not applied to that media when the submission is made. Re-check at submit if that matters.
- **Instruction media** can be added but not removed after creation (no `DELETE` on `task_media`). Add an `archived_at` column if managers ask to remove a wrong photo.
- **Media retention per subscription plan** (NFR-10.03) → sub-project 9. `task-media.cleanup` only removes never-uploaded objects.

## Deferred from task reviews

Small items noticed while reviewing each piece of the tasks API and left for later.

### Tests

- Request-schema tests could cover more combinations of evidence, review and list-query settings.
- The database test for the tasks migration could also assert: the backfill start index is found, replaying it is harmless and bumps `roles.version`, the `taskop_platform` grants, and `WITH CHECK` on the other tables.
- Missing coverage on reading and listing:
  - media attached to another execution
  - paging a resolved list with a cursor
  - paging when two rows share the same cursor value
  - widening a filter beyond the caller's scope
- Missing coverage on creating and assigning:
  - a partial-run create
  - a user without `assignments.view`
  - a concurrent create that reaches the unique constraint rather than the pre-check
  - the replay not emitting `task.assigned` again
- Missing coverage on accepting and starting:
  - a concurrent accept does not check that the loser gets `TASK_ALREADY_TAKEN`
  - starting a team task nobody accepted
  - a member of an inactive team
  - a replay carrying a future time
- Missing coverage on media registration: manage permission returning 404, the photo cap, a team member registering before anyone accepted, and instruction media counted only while non-pending.
- Missing coverage on submitting: media captured by someone else, media already linked, more than 3 videos, the video key, a replay by an unrelated caller, a foreign submission id, and no extra event on a replay.
- Missing coverage on edits and reassignment:
  - both team-reassign branches
  - review settings changed by a non-manager creator
  - cancelling from awaiting review
  - resending the same site
  - resends for a deactivated team or an out-of-scope site
- Missing coverage on the due-date sweep and deactivation: the locked-row test only counts rows and does not assert that no history row is written, there is no two-tenant sweep test, and there is no negative test for setting sites on an active user.
- Missing coverage on sync: a cancelled task inside the 7-day window.
- Missing coverage on problem media: a pending problem medium, problem media on an ad-hoc task, and the URL of a purged medium.
- Missing coverage on tenant isolation: a foreign `problemId` on create, a foreign assignee or site on PATCH, no positive control in the 404 loop, and reading a task at a child site.
- Housekeeping: import order in `i18n.test.ts`, the web client test records method and URL but not request bodies, and a repeated `DAY` constant in tests.

### API behaviour

- A `media` list on a problem can be shorter than `mediaIds`; apps must not assume the two are the same length.
- A reassigned task keeps its old `submittedAt`, which the web and phone screens should keep in mind.
- When one edit request both changes other fields and reassigns the task, the `task.updated` audit entry's after-view also shows the assignee and status change that `task.reassigned` already records.
- Pending media counts as evidence on submit (by design); the evidence message key is built from a template instead of the typed issue codes that already exist in contracts.
- `knownTaskIds` in `/me/sync` can echo a duplicated id twice in `removedTaskIds`.
- Possible refactors: a shared upload-ticket helper for the small media-service mirrors (ticket, uploaded replay literal, MIME check), one helper for the revision-bump update that is repeated six times, and reusing the team-member predicate in `isActiveTeamMember`.

### Infra and housekeeping

- `seaweedfs-init` restarts `on-failure` without a limit; use `on-failure:20`.
- The media purge helper types its parent column loosely.
- The tasks index predicate behind `tasks_due_idx` must be kept in step with the list of final statuses (a comment should say so).
- Prettier is not enforced across the repository.
- A `MaxListenersExceededWarning` appears in some test runs; it predates the tasks code (it comes from `http.Server`).
