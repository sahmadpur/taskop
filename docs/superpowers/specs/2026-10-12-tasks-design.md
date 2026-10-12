# Taskop — Sub-project 5: Tasks — Design Spec

- **Date:** 2026-10-12
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf` — FR-14.01–10, FR-13.07–09, FR-03.04 (tasks), FR-05.04 (task management right), FR-12.01–02 (task evidence), FR-25.01 (own tasks on mobile), FR-26.02 (task audit), FR-04.11
- **Builds on:** `2026-10-07-foundation-design.md` (tenancy, RLS, roles, data scopes, teams), `2026-10-09-scheduling-assignment-design.md` (`JobsService`, `DomainEvents`, per-tenant sweep), `2026-10-09-mobile-execution-design.md` (offline SQLite + outbox, media flow, refusal classification, `execution_problems`)

## 1. Context and decisions

Sub-projects 3 and 4 cover recurring checklist work. Sub-project 5 adds **tasks**: one-off jobs a manager hands to a person or a team ("Repair the fridge door by Friday"), with instructions, a due date and a text/photo/video response. The same model closes the loop on checklist problems: a manager turns a problem into a task with an owner and a fix-by date, and the problem counts as resolved when its task is done (FR-13.07–09).

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| Purpose | **Ad-hoc tasks and problem fixes equally**, one task model for both. |
| Architecture | **A separate Tasks module** with its own tables, API and pages (NFR-15.02). Checklist code is untouched except the phone's outbox, which is generalised from "execution" to "entity type + id". |
| Group tasks (FR-14.03) | **First to accept owns it.** Every member of the team sees the task; the first accept to reach the server sets the assignee and it disappears for the others. Same rule as checklist claiming. |
| Offline | **Fully offline execution.** Accept, start, respond with text/photo/video and complete work without a connection and sync later. **Creating and reviewing tasks need a connection** (people pickers and scope checks are server-side). |
| Completion | **Optional review per task.** The creator sets `requires_review`; such tasks go to `awaiting_review` and are approved or sent back with a comment. Tasks created from problems default to `requires_review = true`. |
| Problem → task | **Manual.** A manager creates a task from a problem, pre-filled from it; only once the problem's run is closed (its row is frozen). One task per problem. |
| Who creates | Holders of the new **`tasks.manage`** permission (owner, admin, manager by default), on web and phone, for people and teams within their data scope. Workers cannot create tasks. |
| Overdue | **A flag, not a status.** `overdue_at` is set by a sweep, so a task can be both overdue and in progress. The FR-14.09 "Gecikib" status is shown as a badge and filter. |
| Notifications | **Out of scope** (SP6). SP5 emits the domain events SP6 will listen to (FR-14.10, FR-15.03). |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A `tasks.manage` holder creates a task on the web or phone with title, instructions, instruction photos/videos, priority, optional site, optional due date and time, evidence rules and a review toggle, assigned to a user or a team within their scope (FR-14.01–05, FR-03.04).
2. A worker sees their tasks and their teams' unaccepted tasks on the phone, accepts, starts, responds with text, photos and videos (live-only when required) and completes them, online or offline (FR-14.06–08, FR-12.01–02, FR-25.01).
3. Statuses `new`, `accepted`, `in_progress`, `awaiting_review`, `completed`, `cancelled` and the overdue flag are tracked with history rows (FR-14.09).
4. Tasks that need review are approved or sent back by the creator or a `tasks.manage` holder in scope; every submission is kept (FR-14.10 groundwork).
5. A manager creates a task from a closed run's problem; the problem shows its resolution (none / open / resolved / cancelled) on the web (FR-13.07–09).
6. Managers list, filter, edit, reassign and cancel tasks on the web; creating, cancelling, reassigning and reviewing are audited (FR-26.02).
7. Domain events for task lifecycle changes exist for SP6.

**Non-goals:**

- Push/email notifications (SP6); task reports and dashboards (SP7)
- Recurring tasks, task templates, comment threads, checklists inside tasks
- Creating or reviewing tasks offline
- Workers creating tasks or handing tasks to each other
- Automatic problem → task conversion
- Retention policies per plan (SP9)

## 3. Statuses

```
new ──accept──▶ accepted ──start──▶ in_progress ──submit──▶ completed                (requires_review = false)
                                        │    ▲
                                        │    └──reject── awaiting_review ──approve──▶ completed
                                        └──submit (requires_review = true)──▶ awaiting_review
