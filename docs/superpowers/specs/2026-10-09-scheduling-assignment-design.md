# Taskop — Sub-project 3: Scheduling & Assignment — Design Spec

- **Date:** 2026-10-09
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf` — FR-03.04, FR-06.03 (the parts not covered by sub-project 2), FR-09.01–10, FR-11.01–02
- **Builds on:** `docs/superpowers/specs/2026-10-07-foundation-design.md` (tenancy, RLS, roles, scopes, audit) and `docs/superpowers/specs/2026-10-08-checklist-builder-design.md` (checklists, versions)

## 1. Context and decisions

Sub-project 2 defined **what** gets inspected. Sub-project 3 defines **where, by whom and when**. An **assignment** binds a published checklist to one site, a set of named users and a schedule. A background job turns assignments into concrete **occurrences** ("Opening checklist, Baku branch 1, Tue 08:00–10:00, for Aysel and Murad"), which sub-project 4 executes on mobile. Shift templates and rosters say who works when, and they gate who may start a shift-bound occurrence.

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| Shifts | **Shift templates + dated rosters.** The tenant defines shifts (e.g. Səhər 08:00–16:00). Users are rostered per shift, site and date. No clock-in; attendance stays in sub-project 9. |
| Occurrences | **Sub-project 3 creates them.** A background job materialises occurrences 14 days ahead. SP3 owns the statuses `pending`, `overdue`, `missed`, `cancelled` and the status history. SP4 adds start/complete, the claim lock and offline. |
| Assignees | **Specific named users only.** Team, job-title and site targeting (rest of FR-09.07) are deferred. |
| Shift role | **Timing + on-shift gate.** A shift-bound assignment takes its window from the shift, and only assignees rostered on that shift that day are eligible to start (FR-09.09/10). SP3 provides the check; SP4 enforces it at start. |
| Sites | **One site per assignment.** "Copy to other sites" duplicates it. |
| Recurrence | **Structured presets + exceptions:** once, daily, weekly on weekdays, monthly (day of month or nth weekday), explicit dates; plus skip dates and an optional end date. Not RRULE. |
| Overdue vs missed | **Start, due and close times.** After due → `overdue`, still startable (late). After close (due + grace) → `missed`, locked. Start → close ≤ 24h unless allowed (FR-09.05/06). |
| Jobs | **pg-boss** (Postgres-backed queue, no new infrastructure). Reused by sub-project 6 for notifications. |
| Timezone | All local times are in the **tenant timezone** (`tenants.timezone`). Sites have no timezone of their own. |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A user with `shifts.manage` can define shift templates and fill a weekly roster per site, with "copy week" and "repeat for N weeks" helpers.
2. A user with `assignments.manage` can assign an active, published checklist to one site and one or more users who belong to that site, with a recurrence and either fixed timing or shift timing, and see a live preview of upcoming slots before saving.
3. Occurrences are generated automatically 14 days ahead, and move to `overdue` and `missed` on time, with every status change recorded in history (FR-11.02).
4. Assignments can be edited, paused, resumed and ended without disturbing occurrences already open; single occurrences can be cancelled with a reason.
5. Managers see and manage only assignments, occurrences and rosters at their sites (data scope applies).
6. Any user can list their own occurrences through `GET /me/occurrences`, and SP4 has a `canStart(occurrence, user, at)` check that it can call unchanged.
7. Recurrence expansion, validation and the az summary are pure functions in `packages/contracts`, shared by the API and web.

**Non-goals:**

- Starting, answering, completing and the "first to start locks the others" claim (FR-09.11/12) — sub-project 4
- Any mobile app changes — sub-project 4 builds the worker list on `/me/occurrences`
- Notifications, reminders and overdue alerts (FR-15.x) — sub-project 6. SP3 only emits an internal domain event.
- Team, job-title or whole-site assignee targeting (rest of FR-09.07)
- Clock-in/out, attendance, shift swaps or approvals — sub-project 9
- Per-site timezones; RRULE import/export; calendar (month-grid) views of occurrences

## 3. Shared scheduling logic (`packages/contracts`)

Defined with Zod in `packages/contracts/src/scheduling.ts`. Time-zone maths uses small `Intl`-based helpers in `packages/contracts/src/scheduling-time.ts`; no extra dependency.

### 3.1 Recurrence

```
Recurrence (discriminated union on `kind`)
  range fields (daily, weekly, monthly only):
    startDate: LocalDate                 'YYYY-MM-DD', first day the rule applies
    endDate: LocalDate | null            inclusive
    skipDates: LocalDate[]               ≤ 366, e.g. public holidays
  kinds:
    once      { date: LocalDate }        no range fields
    daily     { every: 1–365 }           every N days counted from startDate
    weekly    { every: 1–52, weekdays: (1–7)[] }   ISO weekdays, ≥ 1; every N weeks counted from the ISO week of startDate
    monthly   { every: 1–12, by: { dayOfMonth: 1–31 } | { nth: 1|2|3|4|-1, weekday: 1–7 } }
    dates     { dates: LocalDate[] }     1–366 explicit dates ("custom calendar"); no range fields
```

- `monthly` with `dayOfMonth` greater than the month's length falls on the month's last day. `nth: -1` means the last such weekday.
- Skip dates outside `[startDate, endDate]` are allowed but reported as a preview warning.

### 3.2 Timing

```
Timing (discriminated union on `mode`)
  fixed   { startTime: LocalTime 'HH:mm', dueAfterMinutes: 1–10080, graceMinutes: 0–10080 }
  shift   { shiftId: uuid, graceMinutes: 0–10080 }
```

For a slot on local date `d`:

- **fixed:** `startsAt = d + startTime`, `dueAt = startsAt + dueAfterMinutes`, `closesAt = dueAt + graceMinutes`.
- **shift:** `startsAt = d + shift.start_time`, `dueAt = d + shift.end_time` (next day when `end_time ≤ start_time`), `closesAt = dueAt + graceMinutes`.
- **Window cap:** `closesAt − startsAt ≤ 24h` unless the actor has `assignments.extended_window`, in which case ≤ 7 days (FR-09.05/06). Checked on save, not per slot.
- **DST:** local times are converted in the tenant timezone. A local time that does not exist (spring forward) is read with the offset in force before the gap, so it moves forward by the gap length (02:30 → 03:30), as RFC 5545 does; an ambiguous one (fall back) takes the earlier instant. Durations are added in absolute time.

### 3.3 Functions

- **`expandSchedule(recurrence, timing, shift | null, tz, fromDate, toDate)`** returns slots `{ localDate, startsAt, dueAt, closesAt }` (UTC instants) for local dates in the inclusive range, in order, skipping `skipDates`.
- **`validateSchedule(recurrence, timing)`** returns `issues: { path, code }[]` (codes are i18n keys, as in SP2). Covers ranges, `endDate ≥ startDate`, empty weekday lists, duplicate dates.
- **`describeSchedule(recurrence, timing, shiftName | null, t)`** returns a short summary, e.g. "Hər B.e., Ç. 08:00–10:00" or "Hər ayın son Cümə günü, Səhər növbəsi". `t` is the caller's translate function, so contracts stays free of strings; only the web calls it.

## 4. Data model

The Foundation rules apply: UUIDv7 IDs, `timestamptz` in UTC, `tenant_id` with an index that starts with it, RLS with `FORCE ROW LEVEL SECURITY`, composite FKs including `tenant_id`, nothing hard-deleted except join and roster rows.

### 4.1 Tables

**`shifts`**
- `id`, `tenant_id`, `name` (≤ 100)
- `start_time time`, `end_time time` (local; `end_time ≤ start_time` means the shift ends the next day; equal values are rejected)
- `site_id?` → `sites`: null means usable at every site
- `active bool`, `created_at`, `updated_at`

**`shift_roster`**
- `tenant_id`, `user_id`, `shift_id`, `site_id`, `date date` (local date the shift starts)
- Primary key `(user_id, shift_id, site_id, date)`; index `(tenant_id, site_id, date)`
- Insert rules: the user is active and linked to the site (`user_sites`); the shift is active and usable at the site.

**`assignments`**
- `id`, `tenant_id`, `checklist_id` → `checklists`, `site_id` → `sites`
- `name?` (≤ 200; the UI falls back to the checklist name)
- `schedule jsonb` (`Recurrence`), `timing jsonb` (`Timing`)
- `shift_id?`: denormalised from `timing.shiftId` for FKs and queries
- `status`: `active` | `paused` | `ended`
- `revision int not null default 1`
- `materialized_until timestamptz?`: every slot starting at or before this instant has already been considered; null until the first run
- `created_by_user_id?` / `created_by_platform_admin_id?` (exactly one, as in SP2), `created_at`, `updated_at`

**`assignment_assignees`**: `tenant_id`, `assignment_id`, `user_id`; primary key `(assignment_id, user_id)`. 1–50 users per assignment.

**`occurrences`**
- `id`, `tenant_id`, `assignment_id`, `checklist_id`, `site_id`, `shift_id?` (copied from the assignment)
- `local_date date`, `starts_at`, `due_at`, `closes_at`
- `status occurrence_status`, `status_changed_at`
- `cancel_reason?` (≤ 500)
- `created_at`, `updated_at`
- partial unique index `(assignment_id, local_date) where status <> 'cancelled'`: at most one live occurrence per assignment per day, so an edit at 08:30 that moves today's slot to 09:00 does not create a second one beside the open 08:00 occurrence, and a cancelled slot never blocks a regenerated one; indexes `(tenant_id, site_id, starts_at)`, `(tenant_id, status, due_at)`, `(tenant_id, status, closes_at)`
- No checklist version is pinned. SP4 uses `checklists.current_version_id` at start (SP2 §4.4).

**`occurrence_status`** pg enum and contracts enum, with the full FR-11.01 list so SP4 needs no enum migration: `pending`, `started`, `in_progress`, `completed`, `partial`, `overdue`, `missed`, `cancelled`, `audit_pending`, `audited`. SP3 only sets `pending`, `overdue`, `missed` and `cancelled`.

**`occurrence_assignees`**: `tenant_id`, `occurrence_id`, `user_id`; primary key `(occurrence_id, user_id)`; index `(tenant_id, user_id)`. The snapshot of eligible users (§5.1).

**`occurrence_status_history`** (append-only)
- `id`, `tenant_id`, `occurrence_id`, `from_status?` (null on creation), `to_status`, `at`
- `actor_user_id?`, `actor_platform_admin_id?` (both null = system), `reason?`
- `taskop_app` gets `INSERT, SELECT` only, like `audit_log`.

### 4.2 Integrity rules (enforced by the service, inside the tenant transaction)

- An assignment can be created or resumed only when its checklist is `active` and has a `current_version_id`.
- Its site is active and within the actor's scope.
- Every assignee is active and linked to the site through `user_sites`.
- A shift-timed assignment's shift is active and usable at the site.
- `ended` is final.

### 4.3 Migration

Adds the tables, enums, RLS policies, grants, the pg-boss schema bootstrap (`pgboss`, owned by the migration account; `taskop_app` gets the grants pg-boss needs), and the new permission keys for existing Owner and Admin roles (§6).

## 5. Lifecycle and jobs

pg-boss runs inside the API process. Jobs act per tenant through a **system principal**: they set `app.tenant_id` for each tenant's transaction, so RLS still applies. One tenant per transaction; a failure in one tenant doesn't block the others. Time comes from an injectable `Clock` service.

### 5.1 `occurrences.materialize` (cron every 15 min, singleton)

- For every `active` assignment, expand the schedule up to today + 14 days (tenant local) and insert the slots that start after `materialized_until` and close after now, with `ON CONFLICT DO NOTHING` on the partial unique index, status `pending`, with a creation history row. On the first run (`materialized_until` null) slots whose window is already open are included, so an assignment created at 09:00 still gets today's 08:00–10:00 slot.
- Slots whose `closesAt` is already past are not created.
- **Assignee snapshot** for each new occurrence:
  - fixed timing: all assignees still active and linked to the site
  - shift timing: those assignees who are rostered on the assignment's shift, site and `local_date`
- **Snapshot refresh:** while an occurrence is `pending` and `starts_at > now`, its snapshot is recomputed when the roster for that site and date changes, when the assignment's assignees change, or when a user is deactivated or unlinked from the site. Once the window opens, the snapshot is fixed.
- Sets `materialized_until` to the start of day today + 15. A slot is therefore considered once: a cancelled occurrence is never recreated by a later run.
- Create, edit and resume materialise that one assignment **inline, in the request transaction** (at most 14 days of slots), so the response already reflects the result. Edit and resume first set `materialized_until = now`, so only future slots are generated.

### 5.2 `occurrences.sweep` (cron every minute, singleton)

- `pending → overdue` where `due_at ≤ now < closes_at`.
- `pending | overdue → missed` where `closes_at ≤ now`. When an occurrence jumps straight from `pending` (e.g. the server was down), two history rows are written (`pending → overdue` at `due_at`, `overdue → missed` at `closes_at`).
- Each update is guarded by the current status (`UPDATE … WHERE status = …`) and writes history in the same transaction, so running twice is harmless.
- Emits an in-process domain event `occurrence.status_changed { tenantId, occurrenceId, from, to, at }` through a small `DomainEvents` service in `common/`. SP3 registers no listeners for it; SP6 will. The same service carries `user.access_changed` (users module) and `checklist.deactivated` (checklists module) to the scheduling module, so neither depends on it.

### 5.3 Changing assignments and occurrences

- **Edit** (`PUT` with `revision`): occurrences that are `pending` with `starts_at > now` are cancelled with reason `assignment_edited`, then the assignment is re-materialised. Changing a shift's hours does the same for every active assignment that uses the shift (reason `shift_changed`). Occurrences whose window has already opened are untouched. Changing only `name` regenerates nothing; changing only assignees refreshes snapshots instead of regenerating.
- **Pause:** cancels future pending occurrences (reason `assignment_paused`). **Resume:** re-checks §4.2 and materialises from now. **End:** like pause, but final.
- **Checklist deactivated (SP2):** in the same transaction, its active assignments are paused and their future pending occurrences cancelled (reason `checklist_deactivated`). Reactivating the checklist does not resume them automatically.
- **Cancel one occurrence:** `pending | overdue → cancelled`, reason required, history + audit entry.
- **User deactivated or removed from a site:** removed from snapshots of future pending occurrences and from roster rows from today on. Occurrences left with an empty snapshot are not cancelled; the API reports them as `unassigned: true` (computed) so managers can act.

### 5.4 `canStart(occurrenceId, userId, at)`

A service method exported for SP4. Returns `{ ok: true }` or `{ ok: false, reason }`:

| Reason | When |
|---|---|
| `NOT_ASSIGNED` | user not in the snapshot |
| `NOT_STARTABLE` | status not `pending` or `overdue` |
| `NOT_YET_OPEN` | `at < starts_at` |
| `CLOSED` | `at ≥ closes_at` |
| `NOT_ON_SHIFT` | shift timing and no roster row for that user, shift, site and `local_date` |

`late: true` is returned with `ok` when `at ≥ due_at`.

## 6. Permissions and scope

New keys in `PERMISSION_GROUPS`:

| Group | Key | Allows |
|---|---|---|
| assignments | `assignments.view` | List and read assignments, occurrences and their history |
| assignments | `assignments.manage` | Create, edit, pause, resume, end assignments; preview; cancel occurrences |
| assignments | `assignments.extended_window` | Save windows longer than 24h (FR-09.06) |
| shifts | `shifts.view` | View shift templates and rosters |
| shifts | `shifts.manage` | Edit shift templates and rosters |

Built-in role defaults (new tenants via `SYSTEM_ROLE_DEFAULTS`; existing tenants get them by migration for Owner and Admin only):

| Role | Keys |
|---|---|
| Owner | all |
| Admin | all five |
| Manager | `assignments.view`, `assignments.manage`, `shifts.view`, `shifts.manage` |
| Auditor | `assignments.view`, `shifts.view` |
| Worker | none |

Mutating routes also require the matching `view` key. `assignments.manage` also requires `checklists.view` (to pick a checklist).

**Data scope** (Foundation §4.4) applies to assignments, occurrences and roster rows:

- `all`: no filter.
- `site_subtree`: rows whose `site_id` is in the actor's site subtrees. A manager can only pick sites and users within that subtree.
- `subordinates`: occurrences whose snapshot includes the actor or someone below them; assignments with such an assignee; their roster rows. Read-only in practice, since writes also need the site to be in scope, which `subordinates` cannot prove; writes are refused with `SITE_OUT_OF_SCOPE`.
- `own`: the actor's own occurrences, assignments and roster rows.

Shift templates are tenant-wide and not filtered by scope.

## 7. API

All endpoints are under `/api/v1` and follow the Foundation conventions (Zod contracts, OpenAPI, cursor pagination, error format, tenant transaction).

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /shifts` | shifts.view | Filters: `active`, `siteId` (includes tenant-wide shifts) |
| `POST /shifts`, `PATCH /shifts/:id` | shifts.manage | Deactivate via `active: false`; deactivating pauses nothing but blocks new roster rows and new shift-timed assignments |
| `GET /roster?siteId&from&to` | shifts.view | Range ≤ 62 days. Returns users at the site, shifts usable there, and rows |
| `PUT /roster` | shifts.manage | `{ siteId, from, to, rows[] }` replaces all rows for that site and range |
| `POST /roster/copy` | shifts.manage | `{ siteId, sourceWeekStart, targetWeekStarts[] (≤ 12) }` replaces target weeks with the source week |
| `GET /assignments` | assignments.view | Filters: `siteId`, `checklistId`, `status`, `assigneeId`, `q` |
| `GET /assignments/:id` | assignments.view | Includes assignees and the next 5 occurrences; the web renders the summary with `describeSchedule` |
| `POST /assignments` | assignments.manage | Validates §3, §4.2, window cap |
| `PUT /assignments/:id` | assignments.manage | `{ revision, name?, assigneeIds?, schedule?, timing? }`; stale → 409. Checklist and site are fixed after creation (use "Copy to other sites") |
| `POST /assignments/:id/pause` · `/resume` · `/end` | assignments.manage | |
| `POST /assignments/preview` | assignments.manage | `{ siteId, schedule, timing, assigneeIds? }`; returns the next 20 slots and warnings; saves nothing |
| `GET /occurrences` | assignments.view | Filters: `from`, `to` (≤ 62 days), `siteId`, `status[]`, `assigneeId`, `checklistId`, `assignmentId`; rows include `unassigned` |
| `GET /occurrences/:id` | assignments.view | Includes snapshot users and status history |
| `POST /occurrences/:id/cancel` | assignments.manage | `{ reason }` |
| `GET /me/occurrences?from&to&status[]` | none (authenticated) | Occurrences whose snapshot includes the caller |