new / accepted / in_progress / awaiting_review ──cancel──▶ cancelled
```

| Status | Meaning |
|---|---|
| `new` | Assigned, not yet accepted. For a team task, `assignee_user_id` is null. |
| `accepted` | The assignee accepted it (FR-14.09 "Qəbul edilib"). |
| `in_progress` | Started (FR-14.09 "İcradadır"). Also the status after a rejection. |
| `awaiting_review` | Submitted, waiting for approval. |
| `completed` | Final. Submitted without review, or approved. |
| `cancelled` | Final. Cancelled by a manager with a reason. |

Rules:

- `start` on a `new` task accepts and starts it in one step (one tap on the phone); history gets both rows.
- **Reassigning** (editing the assignee) is allowed in any non-final status and resets the task to `new`, clearing `accepted_at`/`started_at`. Earlier submissions stay in history.
- **Overdue:** `overdue_at` is set once `now ≥ due_at` while the task is not final. It is never cleared, except when `due_at` is edited to a later time, which clears it. Completing a task does not clear it, so "completed late" stays visible.
- Final statuses are `completed` and `cancelled`; nothing leaves them.
- The transition table is a pure function in contracts (§4), shared by phone and API.

## 4. Shared contracts (`packages/contracts/src/tasks.ts`)

- `TASK_STATUSES`, `TASK_PRIORITIES` (`normal`, `high`), `TASK_ACTIONS` (`accept`, `start`, `submit`, `approve`, `reject`, `cancel`, `reassign`).
- `taskEvidenceSchema`: `{ photo: 'none' | 'optional' | 'required', video: 'none' | 'optional' | 'required', liveOnly: boolean }`. Default `{ photo: 'optional', video: 'optional', liveOnly: false }`.
- `TASK_LIMITS`: title 1–200, instructions ≤ 5,000, submission text ≤ 5,000, cancel reason and review comment ≤ 1,000, instruction media ≤ 5, response photos ≤ 10 and videos ≤ 3 per submission. File size, type and resize limits reuse `MEDIA_LIMITS`.
- **`taskTransition(status, action, { requiresReview })`** → next status, or `null` if refused. Pure.
- **`taskEvidenceMet(evidence, media)`** → `{ ok: true } | { ok: false, missing: ('photo' | 'video')[] }`. Pure.
- `createTaskSchema`, `updateTaskSchema`, `cancelTaskSchema`, `reviewTaskSchema`, `submissionSchema`, `taskMediaRegisterSchema`, `taskListQuerySchema`, and response shapes (`TaskSummary`, `TaskDetail`).
- `taskAssigneeSchema`: `{ userId } | { teamId }` (exactly one).
- `PROBLEM_RESOLUTIONS`: `none`, `open`, `resolved`, `cancelled`.
- Error codes added to the shared error list: `TASK_ALREADY_TAKEN`, `TASK_STATE_INVALID`, `TASK_ASSIGNEE_INVALID`, `PROBLEM_NOT_CLOSED`, `PROBLEM_ALREADY_HAS_TASK`, `EVIDENCE_REQUIRED`.
- `permissions.ts`: `tasks.view`, `tasks.manage` in a new "Tasks" group. `SYSTEM_ROLE_DEFAULTS`: owner (all), admin and manager get both, auditor gets `tasks.view`, worker none.

## 5. Data model

Migrations `0009_tasks.sql` (tables, enums) and `0010_tasks_security.sql` (RLS `tenant_isolation` policies and grants), following the existing split.

**`tasks`**

- `id` (client-generated UUIDv7), `tenant_id`
- `title`, `instructions`, `priority` (`task_priority` enum)
- `site_id` (nullable FK `sites`)
- `created_by_user_id`
- `assignee_user_id` (nullable), `assignee_team_id` (nullable). Check: at least one is set. A team task has both once a member accepts.
- `requires_review` (bool), `evidence` (jsonb, `taskEvidenceSchema`)
- `due_at` (nullable timestamptz), `overdue_at` (nullable)
- `problem_id` (nullable FK `execution_problems`, `ON DELETE RESTRICT`, **unique**). Only problems of `completed`/`partial` executions are linked, and those rows are frozen.
- `status` (`task_status` enum), `rev` (int, bumped on every change)
- `accepted_at`, `started_at`, `submitted_at`, `completed_at`, `cancelled_at` (device time for worker actions, server time for manager actions), `cancel_reason`
- `created_at`, `updated_at`
- Indexes: `(tenant_id, status)`, `(tenant_id, assignee_user_id)`, `(tenant_id, assignee_team_id) WHERE assignee_user_id IS NULL`, `(tenant_id, site_id)`, `(tenant_id, due_at) WHERE status NOT IN ('completed','cancelled')`, `(tenant_id, updated_at, id)` for sync.

**`task_submissions`**

- `id` (client-generated), `tenant_id`, `task_id`, `submitted_by_user_id`
- `text`, `media_ids uuid[]`
- `submitted_at` (device), `received_at` (server)
- `review_decision` (nullable: `approved` | `rejected`), `review_comment`, `reviewed_by_user_id`, `reviewed_at`

**`task_media`**

- `id` (client-generated), `tenant_id`, `task_id`, `submission_id` (nullable; set when the submission that lists it is accepted)
- `role`: `instruction` | `response`
- `kind`: `photo` | `video`, `source`: `camera` | `gallery`, `mime`, `bytes`, `width?`, `height?`, `duration_ms?`
- `status`: `pending` | `uploaded` (reuses `media_status`), `storage_key` = `t/{tenant}/k/{taskId}/{id}.{ext}`
- `captured_at` (device), `captured_by_user_id`, `created_at`

**`task_status_history`** (append-only)

- `id`, `tenant_id`, `task_id`, `from_status` (nullable), `to_status`, `actor_user_id`, `at`, `comment` (nullable)

**`execution_problems`**: unchanged. Its resolution is derived from the linked task: no task → `none`; task not final → `open`; `completed` → `resolved`; `cancelled` → `cancelled`.

Grants for `taskop_app`: `SELECT, INSERT, UPDATE` on `tasks`, `task_submissions`, `task_media`; `SELECT, INSERT` on `task_status_history`; `DELETE` on `task_media` only (cleanup job).

## 6. API (`apps/api/src/tasks/`)

### 6.1 Scope (`task-scope.ts`)

`TaskScope` (built like `SchedulingScope`) gives a SQL filter and `assertCanRead`/`assertCanManage`.

A user can **read** a task if any of:

1. They created it, or are the assignee.
2. It is a team task with no assignee yet and they are an active member of the team.
3. They hold `tasks.view` and their data scope covers it:
   - `all`: every task.
   - `site_subtree`: `site_id` is in their subtree, or the assignee user is within `ScopeService.usersFilter`.
   - `subordinates`: the assignee user is in their reporting chain.
   - `own`: nothing beyond 1–2.

A user can **manage** a task if they hold `tasks.manage` and either created it or their data scope covers it as in rule 3 (`tasks.manage` counts as `tasks.view` for this). Reviewing is allowed to the creator, or to anyone who can manage the task. Unknown scopes fail closed. Anything not readable is a 404.

**Assignable** (`TASK_ASSIGNEE_INVALID` otherwise):

- A user: active, and within the actor's `ScopeService.usersFilter`.
- A team: active, with at least one active member. Teams are tenant-wide and admin-managed, so any `tasks.manage` holder may use them.
- Site membership is not required, so a technician can take tasks at any site.

### 6.2 Endpoints

| Endpoint | Who | Behaviour |
|---|---|---|
| `POST /tasks` | `tasks.manage` | Body `createTaskSchema` with client `id` (repeat with the same id and body returns the existing task). With `problemId`: the problem must be readable, its execution `completed` or `partial` (`PROBLEM_NOT_CLOSED`), and have no task (`PROBLEM_ALREADY_HAS_TASK`); `site_id` is taken from the problem. Writes history (`null → new`), audit `task.created`, emits `task.assigned`. |
| `PATCH /tasks/:id` | manage | Title, instructions, priority, site, due date, evidence, review toggle, assignee. Refused on final tasks (`TASK_STATE_INVALID`). An assignee change runs the reassign rules (§3), audit `task.reassigned`, emits `task.assigned`. Other edits audit `task.updated`. |
| `POST /tasks/:id/cancel` | manage | `{ reason }`. Audit `task.cancelled`, emits `task.cancelled`. |
| `POST /tasks/:id/review` | creator or manage | `{ decision, comment }`; comment required to reject. Only from `awaiting_review`. Updates the latest submission's review fields. Audit `task.approved` / `task.rejected`; emits `task.completed` or `task.rejected`. |
| `POST /tasks/:id/accept` | assignee, or team member while unassigned | `{ at, rev? }`. For team tasks: `UPDATE … WHERE assignee_user_id IS NULL` so the first one to reach the server wins; others get `TASK_ALREADY_TAKEN`. Repeating your own accept is a no-op. Emits `task.accepted`. |
| `POST /tasks/:id/start` | same as accept | `{ at }`. Accepts first if needed. |
| `POST /tasks/:id/submissions` | assignee | `submissionSchema` `{ id, text, mediaIds, submittedAt }`. Idempotent on `id`. Checks status (`TASK_STATE_INVALID`), that every media id is a registered `response` medium of this task, and `taskEvidenceMet` (`EVIDENCE_REQUIRED`). Links media to the submission; moves to `completed` or `awaiting_review`. Emits `task.submitted` (and `task.completed` if no review). |
| `POST /tasks/:id/media` | creator/manage (`instruction`), assignee (`response`) | Registers `pending` and returns a presigned PUT ticket, as in SP4. Checks type and size (`MEDIA_TYPE_INVALID`, `MEDIA_TOO_LARGE`), counts (`MEDIA_LIMIT_REACHED`), and `source = 'gallery'` on a live-only task's response (`EVIDENCE_LIVE_ONLY`). Idempotent on `id`. |
| `POST /task-media/:id/uploaded` | the uploader | HEADs the object and marks it `uploaded`. |
| `GET /task-media/:id/url` | anyone who can read the task | Presigned GET. |
| `GET /tasks` | `tasks.view`, or anyone for their own tasks | `taskListQuerySchema`: `status[]`, `overdue`, `siteId`, `assigneeUserId`, `teamId`, `createdBy`, `source` (`problem` \| `adhoc`), `awaitingMyReview` (status `awaiting_review` and the caller may review it), `dueFrom`/`dueTo`. Keyset cursor on `(created_at, id)`, filtered by `TaskScope`. |
| `GET /tasks/:id` | readable | `TaskDetail`: fields, assignee and team names, site, submissions with reviews, media, history, and for problem tasks the problem (checklist, site, item label, note, severity, media). |
| `GET /tasks/assignees` | `tasks.manage` | Users within scope and active teams with member counts, for the picker; `q` search. |

Problem endpoints:

- `GET /problems` gains `resolution` and `taskId` on each row, and a `resolution` filter.
- `GET /executions/:id` problems gain the same two fields.

### 6.3 Device times

Worker actions carry device times (`at`, `submittedAt`, `capturedAt`). As in SP4, they are trusted within bounds: not more than 5 minutes in the future and not before the task's `created_at`; otherwise the server time is used. Server receipt times are stored beside them (`received_at` on submissions; `updated_at` on tasks).

### 6.4 Sync (`GET /me/sync`)

The existing response gains a `tasks` section, built with the same change cursor:

- **Included:** non-final tasks assigned to the user, unassigned tasks of their active teams, and the user's tasks completed or cancelled in the last 7 days. (Reviewing is online-only, so tasks awaiting someone's review come from `GET /tasks`, not sync.) Each entry carries the `TaskDetail` fields the phone needs (no history).
- **Removed:** ids of tasks that left the set (reassigned away, accepted by a teammate, older than 7 days after closing) in `removedTaskIds`.

### 6.5 Jobs and events

- `tasks.sweep`, every minute, registered with `jobs.define` in `onModuleInit`. Using `perTenant`/`tenantsWith`, it sets `overdue_at = now` on non-final tasks past `due_at`, bumps `rev`, and emits `task.overdue` per task.
- `task-media.cleanup`, daily: deletes `pending` task media older than `MEDIA_LIMITS.pendingCleanupDays`, as SP4 does.
- `DomainEvents` added: `task.assigned`, `task.accepted`, `task.submitted`, `task.rejected`, `task.completed`, `task.cancelled`, `task.overdue`. Payload `{ tenantId, taskId, actorUserId?, assigneeUserId?, assigneeTeamId?, createdByUserId }`. No listeners in SP5.
- Listener on `user.access_changed` (deactivation): non-final team tasks accepted by that user go back to the team (`assignee_user_id = null`, status `new`, history comment "assignee deactivated"). Non-final tasks assigned directly to them stay as they are; the API marks them `assigneeInactive: true` so managers can reassign. Nothing is deleted (FR-04.11).

### 6.6 Audit

`AuditService.record` with entity type `task`: `task.created`, `task.updated`, `task.reassigned`, `task.cancelled`, `task.approved`, `task.rejected`. Worker status moves (accept, start, submit) go to `task_status_history` only, as occurrence statuses do. New actions are added to `packages/contracts/src/audit.ts`.

## 7. Mobile app

### 7.1 Offline store

A new migration in `apps/mobile/src/offline/db.ts`:

- **`outbox`**: rebuilt (SQLite cannot drop NOT NULL) with `entity_type` (`execution` | `task`) and `entity_id` instead of `execution_id`. Existing rows are copied with `entity_type = 'execution'`, keeping their ids and order.
- **`media`**: rebuilt the same way with `owner_type` and `owner_id`. `media-queue.ts` routes registration, upload and confirmation to the execution or task endpoints by `owner_type`.
- **`tasks`**: the server copy of each task (JSON) plus `local_status`, `rev` and sync state.
- **`task_drafts`**: `task_id`, response text, media ids, `updated_at`. Autosaved on every change.

`COMMAND_KINDS` gains `task.accept`, `task.start`, `task.media`, `task.submit`, each a new case in `sync-engine.ts`. Commands still run in order per entity, and `task.media` registration is queued before the `task.submit` that lists it.

**`task-store.ts`** (beside `execution-store.ts`): accept, start, attach media, edit draft, submit. Each action checks `taskTransition` (and `taskEvidenceMet` for submit), writes SQLite and appends the outbox command in one transaction. Photo resize and the 720p/60 s video limit reuse the SP4 capture code; live-only tasks open the camera only.

**Pull:** `sync-pull.ts` upserts `tasks` and deletes `removedTaskIds` (and their drafts, unless the draft has unsynced media or commands; those stay until the commands resolve).

**Refusals** (SP4 permanent-refusal handling):

- `TASK_ALREADY_TAKEN`: the task is removed locally; a notice says "Bu tapşırığı artıq başqası qəbul edib".
- `TASK_STATE_INVALID` (for example, cancelled while offline): the task is refreshed from the server; the draft is kept and shown read-only with a note.
- `EVIDENCE_REQUIRED`, `EVIDENCE_LIVE_ONLY`, `MEDIA_*`: shown on the task as for executions, with "Sil" on failed media.

### 7.2 Screens

- **Tabs:** Home, **Tapşırıqlar**, Profile (`app/(app)/_layout.tsx`). Home gains a card with open and overdue task counts linking to the tab.
- **Tasks list:** sections *Komanda üçün* (unaccepted team tasks), *Mənim* (overdue first, then by due date), *Yoxlamada* (awaiting review), *Tamamlanıb* (last 7 days). Each row: title, site, due date, status, overdue and sync badges.
- **Task detail:**
  - Instructions with instruction photos/videos; for problem tasks, the problem card (checklist, site, item, note, photos).
  - "Qəbul et" and "Başla" (Başla also accepts).
  - Response text, evidence chips (camera only on live-only tasks), "Tamamla". Missing required evidence disables Tamamla with a reason.
  - After a rejection, the reviewer's comment at the top.
- **For `tasks.manage` holders** (online only; offline shows "İnternet bağlantısı tələb olunur"):
  - A "+" button on the Tasks tab opens **Create task**: title, instructions, person-or-team picker (`GET /tasks/assignees`), site, due date and time, review toggle, evidence rules, instruction photos.
  - A **Yoxlama** section listing tasks awaiting their review (`GET /tasks?awaitingMyReview=true`), with Approve and Reject (comment required).

## 8. Web app

- **`/tasks`** (`apps/web/src/features/tasks/`), a `NAV_ITEMS` entry for `tasks.view` or `tasks.manage`:
  - Tabs: *Hamısı*, *Yoxlamamı gözləyir*, *Gecikmiş*, *Mənim yaratdıqlarım*.
  - Filters: status, site, assignee or team, source, due date range.
  - Table: title, status badge (+ overdue badge), assignee or team, site, due, source (ad-hoc or a link to the problem). "Yeni tapşırıq" button for `tasks.manage`.
- **Create/edit dialog:** title, instructions, priority, person-or-team combobox (users and teams grouped, from `GET /tasks/assignees`), site, due date and time in the tenant time zone, review toggle, evidence rules, instruction media upload. Changing the assignee reassigns.
- **Task drawer** (shadcn Dialog, like the schedule drawer): details; submissions in order with text, media (lightbox, video player) and review result; status history; linked-problem card. Actions when allowed: Approve, Reject (comment), Cancel (reason), Edit. "Assignee inactive" warning when set.
- **Problems page:** a *Resolution* column and filter. Rows without a task get "Tapşırıq yarat", which opens the create dialog pre-filled (title from the item label, instructions from the note, site, priority `high` for critical, review on); disabled with a tooltip while the run is still open. Rows with a task link to its drawer.
- **Execution tab** (schedule drawer): problem rows show the resolution badge and link.
- All strings in `packages/i18n` (az).

## 9. Testing

- **Contracts (Vitest):** `taskTransition` table tests (every allowed and refused action per status, both review settings); `taskEvidenceMet`; schema tests for create, submission and assignee.
- **API integration (existing test-DB setup):**
  - Create: assignee rules per scope, team rules, idempotent repeat, problem path (`PROBLEM_NOT_CLOSED`, `PROBLEM_ALREADY_HAS_TASK`, site copied).
  - Read scope for each data scope, team members before and after acceptance, 404 for others.
  - Concurrent accepts on a team task: exactly one wins, the other gets `TASK_ALREADY_TAKEN`.
  - Start on `new`; submit idempotency; `EVIDENCE_REQUIRED`; live-only gallery refusal; foreign media ids refused.
  - Review approve and reject cycles, history rows, latest submission updated; cancel; reassign resets.
  - Sweep sets `overdue_at` and emits `task.overdue`; editing `due_at` later clears it.
  - Deactivation listener: team task returns to team; direct task flagged.
  - `/me/sync` tasks and `removedTaskIds`; `/problems` resolution field and filter.
  - Audit rows for the six audited actions.
- **Mobile (Vitest):**
  - Outbox and media migration on a database with pending execution commands: nothing lost, order kept, execution sync still works.
  - `task-store` transactions; task commands through the sync engine; `TASK_ALREADY_TAKEN` removes the task; `TASK_STATE_INVALID` keeps the draft; pull removes tasks.
- **Web (Vitest + Testing Library):** tasks table tabs and filters; create dialog (picker, problem pre-fill); drawer review actions and permission gating; problems page resolution column.
- **Playwright end-to-end:** seed a closed run with a problem → create a task from it on the web → accept and submit through the API (standing in for the phone) → reject on the web → submit again → approve → the problems page shows *resolved*.
- **Manual device checklist:** offline accept, start and complete with photos, then sync after reconnecting; two phones racing to accept a team task; creating a task on the phone as a manager.

## 10. Implementation plans

1. **API + contracts:** contracts, migrations 0009/0010, tasks module (scope, endpoints, media, sweep, cleanup, events, deactivation listener, audit), sync and problems changes, API tests, Playwright test.
2. **Mobile:** store migration, task store, sync engine and pull, screens, tests.
3. **Web:** tasks page, dialog, drawer, problems and execution-tab integration, tests.

Plans 2 and 3 depend on plan 1's contracts and endpoints, not on each other.

## 11. Requirement traceability

| Requirement | Where |
|---|---|
| FR-14.01 | Tasks module (§6), web page (§8), mobile tab (§7.2) |
| FR-14.02 | `tasks.manage`, `POST /tasks` (§4, §6.2) |
| FR-14.03 | User or team assignee, first accept wins (§1, §6.2) |
| FR-14.04 | `due_at` (§5) |
| FR-14.05 | `instructions`, instruction media (§5, §6.2) |
| FR-14.06–08 | Submissions with text, photo and video (§5, §6.2, §7) |
| FR-14.09 | Statuses and overdue flag with history (§3, §5) |
| FR-14.10 | `task.completed` event; notification in SP6 (§6.5) |
| FR-13.07–09 | Problem → task, derived resolution (§5, §6.2, §8) |
| FR-03.04 | `site_id` on tasks (§5) |
| FR-05.04 | `tasks.view`, `tasks.manage` (§4) |
| FR-12.01–02, 12.05–06 | Task media, live-only (§6.2, §7.1) |
| FR-25.01 | Own tasks on the phone (§7.2) |
| FR-26.02 | Task audit actions (§6.6) |
| FR-04.11 | Deactivation keeps tasks (§6.5) |

## 12. Open items for later sub-projects

- SP6: listeners for the `task.*` events (FR-14.10, FR-15.03), and for overdue tasks.
- SP7: task status reports (FR-18.12) from `tasks` and `task_status_history`.
- SP9: media retention per plan for task media.
- Later, if asked for: recurring tasks, task templates, comment threads, offline task creation.