**Audit log** (Foundation): shift create/update, roster replace and copy (summary: site, range, row counts), assignment create/update/pause/resume/end, occurrence cancel, and auto-pauses caused by checklist deactivation. Automatic status changes go only to `occurrence_status_history`.

**Platform admins** acting inside a tenant (SP2 §6) can use these endpoints too, with platform-admin attribution in the audit log and creator fields.

### 7.1 Error codes

All codes are i18n keys.

- Assigning:
  - `CHECKLIST_DEACTIVATED`
  - `CHECKLIST_NOT_PUBLISHED`
  - `SITE_INACTIVE`
  - `SITE_OUT_OF_SCOPE`
  - `ASSIGNEE_INACTIVE` and `ASSIGNEE_NOT_AT_SITE`, each with `userIds`
- Timing:
  - `SHIFT_INACTIVE`
  - `SHIFT_NOT_AT_SITE`
  - `WINDOW_TOO_LONG` (over 24h without `assignments.extended_window`)
  - `WINDOW_INVALID` (over 7 days)
  - `SCHEDULE_INVALID` with `issues[]`
  - `SCHEDULE_EMPTY` (no slot in the next 366 days)
- State changes:
  - `REVISION_CONFLICT` (409)
  - `ASSIGNMENT_ENDED`
  - `OCCURRENCE_NOT_CANCELLABLE`
- Roster:
  - `ROSTER_USER_NOT_AT_SITE`
  - `ROSTER_RANGE_TOO_LONG`

**Preview warnings** (they don't block saving): `NO_ROSTERED_ASSIGNEES` (shift timing, nobody rostered in the next 14 days); `SKIP_DATE_OUT_OF_RANGE`.

### 7.2 Job failures

pg-boss retries 3 times with exponential backoff, then moves the job to its dead-letter queue, which is logged with pino at error level. Both jobs are idempotent, so a missed tick catches up on the next run.

## 8. Web app

New routes in the tenant app, shown according to permissions:

1. **Shifts:** list plus a create/edit dialog (name, start, end with a "next day" hint, optional site, active).
2. **Roster:** one site and one week at a time. A grid with a row per user at the site and a column per day; each cell is a multi-select of shifts. Save sends `PUT /roster` for the week. Toolbar: previous/next week, "Copy this week to…" (pick up to 12 following weeks).
3. **Assignments:**
   - A list with filters and status badges.
   - An editor with these steps:
     1. checklist (active and published only)
     2. site (within scope)
     3. users (filtered to the site)
     4. schedule builder (preset tabs, weekday toggles, monthly options, date picker for explicit dates, skip-dates calendar, end date)
     5. timing (fixed: start time, due-after, grace; or shift: shift picker, grace)
   - A live preview panel (debounced `POST /assignments/preview`) shows the summary, the next 20 slots and warnings.
   - Actions: pause, resume, end; "Copy to other sites" opens the editor pre-filled with the site and users cleared.
4. **Schedule:** a day/week list of occurrences grouped by day, with status badges, `unassigned` highlighting and filters. A detail drawer shows the snapshot users, the history timeline and a Cancel action (reason required).
5. **Checklist detail (SP2):** new "Assignments" tab listing its assignments, and an "Assign" button that opens the editor with the checklist preselected.

Dates and times are shown in the tenant timezone with `Intl`; all strings are az i18n keys.

## 9. Testing

- **Contracts (Vitest, table-driven):**
  - `expandSchedule` for each kind of schedule
  - every N days and every N weeks
  - nth weekday and last weekday of the month
  - `dayOfMonth: 31` in short months
  - skip dates, end dates and `once`
  - shift timing that crosses midnight
  - DST gaps and overlaps in `Europe/Berlin` and `America/New_York`, plus `Asia/Baku`
  - `validateSchedule` issue paths and codes
  - `describeSchedule` output
- **API integration (Vitest + Testcontainers):**
  - Materialize:
    - idempotent when run twice
    - the 14-day horizon and `materialized_until`
    - no slots created whose window is already closed
    - fixed vs shift snapshots
    - snapshot refreshed after a roster edit before start, and frozen after start
  - Sweep (driven by `Clock`):
    - `pending → overdue → missed`
    - the direct pending → missed jump with two history rows
    - running twice is harmless
  - Edits:
    - future pending occurrences are cancelled and regenerated, while open ones are untouched
    - name-only and assignee-only edits
    - pause, resume and end
    - a stale revision returns 409
  - Checklist deactivation pauses its assignments.
  - User deactivation leaves `unassigned` occurrences.
  - The 24h cap with and without `assignments.extended_window`; the 7-day hard cap.
  - `canStart`: every reason code, and `late`.
  - Roster replace and copy; rejects users not at the site.
  - **Tenant isolation suite** extended to every new endpoint. **Scope suite:** a `site_subtree` manager sees and writes only their sites; `own` sees only their own; `/me/occurrences` returns only the caller's.
  - `UPDATE`/`DELETE` on `occurrence_status_history` fails for `taskop_app`.
- **Web (Vitest + Testing Library):**
  - schedule builder (UI → `Recurrence` JSON → summary)
  - roster grid editing and copy dialog
  - assignment editor validation and error mapping
- **Playwright end-to-end test:**
  1. create a shift
  2. roster two workers
  3. assign a published checklist with shift timing
  4. check the preview
  5. save
  6. see the occurrences in the schedule view

## 10. Requirement traceability

| Requirement | Where |
|---|---|
| FR-03.04 | Assignments and occurrences bind checklists to a site (§4) |
| FR-06.03 | Site, assignees, start/end, recurrence (§3, §4); rest done in SP2 |
| FR-09.01 | `once` recurrence, fixed timing (§3) |
| FR-09.02 | Timing: start, due, grace (§3.2) |
| FR-09.03 | Daily, weekly/weekdays, monthly, explicit dates, skip dates (§3.1) |
| FR-09.04 | Shift timing (§3.2, §4.1) |
| FR-09.05 / 09.06 | 24h window cap; `assignments.extended_window` up to 7 days (§3.2, §6) |
| FR-09.07 | Specific users only; team, job title and site targeting deferred |
| FR-09.08 | Multiple assignees per assignment and occurrence (§4.1) |
| FR-09.09 / 09.10 | Roster-based snapshot and `canStart` `NOT_ON_SHIFT` (§5.1, §5.4); enforced at start in SP4 |
| FR-09.11 / 09.12 | Deferred to SP4 (claim lock, actual executor) |
| FR-11.01 | Full status enum; SP3 sets pending, overdue, missed, cancelled (§4.1, §5.2) |
| FR-11.02 | `occurrence_status_history` (§4.1) |

## 11. Open items for later sub-projects

- SP4: claim lock on start (FR-09.11), recording the executor (FR-09.12), enforcing `canStart`, mobile list built on `/me/occurrences`, and offline handling of occurrences whose window closes while the device is offline.
- SP6: listeners for `occurrence.status_changed` (overdue alerts, FR-15.05/06), reminders before `due_at` (FR-15.04), "new checklist assigned" push (FR-15.02) — these will use pg-boss.
- Team, job-title and whole-site assignee targeting (rest of FR-09.07), if customers ask for it.
- Per-site timezones, if a tenant operates across timezones.
