# Taskop Notifications — Part 1: Contracts & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the domain events of sub-projects 3–5 into push, in-app and email notifications that never block business work, let `notifications.manage` holders tune the tenant's rules and `notifications.send` holders message users, teams and sites, by adding the notification contracts, i18n strings, `@taskop/api-client` methods, the five notification tables, the `notifications` NestJS module, the job queues and the inbox, preferences and push-device endpoints of the sub-project 6 spec §3–§6.

**Architecture:**
- **Outbox in the business transaction.** `NotificationEvents.record` inserts one `notification_events` row inside a savepoint (`ON CONFLICT DO NOTHING` on the dedupe key) and schedules `notifications.fanout` with `db.afterCommit`. A failing insert is rolled back to the savepoint, logged, and swallowed, so the checklist or task change still commits (NFR-11.01).
- **`NotificationListeners`** map domain events to `record`: `occurrence.status_changed` (overdue, missed), the two new events `assignment.assignees_changed` and `problem.recorded`, and six `task.*` events. A cron (`notifications.scan`) records `checklist.available` and `checklist.due_soon`, which have no status change.
- **Fan-out** (`NotificationFanout`, worker `notifications.fanout`): merges the tenant rule over `DEFAULT_RULES`, loads the target (`NotificationTargets`), resolves recipients (`NotificationRecipients`), renders Azerbaijani texts (`notification-templates.ts`), writes inbox and delivery rows, then queues `notifications.deliver` jobs after commit.
  - Role audiences are resolved per candidate as a `ScopeSubject` (`userId`, role `dataScope`, role permissions) and checked with the existing `SchedulingScope` / `TaskScope` SQL.
- **Delivery** (`NotificationDelivery`, worker `notifications.deliver`): push through `PUSH_SENDER` (`ExpoPushSender` over `expo-server-sdk`, `FakePushSender` in tests), email through the existing `MAILER`. Each row counts its own attempts; the 5th failure marks it `failed`.
- **Crons** (`NotificationJobs`): `notifications.scan`, `.receipts`, `.sweep`, `.cleanup`, registered with the existing `JobsService.define` (stately, per tenant). `JobsService` gains `defineWorker` and `send` for the two standard worker queues and the `notifications.dead` dead-letter queue.
- **Endpoints:** the caller's inbox, unread count, push devices and email preference under `/me`; rules under `/notification-rules` (`notifications.manage`); manual messages under `/notifications/messages` (`notifications.send`). `GET /me/sync` gains `unreadNotifications`, `GET /me` gains `user.emailNotifications`.

**Tech Stack:** Node 24, TypeScript 7, NestJS 12, nestjs-zod 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18, pg-boss 12, nodemailer 10, Vitest 5, Testcontainers (Postgres), supertest. **One new package:** `expo-server-sdk@^7.2.0` (latest on npm on 2026-10-13; ESM-only, Node ≥ 22.12, loaded through Node 24's `require(esm)` exactly as `@taskop/contracts` already is).

**Spec:** `docs/superpowers/specs/2026-10-13-notifications-design.md`

**This plan is Part 1 of 3:**
- Part 1 (this file): contracts, i18n strings, the API client, the DB, the `notifications` module, the job queues, the new domain events, the `me/sync` and `GET /me` additions, API tests, the seed.
- Part 2 (`apps/mobile`): `docs/superpowers/plans/2026-10-13-notifications-2-mobile.md`. Part 3 (`apps/web`): `docs/superpowers/plans/2026-10-13-notifications-3-web.md`. Both are written against the section **Interfaces for Parts 2 and 3** below and do not depend on each other.
- Parts 2 and 3 can start once **Tasks 1–4** are merged into the feature branch: those tasks need nothing from the API and give both apps every type, schema, pure function, i18n key and client method. They need Tasks 5–18 merged before their integration and end-to-end tests run against a real API.
- The spec §9 Playwright flow (an admin edits `task.assigned`, sends a message to a team, a member sees both in the bell) belongs to Part 3's last task. It needs no helper from this part: it uses the public API and waits for fan-out with retrying assertions (≤ 15 s), which works because the e2e API runs with `JOBS_ENABLED=true`.

**Deployment plan note (not a task).** Production needs `EXPO_ACCESS_TOKEN` (optional, enables Expo's enhanced push security) and keeps `NOTIFICATIONS_PUSH_ENABLED` unset (it defaults to `true` outside tests). Whoever merges `docs/superpowers/specs/2026-10-09-deployment-design.md` adds both to the API's environment list. The APNs key and the FCM V1 service-account key are uploaded to Expo by the user (spec §10); the API never sees them.

## Global Constraints

- The product name is **Taskop**. Packages are `@taskop/*`. Azerbaijani (`az`) is the only locale. Server-rendered push and email texts live in `apps/api/src/notifications/notification-templates.ts`, not in `@taskop/i18n`.
- One new npm package: `expo-server-sdk` `^7.2.0` in `apps/api`. Nothing else.
- Event types (spec §3.1), exactly: `checklist.assigned`, `checklist.available`, `checklist.due_soon`, `checklist.overdue`, `checklist.missed`, `problem.recorded`, `problem.critical`, `task.assigned`, `task.submitted`, `task.rejected`, `task.completed`, `task.overdue`, `task.cancelled`, `manual`. `task.accepted` is not notified. `manual` has no rule.
- Default rules (spec §3.1, interfaces table): all enabled; push on for every type except `checklist.missed`; email only for `problem.critical`; direct audiences and system roles as in `DEFAULT_RULES`; `checklist.due_soon` lead time **30** minutes; allowed lead times **15, 30, 60, 120**.
- Dedupe keys: `checklist.available:<occurrenceId>`, `checklist.due_soon:<occurrenceId>`, `checklist.overdue:<occurrenceId>`, `checklist.missed:<occurrenceId>`, `problem:<problemId>`. `checklist.assigned`, `task.*` and `manual` have none.
- Scan guards (spec §3.4): `checklist.available` only when `starts_at` lies within the last **15 minutes** (`starts_at ≥ now − 15 min`, `starts_at ≤ now`) and the occurrence is `pending`; `checklist.due_soon` when `due_at − lead ≤ now < due_at`, the occurrence is `pending`, and **skipped** when `due_at − lead ≤ starts_at`. Only for enabled rules.
- Tables (spec §5): `notification_events`, `notifications`, `notification_deliveries`, `push_devices`, `notification_rules`, plus `users.email_notifications boolean not null default true`. Migrations `0011_notifications.sql` (generated) and `0012_notifications_security.sql` (custom). Every table has `tenant_id`, RLS `FORCE`d with the usual `tenant_isolation` policy, composite `(tenant_id, x)` foreign keys. `push_devices.expo_token` is unique **across all tenants**.
- Grants: `SELECT, INSERT, UPDATE, DELETE` on all five tables to `taskop_app` and `taskop_platform` (cleanup deletes, devices and rule overrides are deleted).
- Outcomes: `fanned_out`, `disabled`, `no_recipients`, `target_gone`. Delivery statuses: `queued`, `sent`, `delivered`, `failed`, `skipped`. Channels: `push`, `email`. Target kinds: `occurrence`, `task`, `none`. Platforms: `ios`, `android`.
- Queues (spec §6.3), exactly:
  - `notifications.fanout` — worker, standard queue, `retryLimit: 5`, backoff, dead letter `notifications.dead`
  - `notifications.deliver` — worker, standard queue, `retryLimit: 5`, backoff, dead letter `notifications.dead`
  - `notifications.scan` — cron `* * * * *` (UTC)
  - `notifications.receipts` — cron `*/15 * * * *`; receipts for `sent` push rows sent **15 min** to **24 h** ago
  - `notifications.sweep` — cron `*/5 * * * *`; re-sends `fanout` for events unprocessed after **2 min** with `attempts < 5`, and `deliver` for deliveries `queued` for over **5 min** with `attempts < 5`
  - `notifications.cleanup` — cron `15 4 * * *` (04:15 UTC); deletes notifications (and their deliveries) and processed events older than **90 days**; disables devices not seen for **180 days**
  - `notifications.dead` — dead-letter queue, every job logged at error level
- Attempts: **5** per event and per delivery (`NOTIFICATION_LIMITS.maxAttempts`). Push jobs carry **≤ 100** deliveries; email jobs carry one.
- Push message: `title`, `body`, `sound: 'default'`, `channelId: 'default'`, `priority: 'high'` for `checklist.overdue`, `problem.critical`, `task.overdue` (else `'default'`), `badge` = the recipient's unread count, `data: PushData`.
- Permissions: `notifications.manage`, `notifications.send` in a new `notifications` group. `SYSTEM_ROLE_DEFAULTS`: owner and admin both (through `ALL_PERMISSIONS`), manager `notifications.send`, worker and auditor none. The `0012` backfill gives exactly these to existing roles.
- Audit actions: `notification_rule.updated`, `notification_rule.reset` (entity type `notification_rule`, entity id null), `notification.message_sent` (entity type `notification_message`, entity id = event id).
- Manual messages: title 1–80, body 1–500 (trimmed), ≤ 200 ids per kind, ≤ **1000** recipients per send.
- Inbox: 30 per page by default (1–100), newest first; `notifications.issues.*` field keys pass through the error filter.
- Config: `EXPO_ACCESS_TOKEN` (optional), `NOTIFICATIONS_PUSH_ENABLED` (default `true`, `false` when `NODE_ENV=test`).
- No new error codes. Refusals use `VALIDATION_FAILED` (400, with `fields`), `FORBIDDEN` (403), `NOT_FOUND` (404), `REFERENCE_NOT_FOUND` (422).
- Every notification timestamp (`created_at`, `processed_at`, `sent_at`, `read_at`, `last_seen_at`, `disabled_at`, `updated_at`) comes from the injected `Clock`, so tests move time with `FakeClock`. No test sleeps. Only the pg-boss wiring tests in `apps/api/test/jobs-wiring.test.ts` poll, with a timeout; every other test calls the worker methods directly (`JOBS_ENABLED=false` in tests, so `JobsService.send` is a no-op there).

### Spec decisions this plan makes (ambiguities and conflicts with the code, resolved)

1. **Attempts are counted by the workers, not by pg-boss.** pg-boss's `retryLimit: 5` means one try plus five retries (six runs). The spec wants the 5th failure to be the last. So each worker counts its own attempts in the row: `NotificationFanout` increments `notification_events.attempts` in a separate transaction after a failed run and, on the 5th, stores `last_error`, sends `{ queue, tenantId, eventId, error }` to `notifications.dead` itself and returns without throwing; `NotificationDelivery` does the same per delivery row (the 5th failure marks it `failed`). The queues keep `retryLimit: 5` (spec §6.3) as the backstop for failures the bookkeeping itself cannot record (the database is down), which pg-boss dead-letters on its own.
2. **Role audiences are checked per candidate with a `ScopeSubject`.** A role holder is not the request principal, so `ScopeSubjects.holdersOf(roleIds)` builds `{ userId, dataScope, permissions }` for every active user of an **active** role in `roleIds`, exactly as `PrincipalLoader` does (owner → every permission; an inactive role grants nothing). Each candidate then runs one `exists` query with the existing SQL: `SchedulingScope.occurrences(subject)` for occurrence and problem targets, `SchedulingScope.assignments(subject)` for `checklist.assigned`, `TaskScope.readable(subject)` for tasks. The parameter types of `SchedulingScope.assignments`/`occurrences` and `TaskScope.covers`/`readable` are widened from `Principal` to the `Pick<Principal, …>` they actually read (`ScopeHolder` / `TaskReader`); no behaviour changes.
3. **Permission per target:** checklist and problem targets need `assignments.view`; task targets need `tasks.view` **or** `tasks.manage` (TaskScope's own rule: `tasks.manage` implies reading); `checklist.assigned` needs `assignments.view` and `SchedulingScope.assignments`.
4. **`checklist.assigned` has `targetKind: 'none'`** (spec §3.1); its role audience is checked against the assignment.
5. **The actor of `checklist.overdue` / `checklist.missed`** is the user of the transaction that changed the status (`db.context().userId`), i.e. `null` for the sweep. `occurrence.status_changed` carries no actor.
6. **`actorUserId` is nullable** in the new domain events (`assignment.assignees_changed`, `problem.recorded`): a platform admin working inside a tenant has no user id (`actorColumns`).
7. **"Inserted, not re-saved" problems** are told apart by `RETURNING (xmax = 0)` on `ProblemWriter`'s upsert: true only for rows the statement inserted. A problem that disappears and is derived again later gets a new id and is notified again.
8. **`notification_deliveries.device_id` has no foreign key.** Devices are deleted (logout, token claim) while their delivery rows stay as history; a queued delivery whose device row is gone is `skipped`. Deliveries cascade from notifications, and notifications from events, so cleanup deletes whole trees.
9. **Expo ticket errors never retry.** `DeviceNotRegistered` disables the device and fails the row; every other ticket error (`InvalidCredentials`, `MessageTooBig`, `MessageRateExceeded`, `DeveloperError`, `ExpoError`, `ProviderError`) fails the row; `InvalidCredentials` and `MessageTooBig` are logged at error level. An HTTP failure of the whole request (including 429 after the SDK's own two retries) is an attempt for every row of the batch.
10. **Receipts window:** `sent` push rows with `sent_at` between 24 h and 15 min ago (Expo keeps receipts for 24 h). Older rows without a receipt stay `sent`.
11. **`NOTIFICATIONS_PUSH_ENABLED` defaults to `NODE_ENV !== 'test'`**: true in production (spec) and in development (the manual device checklist pushes from a dev API), false in tests.
12. **Manual messages are expanded twice:** at send (for the 1000 cap and the preview) and again at fan-out with the sender's current scope (`ScopeSubjects.forUser`), because the spec's payload holds only the selected ids. The cap applies at send only.
13. **Scope of message targets** ("inside the sender's scope"): a user is in scope when `ScopeService.usersFilter(sender)` matches them (any status); a team when the scope is `all` or at least one member matches `usersFilter`; a site when `SchedulingScope.writableSites(sender)` covers it (every site for `all`, the subtree for `site_subtree`, none for narrower scopes). Any selected id outside that → `403 FORBIDDEN`. Inactive users and inactive teams inside the scope are dropped silently by the expansion. Options list only active users (not the sender), active teams with at least one active member in scope (`memberCount` counts those), and active sites in scope.
14. **`unread=false` means "all"** on `GET /me/notifications`; only `unread=true` filters. The UI has one "unread only" toggle.
15. **Inbox paging is keyset on `(created_at, id)` descending**, so rows with the same `created_at` (one fan-out writes many) never repeat or vanish between pages.
16. **Email at delivery** is `skipped` when the user is inactive, has no email address, or has opted out since the fan-out. Email has no `delivered` state; `sent` is final.
17. **Rule reset is audited only when an override existed.** Roles are never deleted in this codebase (only deactivated), so "deleted role ids" are ids with no role row in the tenant: they are dropped from `GET` responses and from the next save. Inactive roles stay in `roleIds` but grant nothing (decision 2).
18. **`JobsService.send` returns `false` and does nothing while jobs are disabled** (`JOBS_ENABLED=false`, tests). `JobsService` stores the pg-boss instance right after `start()`, so a worker that sends a job while the remaining queues are still being created is not dropped.
19. **Interim values in Task 2.** `GET /me` reports `emailNotifications: true` and `/me/sync` reports `unreadNotifications: 0` until Task 16 reads the column and the inbox, so the API compiles and passes its tests after the contracts change.
20. **`MessageSummary` counts are 0 until fan-out has run** (`processed: false`), including `recipientCount` (Interfaces). `POST /notifications/messages` therefore answers with zeros.
21. **Fan-out does not re-check an occurrence's status** for `available` / `due_soon`: the scan records only `pending` occurrences, and the seconds between scan and fan-out are not worth a second rule.
22. **Recipient order** is by user id; one inbox row per user per event (`notifications_event_user_uq`).
23. **`task.submitted` is recorded only while the task is `awaiting_review`.** SP5's `TaskWorkService.submit` emits `task.submitted` on every submission and then `task.completed` when no review is required; spec §3.1 means "awaiting review", so a submission straight to `completed` notifies the creator once, as `task.completed` (Task 8).
24. **Texts use the names current at fan-out.** The event payload holds ids only (spec §5), so checklist, site and task names are read when the fan-out runs, seconds after the event; from then on the stored inbox text never changes ("stable if names change later").
25. **App fixtures are repaired by Parts 2 and 3, not here.** Task 2 makes `SyncResponse.unreadNotifications` and `Me.user.emailNotifications` required; the few typed fixtures in `apps/mobile` and `apps/web` that build those objects are fixed by Part 2's and Part 3's Task 1, so no two plans edit the same lines. This part's verification steps therefore run contracts, i18n, api-client and api only.

## Review Focus

These are the five input classes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **One phone, two people (or two organisations).** A shared phone signs out of one account (the logout call may have failed) and into another, in the same or another tenant. The second `PUT /me/push-devices` must remove the first user's row so the new user alone gets pushes, and the first user's later fan-outs must not create push deliveries for that token. Pinned in Task 16 (`claims a token from another user of the tenant and from another tenant`).
2. **A sweep that jumps a run straight from pending to missed.** After downtime the occurrence sweep records `pending → overdue` and `overdue → missed` in one go; each must produce exactly one event with its own dedupe key, and a second sweep or a replayed listener must add nothing. Pinned in Task 8 (`records overdue and missed once each when a sweep jumps from pending to missed`).
3. **Inbox pages over rows with equal timestamps.** One fan-out writes many rows with the same `created_at`; a user with more than a page of them must see every row exactly once across pages. Pinned in Task 16 (`pages by (created_at, id) without repeating or skipping rows of the same instant`).
4. **A delivery job replayed after it already sent.** The sweep re-queues a delivery while the first worker run is finishing, or pg-boss retries a job whose work committed; the second run must not push or mail again. Pinned in Task 13 (`ignores deliveries that are no longer queued`).
5. **Times in the tenant's timezone.** A due time in a push body must read in the organisation's local time, not UTC, also for a tenant outside Baku. Pinned in Task 11 (`writes times in the tenant’s timezone`) and Task 12 (`renders the due time in Baku time and links the occurrence by its date`).

---
## File Structure

```
packages/contracts/src/
  notifications.ts                          types, groups, audiences, meta, DEFAULT_RULES, rule DTO/input, inbox item,
                                            list query, push device, preferences, PushData, messages, delivery statuses,
                                            aggregateDeliveryStatus, issue codes
  notifications.test.ts
  sync.ts                                   + unreadNotifications
  auth.ts                                   meSchema.user + emailNotifications
  permissions.ts                            + notifications group; manager gets notifications.send
  audit.ts                                  + NOTIFICATION_AUDIT_ACTIONS
  index.ts                                  + notifications
  execution-views.test.ts, task-views.test.ts, resources.test.ts   fixtures gain the new fields
packages/i18n/src/az/
  notifications.ts                          types, groups, audiences, channels, delivery statuses, issues, labels
  roles.ts, audit.ts, nav.ts, index.ts, ../i18n.test.ts
packages/api-client/src/
  endpoints.ts                              + createNotificationsApi
  client.test.ts
apps/api/
  package.json                              + expo-server-sdk
  .env.example                              + EXPO_ACCESS_TOKEN, NOTIFICATIONS_PUSH_ENABLED
  drizzle/0011_notifications.sql            (generated)
  drizzle/0012_notifications_security.sql   (custom: RLS, grants, permission backfill)
  src/db/schema.ts                          + 4 enums, 5 tables, users.email_notifications
  src/config/config.ts (+ config.test.ts)   + EXPO_ACCESS_TOKEN, NOTIFICATIONS_PUSH_ENABLED
  src/common/request.ts                     + ScopeHolder
  src/common/domain-events.ts               + assignment.assignees_changed, problem.recorded
  src/common/error.filter.ts (+ test)       + notifications.* field keys
  src/scheduling/jobs.service.ts            + defineWorker, send, dead-letter queues
  src/scheduling/scheduling-scope.ts        assignments/occurrences take a ScopeHolder
  src/scheduling/assignments.service.ts     emits assignment.assignees_changed
  src/executions/problem-writer.ts          emits problem.recorded for inserted rows
  src/executions/sync.service.ts            + unreadNotifications
  src/executions/executions.module.ts       imports NotificationsModule
  src/tasks/task-scope.ts                   covers/readable take a TaskReader
  src/tasks/tasks.module.ts                 exports TaskScope
  src/auth/me.service.ts                    + emailNotifications
  src/app.module.ts                         + NotificationsModule
  src/db/scripts/seed.ts                    + a welcome message in the demo inboxes
  src/notifications/
    queues.ts (+ queues.test.ts)            queue names, limits, job payloads, failureText, deliveryJobs
    payloads.ts                             payload type per notification type
    notification-events.ts                  NotificationEvents: record (savepoint, swallow), create (throws)
    notification-listeners.ts               domain events → record; deactivation → devices disabled
    notification-rules.ts (+ test)          effectiveRule, ruleIssues (pure)
    rules.service.ts                        NotificationRules: list, effective, update, reset
    rules.controller.ts                     GET/PUT/DELETE /notification-rules
    scope-subjects.ts                       ScopeSubject, ScopeSubjects: holdersOf, forUser
    notification-targets.ts                 NotificationTarget types, NotificationTargets.load
    notification-recipients.ts              NotificationRecipients: resolve, forMessage, expandMessage
    notification-templates.ts (+ test)      renderNotification, notificationLink, notificationMail
    notification-fanout.ts                  NotificationFanout (worker notifications.fanout)
    push-sender.ts (+ test)                 PUSH_SENDER, PushSender, ExpoPushSender, FakePushSender
    notification-delivery.ts                NotificationDelivery (worker notifications.deliver)
    notification-jobs.ts                    NotificationJobs: scan, receipts, sweep, cleanup crons
    inbox.service.ts                        InboxService: list, unread, read, devices, preferences
    me-notifications.controller.ts          /me/notifications*, /me/push-devices*, /me/preferences
    messages.service.ts                     MessagesService: options, preview, send, scope checks
    message-queries.ts                      MessageQueries: list, summary, detail
    messages.controller.ts                  /notifications/messages*
    dto.ts, notifications.module.ts
  test/notification-fixtures.ts             devices, event/inbox/delivery rows, staff, fanOutAll, deliverAll
  test/notifications-db.test.ts, notification-domain-events.test.ts, notification-events.test.ts,
  notification-rules-api.test.ts, notification-recipients.test.ts, notification-fanout.test.ts,
  notification-delivery.test.ts, notification-jobs.test.ts, notification-scan.test.ts,
  notification-inbox.test.ts, notification-messages.test.ts
  test/jobs-wiring.test.ts, roles.test.ts, openapi.test.ts, seed-demo.test.ts   (extended)
(apps/mobile and apps/web fixtures that build Me / SyncResponse are repaired by Parts 2 and 3, Task 1 each; see Task 2.)
```

---
## Interfaces for Parts 2 and 3

Everything below is exported from `@taskop/contracts`, `@taskop/i18n` or `@taskop/api-client` once **Tasks 1–4** of Part 1 are merged. Parts 2 and 3 import these names exactly. All instants are ISO-8601 UTC strings; dates are `YYYY-MM-DD`.

### `@taskop/contracts`

**Catalogue and rules** (`notifications.ts`, Part 1 Task 1):
- `NOTIFICATION_TYPES = ['checklist.assigned', 'checklist.available', 'checklist.due_soon', 'checklist.overdue', 'checklist.missed', 'problem.recorded', 'problem.critical', 'task.assigned', 'task.submitted', 'task.rejected', 'task.completed', 'task.overdue', 'task.cancelled', 'manual'] as const`, `notificationTypeSchema`, `type NotificationType`
- `RULE_TYPES` = `NOTIFICATION_TYPES` without `'manual'` (same order), `ruleTypeSchema`, `type RuleType`
- `NOTIFICATION_GROUPS = ['checklist', 'problem', 'task'] as const`, `type NotificationGroup`
- `DIRECT_AUDIENCES = ['assignees', 'creator'] as const`, `type DirectAudience`
- `NOTIFICATION_TYPE_META: Record<RuleType, { group: NotificationGroup; audiences: readonly DirectAudience[]; hasLeadTime: boolean }>`:
  - `checklist.*`: group `checklist`, audiences `['assignees']` (for `checklist.assigned` "assignees" means the users just added); `hasLeadTime` only for `checklist.due_soon`
  - `problem.*`: group `problem`, audiences `[]`
  - `task.*`: group `task`, audiences `['assignees', 'creator']`
- `LEAD_MINUTES = [15, 30, 60, 120] as const`, `type LeadMinutes`
- `DEFAULT_RULES: Record<RuleType, DefaultRule>` where `type DefaultRule = { enabled: boolean; push: boolean; email: boolean; notifyAssignees: boolean; notifyCreator: boolean; systemRoles: readonly SystemRoleKey[]; leadMinutes: LeadMinutes | null }`. All `enabled: true`. Values (spec §3.1):

| type | push | email | notifyAssignees | notifyCreator | systemRoles | leadMinutes |
|---|---|---|---|---|---|---|
| `checklist.assigned` | true | false | true | false | [] | null |
| `checklist.available` | true | false | true | false | [] | null |
| `checklist.due_soon` | true | false | true | false | [] | 30 |
| `checklist.overdue` | true | false | true | false | ['manager'] | null |
| `checklist.missed` | false | false | false | false | ['manager', 'admin'] | null |
| `problem.recorded` | true | false | false | false | ['manager'] | null |
| `problem.critical` | true | true | false | false | ['manager', 'admin'] | null |
| `task.assigned` | true | false | true | false | [] | null |
| `task.submitted` | true | false | false | true | [] | null |
| `task.rejected` | true | false | true | false | [] | null |
| `task.completed` | true | false | false | true | [] | null |
| `task.overdue` | true | false | true | true | [] | null |
| `task.cancelled` | true | false | true | false | [] | null |

  The API turns `systemRoles` into the tenant's role ids (`roles.system_key`); clients never see `systemRoles`.
- `notificationRuleDtoSchema` / `type NotificationRuleDto = { type: RuleType; enabled: boolean; push: boolean; email: boolean; notifyAssignees: boolean; notifyCreator: boolean; roleIds: string[]; leadMinutes: LeadMinutes | null; isDefault: boolean }` — the effective rule. `isDefault` is true when the tenant has no override row.
- `updateNotificationRuleSchema` / `type UpdateNotificationRuleInput = { enabled; push; email; notifyAssignees; notifyCreator; roleIds: uuid[] (≤ 50, duplicates removed); leadMinutes: LeadMinutes | null }` — all fields required (a full rule). Server-side checks (400 `VALIDATION_FAILED`):
  - `leadMinutes` non-null when `hasLeadTime`, else null → `fields.leadMinutes = 'notifications.issues.leadMinutesRequired'` / `'notifications.issues.leadMinutesNotApplicable'`
  - `notifyAssignees` / `notifyCreator` true for an audience not in the type's `audiences` → `fields.notifyAssignees` / `fields.notifyCreator = 'notifications.issues.audienceNotApplicable'`
  - an unknown role id → `422 REFERENCE_NOT_FOUND`, `fields.roleIds`

**Inbox** (`notifications.ts`, Part 1 Task 1):
- `NOTIFICATION_TARGET_KINDS = ['occurrence', 'task', 'none'] as const`, `type NotificationTargetKind`
- `notificationItemSchema` / `type NotificationItem = { id; type: NotificationType; title: string; body: string; targetKind: NotificationTargetKind; targetId: string | null; targetDate: string | null; createdAt; readAt: string | null }` (`targetDate` is the occurrence's `local_date`, set only for `targetKind: 'occurrence'`)
- `isProblemType(t: NotificationType): boolean` — `t.startsWith('problem.')` (web opens the execution tab for these)
- `notificationListQuerySchema` / `type NotificationListQuery = { cursor?: uuid; limit?: 1–100 (default 30); unread?: 'true' | 'false' }`
- `unreadCountSchema` / `type UnreadCount = { count: number }`
- `PUSH_PLATFORMS = ['ios', 'android'] as const`, `type PushPlatform`
- `registerPushDeviceSchema` / `type RegisterPushDeviceInput = { expoToken: string (≤ 200, matches /^Expo(nent)?PushToken\[.+\]$/); platform: PushPlatform }`
- `preferencesSchema` / `type Preferences = { emailNotifications: boolean }`; `updatePreferencesSchema` / `type UpdatePreferencesInput = { emailNotifications: boolean }`
- `type PushData = { notificationId: string; userId: string; tenantId: string; type: NotificationType; targetKind: NotificationTargetKind; targetId: string | null; targetDate: string | null }` and `pushDataSchema` — the `data` object of every push (Part 2 parses it with `pushDataSchema.safeParse`).

**Manual messages** (`notifications.ts`, Part 1 Task 1):
- `MESSAGE_LIMITS = { titleMax: 80, bodyMax: 500, maxRecipients: 1000, maxTargetsPerKind: 200 }`
- `sendMessageSchema` / `type SendMessageInput = { title: string (trimmed, 1–80); body: string (trimmed, 1–500); userIds?: uuid[] (default [], ≤ 200); teamIds?: uuid[] (default [], ≤ 200); siteIds?: uuid[] (default [], ≤ 200); email?: boolean (default false) }`; a refine fails with `path: ['userIds']`, message `notifications.issues.noTargets` when all three lists are empty.
- `messagePreviewSchema` / `type MessagePreview = { recipientCount: number }`
- `DELIVERY_CHANNELS = ['push', 'email'] as const`, `type DeliveryChannel`
- `DELIVERY_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'skipped'] as const`, `deliveryStatusSchema`, `type DeliveryStatus`
- `aggregateDeliveryStatus(statuses: readonly DeliveryStatus[]): DeliveryStatus | null` — `null` for an empty list; otherwise the first of `delivered`, `sent`, `queued`, `failed`, `skipped` present (a user with one delivered device counts as delivered).
- `deliveryCountsSchema` / `type DeliveryCounts = Record<DeliveryStatus, number>` — counted per recipient using the aggregated status; recipients with no delivery on that channel are not counted.
- `messageSummarySchema` / `type MessageSummary = { id: string (the event id); title; body; sender: UserRef | null; sentAt: iso; emailRequested: boolean; processed: boolean; recipientCount: number; readCount: number; push: DeliveryCounts; email: DeliveryCounts }` (`processed: false` while fan-out has not run; counts are then 0)
- `messageListQuerySchema` / `type MessageListQuery` = the existing `cursorQuerySchema`
- `messageRecipientSchema` / `type MessageRecipient = { user: UserRef; readAt: iso | null; push: { status: DeliveryStatus | null; devices: number; lastError: string | null }; email: { status: DeliveryStatus | null; lastError: string | null } }`
- `messageDetailSchema` / `type MessageDetail = MessageSummary & { targets: { users: UserRef[]; teams: { id; name }[]; sites: { id; name }[] }; recipients: MessageRecipient[] }` (recipients by full name)
- `messageTargetOptionsQuerySchema` / `type MessageTargetOptionsQuery = { q?: string (≤ 100) }`
- `messageTargetOptionsSchema` / `type MessageTargetOptions = { users: { id; fullName; jobTitle: string | null }[] (≤ 50, by name, filtered by q); teams: { id; name; memberCount: number }[] (≤ 50, active, filtered by q); sites: { id; name }[] (≤ 200, active, not filtered by q) }` — all inside the caller's data scope.
- `NOTIFICATION_ISSUE_CODES` (full i18n keys), `type NotificationIssueCode`: `notifications.issues.noTargets`, `notifications.issues.noRecipients`, `notifications.issues.tooManyRecipients`, `notifications.issues.leadMinutesRequired`, `notifications.issues.leadMinutesNotApplicable`, `notifications.issues.audienceNotApplicable`

`UserRef` is the existing `userRefSchema = { id, fullName }`.

**Changes to existing contracts** (Part 1 Task 2):
- `sync.ts`: `syncResponseSchema` gains `unreadNotifications: number` (int ≥ 0).
- `auth.ts`: `meSchema.user` gains `emailNotifications: boolean`.
- `permissions.ts`: `PERMISSION_GROUPS` gains `{ group: 'notifications', keys: ['notifications.manage', 'notifications.send'] }` (last). `SYSTEM_ROLE_DEFAULTS.manager.permissions` gains `'notifications.send'`; owner and admin get both through `ALL_PERMISSIONS`; worker and auditor none.
- `audit.ts`: `NOTIFICATION_AUDIT_ACTIONS = ['notification_rule.updated', 'notification_rule.reset', 'notification.message_sent'] as const`, `type NotificationAuditAction`. Entity types: `notification_rule` (entityId null; `after` carries `{ type, ... }`) and `notification_message` (entityId = event id).
- No new error codes. Refusals use `VALIDATION_FAILED` (400, with `fields`), `FORBIDDEN` (403), `NOT_FOUND` (404), `REFERENCE_NOT_FOUND` (422).

### `@taskop/i18n` (Part 1 Task 3)

- `az.notifications` (new namespace, registered in `az/index.ts`):
  - `types.<NotificationType>` — the rule-row label, e.g. `checklist.due_soon`: "Checklistin vaxtı yaxınlaşır", `manual`: "Admin mesajı"
  - `groups.<NotificationGroup>` ("Checklistlər", "Problemlər", "Tapşırıqlar")
  - `audiences.{ assignees, creator }` ("İcraçılar", "Yaradan")
  - `channels.{ inApp, push, email }` ("Tətbiqdə", "Push", "E-poçt")
  - `deliveryStatuses.<DeliveryStatus>`
  - `issues.<code without the notifications.issues. prefix>`
  - `leadMinutes` ("{{count}} dəq əvvəl")
  - `title` ("Bildirişlər"), `markAllRead` ("Hamısını oxunmuş et"), `empty` ("Bildiriş yoxdur")
- `az.roles.groups.notifications` ("Bildirişlər"), `az.roles.keys.notifications_manage`, `az.roles.keys.notifications_send`
- `az.audit.entityTypes.notification_rule`, `az.audit.entityTypes.notification_message` (and action labels if the audit page has an `actions` map — follow how `task.*` actions were added in SP5)
- `az.nav.notifications` ("Bildirişlər"), `az.nav.messages` ("Mesajlar")
- Part 2 adds phone UI strings to `az.mobile`. Part 3 adds web UI strings to `az.notifications` (new keys only; it never renames these).

Server-rendered push/email texts are **not** in `@taskop/i18n`; they live in `apps/api/src/notifications/notification-templates.ts`.

### `@taskop/api-client` (Part 1 Task 4)

`createTaskopApi(c)` spreads `createNotificationsApi(c)`, also exported with `type NotificationsApi`:

| Method | HTTP | Returns |
|---|---|---|
| `notifications.list(query: NotificationListQuery = {})` | `GET /me/notifications` | `Page<NotificationItem>` |
| `notifications.unreadCount()` | `GET /me/notifications/unread-count` | `UnreadCount` |
| `notifications.markRead(id: string)` | `POST /me/notifications/:id/read` (204) | `void` |
| `notifications.markAllRead()` | `POST /me/notifications/read-all` (204) | `void` |
| `pushDevices.register(body: RegisterPushDeviceInput)` | `PUT /me/push-devices` (204) | `void` |
| `pushDevices.remove(expoToken: string)` | `DELETE /me/push-devices/:token` (token `encodeURIComponent`-ed; 204) | `void` |
| `preferences.update(body: UpdatePreferencesInput)` | `PATCH /me/preferences` | `Preferences` |
| `notificationRules.list()` | `GET /notification-rules` | `NotificationRuleDto[]` (in `RULE_TYPES` order) |
| `notificationRules.update(type: RuleType, body: UpdateNotificationRuleInput)` | `PUT /notification-rules/:type` | `NotificationRuleDto` |
| `notificationRules.reset(type: RuleType)` | `DELETE /notification-rules/:type` | `NotificationRuleDto` (the default) |
| `messages.options(query: MessageTargetOptionsQuery = {})` | `GET /notifications/messages/options` | `MessageTargetOptions` |
| `messages.preview(body: SendMessageInput)` | `POST /notifications/messages/preview` (200) | `MessagePreview` |
| `messages.send(body: SendMessageInput)` | `POST /notifications/messages` (201) | `MessageSummary` |
| `messages.list(query: MessageListQuery = {})` | `GET /notifications/messages` | `Page<MessageSummary>` |
| `messages.get(id: string)` | `GET /notifications/messages/:id` | `MessageDetail` |

`me()` and `sync.pull(...)` are unchanged calls whose results carry the new fields.

### Server behaviour Parts 2 and 3 rely on

- **Inbox:** `/me/notifications*` are open to any signed-in user and only ever touch the caller's rows. `markRead` on an id that is not the caller's → `404`; on an already-read row → `204` (idempotent). Rows older than 90 days disappear (cleanup). `unreadCount` and `SyncResponse.unreadNotifications` count the caller's rows with `readAt === null`.
- **Fan-out is asynchronous.** A business action (assigning a task, sending a message) returns before its notifications exist; they appear within a few seconds when jobs run (`JOBS_ENABLED=true`). Tests and e2e wait with retrying assertions (≤ 15 s), never sleeps.
- **The actor is never notified** of their own action; a manual message never reaches its sender.
- **Push payload:** `title`, `body`, `sound: 'default'`, `channelId: 'default'` (Android), `badge` = the recipient's unread count, `data: PushData`. The phone must create the Android channel `default`.
- **Push devices:** `PUT /me/push-devices` is idempotent (204) and claims the token: any other user's or tenant's row with that token is removed. `DELETE` answers 204 whether or not the row existed. A deactivated user's devices are disabled server-side.
- **Preferences:** `PATCH /me/preferences` changes only the caller; `GET /me` reports `user.emailNotifications`. Users without an email address can still set it (it has no effect).
- **Targets:** `occurrence` → the phone opens `/execution/[targetId]` (route param is the occurrence id) when the occurrence is in its local store; the web opens `/schedule?date=<targetDate>&occurrence=<targetId>` plus `&tab=execution` when `isProblemType(type)`. `task` → phone `/task/[targetId]`, web `/tasks?task=<targetId>`. `none` → stay in the inbox.
- **Rules:** `GET/PUT/DELETE /notification-rules*` need `notifications.manage` (else 403). `roleIds` of deleted roles are dropped from responses.
- **Messages:** need `notifications.send` (else 403). Ids outside the sender's scope → `403 FORBIDDEN`. A send whose expansion yields 0 recipients → `400 VALIDATION_FAILED` `fields.userIds = 'notifications.issues.noRecipients'`; more than 1000 → `fields.userIds = 'notifications.issues.tooManyRecipients'`. `preview` returns the count without those two checks. `GET /notifications/messages`: `notifications.manage` holders see every message of the tenant; other senders only their own. `GET /notifications/messages/:id` for a message the caller may not list → `404`.
- **Recipient expansion for messages:** selected users ∪ active members of selected active teams ∪ users attached (`user_sites`) to a selected site or any site in its subtree; then active users only, inside the sender's scope, minus the sender.

### Clarifications to the interfaces (added by this plan; nothing above is changed)

- `NotificationListQuery.unread`: `'true'` returns unread rows only; `'false'` or absent returns all rows (Spec decision 14). The parsed value is `boolean | undefined`.
- `MessageListQuery` defaults to `limit` 50 (1–200), like every other `cursorQuerySchema` list.
- `pushDevices.register` is also how a phone re-enables a device that the server disabled (user reactivated, `DeviceNotRegistered` cleared by a fresh token): the upsert clears `disabled_at`.
- `PushData.targetDate` is `null` unless `targetKind === 'occurrence'`.
- `GET /notifications/messages/options` answers `403` without `notifications.send`, like the other message routes.

---

### Task 1: Notification catalogue, rules, inbox and message contracts

**Files:**
- Create: `packages/contracts/src/notifications.ts`
- Test: `packages/contracts/src/notifications.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `idSchema`, `isoDateTimeSchema`, `cursorQuerySchema` from `common.ts`; `userRefSchema` from `occurrences.ts`; `localDateSchema` from `scheduling-time.ts`; `type SystemRoleKey` from `permissions.ts`.
- Produces: everything listed under **Catalogue and rules**, **Inbox** and **Manual messages** in *Interfaces for Parts 2 and 3*, plus `leadMinutesSchema`, `notificationTargetKindSchema`, `deliveryChannelSchema`, `pushPlatformSchema`, `type NotificationTypeMeta`, `type UpdateNotificationRuleOutput` (`z.output` of the rule input, used by the API).

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/notifications.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  aggregateDeliveryStatus,
  DEFAULT_RULES,
  DELIVERY_STATUSES,
  isProblemType,
  LEAD_MINUTES,
  leadMinutesSchema,
  MESSAGE_LIMITS,
  messageDetailSchema,
  messageSummarySchema,
  messageTargetOptionsSchema,
  NOTIFICATION_ISSUE_CODES,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  notificationItemSchema,
  notificationListQuerySchema,
  notificationRuleDtoSchema,
  pushDataSchema,
  registerPushDeviceSchema,
  RULE_TYPES,
  sendMessageSchema,
  updateNotificationRuleSchema,
  updatePreferencesSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const ID2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';
const AT = '2026-11-02T04:00:00.000Z';
const zero = { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 };

describe('notification catalogue', () => {
  it('lists the spec §3.1 types; rules cover all of them except manual, in the same order', () => {
    expect(NOTIFICATION_TYPES).toEqual([
      'checklist.assigned', 'checklist.available', 'checklist.due_soon', 'checklist.overdue', 'checklist.missed',
      'problem.recorded', 'problem.critical',
      'task.assigned', 'task.submitted', 'task.rejected', 'task.completed', 'task.overdue', 'task.cancelled',
      'manual',
    ]);
    expect(RULE_TYPES).toEqual(NOTIFICATION_TYPES.filter((t) => t !== 'manual'));
    expect(Object.keys(NOTIFICATION_TYPE_META)).toEqual([...RULE_TYPES]);
    expect(Object.keys(DEFAULT_RULES)).toEqual([...RULE_TYPES]);
  });

  it('describes each group, its direct audiences and the lead time', () => {
    expect(NOTIFICATION_TYPE_META['checklist.assigned']).toEqual({ group: 'checklist', audiences: ['assignees'], hasLeadTime: false });
    expect(NOTIFICATION_TYPE_META['checklist.due_soon']).toEqual({ group: 'checklist', audiences: ['assignees'], hasLeadTime: true });
    expect(NOTIFICATION_TYPE_META['problem.critical']).toEqual({ group: 'problem', audiences: [], hasLeadTime: false });
    expect(NOTIFICATION_TYPE_META['task.overdue']).toEqual({ group: 'task', audiences: ['assignees', 'creator'], hasLeadTime: false });
    expect(RULE_TYPES.filter((t) => NOTIFICATION_TYPE_META[t].hasLeadTime)).toEqual(['checklist.due_soon']);
  });

  it('holds the interfaces table of defaults', () => {
    const row = (t: (typeof RULE_TYPES)[number]) => {
      const d = DEFAULT_RULES[t];
      return [d.enabled, d.push, d.email, d.notifyAssignees, d.notifyCreator, [...d.systemRoles], d.leadMinutes];
    };
    expect(RULE_TYPES.map((t) => [t, ...row(t)])).toEqual([
      ['checklist.assigned', true, true, false, true, false, [], null],
      ['checklist.available', true, true, false, true, false, [], null],
      ['checklist.due_soon', true, true, false, true, false, [], 30],
      ['checklist.overdue', true, true, false, true, false, ['manager'], null],
      ['checklist.missed', true, false, false, false, false, ['manager', 'admin'], null],
      ['problem.recorded', true, true, false, false, false, ['manager'], null],
      ['problem.critical', true, true, true, false, false, ['manager', 'admin'], null],
      ['task.assigned', true, true, false, true, false, [], null],
      ['task.submitted', true, true, false, false, true, [], null],
      ['task.rejected', true, true, false, true, false, [], null],
      ['task.completed', true, true, false, false, true, [], null],
      ['task.overdue', true, true, false, true, true, [], null],
      ['task.cancelled', true, true, false, true, false, [], null],
    ]);
  });

  it('opens the execution tab for problem types only', () => {
    expect(NOTIFICATION_TYPES.filter(isProblemType)).toEqual(['problem.recorded', 'problem.critical']);
  });
});

describe('rule schemas', () => {
  const base = { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [ID, ID, ID2], leadMinutes: 60 };

  it('accepts a full rule, removes duplicate role ids and allows only the four lead times', () => {
    expect(updateNotificationRuleSchema.parse(base)).toEqual({ ...base, roleIds: [ID, ID2] });
    expect(LEAD_MINUTES).toEqual([15, 30, 60, 120]);
    for (const m of LEAD_MINUTES) expect(leadMinutesSchema.parse(m)).toBe(m);
    expect(updateNotificationRuleSchema.safeParse({ ...base, leadMinutes: 45 }).success).toBe(false);
    expect(updateNotificationRuleSchema.safeParse({ ...base, leadMinutes: null }).success).toBe(true);
    const { email: _e, ...missing } = base;
    expect(updateNotificationRuleSchema.safeParse(missing).success).toBe(false);
    expect(updateNotificationRuleSchema.safeParse({ ...base, roleIds: Array.from({ length: 51 }, () => ID) }).success).toBe(false);
  });

  it('parses the effective rule a client receives', () => {
    const dto = { type: 'checklist.due_soon', ...base, roleIds: [ID], leadMinutes: 30, isDefault: false };
    expect(notificationRuleDtoSchema.parse(dto)).toEqual(dto);
    expect(notificationRuleDtoSchema.safeParse({ ...dto, type: 'manual' }).success).toBe(false);
  });
});

describe('inbox schemas', () => {
  it('parses an inbox item and the list query', () => {
    const item = { id: ID, type: 'problem.critical', title: 'Kritik problem', body: 'Filial 1', targetKind: 'occurrence', targetId: ID, targetDate: '2026-11-02', createdAt: AT, readAt: null };
    expect(notificationItemSchema.parse(item)).toEqual(item);
    expect(notificationListQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(notificationListQuerySchema.parse({ cursor: ID, limit: '100', unread: 'true' })).toEqual({ cursor: ID, limit: 100, unread: true });
    expect(notificationListQuerySchema.parse({ unread: 'false' }).unread).toBe(false);
    expect(notificationListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(notificationListQuerySchema.safeParse({ unread: 'yes' }).success).toBe(false);
  });

  it('accepts Expo push tokens only', () => {
    expect(registerPushDeviceSchema.parse({ expoToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'ios' }).platform).toBe('ios');
    expect(registerPushDeviceSchema.safeParse({ expoToken: 'ExpoPushToken[abc]', platform: 'android' }).success).toBe(true);
    expect(registerPushDeviceSchema.safeParse({ expoToken: 'fcm:abc', platform: 'android' }).success).toBe(false);
    expect(registerPushDeviceSchema.safeParse({ expoToken: `ExpoPushToken[${'a'.repeat(200)}]`, platform: 'android' }).success).toBe(false);
    expect(registerPushDeviceSchema.safeParse({ expoToken: 'ExpoPushToken[abc]', platform: 'web' }).success).toBe(false);
    expect(updatePreferencesSchema.parse({ emailNotifications: false })).toEqual({ emailNotifications: false });
  });

  it('parses the push data of a notification', () => {
    const data = { notificationId: ID, userId: ID, tenantId: ID, type: 'task.assigned', targetKind: 'task', targetId: ID, targetDate: null };
    expect(pushDataSchema.parse(data)).toEqual(data);
    const manual = { ...data, type: 'manual', targetKind: 'none', targetId: null, targetDate: null };
    expect(pushDataSchema.parse(manual)).toEqual(manual);
    const occurrence = { ...data, type: 'checklist.overdue', targetKind: 'occurrence', targetDate: '2026-11-02' };
    expect(pushDataSchema.parse(occurrence)).toEqual(occurrence);
    expect(pushDataSchema.safeParse({ ...data, targetKind: 'site' }).success).toBe(false);
  });
});

describe('message schemas', () => {
  it('trims, defaults and needs at least one target', () => {
    expect(sendMessageSchema.parse({ title: '  Diqqət ', body: ' Sabah iclas var. ', teamIds: [ID] })).toEqual({
      title: 'Diqqət',
      body: 'Sabah iclas var.',
      userIds: [],
      teamIds: [ID],
      siteIds: [],
      email: false,
    });
    const empty = sendMessageSchema.safeParse({ title: 'a', body: 'b' });
    expect(empty.success).toBe(false);
    expect(empty.error!.issues).toEqual([expect.objectContaining({ path: ['userIds'], message: 'notifications.issues.noTargets' })]);
  });

  it('enforces the message limits', () => {
    const ok = { title: 'x'.repeat(80), body: 'y'.repeat(500), userIds: [ID] };
    expect(MESSAGE_LIMITS).toEqual({ titleMax: 80, bodyMax: 500, maxRecipients: 1000, maxTargetsPerKind: 200 });
    expect(sendMessageSchema.safeParse(ok).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...ok, title: 'x'.repeat(81) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...ok, body: 'y'.repeat(501) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...ok, title: '   ' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...ok, siteIds: Array.from({ length: 201 }, () => ID) }).success).toBe(false);
  });

  it('aggregates a recipient’s deliveries on one channel', () => {
    expect(DELIVERY_STATUSES).toEqual(['queued', 'sent', 'delivered', 'failed', 'skipped']);
    expect(aggregateDeliveryStatus([])).toBeNull();
    expect(aggregateDeliveryStatus(['failed', 'delivered'])).toBe('delivered');
    expect(aggregateDeliveryStatus(['failed', 'sent', 'queued'])).toBe('sent');
    expect(aggregateDeliveryStatus(['skipped', 'queued'])).toBe('queued');
    expect(aggregateDeliveryStatus(['skipped', 'failed'])).toBe('failed');
    expect(aggregateDeliveryStatus(['skipped'])).toBe('skipped');
  });

  it('parses summaries, details and picker options', () => {
    const summary = {
      id: ID, title: 'Diqqət', body: 'Sabah iclas var.', sender: { id: ID, fullName: 'Elvin' }, sentAt: AT, emailRequested: true,
      processed: true, recipientCount: 2, readCount: 1, push: { ...zero, delivered: 1, failed: 1 }, email: { ...zero, sent: 2 },
    };
    expect(messageSummarySchema.parse(summary)).toEqual(summary);
    expect(messageSummarySchema.safeParse({ ...summary, push: { delivered: 1 } }).success).toBe(false);
    const detail = {
      ...summary,
      targets: { users: [{ id: ID, fullName: 'Nigar' }], teams: [{ id: ID, name: 'Texniki xidmət' }], sites: [{ id: ID, name: 'Filial 1' }] },
      recipients: [
        { user: { id: ID, fullName: 'Nigar' }, readAt: AT, push: { status: 'failed', devices: 1, lastError: 'DeviceNotRegistered: gone' }, email: { status: null, lastError: null } },
      ],
    };
    expect(messageDetailSchema.parse(detail)).toEqual(detail);
    const options = { users: [{ id: ID, fullName: 'Nigar', jobTitle: null }], teams: [{ id: ID, name: 'Texniki xidmət', memberCount: 2 }], sites: [{ id: ID, name: 'Filial 1' }] };
    expect(messageTargetOptionsSchema.parse(options)).toEqual(options);
  });

  it('names every issue with its full i18n key', () => {
    expect(NOTIFICATION_ISSUE_CODES).toEqual([
      'notifications.issues.noTargets',
      'notifications.issues.noRecipients',
      'notifications.issues.tooManyRecipients',
      'notifications.issues.leadMinutesRequired',
      'notifications.issues.leadMinutesNotApplicable',
      'notifications.issues.audienceNotApplicable',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- notifications`
Expected: FAIL: `NOTIFICATION_TYPES` (and every other import) is not exported from `./index.js`.

- [ ] **Step 3: Write the contracts**

`packages/contracts/src/notifications.ts`:

```ts
import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { userRefSchema } from './occurrences.js';
import type { SystemRoleKey } from './permissions.js';
import { localDateSchema } from './scheduling-time.js';

/** Spec §3.1. Every notification type; `manual` is an admin message and has no rule. */
export const NOTIFICATION_TYPES = [
  'checklist.assigned',
  'checklist.available',
  'checklist.due_soon',
  'checklist.overdue',
  'checklist.missed',
  'problem.recorded',
  'problem.critical',
  'task.assigned',
  'task.submitted',
  'task.rejected',
  'task.completed',
  'task.overdue',
  'task.cancelled',
  'manual',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** The types a tenant rule governs (spec §3.2): every type except `manual`, in the same order. */
export const RULE_TYPES = [
  'checklist.assigned',
  'checklist.available',
  'checklist.due_soon',
  'checklist.overdue',
  'checklist.missed',
  'problem.recorded',
  'problem.critical',
  'task.assigned',
  'task.submitted',
  'task.rejected',
  'task.completed',
  'task.overdue',
  'task.cancelled',
] as const satisfies readonly Exclude<NotificationType, 'manual'>[];
export const ruleTypeSchema = z.enum(RULE_TYPES);
export type RuleType = z.infer<typeof ruleTypeSchema>;

export const NOTIFICATION_GROUPS = ['checklist', 'problem', 'task'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/** Direct audiences a rule can switch on. For checklist.assigned, "assignees" means the users just added. */
export const DIRECT_AUDIENCES = ['assignees', 'creator'] as const;
export type DirectAudience = (typeof DIRECT_AUDIENCES)[number];

export interface NotificationTypeMeta {
  group: NotificationGroup;
  /** The direct audiences the settings row shows; others must stay false. */
  audiences: readonly DirectAudience[];
  /** Only checklist.due_soon has a lead time. */
  hasLeadTime: boolean;
}

const checklistMeta = (hasLeadTime = false): NotificationTypeMeta => ({ group: 'checklist', audiences: ['assignees'], hasLeadTime });
const problemMeta: NotificationTypeMeta = { group: 'problem', audiences: [], hasLeadTime: false };
const taskMeta: NotificationTypeMeta = { group: 'task', audiences: ['assignees', 'creator'], hasLeadTime: false };

export const NOTIFICATION_TYPE_META: Record<RuleType, NotificationTypeMeta> = {
  'checklist.assigned': checklistMeta(),
  'checklist.available': checklistMeta(),
  'checklist.due_soon': checklistMeta(true),
  'checklist.overdue': checklistMeta(),
  'checklist.missed': checklistMeta(),
  'problem.recorded': problemMeta,
  'problem.critical': problemMeta,
  'task.assigned': taskMeta,
  'task.submitted': taskMeta,
  'task.rejected': taskMeta,
  'task.completed': taskMeta,
  'task.overdue': taskMeta,
  'task.cancelled': taskMeta,
};

/** FR-15.04: one tenant-wide reminder lead time on the due-soon rule. */
export const LEAD_MINUTES = [15, 30, 60, 120] as const;
export type LeadMinutes = (typeof LEAD_MINUTES)[number];
export const leadMinutesSchema = z.literal([15, 30, 60, 120]);

export type DefaultRule = {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  /** Turned into the tenant's role ids by the API (roles.system_key); clients never see this. */
  systemRoles: readonly SystemRoleKey[];
  leadMinutes: LeadMinutes | null;
};

const rule = (
  push: boolean,
  email: boolean,
  notifyAssignees: boolean,
  notifyCreator: boolean,
  systemRoles: readonly SystemRoleKey[] = [],
  leadMinutes: LeadMinutes | null = null,
): DefaultRule => ({ enabled: true, push, email, notifyAssignees, notifyCreator, systemRoles, leadMinutes });

/** Spec §3.1: the rule a tenant has until it saves its own. */
export const DEFAULT_RULES: Record<RuleType, DefaultRule> = {
  'checklist.assigned': rule(true, false, true, false),
  'checklist.available': rule(true, false, true, false),
  'checklist.due_soon': rule(true, false, true, false, [], 30),
  'checklist.overdue': rule(true, false, true, false, ['manager']),
  'checklist.missed': rule(false, false, false, false, ['manager', 'admin']),
  'problem.recorded': rule(true, false, false, false, ['manager']),
  'problem.critical': rule(true, true, false, false, ['manager', 'admin']),
  'task.assigned': rule(true, false, true, false),
  'task.submitted': rule(true, false, false, true),
  'task.rejected': rule(true, false, true, false),
  'task.completed': rule(true, false, false, true),
  'task.overdue': rule(true, false, true, true),
  'task.cancelled': rule(true, false, true, false),
};

/** The web opens a problem notification on the execution tab. */
export const isProblemType = (t: NotificationType): boolean => t.startsWith('problem.');

/** The effective rule (spec §3.2): the default with the tenant's row laid over it. */
export const notificationRuleDtoSchema = z.object({
  type: ruleTypeSchema,
  enabled: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
  notifyAssignees: z.boolean(),
  notifyCreator: z.boolean(),
  roleIds: z.array(idSchema),
  leadMinutes: leadMinutesSchema.nullable(),
  /** True while the tenant has no override row. */
  isDefault: z.boolean(),
});
export type NotificationRuleDto = z.infer<typeof notificationRuleDtoSchema>;

/** PUT /notification-rules/:type: always the full rule. The API checks audiences and the lead time per type. */
export const updateNotificationRuleSchema = z.object({
  enabled: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
  notifyAssignees: z.boolean(),
  notifyCreator: z.boolean(),
  roleIds: z
    .array(idSchema)
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  leadMinutes: leadMinutesSchema.nullable(),
});
export type UpdateNotificationRuleInput = z.input<typeof updateNotificationRuleSchema>;
export type UpdateNotificationRuleOutput = z.output<typeof updateNotificationRuleSchema>;

export const NOTIFICATION_TARGET_KINDS = ['occurrence', 'task', 'none'] as const;
export const notificationTargetKindSchema = z.enum(NOTIFICATION_TARGET_KINDS);
export type NotificationTargetKind = z.infer<typeof notificationTargetKindSchema>;

/** One inbox row (FR-25.01). Title and body were rendered at fan-out and never change. */
export const notificationItemSchema = z.object({
  id: idSchema,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  targetKind: notificationTargetKindSchema,
  targetId: idSchema.nullable(),
  /** The occurrence's local date, for the web schedule link; set only for targetKind 'occurrence'. */
  targetDate: localDateSchema.nullable(),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationListQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** 'true' = unread only; 'false' or absent = all (Spec decision 14). */
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type NotificationListQuery = z.input<typeof notificationListQuerySchema>;

export const unreadCountSchema = z.object({ count: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export const pushPlatformSchema = z.enum(PUSH_PLATFORMS);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const registerPushDeviceSchema = z.object({
  expoToken: z
    .string()
    .max(200)
    .regex(/^Expo(nent)?PushToken\[.+\]$/),
  platform: pushPlatformSchema,
});
export type RegisterPushDeviceInput = z.input<typeof registerPushDeviceSchema>;

export const preferencesSchema = z.object({ emailNotifications: z.boolean() });
export type Preferences = z.infer<typeof preferencesSchema>;
export const updatePreferencesSchema = z.object({ emailNotifications: z.boolean() });
export type UpdatePreferencesInput = z.input<typeof updatePreferencesSchema>;

/** The `data` of every push (spec §6.1 step 5). The phone parses it with safeParse. */
export const pushDataSchema = z.object({
  notificationId: idSchema,
  userId: idSchema,
  tenantId: idSchema,
  type: notificationTypeSchema,
  targetKind: notificationTargetKindSchema,
  targetId: idSchema.nullable(),
  targetDate: localDateSchema.nullable(),
});
export type PushData = z.infer<typeof pushDataSchema>;

export const MESSAGE_LIMITS = { titleMax: 80, bodyMax: 500, maxRecipients: 1000, maxTargetsPerKind: 200 } as const;

export const NOTIFICATION_ISSUE_CODES = [
  'notifications.issues.noTargets',
  'notifications.issues.noRecipients',
  'notifications.issues.tooManyRecipients',
  'notifications.issues.leadMinutesRequired',
  'notifications.issues.leadMinutesNotApplicable',
  'notifications.issues.audienceNotApplicable',
] as const;
export type NotificationIssueCode = (typeof NOTIFICATION_ISSUE_CODES)[number];

const targetIds = z.array(idSchema).max(MESSAGE_LIMITS.maxTargetsPerKind).default([]);

/** FR-15.08: a message to users, teams and sites (spec §6.4). */
export const sendMessageSchema = z
  .object({
    title: z.string().trim().min(1).max(MESSAGE_LIMITS.titleMax),
    body: z.string().trim().min(1).max(MESSAGE_LIMITS.bodyMax),
    userIds: targetIds,
    teamIds: targetIds,
    siteIds: targetIds,
    email: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (!v.userIds.length && !v.teamIds.length && !v.siteIds.length) {
      ctx.addIssue({ code: 'custom', path: ['userIds'], message: 'notifications.issues.noTargets' });
    }
  });
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const messagePreviewSchema = z.object({ recipientCount: z.number().int().min(0) });
export type MessagePreview = z.infer<typeof messagePreviewSchema>;

export const DELIVERY_CHANNELS = ['push', 'email'] as const;
export const deliveryChannelSchema = z.enum(DELIVERY_CHANNELS);
export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;

export const DELIVERY_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'skipped'] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/** Best first: a user with one delivered device counts as delivered. */
const AGGREGATE_ORDER: readonly DeliveryStatus[] = ['delivered', 'sent', 'queued', 'failed', 'skipped'];

/** One recipient's status on one channel from all its deliveries; null when there are none. */
export function aggregateDeliveryStatus(statuses: readonly DeliveryStatus[]): DeliveryStatus | null {
  return AGGREGATE_ORDER.find((s) => statuses.includes(s)) ?? null;
}

const count = z.number().int().min(0);
/** Recipients per aggregated status; recipients with no delivery on the channel are not counted. */
export const deliveryCountsSchema = z.object({ queued: count, sent: count, delivered: count, failed: count, skipped: count });
export type DeliveryCounts = z.infer<typeof deliveryCountsSchema>;

export const messageSummarySchema = z.object({
  /** The notification event id. */
  id: idSchema,
  title: z.string(),
  body: z.string(),
  sender: userRefSchema.nullable(),
  sentAt: isoDateTimeSchema,
  emailRequested: z.boolean(),
  /** False while fan-out has not run; every count is then 0. */
  processed: z.boolean(),
  recipientCount: count,
  readCount: count,
  push: deliveryCountsSchema,
  email: deliveryCountsSchema,
});
export type MessageSummary = z.infer<typeof messageSummarySchema>;

export const messageListQuerySchema = cursorQuerySchema;
export type MessageListQuery = z.input<typeof messageListQuerySchema>;

export const messageRecipientSchema = z.object({
  user: userRefSchema,
  readAt: isoDateTimeSchema.nullable(),
  push: z.object({ status: deliveryStatusSchema.nullable(), devices: count, lastError: z.string().nullable() }),
  email: z.object({ status: deliveryStatusSchema.nullable(), lastError: z.string().nullable() }),
});
export type MessageRecipient = z.infer<typeof messageRecipientSchema>;

const namedRefSchema = z.object({ id: idSchema, name: z.string() });

export const messageDetailSchema = messageSummarySchema.extend({
  targets: z.object({ users: z.array(userRefSchema), teams: z.array(namedRefSchema), sites: z.array(namedRefSchema) }),
  /** By full name. */
  recipients: z.array(messageRecipientSchema),
});
export type MessageDetail = z.infer<typeof messageDetailSchema>;

export const messageTargetOptionsQuerySchema = z.object({ q: z.string().trim().max(100).optional() });
export type MessageTargetOptionsQuery = z.input<typeof messageTargetOptionsQuerySchema>;

/** GET /notifications/messages/options: everything inside the caller's data scope (Spec decision 13). */
export const messageTargetOptionsSchema = z.object({
  users: z.array(z.object({ id: idSchema, fullName: z.string(), jobTitle: z.string().nullable() })),
  teams: z.array(z.object({ id: idSchema, name: z.string(), memberCount: count })),
  sites: z.array(namedRefSchema),
});
export type MessageTargetOptions = z.infer<typeof messageTargetOptionsSchema>;
```

Add to `packages/contracts/src/index.ts`, after `export * from './sync.js';`:

```ts
export * from './notifications.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS. If `z.literal([15, 30, 60, 120])` does not type-check, the installed Zod is older than 4.0; the repo pins `zod ^4.6.5`, which supports literal arrays.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/notifications.ts packages/contracts/src/notifications.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add the notification catalogue, rules, inbox, push device and message contracts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sync, profile, permission and audit changes to the existing contracts

**Files:**
- Modify:
  - `packages/contracts/src/sync.ts`, `auth.ts`, `permissions.ts`, `audit.ts`, `notifications.test.ts`
  - `packages/contracts/src/execution-views.test.ts`, `task-views.test.ts`, `resources.test.ts`
  - `packages/api-client/src/client.test.ts` (fixtures only)
  - `apps/api/src/auth/me.service.ts`, `apps/api/src/executions/sync.service.ts`, `apps/api/src/common/error.filter.ts`, `apps/api/src/common/error.filter.test.ts`, `apps/api/test/roles.test.ts`

**Fixtures in the apps (decision, agreed with Parts 2 and 3):** this task does **not** touch `apps/mobile` or `apps/web`. Making `unreadNotifications` and `emailNotifications` required breaks a few typed fixtures there (`apps/mobile/src/offline/testing/fixtures.ts` `syncResponse`, the `me` fixture of `apps/mobile/src/lib/session.test.ts` that the session restore parses with `meSchema`, and `apps/web/src/layouts/app-shell.test.tsx`). Part 2's Task 1 repairs the mobile ones and Part 3's Task 1 the web ones, so the three plans never edit the same lines. Until those tasks land, `pnpm --filter @taskop/mobile test` / `typecheck` and the web's may report those fixtures; this task's verification therefore runs contracts, api-client and api only.

**Interfaces:**
- Consumes: Task 1.
- Produces: everything under **Changes to existing contracts** in *Interfaces for Parts 2 and 3*: `SyncResponse.unreadNotifications`, `Me.user.emailNotifications`, the `notifications` permission group, `NOTIFICATION_AUDIT_ACTIONS`, `type NotificationAuditAction`. The API keeps compiling with interim values (Spec decision 19): `GET /me` answers `emailNotifications: true` until Task 16, `/me/sync` answers `unreadNotifications: 0` until Task 16. The error filter passes `notifications.*` zod messages through as field keys.

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/src/notifications.test.ts` (extend the `./index.js` import with `ALL_PERMISSIONS`, `meSchema`, `NOTIFICATION_AUDIT_ACTIONS`, `PERMISSION_GROUPS`, `SYSTEM_ROLE_DEFAULTS` and `syncResponseSchema`):

```ts
describe('changes to existing contracts', () => {
  it('adds the unread count to the sync response', () => {
    const base = { serverTime: AT, occurrences: [], checklistVersions: [], executions: [], tasks: [], removedTaskIds: [] };
    expect(syncResponseSchema.parse({ ...base, unreadNotifications: 3 }).unreadNotifications).toBe(3);
    expect(syncResponseSchema.safeParse(base).success).toBe(false);
    expect(syncResponseSchema.safeParse({ ...base, unreadNotifications: -1 }).success).toBe(false);
  });

  it('reports the email preference on the profile', () => {
    const me = {
      user: { id: ID, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password', emailNotifications: false },
      role: { id: ID, name: 'Owner', systemKey: 'owner', dataScope: 'all' },
      permissions: [],
      tenant: { id: ID, name: 'Acme', orgCode: 'acme', timezone: 'Asia/Baku', locale: 'az' },
    };
    expect(meSchema.parse(me).user.emailNotifications).toBe(false);
  });

  it('adds the notification permissions last, with the role defaults', () => {
    expect(PERMISSION_GROUPS.at(-1)).toEqual({ group: 'notifications', keys: ['notifications.manage', 'notifications.send'] });
    expect(SYSTEM_ROLE_DEFAULTS.owner.permissions).toEqual(expect.arrayContaining(['notifications.manage', 'notifications.send']));
    expect(SYSTEM_ROLE_DEFAULTS.admin.permissions).toEqual(expect.arrayContaining(['notifications.manage', 'notifications.send']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toContain('notifications.send');
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('notifications.manage');
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions.filter((k) => k.startsWith('notifications.'))).toEqual([]);
    expect(ALL_PERMISSIONS.slice(-2)).toEqual(['notifications.manage', 'notifications.send']);
  });

  it('lists the audited notification actions', () => {
    expect(NOTIFICATION_AUDIT_ACTIONS).toEqual(['notification_rule.updated', 'notification_rule.reset', 'notification.message_sent']);
  });
});
```

Append to `apps/api/src/common/error.filter.test.ts`, inside `describe('toAppError', …)` after `maps zod validation errors to field keys`:

```ts
  it('passes notification issue keys through as field keys', () => {
    const r = z
      .object({ userIds: z.array(z.string()) })
      .superRefine((_v, ctx) => ctx.addIssue({ code: 'custom', path: ['userIds'], message: 'notifications.issues.noTargets' }))
      .safeParse({ userIds: [] });
    expect(toAppError(new ZodValidationException(r.error!)).fields).toEqual({ userIds: 'notifications.issues.noTargets' });
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/contracts test -- notifications && pnpm --filter @taskop/api test -- error.filter`
Expected: FAIL: `NOTIFICATION_AUDIT_ACTIONS` is undefined, the sync response accepts a missing `unreadNotifications`, the last permission group is `tasks`; the error filter maps the issue to `errors.validation.invalid`.

- [ ] **Step 3: Change the contracts**

In `packages/contracts/src/sync.ts`, add the last field of `syncResponseSchema`, after `removedTaskIds: z.array(idSchema),`:

```ts
  /** The caller's unread inbox rows (spec §4); the phone sets its app-icon badge from it. */
  unreadNotifications: z.number().int().min(0),
```

In `packages/contracts/src/auth.ts`, in `meSchema.user`, after `credentialKind: credentialKindSchema.nullable(),` add:

```ts
    /** B-12: the only per-user notification switch. */
    emailNotifications: z.boolean(),
```

In `packages/contracts/src/permissions.ts`:
- Add the last group to `PERMISSION_GROUPS`, after `tasks`:

```ts
  { group: 'notifications', keys: ['notifications.manage', 'notifications.send'] },
```

- The manager's `permissions` in `SYSTEM_ROLE_DEFAULTS` become:

```ts
    permissions: ['sites.view', 'teams.view', 'users.view', 'checklists.view', 'checklists.manage', 'assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage', 'tasks.view', 'tasks.manage', 'notifications.send'],
```

Append to `packages/contracts/src/audit.ts`:

```ts
/**
 * Audited notification actions (spec §4). `notification_rule.*` use entity type `notification_rule` with a null entity id and
 * `{ type, … }` in before/after; `notification.message_sent` uses entity type `notification_message`, entity id = the event id.
 */
export const NOTIFICATION_AUDIT_ACTIONS = ['notification_rule.updated', 'notification_rule.reset', 'notification.message_sent'] as const;
export type NotificationAuditAction = (typeof NOTIFICATION_AUDIT_ACTIONS)[number];
```

- [ ] **Step 4: Keep the existing fixtures parsing**

In `packages/contracts/src/execution-views.test.ts`, in `keeps checklist content opaque in a sync response`, after `removedTaskIds: [],` add `unreadNotifications: 0,`.

In `packages/contracts/src/task-views.test.ts`, the `syncResponseSchema.parse(…)` call becomes:

```ts
    const r = syncResponseSchema.parse({ serverTime: AT, occurrences: [], checklistVersions: [], executions: [], tasks: [phone], removedTaskIds: [ID], unreadNotifications: 0 });
```

In `packages/contracts/src/resources.test.ts`, the `meSchema` fixture's `user` becomes:

```ts
        user: { id, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password', emailNotifications: true },
```

In `packages/api-client/src/client.test.ts`:
- the top-level `me` fixture's `user` becomes:

```ts
  user: { id, fullName: 'A B', jobTitle: null, kind: 'staff', email: 'a@b.az', username: null, emailVerified: true, credentialKind: 'password', emailNotifications: true },
```

- both `/me/sync` mock responses gain `unreadNotifications: 0` after `removedTaskIds: […]`:

```ts
      if (url.includes('/me/sync')) return json(200, { serverTime: '2026-11-02T04:00:00.000Z', occurrences: [], checklistVersions: [], executions: [], tasks: [], removedTaskIds: [], unreadNotifications: 0 });
```

```ts
      if (url.includes('/me/sync')) return json(200, { serverTime: now, occurrences: [], checklistVersions: [], executions: [], tasks: [], removedTaskIds: [id], unreadNotifications: 0 });
```


- [ ] **Step 5: Keep the API compiling and passing**

In `apps/api/src/auth/me.service.ts`, after `credentialKind: row.user.credentialKind,` add:

```ts
        // Read from users.email_notifications once the column exists (Task 16).
        emailNotifications: true,
```

In `apps/api/src/executions/sync.service.ts`, the returned object ends with:

```ts
      ...(await this.taskSync.forUser(p, q.knownTaskIds, now)),
      // Counted from the inbox once it exists (Task 16).
      unreadNotifications: 0,
    };
```

In `apps/api/src/common/error.filter.ts`, the field-key test in `toAppError` becomes:

```ts
      fields[key] ??= /^(errors|scheduling|executions|tasks|notifications)\./.test(issue.message) ? issue.message : 'errors.validation.invalid';
```

In `apps/api/test/roles.test.ts`, the expected manager permissions become:

```ts
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual([
      'assignments.manage', 'assignments.view', 'checklists.manage', 'checklists.view', 'notifications.send', 'shifts.manage', 'shifts.view', 'sites.view', 'tasks.manage', 'tasks.view', 'teams.view', 'users.view',
    ]);
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- error.filter roles executions-sync auth-signup && pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck`
Expected: PASS. `auth-signup` still sees every permission for the owner (it compares with `ALL_PERMISSIONS`). Do not run the i18n tests yet: `labels every permission group and key` fails until Task 3 adds the labels. Do not run the mobile and web checks here (see **Fixtures in the apps** above).

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src packages/api-client/src/client.test.ts apps/api/src/auth/me.service.ts apps/api/src/executions/sync.service.ts apps/api/src/common/error.filter.ts apps/api/src/common/error.filter.test.ts apps/api/test/roles.test.ts
git commit -m "feat(contracts): add unread count to sync, email preference to me, notification permissions and audit actions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Azerbaijani strings for notification types, rules, channels, statuses and issues

**Files:**
- Create: `packages/i18n/src/az/notifications.ts`
- Modify: `packages/i18n/src/az/roles.ts`, `packages/i18n/src/az/audit.ts`, `packages/i18n/src/az/nav.ts`, `packages/i18n/src/az/index.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `NOTIFICATION_TYPES`, `NOTIFICATION_GROUPS`, `DIRECT_AUDIENCES`, `DELIVERY_STATUSES`, `NOTIFICATION_ISSUE_CODES` (Task 1); the `notifications` permission group (Task 2).
- Produces: `az.notifications` and the keys listed under `@taskop/i18n` in *Interfaces for Parts 2 and 3*. The audit page has no `actions` map (only `entityTypes`), so no action labels are added.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`. Extend the `@taskop/contracts` import with `DELIVERY_STATUSES`, `DIRECT_AUDIENCES`, `NOTIFICATION_GROUPS`, `NOTIFICATION_ISSUE_CODES` and `NOTIFICATION_TYPES`:

```ts
describe('notification translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('labels every type, group, audience, channel, delivery status and issue', () => {
    for (const ty of NOTIFICATION_TYPES) expect(az.notifications.types[ty], ty).toBeTypeOf('string');
    for (const g of NOTIFICATION_GROUPS) expect(az.notifications.groups[g], g).toBeTypeOf('string');
    for (const a of DIRECT_AUDIENCES) expect(az.notifications.audiences[a], a).toBeTypeOf('string');
    for (const c of ['inApp', 'push', 'email'] as const) expect(az.notifications.channels[c], c).toBeTypeOf('string');
    for (const s of DELIVERY_STATUSES) expect(az.notifications.deliveryStatuses[s], s).toBeTypeOf('string');
    for (const code of NOTIFICATION_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
  });

  it('uses the agreed wording and registers the nav, audit and role labels', () => {
    expect(az.notifications.types['checklist.due_soon']).toBe('Checklistin vaxtı yaxınlaşır');
    expect(az.notifications.types.manual).toBe('Admin mesajı');
    expect(az.notifications.groups).toEqual({ checklist: 'Checklistlər', problem: 'Problemlər', task: 'Tapşırıqlar' });
    expect(az.notifications.audiences).toEqual({ assignees: 'İcraçılar', creator: 'Yaradan' });
    expect(az.notifications.channels).toEqual({ inApp: 'Tətbiqdə', push: 'Push', email: 'E-poçt' });
    expect(az.notifications.leadMinutes).toBe('{{count}} dəq əvvəl');
    expect(az.notifications.title).toBe('Bildirişlər');
    expect(az.notifications.markAllRead).toBe('Hamısını oxunmuş et');
    expect(az.notifications.empty).toBe('Bildiriş yoxdur');
    expect(az.nav.notifications).toBe('Bildirişlər');
    expect(az.nav.messages).toBe('Mesajlar');
    expect(az.roles.groups.notifications).toBe('Bildirişlər');
    expect(az.roles.keys.notifications_manage).toBeTypeOf('string');
    expect(az.roles.keys.notifications_send).toBeTypeOf('string');
    expect(az.audit.entityTypes.notification_rule).toBe('Bildiriş qaydası');
    expect(az.audit.entityTypes.notification_message).toBe('Bildiriş mesajı');
  });
});
```

(The existing test `labels every permission group and key` now also covers `notifications.manage` and `notifications.send`.)

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.notifications` is undefined, and the permission-label test fails for the `notifications` group and keys.

- [ ] **Step 3: Implement**

`packages/i18n/src/az/notifications.ts`:

```ts
export default {
  title: 'Bildirişlər',
  markAllRead: 'Hamısını oxunmuş et',
  empty: 'Bildiriş yoxdur',
  /** Rule-row labels in Settings → Bildirişlər, and the inbox's type labels. */
  types: {
    'checklist.assigned': 'Checklist təyin edildi',
    'checklist.available': 'Checklist başladı',
    'checklist.due_soon': 'Checklistin vaxtı yaxınlaşır',
    'checklist.overdue': 'Checklist gecikir',
    'checklist.missed': 'Checklist buraxıldı',
    'problem.recorded': 'Yeni problem',
    'problem.critical': 'Kritik problem',
    'task.assigned': 'Tapşırıq təyin edildi',
    'task.submitted': 'Tapşırıq yoxlamaya göndərildi',
    'task.rejected': 'Tapşırıq geri qaytarıldı',
    'task.completed': 'Tapşırıq tamamlandı',
    'task.overdue': 'Tapşırıq gecikir',
    'task.cancelled': 'Tapşırıq ləğv edildi',
    manual: 'Admin mesajı',
  },
  groups: { checklist: 'Checklistlər', problem: 'Problemlər', task: 'Tapşırıqlar' },
  audiences: { assignees: 'İcraçılar', creator: 'Yaradan' },
  channels: { inApp: 'Tətbiqdə', push: 'Push', email: 'E-poçt' },
  deliveryStatuses: { queued: 'Növbədə', sent: 'Göndərildi', delivered: 'Çatdırıldı', failed: 'Alınmadı', skipped: 'Ötürüldü' },
  issues: {
    noTargets: 'Ən azı bir istifadəçi, komanda və ya obyekt seçin.',
    noRecipients: 'Seçiminizə uyğun aktiv alıcı yoxdur.',
    tooManyRecipients: 'Bir mesaj ən çox 1000 nəfərə göndərilə bilər.',
    leadMinutesRequired: 'Xatırlatma vaxtını seçin.',
    leadMinutesNotApplicable: 'Bu bildiriş növü üçün xatırlatma vaxtı yoxdur.',
    audienceNotApplicable: 'Bu alıcı bu bildiriş növünə aid deyil.',
  },
  leadMinutes: '{{count}} dəq əvvəl',
} as const;
```

In `packages/i18n/src/az/roles.ts`, add `notifications: 'Bildirişlər',` as the last entry of `groups`, and the last two entries of `keys`:

```ts
    notifications_manage: 'Bildiriş qaydalarını idarə etmək',
    notifications_send: 'Bildiriş mesajları göndərmək',
```

In `packages/i18n/src/az/audit.ts`, add the last two entries of `entityTypes`:

```ts
    notification_rule: 'Bildiriş qaydası',
    notification_message: 'Bildiriş mesajı',
```

In `packages/i18n/src/az/nav.ts`, after `tasks: 'Tapşırıqlar',` add:

```ts
  notifications: 'Bildirişlər',
  messages: 'Mesajlar',
```

In `packages/i18n/src/az/index.ts`, import `notifications from './notifications.js'` and add it to `az` after `nav`:

```ts
export const az = { common, errors, executions, audit, auth, checklists, mobile, nav, notifications, platform, roles, scheduling, settings, sites, tasks, teams, users } as const;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n typecheck && pnpm --filter @taskop/i18n build`
Expected: PASS. (The apps' checks wait for Parts 2 and 3's first tasks; see Task 2, **Fixtures in the apps**.)

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add Azerbaijani strings for notification types, rules, channels, statuses and issues" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: API client methods for the inbox, push devices, preferences, rules and messages

**Files:**
- Modify: `packages/api-client/src/endpoints.ts`, `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: the schemas and types of Tasks 1–2.
- Produces: `createNotificationsApi(c: ApiClient)`, `type NotificationsApi`, spread into `createTaskopApi`. Method table under **`@taskop/api-client`** in *Interfaces for Parts 2 and 3*.

- [ ] **Step 1: Write the failing test**

Append to `packages/api-client/src/client.test.ts`:

```ts
describe('notification endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'mobile', store);
  }
  const now = '2026-11-02T04:00:00.000Z';
  const token = 'ExponentPushToken[abc]';
  const zero = { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 };
  const rule = { type: 'task.assigned', enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, isDefault: true };
  const summary = {
    id, title: 'Diqqət', body: 'Sabah iclas var.', sender: { id, fullName: 'Elvin' }, sentAt: now, emailRequested: false,
    processed: false, recipientCount: 0, readCount: 0, push: zero, email: zero,
  };
  const item = { id, type: 'manual', title: 'Diqqət', body: 'Sabah iclas var.', targetKind: 'none', targetId: null, targetDate: null, createdAt: now, readAt: null };

  it('builds every path, method and body', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url} ${init.body ?? ''}`);
      if (init.method === 'POST' && (url.endsWith('/read') || url.endsWith('/read-all'))) return new Response(null, { status: 204 });
      if (url.includes('/push-devices')) return new Response(null, { status: 204 });
      if (url.endsWith('/unread-count')) return json(200, { count: 2 });
      if (url.includes('/me/notifications')) return json(200, { items: [item], nextCursor: null });
      if (url.endsWith('/me/preferences')) return json(200, { emailNotifications: false });
      if (url.endsWith('/notification-rules')) return json(200, [rule]);
      if (url.includes('/notification-rules/')) return json(200, rule);
      if (url.includes('/messages/options')) return json(200, { users: [{ id, fullName: 'Nigar', jobTitle: null }], teams: [], sites: [] });
      if (url.endsWith('/messages/preview')) return json(200, { recipientCount: 3 });
      if (init.method === 'POST' && url.endsWith('/notifications/messages')) return json(201, summary);
      if (url.includes('/notifications/messages?')) return json(200, { items: [summary], nextCursor: null });
      return json(200, { ...summary, targets: { users: [], teams: [], sites: [] }, recipients: [] });
    });
    const t = createTaskopApi(api);
    expect((await t.notifications.list({ limit: 10, unread: 'true' })).items[0]!.type).toBe('manual');
    expect(await t.notifications.unreadCount()).toEqual({ count: 2 });
    await t.notifications.markRead(id);
    await t.notifications.markAllRead();
    await t.pushDevices.register({ expoToken: token, platform: 'ios' });
    await t.pushDevices.remove(token);
    expect(await t.preferences.update({ emailNotifications: false })).toEqual({ emailNotifications: false });
    expect(await t.notificationRules.list()).toEqual([rule]);
    await t.notificationRules.update('task.assigned', { enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null });
    await t.notificationRules.reset('task.assigned');
    await t.messages.options({ q: 'Nig' });
    expect(await t.messages.preview({ title: 'Diqqət', body: 'Sabah iclas var.', teamIds: [id] })).toEqual({ recipientCount: 3 });
    await t.messages.send({ title: 'Diqqət', body: 'Sabah iclas var.', teamIds: [id] });
    await t.messages.list({ limit: 20 });
    expect((await t.messages.get(id)).recipients).toEqual([]);
    expect(calls).toEqual([
      'GET /api/v1/me/notifications?limit=10&unread=true ',
      'GET /api/v1/me/notifications/unread-count ',
      `POST /api/v1/me/notifications/${id}/read {}`,
      'POST /api/v1/me/notifications/read-all {}',
      `PUT /api/v1/me/push-devices {"expoToken":"${token}","platform":"ios"}`,
      'DELETE /api/v1/me/push-devices/ExponentPushToken%5Babc%5D ',
      'PATCH /api/v1/me/preferences {"emailNotifications":false}',
      'GET /api/v1/notification-rules ',
      'PUT /api/v1/notification-rules/task.assigned {"enabled":true,"push":true,"email":false,"notifyAssignees":true,"notifyCreator":false,"roleIds":[],"leadMinutes":null}',
      'DELETE /api/v1/notification-rules/task.assigned ',
      'GET /api/v1/notifications/messages/options?q=Nig ',
      `POST /api/v1/notifications/messages/preview {"title":"Diqqət","body":"Sabah iclas var.","teamIds":["${id}"]}`,
      `POST /api/v1/notifications/messages {"title":"Diqqət","body":"Sabah iclas var.","teamIds":["${id}"]}`,
      'GET /api/v1/notifications/messages?limit=20 ',
      `GET /api/v1/notifications/messages/${id} `,
    ]);
  });

  it('exposes a refused send as an ApiError with its fields', async () => {
    const { api } = await authed(() =>
      json(400, { error: { code: 'VALIDATION_FAILED', messageKey: 'errors.VALIDATION_FAILED', fields: { userIds: 'notifications.issues.tooManyRecipients' }, retryAfterSeconds: null, requestId: 'r1' } }),
    );
    await expect(createTaskopApi(api).messages.send({ title: 'a', body: 'b', siteIds: [id] })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: { userIds: 'notifications.issues.tooManyRecipients' },
    });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api-client test`
Expected: FAIL: `t.notifications` is undefined.

- [ ] **Step 3: Implement**

In `packages/api-client/src/endpoints.ts`, add these to the `@taskop/contracts` import:

```ts
  type MessageListQuery,
  messageDetailSchema,
  messagePreviewSchema,
  messageSummarySchema,
  type MessageTargetOptionsQuery,
  messageTargetOptionsSchema,
  notificationItemSchema,
  type NotificationListQuery,
  notificationRuleDtoSchema,
  preferencesSchema,
  type RegisterPushDeviceInput,
  type RuleType,
  type SendMessageInput,
  unreadCountSchema,
  type UpdateNotificationRuleInput,
  type UpdatePreferencesInput,
```

Add `...createNotificationsApi(c),` as the last line of the object returned by `createTaskopApi` (after `...createTasksApi(c),`), and append:

```ts
/** Sub-project 6: the inbox, push devices and the email preference (everyone), rules (notifications.manage), messages (notifications.send). */
export function createNotificationsApi(c: ApiClient) {
  return {
    notifications: {
      list: (query: NotificationListQuery = {}) => c.request('GET', '/me/notifications', { query: q(query), schema: pageOf(notificationItemSchema) }),
      unreadCount: () => c.request('GET', '/me/notifications/unread-count', { schema: unreadCountSchema }),
      markRead: (id: string) => c.request<void>('POST', `/me/notifications/${id}/read`, { body: {} }),
      markAllRead: () => c.request<void>('POST', '/me/notifications/read-all', { body: {} }),
    },
    pushDevices: {
      register: (body: RegisterPushDeviceInput) => c.request<void>('PUT', '/me/push-devices', { body }),
      remove: (expoToken: string) => c.request<void>('DELETE', `/me/push-devices/${encodeURIComponent(expoToken)}`),
    },
    preferences: {
      update: (body: UpdatePreferencesInput) => c.request('PATCH', '/me/preferences', { body, schema: preferencesSchema }),
    },
    notificationRules: {
      list: () => c.request('GET', '/notification-rules', { schema: z.array(notificationRuleDtoSchema) }),
      update: (type: RuleType, body: UpdateNotificationRuleInput) => c.request('PUT', `/notification-rules/${type}`, { body, schema: notificationRuleDtoSchema }),
      reset: (type: RuleType) => c.request('DELETE', `/notification-rules/${type}`, { schema: notificationRuleDtoSchema }),
    },
    messages: {
      options: (query: MessageTargetOptionsQuery = {}) => c.request('GET', '/notifications/messages/options', { query: q(query), schema: messageTargetOptionsSchema }),
      preview: (body: SendMessageInput) => c.request('POST', '/notifications/messages/preview', { body, schema: messagePreviewSchema }),
      send: (body: SendMessageInput) => c.request('POST', '/notifications/messages', { body, schema: messageSummarySchema }),
      list: (query: MessageListQuery = {}) => c.request('GET', '/notifications/messages', { query: q(query), schema: pageOf(messageSummarySchema) }),
      get: (id: string) => c.request('GET', `/notifications/messages/${id}`, { schema: messageDetailSchema }),
    },
  };
}
export type NotificationsApi = ReturnType<typeof createNotificationsApi>;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck && pnpm --filter @taskop/api-client build`
Expected: PASS. The query string keeps the object's key order and drops undefined values (`toQueryString`); a 204 resolves to `undefined`.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add inbox, push device, preference, notification rule and message endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Notification tables, RLS, grants, the email preference column and the permission backfill

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0011_notifications.sql` (generated), `apps/api/drizzle/0012_notifications_security.sql` (custom), `apps/api/test/notification-fixtures.ts`
- Test: `apps/api/test/notifications-db.test.ts`

**Interfaces:**
- Consumes: the `notifications.manage` / `notifications.send` keys (Task 2).
- Produces Drizzle enums and tables, used by every later API task:
  - Enums: `notificationTargetKind` (`notification_target_kind`), `notificationChannel` (`notification_channel`), `notificationDeliveryStatus` (`notification_delivery_status`), `pushPlatform` (`push_platform`)
  - `notificationEvents` (`notification_events_dedupe_uq` partial unique on `(tenant_id, dedupe_key)`), `notifications` (`notifications_event_user_uq`, cascades from its event), `notificationDeliveries` (cascades from its notification; `device_id` without a foreign key, Spec decision 8), `pushDevices` (`push_devices_token_uq` across tenants), `notificationRules` (primary key `(tenant_id, type)`, `notification_rules_lead_ck`)
  - `users.emailNotifications` (`email_notifications boolean not null default true`)
- Column types: `timestamptz` columns are `Date`; `payload` is `jsonb`; `role_ids` is `uuid[]`; `target_date` is a `YYYY-MM-DD` string.
- Test helpers in `apps/api/test/notification-fixtures.ts`:
  - `addDevice(tenantId: string, userId: string, token?: string): Promise<{ id: string; token: string }>` — an Android device row (owner connection)
  - `type EventRow`, `eventRows(tenantId: string, type?: string): Promise<EventRow[]>` — events of a tenant, oldest first
  - `asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T>` — a rolled-back `taskop_app` transaction with RLS set to `tenantId`

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { inject } from 'vitest';
import { ownerQuery } from './owner-db';

/** An Android device row straight in the DB (owner connection). */
export async function addDevice(tenantId: string, userId: string, token = `ExponentPushToken[${randomUUID()}]`): Promise<{ id: string; token: string }> {
  const id = uuidv7();
  await ownerQuery(
    `insert into push_devices (id, tenant_id, user_id, expo_token, platform, last_seen_at) values ($1, $2, $3, $4, 'android', now())`,
    [id, tenantId, userId, token],
  );
  return { id, token };
}

export interface EventRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  actor_user_id: string | null;
  dedupe_key: string | null;
  created_at: Date;
  processed_at: Date | null;
  outcome: string | null;
  attempts: number;
  last_error: string | null;
}

/** The tenant's notification events, oldest first (owner connection). */
export async function eventRows(tenantId: string, type?: string): Promise<EventRow[]> {
  const r = await ownerQuery<EventRow>(
    `select * from notification_events where tenant_id = $1 ${type ? 'and type = $2' : ''} order by created_at, id`,
    type ? [tenantId, type] : [tenantId],
  );
  return r.rows;
}

/** A taskop_app transaction with RLS set to `tenantId`; always rolled back. */
export async function asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: inject('db').appUrl, max: 1 });
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
    await pool.end();
  }
}
```

`apps/api/test/notifications-db.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { createUserDirect, signupTenant } from './fixtures';
import { addDevice, asApp } from './notification-fixtures';
import { ownerQuery } from './owner-db';

const TABLES = ['notification_events', 'notifications', 'notification_deliveries', 'push_devices', 'notification_rules'];

const insertEvent = async (tenantId: string, dedupeKey: string | null = null) => {
  const id = uuidv7();
  await ownerQuery("insert into notification_events (id, tenant_id, type, payload, dedupe_key) values ($1, $2, 'task.assigned', '{}'::jsonb, $3)", [id, tenantId, dedupeKey]);
  return id;
};
const insertNotification = async (tenantId: string, eventId: string, userId: string) => {
  const id = uuidv7();
  await ownerQuery(
    "insert into notifications (id, tenant_id, event_id, user_id, type, title, body, target_kind) values ($1, $2, $3, $4, 'task.assigned', 'Yeni tapşırıq', 'Qapı', 'none')",
    [id, tenantId, eventId, userId],
  );
  return id;
};

describe('notification tables', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('forces row level security on every new table', async () => {
    const r = await ownerQuery<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by relname',
      [TABLES],
    );
    expect(r.rows).toHaveLength(TABLES.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('hides another tenant’s rows from the app role, and lets it delete its own', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const eventId = await insertEvent(a.tenantId);
    await insertNotification(a.tenantId, eventId, a.ownerId);
    await addDevice(a.tenantId, a.ownerId);
    for (const table of TABLES) {
      expect((await asApp(b.tenantId, (c) => c.query(`select 1 from ${table}`))).rowCount, table).toBe(0);
    }
    expect((await asApp(a.tenantId, (c) => c.query('select 1 from notifications'))).rowCount).toBe(1);
    expect((await asApp(a.tenantId, (c) => c.query('delete from push_devices'))).rowCount).toBe(1);
  });

  it('dedupes events per tenant on dedupe_key and allows any number without one', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    await insertEvent(a.tenantId, 'checklist.overdue:x');
    await expect(insertEvent(a.tenantId, 'checklist.overdue:x')).rejects.toThrow(/notification_events_dedupe_uq/);
    await insertEvent(b.tenantId, 'checklist.overdue:x');
    await insertEvent(a.tenantId);
    await insertEvent(a.tenantId);
  });

  it('keeps one inbox row per user and event, and deletes notifications and deliveries with their event', async () => {
    const a = await signupTenant(t);
    const eventId = await insertEvent(a.tenantId);
    const n = await insertNotification(a.tenantId, eventId, a.ownerId);
    await expect(insertNotification(a.tenantId, eventId, a.ownerId)).rejects.toThrow(/notifications_event_user_uq/);
    await ownerQuery("insert into notification_deliveries (id, tenant_id, notification_id, channel) values ($1, $2, $3, 'email')", [uuidv7(), a.tenantId, n]);
    await ownerQuery('delete from notification_events where id = $1', [eventId]);
    expect((await ownerQuery('select 1 from notifications where id = $1', [n])).rowCount).toBe(0);
    expect((await ownerQuery('select 1 from notification_deliveries where notification_id = $1', [n])).rowCount).toBe(0);
  });

  it('keeps an Expo token unique across tenants', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { token } = await addDevice(a.tenantId, a.ownerId);
    await expect(addDevice(b.tenantId, b.ownerId, token)).rejects.toThrow(/push_devices_token_uq/);
  });

  it('allows only the four lead times and defaults email notifications to on', async () => {
    const a = await signupTenant(t);
    const rule = (type: string, lead: number | null) =>
      ownerQuery(
        'insert into notification_rules (tenant_id, type, enabled, push, email, notify_assignees, notify_creator, lead_minutes) values ($1, $2, true, true, false, true, false, $3)',
        [a.tenantId, type, lead],
      );
    await rule('checklist.due_soon', 60);
    await expect(rule('checklist.available', 45)).rejects.toThrow(/notification_rules_lead_ck/);
    await rule('checklist.available', null);
    const w = await createUserDirect(t, a.tenantId);
    expect((await ownerQuery<{ e: boolean }>('select email_notifications as e from users where id = $1', [w.id])).rows[0]!.e).toBe(true);
  });

  it('backfills the notification keys for existing Admin and Manager roles', async () => {
    const s = await signupTenant(t);
    const roleOf = async (key: string) => (await ownerQuery<{ id: string }>('select id from roles where tenant_id = $1 and system_key = $2', [s.tenantId, key])).rows[0]!.id;
    const roles = { admin: await roleOf('admin'), manager: await roleOf('manager'), auditor: await roleOf('auditor'), worker: await roleOf('worker') };
    await ownerQuery("delete from role_permissions where role_id = any($1) and permission_key like 'notifications.%'", [Object.values(roles)]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0012_notifications_security.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim());
    const start = stmts.findIndex((x) => /row_security\s*=\s*off/i.test(x));
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts.slice(start)) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = async (roleId: string) =>
      (await ownerQuery<{ k: string }>("select permission_key as k from role_permissions where role_id = $1 and permission_key like 'notifications.%' order by 1", [roleId])).rows.map((r) => r.k);
    expect(await keys(roles.admin)).toEqual(['notifications.manage', 'notifications.send']);
    expect(await keys(roles.manager)).toEqual(['notifications.send']);
    expect(await keys(roles.auditor)).toEqual([]);
    expect(await keys(roles.worker)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notifications-db`
Expected: FAIL: relation `notification_events` does not exist.

- [ ] **Step 3: Add the tables to the Drizzle schema**

In `apps/api/src/db/schema.ts`:

1. In `users`, after `totpSecretEnc: text('totp_secret_enc'),` add:

```ts
    // B-12: the only per-user notification switch (SP6 spec §5).
    emailNotifications: boolean('email_notifications').notNull().default(true),
```

2. Append at the end of the file:

```ts
// Must match NOTIFICATION_TARGET_KINDS, DELIVERY_CHANNELS, DELIVERY_STATUSES and PUSH_PLATFORMS in @taskop/contracts.
export const notificationTargetKind = pgEnum('notification_target_kind', ['occurrence', 'task', 'none']);
export const notificationChannel = pgEnum('notification_channel', ['push', 'email']);
export const notificationDeliveryStatus = pgEnum('notification_delivery_status', ['queued', 'sent', 'delivered', 'failed', 'skipped']);
export const pushPlatform = pgEnum('push_platform', ['ios', 'android']);

/** The outbox (SP6 spec §5): one row per business event, inserted in the business transaction. */
export const notificationEvents = pgTable(
  'notification_events',
  {
    id: id(),
    tenantId: tenantId(),
    // A NotificationType.
    type: text('type').notNull(),
    // Ids only; for `manual` the message itself.
    payload: jsonb('payload').notNull(),
    actorUserId: uuid('actor_user_id'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    // Null until fan-out finishes.
    processedAt: ts('processed_at'),
    // fanned_out | disabled | no_recipients | target_gone
    outcome: text('outcome'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    unique('notification_events_tenant_id_uq').on(t.tenantId, t.id),
    uniqueIndex('notification_events_dedupe_uq').on(t.tenantId, t.dedupeKey).where(sql`dedupe_key is not null`),
    foreignKey({ columns: [t.tenantId, t.actorUserId], foreignColumns: [users.tenantId, users.id], name: 'notification_events_actor_fk' }),
    // The sweeper.
    index('notification_events_unprocessed_idx').on(t.createdAt).where(sql`processed_at is null`),
    // GET /notifications/messages.
    index('notification_events_manual_idx').on(t.tenantId, t.createdAt).where(sql`type = 'manual'`),
  ],
);

/** The inbox: one row per recipient; title and body are rendered at fan-out and never change. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    targetKind: notificationTargetKind('target_kind').notNull(),
    targetId: uuid('target_id'),
    // The occurrence's local_date, for the web schedule link.
    targetDate: localDate('target_date'),
    createdAt: createdAt(),
    readAt: ts('read_at'),
  },
  (t) => [
    unique('notifications_tenant_id_uq').on(t.tenantId, t.id),
    unique('notifications_event_user_uq').on(t.eventId, t.userId),
    foreignKey({ columns: [t.tenantId, t.eventId], foreignColumns: [notificationEvents.tenantId, notificationEvents.id], name: 'notifications_event_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'notifications_user_fk' }),
    index('notifications_user_created_idx').on(t.tenantId, t.userId, t.createdAt.desc(), t.id.desc()),
    index('notifications_unread_idx').on(t.tenantId, t.userId).where(sql`read_at is null`),
    // notifications.cleanup.
    index('notifications_created_idx').on(t.tenantId, t.createdAt),
  ],
);

/** One row per channel target (NFR-11.02). */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: id(),
    tenantId: tenantId(),
    notificationId: uuid('notification_id').notNull(),
    channel: notificationChannel('channel').notNull(),
    // Push only. No foreign key: devices are deleted while their deliveries stay (Spec decision 8).
    deviceId: uuid('device_id'),
    status: notificationDeliveryStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    // The Expo ticket id.
    providerRef: text('provider_ref'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('notification_deliveries_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.notificationId],
      foreignColumns: [notifications.tenantId, notifications.id],
      name: 'notification_deliveries_notification_fk',
    }).onDelete('cascade'),
    index('notification_deliveries_notification_idx').on(t.tenantId, t.notificationId),
    // notifications.receipts.
    index('notification_deliveries_receipt_idx').on(t.status, t.sentAt).where(sql`channel = 'push' and status = 'sent'`),
    // notifications.sweep.
    index('notification_deliveries_queued_idx').on(t.status, t.createdAt).where(sql`status = 'queued'`),
  ],
);

/** Expo push tokens. A token belongs to one user of one tenant at a time (token claim, spec §6.4). */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    expoToken: text('expo_token').notNull(),
    platform: pushPlatform('platform').notNull(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull(),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    unique('push_devices_tenant_id_uq').on(t.tenantId, t.id),
    // Across all tenants: claiming a token removes every other row first.
    unique('push_devices_token_uq').on(t.expoToken),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'push_devices_user_fk' }),
    index('push_devices_user_idx').on(t.tenantId, t.userId),
  ],
);

/** At most one override per tenant and rule type (FR-15.09); a missing row means DEFAULT_RULES. */
export const notificationRules = pgTable(
  'notification_rules',
  {
    tenantId: tenantId(),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull(),
    push: boolean('push').notNull(),
    email: boolean('email').notNull(),
    notifyAssignees: boolean('notify_assignees').notNull(),
    notifyCreator: boolean('notify_creator').notNull(),
    roleIds: uuid('role_ids').array().notNull().default(sql`'{}'::uuid[]`),
    // checklist.due_soon only.
    leadMinutes: integer('lead_minutes'),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    primaryKey({ name: 'notification_rules_pk', columns: [t.tenantId, t.type] }),
    foreignKey({ columns: [t.tenantId, t.updatedBy], foreignColumns: [users.tenantId, users.id], name: 'notification_rules_updated_by_fk' }),
    check('notification_rules_lead_ck', sql`${t.leadMinutes} is null or ${t.leadMinutes} in (15, 30, 60, 120)`),
  ],
);
```

(`localDate` is the `date(name, { mode: 'string' })` helper already defined above `assignments` in this file.)

- [ ] **Step 4: Generate the migrations**

```bash
pnpm --filter @taskop/api exec drizzle-kit generate --name notifications
pnpm --filter @taskop/api exec drizzle-kit generate --custom --name notifications_security
```

Check the output:
- `apps/api/drizzle/0011_notifications.sql` contains the 4 `CREATE TYPE`s, the 5 `CREATE TABLE`s, `ALTER TABLE "users" ADD COLUMN "email_notifications" boolean DEFAULT true NOT NULL`, the check, the foreign keys (`notifications_event_fk` and `notification_deliveries_notification_fk` with `ON DELETE cascade`), and the indexes.
- The partial indexes end in `WHERE dedupe_key is not null`, `WHERE processed_at is null`, `WHERE type = 'manual'`, `WHERE read_at is null`, `WHERE channel = 'push' and status = 'sent'`, `WHERE status = 'queued'`.
- `meta/_journal.json` has entries `0011_notifications` and `0012_notifications_security`; `0012_notifications_security.sql` is created empty.

Write `apps/api/drizzle/0012_notifications_security.sql`:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_events','notifications','notification_deliveries','push_devices','notification_rules']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Cleanup deletes old notifications and events, devices are removed at logout, rule overrides are reset (SP6 spec §5, §6.3).
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_events, notifications, notification_deliveries, push_devices, notification_rules TO taskop_app, taskop_platform;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants get the SYSTEM_ROLE_DEFAULTS notification keys (new tenants get them at signup).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['notifications.manage','notifications.send']) AS k
  WHERE r.system_key = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, 'notifications.send' FROM roles r WHERE r.system_key = 'manager'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key IN ('admin', 'manager');
--> statement-breakpoint
SET LOCAL row_security = on;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notifications-db tasks-db users roles`
Expected: PASS. The global test setup applies the new migrations to a fresh container.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/notification-fixtures.ts apps/api/test/notifications-db.test.ts
git commit -m "feat(api): add notification event, inbox, delivery, device and rule tables with RLS and the permission backfill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `JobsService.defineWorker`, `send` and dead-letter queues

**Files:**
- Modify: `apps/api/src/scheduling/jobs.service.ts`
- Test: `apps/api/test/jobs-wiring.test.ts`

**Interfaces:**
- Consumes: pg-boss 12 (`createQueue` with `policy: 'standard'`, `retryLimit`, `retryBackoff`, `deadLetter`; `send`; `work`).
- Produces:
  - `interface WorkerOptions { retryLimit: number; deadLetter: string }`
  - `JobsService.defineWorker<T extends object>(name: string, handler: (data: T) => Promise<void>, opts: WorkerOptions): void` — call from a provider's `onModuleInit`, like `define`. Creates a **standard** queue (many jobs at once, unlike the stately crons) with `retryBackoff: true`, ensures the dead-letter queue and works it: every dead job is logged at error level with its data.
  - `JobsService.send(queue: string, data: object): Promise<boolean>` — queues one job; `false` and nothing else while jobs are disabled (Spec decision 18).

- [ ] **Step 1: Write the failing test**

In `apps/api/test/jobs-wiring.test.ts`, add these imports:

```ts
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/config';
import type { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { testEnv } from './app';
```

and append inside `describe('pg-boss wiring', …)`:

```ts
  describe('JobsService workers', () => {
    // Completes stray scheduling jobs harmlessly; this JobsService has no Nest app around it.
    const idle = { materializeAll: async () => 0, sweepAll: async () => 0 } as unknown as OccurrenceJobs;

    it('runs a defined worker for every sent job, retries a failing one and then dead-letters it', async () => {
      const jobs = new JobsService(loadConfig(testEnv({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' })), idle);
      const queue = `test.echo.${randomUUID()}`;
      const dead = `test.dead.${randomUUID()}`;
      const seen: string[] = [];
      jobs.defineWorker<{ v: string }>(
        queue,
        async (d) => {
          seen.push(d.v);
          if (d.v === 'bad') throw new Error('boom');
        },
        { retryLimit: 1, deadLetter: dead },
      );
      await jobs.onApplicationBootstrap();
      try {
        expect(await jobs.send(queue, { v: 'a' })).toBe(true);
        expect(await jobs.send(queue, { v: 'b' })).toBe(true);
        await expect.poll(() => [...seen].sort(), { timeout: 20_000, interval: 250 }).toEqual(['a', 'b']);
        await jobs.send(queue, { v: 'bad' });
        // One try and one retry (retryLimit 1), then the job moves to the dead-letter queue.
        await expect.poll(() => seen.filter((v) => v === 'bad').length, { timeout: 20_000, interval: 250 }).toBe(2);
        await expect
          .poll(async () => (await ownerQuery<{ n: number }>('select count(*)::int as n from pgboss.job where name = $1', [dead])).rows[0]!.n, { timeout: 20_000, interval: 250 })
          .toBe(1);
        const policy = await ownerQuery<{ policy: string }>('select policy from pgboss.queue where name = $1', [queue]);
        expect(policy.rows[0]!.policy).toBe('standard');
      } finally {
        await jobs.onModuleDestroy();
      }
    });

    it('send does nothing while background jobs are disabled', async () => {
      const jobs = new JobsService(loadConfig(testEnv()), idle);
      await jobs.onApplicationBootstrap();
      expect(await jobs.send('anything', { v: 1 })).toBe(false);
      expect(() => jobs.defineWorker('late', async () => undefined, { retryLimit: 1, deadLetter: 'late.dead' })).not.toThrow();
    });
  });
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- jobs-wiring`
Expected: FAIL: `jobs.defineWorker is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/scheduling/jobs.service.ts`:

1. After the `JobDefinition` interface add:

```ts
/** Retry policy of a worker queue (SP6 spec §6.3). */
export interface WorkerOptions {
  /** pg-boss retries after the first try. */
  retryLimit: number;
  /** Receives the job once the retries are exhausted; every job there is logged at error level. */
  deadLetter: string;
}

interface WorkerDefinition {
  name: string;
  handler: (data: object) => Promise<void>;
  opts: WorkerOptions;
}
```

2. Add a field after `private readonly defined: JobDefinition[] = [];`:

```ts
  private readonly workers: WorkerDefinition[] = [];
```

3. After `define(…)` add:

```ts
  /** A queue many jobs flow through (e.g. notifications.fanout), as opposed to a stately cron. Define it in onModuleInit. */
  defineWorker<T extends object>(name: string, handler: (data: T) => Promise<void>, opts: WorkerOptions): void {
    if (this.boss) throw new Error(`Worker ${name} must be defined before the application starts`);
    this.workers.push({ name, handler: handler as (data: object) => Promise<void>, opts });
  }

  /** Queues one job. While background jobs are disabled (tests, JOBS_ENABLED=false) it does nothing and returns false. */
  async send(queue: string, data: object): Promise<boolean> {
    if (!this.boss) return false;
    await this.boss.send(queue, data);
    return true;
  }
```

4. In `onApplicationBootstrap`, store the instance right after it starts and set up the worker queues after the `define`d ones. The method becomes:

```ts
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.JOBS_ENABLED) return;
    // `schedule: false` also stops this instance from firing schedules registered by an earlier run.
    const boss = new PgBoss({
      connectionString: this.config.DATABASE_APP_URL,
      schema: 'pgboss',
      createSchema: false,
      application_name: 'taskop-jobs',
      schedule: this.config.JOBS_CRON,
    });
    boss.on('error', (err) => this.logger.error(`pg-boss: ${String(err)}`));
    await boss.start();
    // Stored at once: a worker that sends a job while later queues are still being created must not lose it.
    this.boss = boss;
    await this.ensureQueue(boss, QUEUES.dead);
    for (const name of [QUEUES.materialize, QUEUES.sweep]) {
      // stately: at most one queued and one running job, so a run requested while another is busy is not lost.
      await this.ensureQueue(boss, name, { policy: 'stately', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
    }
    await boss.work<JobData>(QUEUES.materialize, async ([job]) => {
      await this.ops.materializeAll(job?.data?.tenantIds);
    });
    await boss.work<JobData>(QUEUES.sweep, async ([job]) => {
      await this.ops.sweepAll(job?.data?.tenantIds);
    });
    for (const def of this.defined) {
      await this.ensureQueue(boss, def.name, { policy: 'stately', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
      await boss.work<JobData>(def.name, async ([job]) => {
        await def.handler(job?.data?.tenantIds);
      });
    }
    const deadLetters = [...new Set(this.workers.map((w) => w.opts.deadLetter))].filter((q) => q !== QUEUES.dead);
    for (const dl of deadLetters) await this.ensureQueue(boss, dl);
    for (const w of this.workers) {
      // standard: any number of queued jobs, each retried with backoff and then dead-lettered.
      await this.ensureQueue(boss, w.name, { policy: 'standard', retryLimit: w.opts.retryLimit, retryBackoff: true, deadLetter: w.opts.deadLetter });
      await boss.work<object>(w.name, async ([job]) => {
        if (job) await w.handler(job.data);
      });
    }
    await boss.work(QUEUES.dead, async (jobs) => {
      for (const j of jobs) this.logger.error(`Job ${j.name} (${j.id}) failed after all retries`);
    });
    for (const dl of deadLetters) {
      await boss.work<object>(dl, async (jobs) => {
        for (const j of jobs) this.logger.error(`Job ${j.id} reached ${dl} after all retries: ${JSON.stringify(j.data)}`);
      });
    }
    if (this.config.JOBS_CRON) {
      await boss.schedule(QUEUES.materialize, '*/15 * * * *', null, { tz: 'UTC', missed: 'once' });
      await boss.schedule(QUEUES.sweep, '* * * * *', null, { tz: 'UTC', missed: 'once' });
      for (const def of this.defined) await boss.schedule(def.name, def.cron, null, { tz: 'UTC', missed: 'once' });
      // A freshly started API catches up at once instead of waiting for the next quarter hour.
      await boss.send(QUEUES.materialize, {});
    } else {
      for (const name of [QUEUES.materialize, QUEUES.sweep, ...this.defined.map((d) => d.name)]) {
        // Drops schedules left by an earlier run with cron on; there may be none.
        await boss.unschedule(name).catch(() => undefined);
      }
    }
  }
```

The second test's `defineWorker` after a disabled bootstrap does not throw because `this.boss` stays null when jobs are off; that is the existing behaviour of `define` too.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- jobs-wiring`
Expected: PASS. The existing wiring tests still pass: the scheduling queues are unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduling/jobs.service.ts apps/api/test/jobs-wiring.test.ts
git commit -m "feat(api): add worker queues with dead-letter logging and send to JobsService" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Domain events `assignment.assignees_changed` and `problem.recorded`

**Files:**
- Modify: `apps/api/src/common/domain-events.ts`, `apps/api/src/scheduling/assignments.service.ts`, `apps/api/src/executions/problem-writer.ts`
- Test: `apps/api/test/notification-domain-events.test.ts`

**Interfaces:**
- Consumes: `DomainEvents`, `actorColumns(db)`; `type ProblemSeverity` from `@taskop/contracts`.
- Produces (in `DomainEventMap`):
  - `'assignment.assignees_changed': { tenantId: string; assignmentId: string; addedUserIds: string[]; actorUserId: string | null }` — emitted by `AssignmentsService.create` (all assignees) and `AssignmentsService.update` (only the added ones, when there are any), after the change, in its transaction.
  - `'problem.recorded': { tenantId: string; problemId: string; occurrenceId: string; severity: ProblemSeverity; actorUserId: string | null }` — emitted by `ProblemWriter.rewrite` for each row its upsert **inserted** (Spec decision 7), never for re-saves.
  - `actorUserId` is the transaction's user, `null` for a platform admin (Spec decision 6).

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-domain-events.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents, type DomainEventMap } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { answersBody, startedExecution } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { createAssignment, MONDAY_0800, schedulingWorld } from './scheduling-fixtures';

function capture<K extends keyof DomainEventMap>(t: TestApp, name: K) {
  const seen: DomainEventMap[K][] = [];
  const stop = t.app.get(DomainEvents).on(name, (e) => void seen.push(e));
  return { seen, stop };
}

describe('notification domain events', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('emits assignment.assignees_changed on create and on updates that add people, only for the added ones', async () => {
    const w = await schedulingWorld(t);
    const events = capture(t, 'assignment.assignees_changed');
    const a = await createAssignment(w);
    expect(events.seen).toHaveLength(1);
    expect(events.seen[0]).toMatchObject({ tenantId: w.s.tenantId, assignmentId: a.id, actorUserId: w.s.ownerId });
    expect([...events.seen[0]!.addedUserIds].sort()).toEqual([...w.workers].sort());
    events.seen.length = 0;
    expect((await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, name: 'Yeni ad' })).status).toBe(200);
    expect((await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 2, assigneeIds: [w.workers[0]] })).status).toBe(200);
    expect(events.seen).toEqual([]);
    const third = await createUserDirect(t, w.s.tenantId, { fullName: 'İşçi 3' });
    expect((await w.api.put(`/api/v1/users/${third.id}/sites`, { siteIds: [w.siteId] })).status).toBe(200);
    const res = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 3, assigneeIds: [w.workers[0], w.workers[1], third.id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    events.stop();
    expect(events.seen.map((e) => [...e.addedUserIds].sort())).toEqual([[w.workers[1], third.id].sort()]);
  });

  it('emits problem.recorded for problems a save inserts, not for re-saves of the same problem', async () => {
    const { w, executionId, api } = await startedExecution(t, clock);
    const events = capture(t, 'problem.recorded');
    const at = '2026-11-02T04:20:00.000Z';
    const save = (rev: number, temp: Record<string, unknown>) => api.put(`/api/v1/executions/${executionId}/answers`, answersBody(rev, { [w.c.temp.id]: temp }, at));
    expect((await save(1, { number: 10, note: 'isti' })).status).toBe(200);
    expect(events.seen).toEqual([
      { tenantId: w.s.tenantId, problemId: expect.any(String), occurrenceId: w.occurrenceId, severity: 'normal', actorUserId: w.workers[0].id },
    ]);
    const ruleProblem = events.seen[0]!.problemId;
    expect((await save(2, { number: 12, note: 'çox isti' })).status).toBe(200);
    expect(events.seen).toHaveLength(1);
    const res = await save(3, { number: 12, note: 'çox isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    events.stop();
    expect(events.seen).toHaveLength(2);
    expect(events.seen[1]).toMatchObject({ severity: 'critical', occurrenceId: w.occurrenceId });
    expect(events.seen[1]!.problemId).not.toBe(ruleProblem);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-domain-events`
Expected: FAIL: nothing emits the two events yet, so the handlers are never called and the first assertion of each test sees `[]`. (Vitest's SWC transform does not type-check, so the unknown event names do not stop the run.)

- [ ] **Step 3: Add the events**

In `apps/api/src/common/domain-events.ts`:
- change the contracts import to `import type { OccurrenceStatus, ProblemSeverity } from '@taskop/contracts';`
- add two entries to `DomainEventMap`, after `'occurrence.status_changed'`:

```ts
  /** Users were added to an assignment (create: all assignees). SP6 turns it into checklist.assigned. */
  'assignment.assignees_changed': { tenantId: string; assignmentId: string; addedUserIds: string[]; actorUserId: string | null };
  /** A counted execution's answers produced a problem row that did not exist before (not a re-save). */
  'problem.recorded': { tenantId: string; problemId: string; occurrenceId: string; severity: ProblemSeverity; actorUserId: string | null };
```

- [ ] **Step 4: Emit them**

In `apps/api/src/scheduling/assignments.service.ts`:
- import `import { DomainEvents } from '../common/domain-events';`
- add a constructor parameter after `protected readonly queries: OccurrenceQueries,`:

```ts
    protected readonly events: DomainEvents,
```

- in `create`, after `await this.writer.materialize(id);` add:

```ts
    await this.events.emit('assignment.assignees_changed', { tenantId, assignmentId: id, addedUserIds: assigneeIds, actorUserId: actor.userId });
```

- in `update`, after the `if (assigneesChanged) { … }` block add:

```ts
    if (addedIds.length) {
      await this.events.emit('assignment.assignees_changed', { tenantId: row.tenantId, assignmentId: id, addedUserIds: addedIds, actorUserId: actorColumns(this.db).userId });
    }
```

`apps/api/src/executions/problem-writer.ts` becomes:

```ts
import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, deriveProblems } from '@taskop/contracts';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';

@Injectable()
export class ProblemWriter {
  constructor(
    private readonly db: DbService,
    private readonly events: DomainEvents,
  ) {}

  /**
   * Rewrites a counted execution's problems from its answers (spec §5.2). Upserting on (execution, item, source)
   * keeps a problem's id and created_at while it persists; problems that are gone are deleted, unless a task was created from them.
   * Each row the upsert inserts (not a re-save) emits problem.recorded (SP6 spec §6.1).
   */
  async rewrite(
    e: { id: string; tenantId: string },
    o: { id: string; siteId: string; checklistId: string },
    content: ChecklistContent,
    answers: Answers,
    now: Date,
  ): Promise<void> {
    const tx = this.db.tx();
    const derived = deriveProblems(content, answers);
    if (derived.length) {
      const rows = await tx
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
    const keep = derived.map((d) => `${d.itemId}:${d.source}`);
    await tx
      .delete(executionProblems)
      .where(
        and(
          eq(executionProblems.executionId, e.id),
          keep.length ? notInArray(sql<string>`${executionProblems.itemId}::text || ':' || ${executionProblems.source}::text`, keep) : undefined,
          // A problem turned into a task stays (spec §5): a late answers sync on a swept run may no longer derive it.
          sql`not exists (select 1 from tasks k where k.problem_id = ${executionProblems.id})`,
        ),
      );
  }
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-domain-events assignments assignment-changes executions-answers executions-complete problems-resolution`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/domain-events.ts apps/api/src/scheduling/assignments.service.ts apps/api/src/executions/problem-writer.ts apps/api/test/notification-domain-events.test.ts
git commit -m "feat(api): emit assignment.assignees_changed and problem.recorded for inserted problems" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The outbox: `NotificationEvents.record` and the listeners

**Files:**
- Create: `apps/api/src/notifications/queues.ts`, `apps/api/src/notifications/payloads.ts`, `apps/api/src/notifications/notification-events.ts`, `apps/api/src/notifications/notification-listeners.ts`, `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/notification-events.test.ts`

**Interfaces:**
- Consumes: `JobsService.send` (Task 6); `assignment.assignees_changed`, `problem.recorded` (Task 7); `occurrence.status_changed`, `TaskEvent`, `DomainEvents`; `notificationEvents`, `tasks` (Task 5); `Clock`, `DbService` (`tx`, `context`, `afterCommit`), `sanitiseForLog`, `pgErrorOf`.
- Produces:
  - `queues.ts`: `NOTIFICATION_QUEUES = { fanout: 'notifications.fanout', deliver: 'notifications.deliver', scan: 'notifications.scan', receipts: 'notifications.receipts', sweep: 'notifications.sweep', cleanup: 'notifications.cleanup', dead: 'notifications.dead' }`; `NOTIFICATION_LIMITS = { maxAttempts: 5, pushBatch: 100, availableWindowMinutes: 15, receiptDelayMinutes: 15, receiptMaxAgeHours: 24, fanoutStaleMinutes: 2, deliverStaleMinutes: 5, retentionDays: 90, deviceIdleDays: 180 }`; `interface FanoutJob { tenantId: string; eventId: string }`; `interface DeliverJob { tenantId: string; deliveryIds: string[] }`; `failureText(e: unknown): string` (≤ 500 characters, never SQL or parameters).
  - `payloads.ts`: `OccurrencePayload { occurrenceId }`, `AssignedPayload { assignmentId; addedUserIds: string[] }`, `ProblemPayload { problemId; occurrenceId }`, `TaskPayload { taskId }`, `ManualPayload { title; body; userIds: string[]; teamIds: string[]; siteIds: string[]; email: boolean }`, `PayloadOf` (one entry per `NotificationType`).
  - `NotificationEvents.record<T extends NotificationType>(type: T, payload: PayloadOf[T], actorUserId: string | null, dedupeKey?: string): Promise<void>` — never throws.
  - `NotificationEvents.create<T extends NotificationType>(type: T, payload: PayloadOf[T], actorUserId: string | null, dedupeKey?: string | null): Promise<string | null>` — throws; returns the new event id, or `null` when the dedupe key exists. Both schedule `notifications.fanout` `{ tenantId, eventId }` after commit.
  - `NotificationListeners` (spec §6.1 step 2): `occurrence.status_changed` → `checklist.overdue` / `checklist.missed`; `assignment.assignees_changed` → `checklist.assigned`; `problem.recorded` → `problem.recorded` / `problem.critical` (dedupe `problem:<id>`); `task.assigned`, `task.submitted` (only while the task is `awaiting_review`, Spec decision 23 below), `task.rejected`, `task.completed`, `task.overdue`, `task.cancelled`.
  - `NotificationsModule` (imports `SchedulingModule`), registered in `AppModule`; exports `NotificationEvents`.

**Spec decision 23 (added by this task).** SP5's `TaskWorkService.submit` emits `task.submitted` on every submission, followed by `task.completed` when no review is required. Spec §3.1 means "awaiting review" for `task.submitted`, so the listener records it only when the task's status in the same transaction is `awaiting_review`; a submission straight to `completed` notifies the creator once, as `task.completed`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-events.test.ts`:

```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationEvents } from '../src/notifications/notification-events';
import { JobsService } from '../src/scheduling/jobs.service';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { eventRows } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { act, closedRunWithProblems, createTask, newTaskBody, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;

describe('notification outbox', () => {
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

  it('records task events in the task’s transaction with the actor and the clock’s time, and queues fan-out after commit', async () => {
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const [assigned] = await eventRows(w.s.tenantId);
    expect(assigned).toMatchObject({
      type: 'task.assigned', payload: { taskId: task.id }, actor_user_id: w.manager.id, dedupe_key: null,
      processed_at: null, outcome: null, attempts: 0, created_at: new Date(MONDAY_0800),
    });
    expect(send).toHaveBeenCalledWith('notifications.fanout', { tenantId: w.s.tenantId, eventId: assigned!.id });
    clock.set(T('04:20'));
    await act(w.workers[0].api, task.id, 'start', T('04:10'));
    const done = await w.workers[0].api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') });
    expect(done.body.status).toBe('completed');
    // No review: task.submitted is not notified (Spec decision 23); task.accepted never is.
    expect((await eventRows(w.s.tenantId)).map((r) => [r.type, r.actor_user_id])).toEqual([
      ['task.assigned', w.manager.id],
      ['task.completed', w.workers[0].id],
    ]);
  });

  it('records task.submitted when the task waits for review, then rejection and cancellation', async () => {
    const w = await taskWorld(t);
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, { requiresReview: true }));
    clock.set(T('04:20'));
    await act(w.workers[0].api, task.id, 'start', T('04:10'));
    expect((await w.workers[0].api.post(`/api/v1/tasks/${task.id}/submissions`, { id: uuidv7(), submittedAt: T('04:15') })).body.status).toBe('awaiting_review');
    expect((await w.manager.api.post(`/api/v1/tasks/${task.id}/review`, { decision: 'reject', comment: 'Foto yoxdur' })).status).toBe(200);
    expect((await w.manager.api.post(`/api/v1/tasks/${task.id}/cancel`, { reason: 'Lazım deyil' })).status).toBe(200);
    expect((await eventRows(w.s.tenantId)).map((r) => r.type)).toEqual(['task.assigned', 'task.submitted', 'task.rejected', 'task.cancelled']);
  });

  it('keeps the business change when recording fails', async () => {
    const w = await taskWorld(t);
    const constraint = `test_fail_${w.s.tenantId.replace(/-/g, '')}`;
    // Fails every insert for this tenant only; NOT VALID leaves existing rows alone. Other test files keep working.
    await ownerQuery(`alter table notification_events add constraint ${constraint} check (tenant_id <> '${w.s.tenantId}') not valid`);
    try {
      const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
      expect((await ownerQuery('select 1 from tasks where id = $1', [task.id])).rowCount).toBe(1);
      expect((await ownerQuery('select 1 from task_status_history where task_id = $1', [task.id])).rowCount).toBe(1);
    } finally {
      await ownerQuery(`alter table notification_events drop constraint ${constraint}`);
    }
    expect(await eventRows(w.s.tenantId)).toEqual([]);
  });

  it('drops the event and the fan-out when the business transaction rolls back', async () => {
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const w = await taskWorld(t);
    send.mockClear();
    const db = t.app.get(DbService);
    const events = t.app.get(NotificationEvents);
    await expect(
      db.withTenant(w.s.tenantId, null, async () => {
        await events.record('task.overdue', { taskId: uuidv7() }, null);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await eventRows(w.s.tenantId, 'task.overdue')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('dedupes on the key: a second record is a no-op, create returns null', async () => {
    const w = await taskWorld(t);
    const db = t.app.get(DbService);
    const events = t.app.get(NotificationEvents);
    const occurrenceId = uuidv7();
    const key = `checklist.overdue:${occurrenceId}`;
    const first = await db.withTenant(w.s.tenantId, null, () => events.create('checklist.overdue', { occurrenceId }, null, key));
    await db.withTenant(w.s.tenantId, null, () => events.record('checklist.overdue', { occurrenceId }, null, key));
    expect(await db.withTenant(w.s.tenantId, null, () => events.create('checklist.overdue', { occurrenceId }, null, key))).toBeNull();
    expect((await eventRows(w.s.tenantId, 'checklist.overdue')).map((r) => r.id)).toEqual([first]);
  });

  it('records overdue and missed once each when a sweep jumps from pending to missed', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const today = (await occurrenceRows(a.id))[0]!;
    clock.set('2026-11-02T07:30:00Z');
    const jobs = t.app.get(OccurrenceJobs);
    await jobs.sweepAll([w.s.tenantId]);
    await jobs.sweepAll([w.s.tenantId]);
    const rows = await eventRows(w.s.tenantId);
    expect(rows.filter((r) => r.type.startsWith('checklist.') && r.type !== 'checklist.assigned').map((r) => [r.type, r.dedupe_key, r.actor_user_id, r.payload])).toEqual([
      ['checklist.overdue', `checklist.overdue:${today.id}`, null, { occurrenceId: today.id }],
      ['checklist.missed', `checklist.missed:${today.id}`, null, { occurrenceId: today.id }],
    ]);
  });

  it('records checklist.assigned with the added users, and problems by severity with their dedupe key', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const [assigned] = await eventRows(w.s.tenantId, 'checklist.assigned');
    expect(assigned).toMatchObject({ actor_user_id: w.s.ownerId, dedupe_key: null, payload: { assignmentId: a.id } });
    expect([...(assigned!.payload.addedUserIds as string[])].sort()).toEqual([...w.workers].sort());

    const run = await closedRunWithProblems(t, clock);
    const problems = (await eventRows(run.w.s.tenantId)).filter((r) => r.type.startsWith('problem.'));
    expect(problems.map((r) => [r.type, r.dedupe_key, r.actor_user_id, r.payload]).sort()).toEqual(
      [
        ['problem.critical', `problem:${run.manualProblemId}`, run.w.workers[0].id, { problemId: run.manualProblemId, occurrenceId: run.w.occurrenceId }],
        ['problem.recorded', `problem:${run.ruleProblemId}`, run.w.workers[0].id, { problemId: run.ruleProblemId, occurrenceId: run.w.occurrenceId }],
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-events`
Expected: FAIL: `Cannot find module '../src/notifications/notification-events'`.

- [ ] **Step 3: Queue names, limits and payloads**

`apps/api/src/notifications/queues.ts`:

```ts
import { pgErrorOf } from '../common/pg-errors';

/** SP6 spec §6.3. */
export const NOTIFICATION_QUEUES = {
  fanout: 'notifications.fanout',
  deliver: 'notifications.deliver',
  scan: 'notifications.scan',
  receipts: 'notifications.receipts',
  sweep: 'notifications.sweep',
  cleanup: 'notifications.cleanup',
  dead: 'notifications.dead',
} as const;

export const NOTIFICATION_LIMITS = {
  /** Per event and per delivery (spec §6.1, NFR-11.03). */
  maxAttempts: 5,
  /** Push deliveries per notifications.deliver job (one Expo request). */
  pushBatch: 100,
  /** checklist.available only for occurrences that opened this recently (spec §3.4). */
  availableWindowMinutes: 15,
  /** notifications.receipts reads receipts for pushes sent at least this long ago… */
  receiptDelayMinutes: 15,
  /** …and at most this long ago (Expo keeps receipts for 24 h; Spec decision 10). */
  receiptMaxAgeHours: 24,
  /** notifications.sweep re-sends fan-out for events unprocessed this long… */
  fanoutStaleMinutes: 2,
  /** …and delivery for rows queued this long. */
  deliverStaleMinutes: 5,
  /** notifications.cleanup deletes notifications and processed events older than this… */
  retentionDays: 90,
  /** …and disables devices not seen for this long. */
  deviceIdleDays: 180,
} as const;

export interface FanoutJob {
  tenantId: string;
  eventId: string;
}

export interface DeliverJob {
  tenantId: string;
  /** ≤ 100 push deliveries, or one email delivery. */
  deliveryIds: string[];
}

/** The text stored in last_error: never a driver error's SQL or parameters (see sanitiseForLog). */
export function failureText(e: unknown): string {
  const pg = pgErrorOf(e);
  if (pg) return `Database error ${pg.code}${pg.constraint ? ` (${pg.constraint})` : ''}`;
  const message = e instanceof Error ? e.message : String(e);
  if (message.startsWith('Failed query:')) return 'Database error';
  return message.slice(0, 500);
}
```

`apps/api/src/notifications/payloads.ts`:

```ts
import type { NotificationType } from '@taskop/contracts';

/** notification_events.payload holds ids only (spec §5), except for manual messages. */
export interface OccurrencePayload {
  occurrenceId: string;
}

export interface AssignedPayload {
  assignmentId: string;
  addedUserIds: string[];
}

export interface ProblemPayload {
  problemId: string;
  occurrenceId: string;
}

export interface TaskPayload {
  taskId: string;
}

/** The message as sent; recipients are expanded from the ids at fan-out (Spec decision 12). */
export interface ManualPayload {
  title: string;
  body: string;
  userIds: string[];
  teamIds: string[];
  siteIds: string[];
  email: boolean;
}

export interface PayloadOf extends Record<NotificationType, object> {
  'checklist.assigned': AssignedPayload;
  'checklist.available': OccurrencePayload;
  'checklist.due_soon': OccurrencePayload;
  'checklist.overdue': OccurrencePayload;
  'checklist.missed': OccurrencePayload;
  'problem.recorded': ProblemPayload;
  'problem.critical': ProblemPayload;
  'task.assigned': TaskPayload;
  'task.submitted': TaskPayload;
  'task.rejected': TaskPayload;
  'task.completed': TaskPayload;
  'task.overdue': TaskPayload;
  'task.cancelled': TaskPayload;
  manual: ManualPayload;
}
```

- [ ] **Step 4: The outbox writer**

`apps/api/src/notifications/notification-events.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@taskop/contracts';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService, type Executor } from '../db/db.service';
import { notificationEvents } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import type { PayloadOf } from './payloads';
import { type FanoutJob, NOTIFICATION_QUEUES } from './queues';

/** Spec §6.1 step 1: one row per business event, inside the business transaction. */
@Injectable()
export class NotificationEvents {
  private readonly logger = new Logger('NotificationEvents');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
  ) {}

  /**
   * For listeners and the scan: never throws (NFR-11.01). The insert runs in a savepoint; on any error the savepoint
   * is rolled back and the error logged, so the business change still commits.
   */
  async record<T extends NotificationType>(type: T, payload: PayloadOf[T], actorUserId: string | null, dedupeKey?: string): Promise<void> {
    try {
      await this.db.tx().transaction((sp) => this.insert(sp, type, payload, actorUserId, dedupeKey ?? null));
    } catch (e) {
      this.logger.error(sanitiseForLog(e, null), `Recording a ${type} notification failed; the business change still commits`);
    }
  }

  /** For manual messages, whose sender must learn of a failure: throws. Null when the dedupe key already exists. */
  async create<T extends NotificationType>(type: T, payload: PayloadOf[T], actorUserId: string | null, dedupeKey: string | null = null): Promise<string | null> {
    return this.insert(this.db.tx(), type, payload, actorUserId, dedupeKey);
  }

  private async insert(tx: Executor, type: NotificationType, payload: object, actorUserId: string | null, dedupeKey: string | null): Promise<string | null> {
    const { tenantId } = this.db.context();
    const [row] = await tx
      .insert(notificationEvents)
      .values({ tenantId, type, payload, actorUserId, dedupeKey, createdAt: this.clock.now() })
      // The partial unique index on (tenant_id, dedupe_key) makes a repeat a no-op.
      .onConflictDoNothing()
      .returning({ id: notificationEvents.id });
    if (!row) return null;
    const job: FanoutJob = { tenantId, eventId: row.id };
    // Dropped if the business transaction rolls back; the sweep re-sends it if this send is lost.
    this.db.afterCommit(() => this.jobs.send(NOTIFICATION_QUEUES.fanout, job));
    return row.id;
  }
}
```

- [ ] **Step 5: The listeners and the module**

`apps/api/src/notifications/notification-listeners.ts`:

```ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { NotificationType, OccurrenceStatus } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { DomainEvents, type TaskEvent, type TaskEventName } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { tasks } from '../db/schema';
import { NotificationEvents } from './notification-events';

/** task.* events that become notifications of the same name (spec §6.1 step 2). task.accepted is not notified. */
const TASK_TYPES = ['task.assigned', 'task.rejected', 'task.completed', 'task.overdue', 'task.cancelled'] as const satisfies readonly (TaskEventName & NotificationType)[];

/** Maps domain events to notification events. Handlers run in the caller's transaction and never throw (record swallows). */
@Injectable()
export class NotificationListeners implements OnModuleInit {
  constructor(
    private readonly events: DomainEvents,
    private readonly db: DbService,
    private readonly notifications: NotificationEvents,
  ) {}

  onModuleInit(): void {
    this.events.on('occurrence.status_changed', (e) => this.onOccurrence(e.occurrenceId, e.to));
    this.events.on('assignment.assignees_changed', (e) =>
      this.notifications.record('checklist.assigned', { assignmentId: e.assignmentId, addedUserIds: e.addedUserIds }, e.actorUserId),
    );
    this.events.on('problem.recorded', (e) =>
      this.notifications.record(e.severity === 'critical' ? 'problem.critical' : 'problem.recorded', { problemId: e.problemId, occurrenceId: e.occurrenceId }, e.actorUserId, `problem:${e.problemId}`),
    );
    for (const name of TASK_TYPES) this.events.on(name, (e) => this.notifications.record(name, { taskId: e.taskId }, e.actorUserId));
    this.events.on('task.submitted', (e) => this.onSubmitted(e));
  }

  /** The sweep has no user, so its overdue and missed events have no actor (Spec decision 5). */
  private async onOccurrence(occurrenceId: string, to: OccurrenceStatus): Promise<void> {
    if (to !== 'overdue' && to !== 'missed') return;
    const type = to === 'overdue' ? 'checklist.overdue' : 'checklist.missed';
    await this.notifications.record(type, { occurrenceId }, this.db.context().userId, `${type}:${occurrenceId}`);
  }

  /** Spec decision 23: only a submission that waits for review is "submitted"; one straight to completed is told as completed. */
  private async onSubmitted(e: TaskEvent): Promise<void> {
    const [t] = await this.db.tx().select({ status: tasks.status }).from(tasks).where(eq(tasks.id, e.taskId));
    if (t?.status !== 'awaiting_review') return;
    await this.notifications.record('task.submitted', { taskId: e.taskId }, e.actorUserId);
  }
}
```

`apps/api/src/notifications/notifications.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { NotificationEvents } from './notification-events';
import { NotificationListeners } from './notification-listeners';

/** Sub-project 6: notifications. Reaches scheduling and tasks only through DomainEvents, their scope services and the DB. */
@Module({
  imports: [SchedulingModule],
  providers: [NotificationEvents, NotificationListeners],
  exports: [NotificationEvents],
})
export class NotificationsModule {}
```

In `apps/api/src/app.module.ts`, import `NotificationsModule` from `./notifications/notifications.module` and add it to `imports` after `TasksModule`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-events notification-domain-events tasks-work tasks-manage occurrence-jobs`
Expected: PASS. The forced failure logs one `Recording a task.assigned notification failed` error (silenced by `LOG_LEVEL=silent`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/notifications apps/api/src/app.module.ts apps/api/test/notification-events.test.ts
git commit -m "feat(api): record notification events in the business transaction from domain events" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Rules: the effective-rule merge, `GET/PUT/DELETE /notification-rules` and their audit

**Files:**
- Create: `apps/api/src/notifications/notification-rules.ts`, `apps/api/src/notifications/notification-rules.test.ts`, `apps/api/src/notifications/rules.service.ts`, `apps/api/src/notifications/rules.controller.ts`, `apps/api/src/notifications/dto.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`, `apps/api/test/notification-fixtures.ts`
- Test: `apps/api/test/notification-rules-api.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_RULES`, `NOTIFICATION_TYPE_META`, `RULE_TYPES`, `ruleTypeSchema`, `notificationRuleDtoSchema`, `updateNotificationRuleSchema`, `type UpdateNotificationRuleOutput`, `type NotificationIssueCode` (Task 1); `notificationRules`, `roles` (Task 5); `AuditService.record`, `RequirePermission`, `AppError`.
- Produces:
  - `notification-rules.ts` (pure): `interface RuleRow { enabled; push; email; notifyAssignees; notifyCreator: boolean; roleIds: string[]; leadMinutes: number | null }`, `interface RoleCatalog { bySystemKey: Partial<Record<SystemRoleKey, string>>; ids: ReadonlySet<string> }`, `effectiveRule(type: RuleType, row: RuleRow | null, roles: RoleCatalog): NotificationRuleDto`, `ruleIssues(type: RuleType, input: UpdateNotificationRuleOutput): Record<string, NotificationIssueCode>`.
  - `NotificationRules` (provider): `list(): Promise<NotificationRuleDto[]>` (in `RULE_TYPES` order), `effective(type: RuleType): Promise<NotificationRuleDto>`, `update(type, input): Promise<NotificationRuleDto>`, `reset(type): Promise<NotificationRuleDto>`. Runs in the current tenant transaction.
  - `GET /notification-rules`, `PUT /notification-rules/:type`, `DELETE /notification-rules/:type` (all `notifications.manage`; an unknown `:type` is `404`).
  - `dto.ts`: `UpdateNotificationRuleDto`, `NotificationRuleResponse`.
  - Fixture `staffAt(t, tenantId, ownerApi, roleKey, siteIds, fullName?)` → `{ id: string; email: string; api: Api }`: a staff user with a built-in role, linked to sites, logged in.

- [ ] **Step 1: Write the failing unit test**

`apps/api/src/notifications/notification-rules.test.ts`:

```ts
import { DEFAULT_RULES, RULE_TYPES } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { effectiveRule, type RoleCatalog, ruleIssues } from './notification-rules';

const MANAGER = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
const ADMIN = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02';
const CUSTOM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e03';
const GONE = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e04';
const roles: RoleCatalog = { bySystemKey: { manager: MANAGER, admin: ADMIN }, ids: new Set([MANAGER, ADMIN, CUSTOM]) };
const row = { enabled: false, push: false, email: true, notifyAssignees: true, notifyCreator: false, roleIds: [CUSTOM, GONE], leadMinutes: null };

describe('effectiveRule', () => {
  it('turns each default’s system roles into the tenant’s role ids', () => {
    expect(effectiveRule('checklist.missed', null, roles)).toEqual({
      type: 'checklist.missed', enabled: true, push: false, email: false, notifyAssignees: false, notifyCreator: false, roleIds: [MANAGER, ADMIN], leadMinutes: null, isDefault: true,
    });
    expect(effectiveRule('checklist.due_soon', null, roles)).toMatchObject({ roleIds: [], leadMinutes: 30, isDefault: true });
    for (const type of RULE_TYPES) expect(effectiveRule(type, null, roles)).toMatchObject({ enabled: DEFAULT_RULES[type].enabled, push: DEFAULT_RULES[type].push });
  });

  it('skips a system role the tenant does not have', () => {
    expect(effectiveRule('problem.critical', null, { bySystemKey: { admin: ADMIN }, ids: new Set([ADMIN]) }).roleIds).toEqual([ADMIN]);
  });

  it('lays the tenant row over the default and drops role ids that no longer exist', () => {
    expect(effectiveRule('task.assigned', row, roles)).toEqual({ type: 'task.assigned', ...row, roleIds: [CUSTOM], isDefault: false });
  });

  it('keeps the lead time only where it applies, falling back to the default when a stored one is missing', () => {
    expect(effectiveRule('checklist.due_soon', { ...row, leadMinutes: 120 }, roles).leadMinutes).toBe(120);
    expect(effectiveRule('checklist.due_soon', { ...row, leadMinutes: null }, roles).leadMinutes).toBe(30);
    expect(effectiveRule('checklist.available', { ...row, leadMinutes: 60 }, roles).leadMinutes).toBeNull();
  });
});

describe('ruleIssues', () => {
  const input = { enabled: true, push: true, email: false, notifyAssignees: false, notifyCreator: false, roleIds: [], leadMinutes: null };

  it('requires the lead time on due_soon and refuses it elsewhere', () => {
    expect(ruleIssues('checklist.due_soon', input)).toEqual({ leadMinutes: 'notifications.issues.leadMinutesRequired' });
    expect(ruleIssues('checklist.due_soon', { ...input, leadMinutes: 15 })).toEqual({});
    expect(ruleIssues('task.assigned', { ...input, leadMinutes: 15 })).toEqual({ leadMinutes: 'notifications.issues.leadMinutesNotApplicable' });
  });

  it('refuses direct audiences a type does not have', () => {
    expect(ruleIssues('problem.critical', { ...input, notifyAssignees: true, notifyCreator: true })).toEqual({
      notifyAssignees: 'notifications.issues.audienceNotApplicable',
      notifyCreator: 'notifications.issues.audienceNotApplicable',
    });
    expect(ruleIssues('checklist.overdue', { ...input, notifyAssignees: true, notifyCreator: true })).toEqual({ notifyCreator: 'notifications.issues.audienceNotApplicable' });
    expect(ruleIssues('task.overdue', { ...input, notifyAssignees: true, notifyCreator: true })).toEqual({});
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/api test -- src/notifications/notification-rules`
Expected: FAIL: `Cannot find module './notification-rules'`.

- [ ] **Step 3: The pure merge and checks**

`apps/api/src/notifications/notification-rules.ts`:

```ts
import {
  DEFAULT_RULES,
  type LeadMinutes,
  NOTIFICATION_TYPE_META,
  type NotificationIssueCode,
  type NotificationRuleDto,
  type RuleType,
  type SystemRoleKey,
  type UpdateNotificationRuleOutput,
} from '@taskop/contracts';

/** A notification_rules row, as stored. */
export interface RuleRow {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  roleIds: string[];
  leadMinutes: number | null;
}

/** The tenant's roles: the built-in ones by key, and every id that exists (roles are never deleted, only deactivated). */
export interface RoleCatalog {
  bySystemKey: Partial<Record<SystemRoleKey, string>>;
  ids: ReadonlySet<string>;
}

/** Spec §3.2: the default, with the tenant row's fields laid over it. Role ids without a role row are dropped. */
export function effectiveRule(type: RuleType, row: RuleRow | null, roles: RoleCatalog): NotificationRuleDto {
  const d = DEFAULT_RULES[type];
  if (!row) {
    return {
      type,
      enabled: d.enabled,
      push: d.push,
      email: d.email,
      notifyAssignees: d.notifyAssignees,
      notifyCreator: d.notifyCreator,
      roleIds: d.systemRoles.map((k) => roles.bySystemKey[k]).filter((id): id is string => id !== undefined),
      leadMinutes: d.leadMinutes,
      isDefault: true,
    };
  }
  return {
    type,
    enabled: row.enabled,
    push: row.push,
    email: row.email,
    notifyAssignees: row.notifyAssignees,
    notifyCreator: row.notifyCreator,
    roleIds: row.roleIds.filter((id) => roles.ids.has(id)),
    // notification_rules_lead_ck keeps a stored value inside LEAD_MINUTES.
    leadMinutes: NOTIFICATION_TYPE_META[type].hasLeadTime ? ((row.leadMinutes as LeadMinutes | null) ?? d.leadMinutes) : null,
    isDefault: false,
  };
}

/** The checks the input schema cannot make without the type (Interfaces: 400 VALIDATION_FAILED with these fields). */
export function ruleIssues(type: RuleType, input: UpdateNotificationRuleOutput): Record<string, NotificationIssueCode> {
  const meta = NOTIFICATION_TYPE_META[type];
  const issues: Record<string, NotificationIssueCode> = {};
  if (meta.hasLeadTime && input.leadMinutes === null) issues.leadMinutes = 'notifications.issues.leadMinutesRequired';
  if (!meta.hasLeadTime && input.leadMinutes !== null) issues.leadMinutes = 'notifications.issues.leadMinutesNotApplicable';
  if (input.notifyAssignees && !meta.audiences.includes('assignees')) issues.notifyAssignees = 'notifications.issues.audienceNotApplicable';
  if (input.notifyCreator && !meta.audiences.includes('creator')) issues.notifyCreator = 'notifications.issues.audienceNotApplicable';
  return issues;
}
```

- [ ] **Step 4: Run the unit test and check it passes**

Run: `pnpm --filter @taskop/api test -- src/notifications/notification-rules`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint test**

Append to `apps/api/test/notification-fixtures.ts` (add `import type { SystemRoleKey } from '@taskop/contracts';`, `import type { TestApp } from './app';`, `import { as, createUserDirect, loginStaff } from './fixtures';` and `import type { Api } from './scheduling-fixtures';`):

```ts
/** A staff user with a built-in role, linked to `siteIds`, logged in on the web. */
export async function staffAt(t: TestApp, tenantId: string, owner: Api, roleKey: SystemRoleKey, siteIds: string[], fullName = `Staff ${roleKey}`) {
  const u = await createUserDirect(t, tenantId, { kind: 'staff', roleKey, fullName, emailVerified: true });
  if (siteIds.length) {
    const res = await owner.put(`/api/v1/users/${u.id}/sites`, { siteIds });
    if (res.status !== 200) throw new Error(`linking sites failed: ${JSON.stringify(res.body)}`);
  }
  const login = await loginStaff(t, u.email!, u.secret, 'web');
  return { id: u.id, email: u.email!, api: as(t, login.accessToken) };
}
```

`apps/api/test/notification-rules-api.test.ts`:

```ts
import { RULE_TYPES } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, roleIdOf, signupTenant } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';

const full = { enabled: true, push: false, email: true, notifyAssignees: true, notifyCreator: true, roleIds: [] as string[], leadMinutes: null };

describe('notification rules API', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('lists every rule type with its effective defaults', async () => {
    const s = await signupTenant(t);
    const res = await as(t, s.accessToken).get('/api/v1/notification-rules');
    expect(res.status).toBe(200);
    expect(res.body.map((r: { type: string }) => r.type)).toEqual([...RULE_TYPES]);
    const manager = await roleIdOf(s.tenantId, 'manager');
    const admin = await roleIdOf(s.tenantId, 'admin');
    expect(res.body.find((r: { type: string }) => r.type === 'problem.critical')).toEqual({
      type: 'problem.critical', enabled: true, push: true, email: true, notifyAssignees: false, notifyCreator: false, roleIds: [manager, admin], leadMinutes: null, isDefault: true,
    });
  });

  it('saves an override, audits it, and resets back to the default', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const manager = await roleIdOf(s.tenantId, 'manager');
    const saved = await owner.put('/api/v1/notification-rules/task.overdue', { ...full, roleIds: [manager, manager] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ type: 'task.overdue', ...full, roleIds: [manager], isDefault: false });
    expect((await owner.get('/api/v1/notification-rules')).body.find((r: { type: string }) => r.type === 'task.overdue').isDefault).toBe(false);
    const reset = await owner.delete('/api/v1/notification-rules/task.overdue');
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ type: 'task.overdue', push: true, email: false, isDefault: true });
    expect((await owner.delete('/api/v1/notification-rules/task.overdue')).status).toBe(200);
    const audit = await ownerQuery<{ action: string; entity_type: string; entity_id: string | null; after: { type: string; isDefault: boolean } }>(
      "select action, entity_type, entity_id, after from audit_log where tenant_id = $1 and entity_type = 'notification_rule' order by occurred_at, id",
      [s.tenantId],
    );
    expect(audit.rows.map((r) => [r.action, r.entity_type, r.entity_id, r.after.type, r.after.isDefault])).toEqual([
      ['notification_rule.updated', 'notification_rule', null, 'task.overdue', false],
      ['notification_rule.reset', 'notification_rule', null, 'task.overdue', true],
    ]);
  });

  it('checks the lead time, the audiences and the roles', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const bad = async (type: string, body: object) => (await owner.put(`/api/v1/notification-rules/${type}`, body)).body.error;
    expect(await bad('checklist.due_soon', { ...full, notifyCreator: false })).toMatchObject({
      code: 'VALIDATION_FAILED', fields: { leadMinutes: 'notifications.issues.leadMinutesRequired' },
    });
    expect(await bad('problem.recorded', { ...full, leadMinutes: 30 })).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: { leadMinutes: 'notifications.issues.leadMinutesNotApplicable', notifyAssignees: 'notifications.issues.audienceNotApplicable', notifyCreator: 'notifications.issues.audienceNotApplicable' },
    });
    expect(await bad('task.assigned', { ...full, leadMinutes: 45 })).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await bad('task.assigned', { ...full, roleIds: [uuidv7()] })).toMatchObject({ code: 'REFERENCE_NOT_FOUND', fields: { roleIds: 'errors.REFERENCE_NOT_FOUND' } });
    const other = await signupTenant(t);
    expect(await bad('task.assigned', { ...full, roleIds: [await roleIdOf(other.tenantId, 'manager')] })).toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
    expect((await owner.put('/api/v1/notification-rules/manual', full)).status).toBe(404);
    expect((await owner.get('/api/v1/notification-rules/nope')).status).toBe(404);
    const ok = await owner.put('/api/v1/notification-rules/checklist.due_soon', { ...full, notifyCreator: false, leadMinutes: 120 });
    expect(ok.body).toMatchObject({ leadMinutes: 120, isDefault: false });
  });

  it('drops role ids that have no role row any more', async () => {
    const s = await signupTenant(t);
    const owner = as(t, s.accessToken);
    const manager = await roleIdOf(s.tenantId, 'manager');
    expect((await owner.put('/api/v1/notification-rules/task.completed', { ...full, notifyAssignees: false, roleIds: [manager] })).status).toBe(200);
    await ownerQuery("update notification_rules set role_ids = role_ids || $2::uuid where tenant_id = $1 and type = 'task.completed'", [s.tenantId, uuidv7()]);
    expect((await owner.get('/api/v1/notification-rules')).body.find((r: { type: string }) => r.type === 'task.completed').roleIds).toEqual([manager]);
  });

  it('needs notifications.manage', async () => {
    const s = await signupTenant(t);
    const manager = await staffAt(t, s.tenantId, as(t, s.accessToken), 'manager', []);
    expect((await manager.api.get('/api/v1/notification-rules')).status).toBe(403);
    expect((await manager.api.put('/api/v1/notification-rules/task.assigned', full)).status).toBe(403);
    expect((await manager.api.delete('/api/v1/notification-rules/task.assigned')).status).toBe(403);
    const admin = await staffAt(t, s.tenantId, as(t, s.accessToken), 'admin', []);
    expect((await admin.api.get('/api/v1/notification-rules')).status).toBe(200);
  });
});
```

- [ ] **Step 6: Run it and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-rules-api`
Expected: FAIL: `GET /api/v1/notification-rules` answers 404.

- [ ] **Step 7: Service, controller and DTOs**

`apps/api/src/notifications/dto.ts`:

```ts
import { notificationRuleDtoSchema, updateNotificationRuleSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateNotificationRuleDto extends createZodDto(updateNotificationRuleSchema) {}
export class NotificationRuleResponse extends createZodDto(notificationRuleDtoSchema) {}
```

`apps/api/src/notifications/rules.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type NotificationRuleDto, RULE_TYPES, type RuleType, type SystemRoleKey, type UpdateNotificationRuleOutput } from '@taskop/contracts';
import { eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { notificationRules, roles } from '../db/schema';
import { effectiveRule, type RoleCatalog, type RuleRow, ruleIssues } from './notification-rules';

/** FR-15.09: the tenant's rules, read and written in the current tenant transaction. */
@Injectable()
export class NotificationRules {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<NotificationRuleDto[]> {
    const rows = await this.db.tx().select().from(notificationRules);
    const byType = new Map(rows.map((r) => [r.type, r]));
    const catalog = await this.catalog();
    return RULE_TYPES.map((type) => effectiveRule(type, byType.get(type) ?? null, catalog));
  }

  async effective(type: RuleType): Promise<NotificationRuleDto> {
    return effectiveRule(type, await this.row(type), await this.catalog());
  }

  async update(type: RuleType, input: UpdateNotificationRuleOutput): Promise<NotificationRuleDto> {
    const issues = ruleIssues(type, input);
    if (Object.keys(issues).length) throw new AppError('VALIDATION_FAILED', { fields: issues });
    const tx = this.db.tx();
    if (input.roleIds.length) {
      // RLS hides other tenants' roles, so a foreign id is as unknown as a made-up one.
      const found = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, input.roleIds));
      if (found.length !== input.roleIds.length) throw new AppError('REFERENCE_NOT_FOUND', { fields: { roleIds: 'errors.REFERENCE_NOT_FOUND' } });
    }
    const before = await this.effective(type);
    const { tenantId, userId } = this.db.context();
    const values: RuleRow = {
      enabled: input.enabled,
      push: input.push,
      email: input.email,
      notifyAssignees: input.notifyAssignees,
      notifyCreator: input.notifyCreator,
      roleIds: input.roleIds,
      leadMinutes: input.leadMinutes,
    };
    const now = this.clock.now();
    await tx
      .insert(notificationRules)
      .values({ tenantId, type, ...values, updatedAt: now, updatedBy: userId })
      .onConflictDoUpdate({ target: [notificationRules.tenantId, notificationRules.type], set: { ...values, updatedAt: now, updatedBy: userId } });
    const after = await this.effective(type);
    await this.audit.record({ action: 'notification_rule.updated', entityType: 'notification_rule', entityId: null, before, after });
    return after;
  }

  /** Back to DEFAULT_RULES. Audited only when there was an override (Spec decision 17). */
  async reset(type: RuleType): Promise<NotificationRuleDto> {
    const before = await this.effective(type);
    const deleted = await this.db
      .tx()
      .delete(notificationRules)
      .where(eq(notificationRules.type, type))
      .returning({ type: notificationRules.type });
    const after = await this.effective(type);
    if (deleted.length) await this.audit.record({ action: 'notification_rule.reset', entityType: 'notification_rule', entityId: null, before, after });
    return after;
  }

  private async row(type: RuleType): Promise<RuleRow | null> {
    const [r] = await this.db.tx().select().from(notificationRules).where(eq(notificationRules.type, type));
    return r ?? null;
  }

  private async catalog(): Promise<RoleCatalog> {
    const rows = await this.db.tx().select({ id: roles.id, systemKey: roles.systemKey }).from(roles);
    const bySystemKey: Partial<Record<SystemRoleKey, string>> = {};
    for (const r of rows) if (r.systemKey) bySystemKey[r.systemKey] = r.id;
    return { bySystemKey, ids: new Set(rows.map((r) => r.id)) };
  }
}
```

`apps/api/src/notifications/rules.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Inject, Injectable, Param, type PipeTransform, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type NotificationRuleDto, type RuleType, ruleTypeSchema } from '@taskop/contracts';
import { AppError } from '../common/app-error';
import { RequirePermission } from '../common/decorators';
import { NotificationRuleResponse, UpdateNotificationRuleDto } from './dto';
import { NotificationRules } from './rules.service';

/** `manual` and unknown names are not rules: 404, like an unknown id. */
@Injectable()
export class ParseRuleTypePipe implements PipeTransform<string, RuleType> {
  transform(value: string): RuleType {
    const parsed = ruleTypeSchema.safeParse(value);
    if (!parsed.success) throw new AppError('NOT_FOUND');
    return parsed.data;
  }
}

/** Spec §6.4 "Rules". */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notification-rules')
@RequirePermission('notifications.manage')
export class NotificationRulesController {
  constructor(@Inject(NotificationRules) private readonly rules: NotificationRules) {}

  @Get()
  @ApiOkResponse({ type: [NotificationRuleResponse] })
  list(): Promise<NotificationRuleDto[]> {
    return this.rules.list();
  }

  @Put(':type')
  @ApiOkResponse({ type: NotificationRuleResponse })
  update(@Param('type', ParseRuleTypePipe) type: RuleType, @Body() body: UpdateNotificationRuleDto): Promise<NotificationRuleDto> {
    return this.rules.update(type, body);
  }

  @Delete(':type')
  @ApiOkResponse({ type: NotificationRuleResponse })
  reset(@Param('type', ParseRuleTypePipe) type: RuleType): Promise<NotificationRuleDto> {
    return this.rules.reset(type);
  }
}
```

In `apps/api/src/notifications/notifications.module.ts`, add `controllers: [NotificationRulesController]`, add `NotificationRules` to `providers` and `exports`:

```ts
@Module({
  imports: [SchedulingModule],
  controllers: [NotificationRulesController],
  providers: [NotificationEvents, NotificationListeners, NotificationRules],
  exports: [NotificationEvents, NotificationRules],
})
export class NotificationsModule {}
```

(with `import { NotificationRulesController } from './rules.controller';` and `import { NotificationRules } from './rules.service';`).

- [ ] **Step 8: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-rules`
Expected: PASS (both the unit file and `notification-rules-api`). `GET /notification-rules/nope` is `404` because no `GET :type` route exists.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/notifications apps/api/test/notification-fixtures.ts apps/api/test/notification-rules-api.test.ts
git commit -m "feat(api): add tenant notification rules over the code defaults, with audit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Targets and recipients (rule audiences, role scopes, manual expansion)

**Files:**
- Create: `apps/api/src/notifications/scope-subjects.ts`, `apps/api/src/notifications/notification-targets.ts`, `apps/api/src/notifications/notification-recipients.ts`
- Modify: `apps/api/src/common/request.ts`, `apps/api/src/scheduling/scheduling-scope.ts`, `apps/api/src/tasks/task-scope.ts`, `apps/api/src/tasks/tasks.module.ts`, `apps/api/src/notifications/notifications.module.ts`
- Test: `apps/api/test/notification-recipients.test.ts`

**Interfaces:**
- Consumes: `NotificationRules.effective` (Task 9); payload types (Task 8); `SchedulingScope`, `TaskScope`, `ScopeService.usersFilter`, `loadRolePermissions`; tables `users`, `roles`, `occurrences`, `occurrenceAssignees`, `checklists`, `sites`, `assignments`, `executionProblems`, `tasks`, `teams`, `userTeams`, `userSites`, `tenants`.
- Produces:
  - `request.ts`: `type ScopeHolder = Pick<Principal, 'userId' | 'dataScope'>`, `type TaskReader = Pick<Principal, 'userId' | 'dataScope' | 'permissions'>`. `SchedulingScope.assignments` / `.occurrences` take `ScopeHolder | null`; `TaskScope.covers` / `.readable` take `TaskReader`. `TasksModule` exports `TaskScope`.
  - `scope-subjects.ts`: `type ScopeSubject = TaskReader`; `ScopeSubjects.holdersOf(roleIds: string[]): Promise<ScopeSubject[]>` (active users of active roles), `ScopeSubjects.forUser(userId: string): Promise<ScopeSubject | null>`.
  - `notification-targets.ts`: `OccurrenceTarget { kind: 'occurrence'; occurrenceId; assignmentId; localDate: string; startsAt: Date; dueAt: Date; checklistName; siteName; timezone }`, `ProblemTarget { kind: 'problem'; problemId; severity: ProblemSeverity; note: string | null; occurrence: OccurrenceTarget }`, `AssignmentTarget { kind: 'assignment'; assignmentId; addedUserIds: string[]; checklistName; siteName }`, `TaskTarget { kind: 'task'; taskId; title; assigneeUserId: string | null; assigneeTeamId: string | null; createdByUserId; dueAt: Date | null; timezone }`, `ManualTarget = ManualPayload & { kind: 'manual'; senderUserId: string | null }`, `RuleTarget`, `NotificationTarget`; `NotificationTargets.load(type: NotificationType, payload: unknown, actorUserId: string | null): Promise<NotificationTarget | null>` (`null` = target gone).
  - `notification-recipients.ts`: `NotificationRecipients.resolve(rule: NotificationRuleDto, target: RuleTarget, actorUserId: string | null): Promise<string[]>` (spec §3.3, sorted user ids); `NotificationRecipients.forMessage(target: ManualTarget): Promise<string[]>`; `NotificationRecipients.expandMessage(sender: ScopeSubject, targets: { userIds: string[]; teamIds: string[]; siteIds: string[] }): Promise<string[]>`. All run in the current tenant transaction.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-recipients.test.ts`:

```ts
import type { NotificationRuleDto, RuleType } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationRecipients } from '../src/notifications/notification-recipients';
import { NotificationTargets, type RuleTarget } from '../src/notifications/notification-targets';
import { NotificationRules } from '../src/notifications/rules.service';
import { ScopeSubjects } from '../src/notifications/scope-subjects';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect, roleIdOf, siteTypeIdOf } from './fixtures';
import { staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { type Api, createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { act, closedRunWithProblems, createTask, newTaskBody, taskWorld } from './task-fixtures';

const sorted = (...ids: string[]) => [...ids].sort();

describe('notification recipients', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** Loads the target and the tenant's effective rule (with `override` laid over it) and resolves the recipients. */
  const resolve = (tenantId: string, type: RuleType, payload: object, actor: string | null = null, override: Partial<NotificationRuleDto> = {}) =>
    t.app.get(DbService).withTenant(tenantId, null, async () => {
      const target = await t.app.get(NotificationTargets).load(type, payload, actor);
      const rule = { ...(await t.app.get(NotificationRules).effective(type)), ...override };
      return t.app.get(NotificationRecipients).resolve(rule, target as RuleTarget, actor);
    });

  const role = async (api: Api, name: string, dataScope: string, permissions: string[]) => {
    const res = await api.post('/api/v1/roles', { name, dataScope, permissions });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  async function checklistWorld() {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const occurrenceId = (await occurrenceRows(a.id))[0]!.id;
    const here = await staffAt(t, w.s.tenantId, w.api, 'manager', [w.siteId], 'Menecer 1');
    const there = await staffAt(t, w.s.tenantId, w.api, 'manager', [w.otherSiteId], 'Menecer 2');
    const admin = await staffAt(t, w.s.tenantId, w.api, 'admin', [], 'Admin');
    return { w, a, occurrenceId, here, there, admin };
  }

  it('sends overdue to the assignees and the managers whose sites cover the run; missed to managers and admins', async () => {
    const { w, occurrenceId, here, admin } = await checklistWorld();
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId })).toEqual(sorted(w.workers[0]!, w.workers[1]!, here.id));
    expect(await resolve(w.s.tenantId, 'checklist.missed', { occurrenceId })).toEqual(sorted(here.id, admin.id));
  });

  it('applies every data scope of a role holder and needs assignments.view', async () => {
    const { w, occurrenceId } = await checklistWorld();
    const rAll = await role(w.api, 'Hamısı', 'all', ['assignments.view']);
    const rSubtree = await role(w.api, 'Obyekt', 'site_subtree', ['assignments.view']);
    const rSubs = await role(w.api, 'Rəhbər', 'subordinates', ['assignments.view']);
    const rOwn = await role(w.api, 'Özü', 'own', ['assignments.view']);
    const rNoView = await role(w.api, 'Baxışsız', 'all', []);
    const user = (roleId: string, fullName: string) => createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId, fullName });
    const all = await user(rAll, 'Hamısı');
    const subtreeHere = await user(rSubtree, 'Obyekt 1');
    expect((await w.api.put(`/api/v1/users/${subtreeHere.id}/sites`, { siteIds: [w.siteId] })).status).toBe(200);
    // Left out: a site_subtree holder elsewhere, a boss without subordinates on the run, an "own" stranger, a role without assignments.view.
    const subtreeThere = await user(rSubtree, 'Obyekt 2');
    expect((await w.api.put(`/api/v1/users/${subtreeThere.id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    const boss = await user(rSubs, 'Rəhbər');
    await ownerQuery('update users set manager_id = $1 where id = $2', [boss.id, w.workers[0]]);
    await user(rSubs, 'Tək rəhbər');
    // An assignee whose own role is "own" sees the run; a stranger with "own" does not.
    await ownerQuery('update users set role_id = $1 where id = $2', [rOwn, w.workers[1]]);
    await user(rOwn, 'Kənar');
    await user(rNoView, 'Baxışsız');
    const roleIds = [rAll, rSubtree, rSubs, rOwn, rNoView];
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId }, null, { notifyAssignees: false, roleIds })).toEqual(
      sorted(all.id, subtreeHere.id, boss.id, w.workers[1]!),
    );
    // An inactive role grants nothing.
    await ownerQuery('update roles set active = false where id = $1', [rAll]);
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId }, null, { notifyAssignees: false, roleIds })).toEqual(
      sorted(subtreeHere.id, boss.id, w.workers[1]!),
    );
  });

  it('removes the actor and inactive users', async () => {
    const { w, occurrenceId, here } = await checklistWorld();
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId }, w.workers[0]!)).toEqual(sorted(w.workers[1]!, here.id));
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w.workers[1]]);
    expect(await resolve(w.s.tenantId, 'checklist.overdue', { occurrenceId })).toEqual(sorted(w.workers[0]!, here.id));
  });

  it('tells the added users about an assignment, and role holders whose scope covers it', async () => {
    const { w, a, here } = await checklistWorld();
    const manager = await roleIdOf(w.s.tenantId, 'manager');
    expect(await resolve(w.s.tenantId, 'checklist.assigned', { assignmentId: a.id, addedUserIds: [w.workers[0]] })).toEqual([w.workers[0]]);
    expect(await resolve(w.s.tenantId, 'checklist.assigned', { assignmentId: a.id, addedUserIds: [w.workers[0]] }, w.s.ownerId, { roleIds: [manager] })).toEqual(
      sorted(w.workers[0]!, here.id),
    );
  });

  it('sends problems to the role holders who can see the run only, and treats a deleted problem as gone', async () => {
    const run = await closedRunWithProblems(t, clock);
    const w = run.w;
    const here = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 1');
    await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.otherSiteId], 'Menecer 2');
    const admin = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    const critical = { problemId: run.manualProblemId, occurrenceId: w.occurrenceId };
    expect(await resolve(w.s.tenantId, 'problem.critical', critical, w.workers[0].id)).toEqual(sorted(here.id, admin.id));
    expect(await resolve(w.s.tenantId, 'problem.recorded', { problemId: run.ruleProblemId, occurrenceId: w.occurrenceId }, w.workers[0].id)).toEqual([here.id]);
    // A later answers sync may delete a problem before its fan-out runs.
    await ownerQuery('delete from execution_problems where id = $1', [run.manualProblemId]);
    const gone = await t.app.get(DbService).withTenant(w.s.tenantId, null, () => t.app.get(NotificationTargets).load('problem.critical', critical, null));
    expect(gone).toBeNull();
  });

  it('sends team tasks to active team members until one accepts, and dedupes an assignee who is also the creator', async () => {
    const w = await taskWorld(t);
    const [w1, w2] = w.workers;
    const team = await createTask(w.manager.api, newTaskBody({ teamId: w.teamId }));
    expect(await resolve(w.s.tenantId, 'task.assigned', { taskId: team.id }, w.manager.id)).toEqual(sorted(w1.id, w2.id));
    await ownerQuery("update users set status = 'deactivated' where id = $1", [w2.id]);
    expect(await resolve(w.s.tenantId, 'task.cancelled', { taskId: team.id }, w.manager.id)).toEqual([w1.id]);
    await ownerQuery("update users set status = 'active' where id = $1", [w2.id]);
    clock.set('2026-11-02T04:20:00Z');
    await act(w1.api, team.id, 'accept', '2026-11-02T04:10:00.000Z');
    expect(await resolve(w.s.tenantId, 'task.cancelled', { taskId: team.id }, w.manager.id)).toEqual([w1.id]);
    const own = await createTask(w.manager.api, newTaskBody({ userId: w.manager.id }));
    expect(await resolve(w.s.tenantId, 'task.overdue', { taskId: own.id })).toEqual([w.manager.id]);
    expect(await resolve(w.s.tenantId, 'task.overdue', { taskId: own.id }, w.manager.id)).toEqual([]);
  });

  it('sends task notices to role holders who can read the task (tasks.view or tasks.manage, and TaskScope)', async () => {
    const w = await taskWorld(t);
    // A manager at Filial 2 reads neither the site nor the assignee (İşçi 1 works at Filial 1).
    await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.otherSiteId], 'Menecer 2');
    const task = await createTask(w.owner, newTaskBody({ userId: w.workers[0].id }, { siteId: w.siteId }));
    const manager = await roleIdOf(w.s.tenantId, 'manager');
    const worker = await roleIdOf(w.s.tenantId, 'worker');
    const rule = { notifyCreator: false, roleIds: [manager, worker] };
    expect(await resolve(w.s.tenantId, 'task.completed', { taskId: task.id }, w.workers[0].id, rule)).toEqual([w.manager.id]);
    expect(await resolve(w.s.tenantId, 'task.completed', { taskId: task.id }, w.workers[0].id)).toEqual([w.s.ownerId]);
  });

  it('expands a message to users, active members of active teams and users of a site subtree, inside the sender’s scope', async () => {
    const w = await schedulingWorld(t);
    const typeId = await siteTypeIdOf(w.s.tenantId);
    const child = (await w.api.post('/api/v1/sites', { parentId: w.siteId, typeId, name: 'Filial 1A' })).body.id as string;
    const childWorker = await createUserDirect(t, w.s.tenantId, { fullName: 'İşçi 1A' });
    expect((await w.api.put(`/api/v1/users/${childWorker.id}/sites`, { siteIds: [child] })).status).toBe(200);
    const far = await createUserDirect(t, w.s.tenantId, { fullName: 'Uzaq işçi' });
    expect((await w.api.put(`/api/v1/users/${far.id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    const team = (await w.api.post('/api/v1/teams', { name: 'Növbə A' })).body.id as string;
    expect((await w.api.put(`/api/v1/teams/${team}/members`, { userIds: [w.workers[0], far.id] })).status).toBe(200);
    const sleeping = (await w.api.post('/api/v1/teams', { name: 'Köhnə' })).body.id as string;
    expect((await w.api.put(`/api/v1/teams/${sleeping}/members`, { userIds: [w.workers[1]] })).status).toBe(200);
    expect((await w.api.patch(`/api/v1/teams/${sleeping}`, { active: false })).status).toBe(200);
    const here = await staffAt(t, w.s.tenantId, w.api, 'manager', [w.siteId], 'Menecer 1');
    const expand = (senderId: string, targets: { userIds?: string[]; teamIds?: string[]; siteIds?: string[] }) =>
      t.app.get(DbService).withTenant(w.s.tenantId, null, async () => {
        const sender = (await t.app.get(ScopeSubjects).forUser(senderId))!;
        return t.app.get(NotificationRecipients).expandMessage(sender, { userIds: [], teamIds: [], siteIds: [], ...targets });
      });
    expect(await expand(here.id, { siteIds: [w.siteId] })).toEqual(sorted(w.workers[0]!, w.workers[1]!, childWorker.id));
    expect(await expand(here.id, { siteIds: [child] })).toEqual([childWorker.id]);
    expect(await expand(here.id, { teamIds: [team] })).toEqual([w.workers[0]]);
    expect(await expand(here.id, { teamIds: [sleeping] })).toEqual([]);
    expect(await expand(here.id, { userIds: [far.id, here.id] })).toEqual([]);
    expect(await expand(w.s.ownerId, { teamIds: [team], userIds: [here.id] })).toEqual(sorted(w.workers[0]!, far.id, here.id));
    await ownerQuery("update users set status = 'deactivated' where id = $1", [childWorker.id]);
    expect(await expand(here.id, { siteIds: [w.siteId] })).toEqual(sorted(w.workers[0]!, w.workers[1]!));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-recipients`
Expected: FAIL: `Cannot find module '../src/notifications/notification-recipients'`.

- [ ] **Step 3: Widen the scope parameter types**

In `apps/api/src/common/request.ts`, append:

```ts
/** What the data-scope SQL reads from a principal. Notification fan-out builds one for recipients who are not the caller. */
export type ScopeHolder = Pick<Principal, 'userId' | 'dataScope'>;

/** What TaskScope's read rules read. */
export type TaskReader = Pick<Principal, 'userId' | 'dataScope' | 'permissions'>;
```

In `apps/api/src/scheduling/scheduling-scope.ts`, add `import type { ScopeHolder } from '../common/request';` and change two signatures (bodies unchanged):

```ts
  assignments(a: ScopeHolder | null): SQL | undefined {
```

```ts
  occurrences(a: ScopeHolder | null): SQL | undefined {
```

In `apps/api/src/tasks/task-scope.ts`, change the request import to `import type { Principal, TaskReader } from '../common/request';` and two signatures (bodies unchanged):

```ts
  covers(p: TaskReader): SQL {
```

```ts
  readable(p: TaskReader): SQL {
```

In `apps/api/src/tasks/tasks.module.ts`, export `TaskScope`:

```ts
  exports: [TaskSync, TaskScope],
```

- [ ] **Step 4: Scope subjects**

`apps/api/src/notifications/scope-subjects.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { PermissionKey } from '@taskop/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { TaskReader } from '../common/request';
import { DbService } from '../db/db.service';
import { roles, users } from '../db/schema';
import { loadRolePermissions } from '../roles/permission-resolver';

/** A user as the data-scope SQL sees them, built from their role like PrincipalLoader (Spec decision 2). */
export type ScopeSubject = TaskReader;

const NOTHING: ReadonlySet<PermissionKey> = new Set();

@Injectable()
export class ScopeSubjects {
  constructor(private readonly db: DbService) {}

  /** Active users holding one of `roleIds`. An inactive role grants nothing, so its holders are left out. */
  async holdersOf(roleIds: string[]): Promise<ScopeSubject[]> {
    if (!roleIds.length) return [];
    const tx = this.db.tx();
    const rows = await tx
      .select({ userId: users.id, roleId: roles.id, systemKey: roles.systemKey, dataScope: roles.dataScope })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(users.roleId, roleIds), eq(users.status, 'active'), eq(roles.active, true)))
      .orderBy(asc(users.id));
    const granted = new Map<string, ReadonlySet<PermissionKey>>();
    for (const r of rows) {
      if (!granted.has(r.roleId)) granted.set(r.roleId, new Set(await loadRolePermissions(tx, { id: r.roleId, systemKey: r.systemKey })));
    }
    return rows.map((r) => ({ userId: r.userId, dataScope: r.dataScope, permissions: granted.get(r.roleId)! }));
  }

  /** One user, whatever their status (a message's sender). An inactive role narrows to own and grants nothing. */
  async forUser(userId: string): Promise<ScopeSubject | null> {
    const tx = this.db.tx();
    const [r] = await tx
      .select({ roleId: roles.id, systemKey: roles.systemKey, dataScope: roles.dataScope, active: roles.active })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, userId));
    if (!r) return null;
    if (!r.active) return { userId, dataScope: 'own', permissions: NOTHING };
    return { userId, dataScope: r.dataScope, permissions: new Set(await loadRolePermissions(tx, { id: r.roleId, systemKey: r.systemKey })) };
  }
}
```

- [ ] **Step 5: Targets**

`apps/api/src/notifications/notification-targets.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { NotificationType, ProblemSeverity } from '@taskop/contracts';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { assignments, checklists, executionProblems, occurrences, sites, tasks, tenants } from '../db/schema';
import type { AssignedPayload, ManualPayload, OccurrencePayload, ProblemPayload, TaskPayload } from './payloads';

export interface OccurrenceTarget {
  kind: 'occurrence';
  occurrenceId: string;
  assignmentId: string;
  localDate: string;
  startsAt: Date;
  dueAt: Date;
  checklistName: string;
  siteName: string;
  /** The tenant's timezone, for times in texts. */
  timezone: string;
}

export interface ProblemTarget {
  kind: 'problem';
  problemId: string;
  severity: ProblemSeverity;
  note: string | null;
  occurrence: OccurrenceTarget;
}

export interface AssignmentTarget {
  kind: 'assignment';
  assignmentId: string;
  addedUserIds: string[];
  checklistName: string;
  siteName: string;
}

export interface TaskTarget {
  kind: 'task';
  taskId: string;
  title: string;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  createdByUserId: string;
  dueAt: Date | null;
  timezone: string;
}

export type ManualTarget = ManualPayload & { kind: 'manual'; senderUserId: string | null };

export type RuleTarget = OccurrenceTarget | ProblemTarget | AssignmentTarget | TaskTarget;
export type NotificationTarget = RuleTarget | ManualTarget;

/** Spec §6.1 step 4: what an event is about, read in the fan-out's tenant transaction. Null when it no longer exists. */
@Injectable()
export class NotificationTargets {
  constructor(private readonly db: DbService) {}

  async load(type: NotificationType, payload: unknown, actorUserId: string | null): Promise<NotificationTarget | null> {
    if (type === 'manual') return { kind: 'manual', ...(payload as ManualPayload), senderUserId: actorUserId };
    if (type === 'checklist.assigned') return this.assignment(payload as AssignedPayload);
    if (type.startsWith('checklist.')) return this.occurrence((payload as OccurrencePayload).occurrenceId);
    if (type.startsWith('problem.')) return this.problem(payload as ProblemPayload);
    return this.task((payload as TaskPayload).taskId);
  }

  private async timezone(): Promise<string> {
    const [t] = await this.db.tx().select({ timezone: tenants.timezone }).from(tenants);
    return t?.timezone ?? 'Asia/Baku';
  }

  private async occurrence(occurrenceId: string): Promise<OccurrenceTarget | null> {
    const [r] = await this.db
      .tx()
      .select({
        id: occurrences.id,
        assignmentId: occurrences.assignmentId,
        localDate: occurrences.localDate,
        startsAt: occurrences.startsAt,
        dueAt: occurrences.dueAt,
        checklistName: checklists.name,
        siteName: sites.name,
      })
      .from(occurrences)
      .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
      .innerJoin(sites, eq(sites.id, occurrences.siteId))
      .where(eq(occurrences.id, occurrenceId));
    if (!r) return null;
    return {
      kind: 'occurrence',
      occurrenceId: r.id,
      assignmentId: r.assignmentId,
      localDate: r.localDate,
      startsAt: r.startsAt,
      dueAt: r.dueAt,
      checklistName: r.checklistName,
      siteName: r.siteName,
      timezone: await this.timezone(),
    };
  }

  /** A problem a later answers sync deleted is gone, even though its occurrence stays. */
  private async problem(p: ProblemPayload): Promise<ProblemTarget | null> {
    const [r] = await this.db
      .tx()
      .select({ id: executionProblems.id, severity: executionProblems.severity, note: executionProblems.note })
      .from(executionProblems)
      .where(eq(executionProblems.id, p.problemId));
    if (!r) return null;
    const occurrence = await this.occurrence(p.occurrenceId);
    return occurrence ? { kind: 'problem', problemId: r.id, severity: r.severity, note: r.note, occurrence } : null;
  }

  private async assignment(p: AssignedPayload): Promise<AssignmentTarget | null> {
    const [r] = await this.db
      .tx()
      .select({ id: assignments.id, checklistName: checklists.name, siteName: sites.name })
      .from(assignments)
      .innerJoin(checklists, eq(checklists.id, assignments.checklistId))
      .innerJoin(sites, eq(sites.id, assignments.siteId))
      .where(eq(assignments.id, p.assignmentId));
    return r ? { kind: 'assignment', assignmentId: r.id, addedUserIds: p.addedUserIds, checklistName: r.checklistName, siteName: r.siteName } : null;
  }

  private async task(taskId: string): Promise<TaskTarget | null> {
    const [r] = await this.db
      .tx()
      .select({
        id: tasks.id,
        title: tasks.title,
        assigneeUserId: tasks.assigneeUserId,
        assigneeTeamId: tasks.assigneeTeamId,
        createdByUserId: tasks.createdByUserId,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!r) return null;
    return { kind: 'task', taskId: r.id, title: r.title, assigneeUserId: r.assigneeUserId, assigneeTeamId: r.assigneeTeamId, createdByUserId: r.createdByUserId, dueAt: r.dueAt, timezone: await this.timezone() };
  }
}
```

- [ ] **Step 6: Recipients**

`apps/api/src/notifications/notification-recipients.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { NotificationRuleDto } from '@taskop/contracts';
import { and, asc, eq, inArray, ne, or, type SQL, sql } from 'drizzle-orm';
import { ScopeService } from '../common/scope.service';
import { DbService } from '../db/db.service';
import { assignments, occurrenceAssignees, occurrences, sites, tasks, teams, users, userSites, userTeams } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import { TaskScope } from '../tasks/task-scope';
import type { ManualTarget, RuleTarget, TaskTarget } from './notification-targets';
import { type ScopeSubject, ScopeSubjects } from './scope-subjects';

/** Spec §3.3, and the manual-message expansion of spec §6.4. Runs in the current tenant transaction. */
@Injectable()
export class NotificationRecipients {
  constructor(
    private readonly db: DbService,
    private readonly subjects: ScopeSubjects,
    private readonly scheduling: SchedulingScope,
    private readonly taskScope: TaskScope,
    private readonly scope: ScopeService,
  ) {}

  /** Direct audience ∪ role audience in scope; active users only; the actor removed; one entry per user, by id. */
  async resolve(rule: NotificationRuleDto, target: RuleTarget, actorUserId: string | null): Promise<string[]> {
    const ids = new Set<string>([...(await this.direct(rule, target)), ...(await this.byRole(rule.roleIds, target))]);
    if (actorUserId) ids.delete(actorUserId);
    return this.activeOnly([...ids]);
  }

  /** A manual message at fan-out: expanded again with the sender's current scope (Spec decision 12). */
  async forMessage(target: ManualTarget): Promise<string[]> {
    if (!target.senderUserId) return [];
    const sender = await this.subjects.forUser(target.senderUserId);
    return sender ? this.expandMessage(sender, target) : [];
  }

  /**
   * Selected users ∪ members of selected active teams ∪ users attached to a selected site or any site below it;
   * then active users inside the sender's users scope, minus the sender. Sorted by id.
   */
  async expandMessage(sender: ScopeSubject, t: { userIds: string[]; teamIds: string[]; siteIds: string[] }): Promise<string[]> {
    const tx = this.db.tx();
    const via: SQL[] = [];
    if (t.userIds.length) via.push(inArray(users.id, t.userIds));
    if (t.teamIds.length) {
      via.push(
        inArray(
          users.id,
          tx
            .select({ id: userTeams.userId })
            .from(userTeams)
            .innerJoin(teams, eq(teams.id, userTeams.teamId))
            .where(and(inArray(userTeams.teamId, t.teamIds), eq(teams.active, true))),
        ),
      );
    }
    if (t.siteIds.length) {
      via.push(
        inArray(
          users.id,
          tx
            .select({ id: userSites.userId })
            .from(userSites)
            .innerJoin(sites, eq(sites.id, userSites.siteId))
            .where(sql`exists (select 1 from sites sel where ${inArray(sql`sel.id`, t.siteIds)} and ${sites.path} <@ sel.path)`),
        ),
      );
    }
    if (!via.length) return [];
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, 'active'), ne(users.id, sender.userId), this.scope.usersFilter(sender), or(...via)))
      .orderBy(asc(users.id));
    return rows.map((r) => r.id);
  }

  private async direct(rule: NotificationRuleDto, target: RuleTarget): Promise<string[]> {
    switch (target.kind) {
      case 'assignment':
        return rule.notifyAssignees ? target.addedUserIds : [];
      case 'occurrence': {
        if (!rule.notifyAssignees) return [];
        const rows = await this.db
          .tx()
          .select({ id: occurrenceAssignees.userId })
          .from(occurrenceAssignees)
          .where(eq(occurrenceAssignees.occurrenceId, target.occurrenceId));
        return rows.map((r) => r.id);
      }
      case 'problem':
        return [];
      case 'task':
        return [...(rule.notifyAssignees ? await this.taskAssignees(target) : []), ...(rule.notifyCreator ? [target.createdByUserId] : [])];
      default: {
        const unhandled: never = target;
        throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** The assignee, or while nobody has accepted, the members of the task's active team. */
  private async taskAssignees(t: TaskTarget): Promise<string[]> {
    if (t.assigneeUserId) return [t.assigneeUserId];
    if (!t.assigneeTeamId) return [];
    const rows = await this.db
      .tx()
      .select({ id: userTeams.userId })
      .from(userTeams)
      .innerJoin(teams, eq(teams.id, userTeams.teamId))
      .where(and(eq(userTeams.teamId, t.assigneeTeamId), eq(teams.active, true)));
    return rows.map((r) => r.id);
  }

  private async byRole(roleIds: string[], target: RuleTarget): Promise<string[]> {
    const out: string[] = [];
    for (const s of await this.subjects.holdersOf(roleIds)) if (await this.sees(s, target)) out.push(s.userId);
    return out;
  }

  /** Spec §3.3 rule 2 with Spec decisions 2–3: the role's permission, then the existing scope SQL for that user. */
  private async sees(s: ScopeSubject, target: RuleTarget): Promise<boolean> {
    const tx = this.db.tx();
    switch (target.kind) {
      case 'occurrence':
      case 'problem': {
        if (!s.permissions.has('assignments.view')) return false;
        const id = target.kind === 'occurrence' ? target.occurrenceId : target.occurrence.occurrenceId;
        const [r] = await tx.select({ id: occurrences.id }).from(occurrences).where(and(eq(occurrences.id, id), this.scheduling.occurrences(s)));
        return r !== undefined;
      }
      case 'assignment': {
        if (!s.permissions.has('assignments.view')) return false;
        const [r] = await tx.select({ id: assignments.id }).from(assignments).where(and(eq(assignments.id, target.assignmentId), this.scheduling.assignments(s)));
        return r !== undefined;
      }
      case 'task': {
        if (!s.permissions.has('tasks.view') && !s.permissions.has('tasks.manage')) return false;
        const [r] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, target.taskId), this.taskScope.readable(s)));
        return r !== undefined;
      }
      default: {
        const unhandled: never = target;
        throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async activeOnly(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .tx()
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.status, 'active')))
      .orderBy(asc(users.id));
    return rows.map((r) => r.id);
  }
}
```

In `apps/api/src/notifications/notifications.module.ts`, import `TasksModule` and add the three providers:

```ts
@Module({
  imports: [SchedulingModule, TasksModule],
  controllers: [NotificationRulesController],
  providers: [NotificationEvents, NotificationListeners, NotificationRules, ScopeSubjects, NotificationTargets, NotificationRecipients],
  exports: [NotificationEvents, NotificationRules],
})
export class NotificationsModule {}
```

(with `import { TasksModule } from '../tasks/tasks.module';`, `import { NotificationRecipients } from './notification-recipients';`, `import { NotificationTargets } from './notification-targets';`, `import { ScopeSubjects } from './scope-subjects';`).

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-recipients scheduling-scope tasks-scope`
Expected: PASS. The scope tests prove the widened signatures changed nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common/request.ts apps/api/src/scheduling/scheduling-scope.ts apps/api/src/tasks/task-scope.ts apps/api/src/tasks/tasks.module.ts apps/api/src/notifications apps/api/test/notification-recipients.test.ts
git commit -m "feat(api): load notification targets and resolve recipients by audience, role and data scope" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Azerbaijani notification texts and the email template

**Files:**
- Create: `apps/api/src/notifications/notification-templates.ts`
- Test: `apps/api/src/notifications/notification-templates.test.ts`

**Interfaces:**
- Consumes: the target types (Task 10); `type MailMessage` from `../mail/mailer`; `isProblemType`, `type NotificationType`, `type NotificationTargetKind` from `@taskop/contracts`.
- Produces:
  - `interface RenderedNotification { title: string; body: string; targetKind: NotificationTargetKind; targetId: string | null; targetDate: string | null }`
  - `renderNotification(type: NotificationType, target: NotificationTarget): RenderedNotification` — pure; times in `target.timezone` (24-hour `HH:mm`), dates `DD.MM.YYYY`; problem notes cut at 200 characters with `…`.
  - `notificationLink(webUrl: string, n: { type: NotificationType; targetKind; targetId; targetDate }): string` — `occurrence` → `/schedule?date=<targetDate>&occurrence=<id>` (+ `&tab=execution` for problem types), `task` → `/tasks?task=<id>`, `none` → `/notifications`.
  - `notificationMail(p: { to: string; webUrl: string; notification: RenderedNotification & { type: NotificationType } }): MailMessage` — subject = title; text = body, the link, and the opt-out hint.

- [ ] **Step 1: Write the failing test**

`apps/api/src/notifications/notification-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AssignmentTarget, ManualTarget, OccurrenceTarget, ProblemTarget, TaskTarget } from './notification-targets';
import { notificationLink, notificationMail, renderNotification } from './notification-templates';

const OCC = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
const TASK = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02';
// 08:00–10:00 in Baku (UTC+4).
const occurrence: OccurrenceTarget = {
  kind: 'occurrence', occurrenceId: OCC, assignmentId: OCC, localDate: '2026-11-02', startsAt: new Date('2026-11-02T04:00:00Z'),
  dueAt: new Date('2026-11-02T06:00:00Z'), checklistName: 'Açılış yoxlaması', siteName: 'Filial 1', timezone: 'Asia/Baku',
};
const problem: ProblemTarget = { kind: 'problem', problemId: OCC, severity: 'critical', note: 'Kondisioner xarabdır', occurrence };
const assignment: AssignmentTarget = { kind: 'assignment', assignmentId: OCC, addedUserIds: [], checklistName: 'Açılış yoxlaması', siteName: 'Filial 1' };
const task: TaskTarget = {
  kind: 'task', taskId: TASK, title: 'Soyuducunun qapısını təmir edin', assigneeUserId: null, assigneeTeamId: null, createdByUserId: TASK,
  dueAt: new Date('2026-11-02T10:30:00Z'), timezone: 'Asia/Baku',
};
const manual: ManualTarget = { kind: 'manual', title: 'Diqqət', body: 'Sabah iclas var.', userIds: [], teamIds: [], siteIds: [], email: false, senderUserId: null };
const onOccurrence = { targetKind: 'occurrence', targetId: OCC, targetDate: '2026-11-02' };
const onTask = { targetKind: 'task', targetId: TASK, targetDate: null };
const nowhere = { targetKind: 'none', targetId: null, targetDate: null };

describe('renderNotification', () => {
  it.each([
    ['checklist.assigned', assignment, 'Yeni checklist təyin edildi', 'Açılış yoxlaması — Filial 1', nowhere],
    ['checklist.available', occurrence, 'Checklist başladı', 'Açılış yoxlaması — Filial 1. Son vaxt: 10:00.', onOccurrence],
    ['checklist.due_soon', occurrence, 'Checklistin vaxtı yaxınlaşır', 'Açılış yoxlaması — Filial 1. 10:00-dək tamamlayın.', onOccurrence],
    ['checklist.overdue', occurrence, 'Checklist gecikir', 'Açılış yoxlaması — Filial 1. Son vaxt 10:00 idi (02.11.2026).', onOccurrence],
    ['checklist.missed', occurrence, 'Checklist icra olunmadı', 'Açılış yoxlaması — Filial 1, 02.11.2026.', onOccurrence],
    ['problem.recorded', { ...problem, severity: 'normal' }, 'Yeni problem', 'Filial 1, Açılış yoxlaması: Kondisioner xarabdır', onOccurrence],
    ['problem.critical', problem, 'Kritik problem!', 'Filial 1, Açılış yoxlaması: Kondisioner xarabdır', onOccurrence],
    ['task.assigned', task, 'Yeni tapşırıq', 'Soyuducunun qapısını təmir edin. Son vaxt: 02.11.2026 14:30.', onTask],
    ['task.submitted', task, 'Tapşırıq yoxlamaya göndərildi', 'Soyuducunun qapısını təmir edin', onTask],
    ['task.rejected', task, 'Tapşırıq geri qaytarıldı', 'Soyuducunun qapısını təmir edin', onTask],
    ['task.completed', task, 'Tapşırıq tamamlandı', 'Soyuducunun qapısını təmir edin', onTask],
    ['task.overdue', task, 'Tapşırıq gecikir', 'Soyuducunun qapısını təmir edin. Son vaxt 02.11.2026 14:30 idi.', onTask],
    ['task.cancelled', task, 'Tapşırıq ləğv edildi', 'Soyuducunun qapısını təmir edin', onTask],
    ['manual', manual, 'Diqqət', 'Sabah iclas var.', nowhere],
  ] as const)('%s', (type, target, title, body, where) => {
    expect(renderNotification(type, target)).toEqual({ title, body, ...where });
  });

  it('leaves the due part out of a task without a due time, and the note out of a problem without one', () => {
    expect(renderNotification('task.assigned', { ...task, dueAt: null }).body).toBe('Soyuducunun qapısını təmir edin');
    expect(renderNotification('task.overdue', { ...task, dueAt: null }).body).toBe('Soyuducunun qapısını təmir edin');
    expect(renderNotification('problem.critical', { ...problem, note: null }).body).toBe('Filial 1, Açılış yoxlaması');
  });

  it('cuts a long problem note', () => {
    const body = renderNotification('problem.recorded', { ...problem, note: 'x'.repeat(300) }).body;
    expect(body).toBe(`Filial 1, Açılış yoxlaması: ${'x'.repeat(200)}…`);
  });

  it('writes times in the tenant’s timezone', () => {
    expect(renderNotification('checklist.due_soon', { ...occurrence, timezone: 'UTC' }).body).toBe('Açılış yoxlaması — Filial 1. 06:00-dək tamamlayın.');
    expect(renderNotification('checklist.due_soon', { ...occurrence, timezone: 'Europe/Istanbul' }).body).toBe('Açılış yoxlaması — Filial 1. 09:00-dək tamamlayın.');
    // 23:30 UTC is already the next day in Baku.
    expect(renderNotification('task.overdue', { ...task, dueAt: new Date('2026-11-02T23:30:00Z') }).body).toBe('Soyuducunun qapısını təmir edin. Son vaxt 03.11.2026 03:30 idi.');
  });
});

describe('links and email', () => {
  const web = 'http://localhost:5173';

  it('links each target kind to its web page', () => {
    expect(notificationLink(web, { type: 'checklist.overdue', ...onOccurrence } as const)).toBe(`${web}/schedule?date=2026-11-02&occurrence=${OCC}`);
    expect(notificationLink(web, { type: 'problem.critical', ...onOccurrence } as const)).toBe(`${web}/schedule?date=2026-11-02&occurrence=${OCC}&tab=execution`);
    expect(notificationLink(web, { type: 'task.assigned', ...onTask } as const)).toBe(`${web}/tasks?task=${TASK}`);
    expect(notificationLink(web, { type: 'manual', ...nowhere } as const)).toBe(`${web}/notifications`);
  });

  it('mails the title as the subject and the body with the link', () => {
    const rendered = renderNotification('problem.critical', problem);
    expect(notificationMail({ to: 'menecer@example.az', webUrl: web, notification: { type: 'problem.critical', ...rendered } })).toEqual({
      to: 'menecer@example.az',
      subject: 'Kritik problem!',
      text: `Filial 1, Açılış yoxlaması: Kondisioner xarabdır\n\nAçmaq üçün: ${web}/schedule?date=2026-11-02&occurrence=${OCC}&tab=execution\n\nBu e-poçtları profil ayarlarında söndürə bilərsiniz.`,
    });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-templates`
Expected: FAIL: `Cannot find module './notification-templates'`.

- [ ] **Step 3: Implement**

`apps/api/src/notifications/notification-templates.ts`:

```ts
import { isProblemType, type NotificationTargetKind, type NotificationType } from '@taskop/contracts';
import type { MailMessage } from '../mail/mailer';
import type { NotificationTarget, OccurrenceTarget, ProblemTarget, TaskTarget } from './notification-targets';

/** What one inbox row stores and every channel sends (spec §5 `notifications`). */
export interface RenderedNotification {
  title: string;
  body: string;
  targetKind: NotificationTargetKind;
  targetId: string | null;
  targetDate: string | null;
}

const NOTE_MAX = 200;

/** HH:mm, 24-hour, in the tenant's timezone. */
const time = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/** DD.MM.YYYY from a YYYY-MM-DD local date. */
const day = (localDate: string) => localDate.split('-').reverse().join('.');

/** DD.MM.YYYY HH:mm of an instant, in the tenant's timezone. */
const dayTime = (d: Date, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${day(parts)} ${time(d, tz)}`;
};

const cut = (s: string) => (s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX)}…` : s);

const onOccurrence = (o: OccurrenceTarget) => ({ targetKind: 'occurrence' as const, targetId: o.occurrenceId, targetDate: o.localDate });
const onTask = (t: TaskTarget) => ({ targetKind: 'task' as const, targetId: t.taskId, targetDate: null });
const nowhere = { targetKind: 'none' as const, targetId: null, targetDate: null };

const place = (o: OccurrenceTarget) => `${o.checklistName} — ${o.siteName}`;
const problemBody = (p: ProblemTarget) => `${p.occurrence.siteName}, ${p.occurrence.checklistName}${p.note ? `: ${cut(p.note)}` : ''}`;

const OCCURRENCE_TEXTS: Record<'checklist.available' | 'checklist.due_soon' | 'checklist.overdue' | 'checklist.missed', [string, (o: OccurrenceTarget) => string]> = {
  'checklist.available': ['Checklist başladı', (o) => `${place(o)}. Son vaxt: ${time(o.dueAt, o.timezone)}.`],
  'checklist.due_soon': ['Checklistin vaxtı yaxınlaşır', (o) => `${place(o)}. ${time(o.dueAt, o.timezone)}-dək tamamlayın.`],
  'checklist.overdue': ['Checklist gecikir', (o) => `${place(o)}. Son vaxt ${time(o.dueAt, o.timezone)} idi (${day(o.localDate)}).`],
  'checklist.missed': ['Checklist icra olunmadı', (o) => `${place(o)}, ${day(o.localDate)}.`],
};

const TASK_TITLES: Record<'task.assigned' | 'task.submitted' | 'task.rejected' | 'task.completed' | 'task.overdue' | 'task.cancelled', string> = {
  'task.assigned': 'Yeni tapşırıq',
  'task.submitted': 'Tapşırıq yoxlamaya göndərildi',
  'task.rejected': 'Tapşırıq geri qaytarıldı',
  'task.completed': 'Tapşırıq tamamlandı',
  'task.overdue': 'Tapşırıq gecikir',
  'task.cancelled': 'Tapşırıq ləğv edildi',
};

const taskBody = (type: keyof typeof TASK_TITLES, t: TaskTarget) => {
  if (type === 'task.assigned' && t.dueAt) return `${t.title}. Son vaxt: ${dayTime(t.dueAt, t.timezone)}.`;
  if (type === 'task.overdue' && t.dueAt) return `${t.title}. Son vaxt ${dayTime(t.dueAt, t.timezone)} idi.`;
  return t.title;
};

/** Spec §6.1 step 4: the Azerbaijani title and body, rendered once at fan-out. */
export function renderNotification(type: NotificationType, target: NotificationTarget): RenderedNotification {
  switch (target.kind) {
    case 'manual':
      return { title: target.title, body: target.body, ...nowhere };
    case 'assignment':
      return { title: 'Yeni checklist təyin edildi', body: `${target.checklistName} — ${target.siteName}`, ...nowhere };
    case 'occurrence': {
      const [title, body] = OCCURRENCE_TEXTS[type as keyof typeof OCCURRENCE_TEXTS];
      return { title, body: body(target), ...onOccurrence(target) };
    }
    case 'problem':
      return { title: type === 'problem.critical' ? 'Kritik problem!' : 'Yeni problem', body: problemBody(target), ...onOccurrence(target.occurrence) };
    case 'task': {
      const t = type as keyof typeof TASK_TITLES;
      return { title: TASK_TITLES[t], body: taskBody(t, target), ...onTask(target) };
    }
    default: {
      const unhandled: never = target;
      throw new Error(`Unhandled target: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The web page a notification opens (spec §8), as an absolute link for email. */
export function notificationLink(
  webUrl: string,
  n: { type: NotificationType; targetKind: NotificationTargetKind; targetId: string | null; targetDate: string | null },
): string {
  if (n.targetKind === 'occurrence' && n.targetId && n.targetDate) {
    return `${webUrl}/schedule?date=${n.targetDate}&occurrence=${n.targetId}${isProblemType(n.type) ? '&tab=execution' : ''}`;
  }
  if (n.targetKind === 'task' && n.targetId) return `${webUrl}/tasks?task=${n.targetId}`;
  return `${webUrl}/notifications`;
}

/** Plain-text email (spec §6.1 step 5), next to mail/templates.ts in style. */
export function notificationMail(p: { to: string; webUrl: string; notification: RenderedNotification & { type: NotificationType } }): MailMessage {
  const n = p.notification;
  return {
    to: p.to,
    subject: n.title,
    text: `${n.body}\n\nAçmaq üçün: ${notificationLink(p.webUrl, n)}\n\nBu e-poçtları profil ayarlarında söndürə bilərsiniz.`,
  };
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api test -- notification-templates && pnpm --filter @taskop/api typecheck`
Expected: PASS. Node 24 ships full ICU, so `Intl.DateTimeFormat` knows every IANA zone; `en-CA` formats dates as `YYYY-MM-DD`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications/notification-templates.ts apps/api/src/notifications/notification-templates.test.ts
git commit -m "feat(api): render Azerbaijani notification texts, web links and the notification email" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The fan-out worker (`notifications.fanout`)

**Files:**
- Create: `apps/api/src/notifications/notification-fanout.ts`, `apps/api/src/notifications/queues.test.ts`
- Modify: `apps/api/src/notifications/queues.ts`, `apps/api/src/notifications/notifications.module.ts`, `apps/api/test/notification-fixtures.ts`
- Test: `apps/api/test/notification-fanout.test.ts`

**Interfaces:**
- Consumes: `JobsService.defineWorker` / `send` (Task 6); `NotificationRules.effective` (Task 9); `NotificationTargets.load`, `NotificationRecipients.resolve` / `forMessage` (Task 10); `renderNotification` (Task 11); tables `notificationEvents`, `notifications`, `notificationDeliveries`, `pushDevices`, `users` (Task 5).
- Produces:
  - `queues.ts`: `deliveryJobs(tenantId: string, rows: ReadonlyArray<{ id: string; channel: DeliveryChannel }>): DeliverJob[]` — push ids in chunks of ≤ 100, then one job per email delivery.
  - `NOTIFICATION_OUTCOMES = ['fanned_out', 'disabled', 'no_recipients', 'target_gone'] as const`, `type NotificationOutcome`, `type FanoutResult = NotificationOutcome | 'already_processed' | 'missing' | 'failed'`.
  - `NotificationFanout.run(job: FanoutJob): Promise<FanoutResult>` — the body of the `notifications.fanout` worker (defined in `onModuleInit`, `retryLimit: 5`, dead letter `notifications.dead`). Throws on a failed attempt below 5; on the 5th it stores `last_error`, sends `{ queue: 'notifications.fanout', tenantId, eventId, error }` to `notifications.dead` and returns `'failed'` (Spec decision 1).
  - Inbox rows carry the rendered texts; delivery rows: one `push` per active device of the recipient when push is on (manual: always), one `email` when email is on (manual: `payload.email`), the user has an email address and `email_notifications` is true. Deliver jobs are sent after commit.
  - Fixtures: `fanOutAll(t, tenantId): Promise<FanoutResult[]>`, `type InboxRow`, `inboxOf(userId): Promise<InboxRow[]>`, `type DeliveryRow`, `deliveriesOf(userId): Promise<DeliveryRow[]>`.

- [ ] **Step 1: Write the failing unit test**

`apps/api/src/notifications/queues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deliveryJobs, failureText } from './queues';

describe('deliveryJobs', () => {
  it('batches push deliveries by 100 and sends each email on its own', () => {
    const push = Array.from({ length: 250 }, (_, i) => ({ id: `p${i}`, channel: 'push' as const }));
    const jobs = deliveryJobs('t1', [...push, { id: 'e1', channel: 'email' }, { id: 'e2', channel: 'email' }]);
    expect(jobs.map((j) => j.deliveryIds.length)).toEqual([100, 100, 50, 1, 1]);
    expect(jobs.every((j) => j.tenantId === 't1')).toBe(true);
    expect(jobs.at(-1)!.deliveryIds).toEqual(['e2']);
    expect(deliveryJobs('t1', [])).toEqual([]);
  });
});

describe('failureText', () => {
  it('never stores SQL or parameters', () => {
    expect(failureText({ message: 'Failed query: insert … params: secret', cause: { code: '23505', constraint: 'x_uq' } })).toBe('Database error 23505 (x_uq)');
    expect(failureText(new Error('Failed query: select 1\nparams: secret'))).toBe('Database error');
    expect(failureText(new Error('boom'))).toBe('boom');
    expect(failureText(new Error('x'.repeat(600)))).toHaveLength(500);
  });
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `pnpm --filter @taskop/api test -- src/notifications/queues`
Expected: FAIL: `deliveryJobs` is not exported.

- [ ] **Step 3: Implement `deliveryJobs`**

Append to `apps/api/src/notifications/queues.ts` (and add `import type { DeliveryChannel } from '@taskop/contracts';` at the top):

```ts
/** Spec §6.1 step 4: push deliveries in batches of ≤ 100 (one Expo request each), email deliveries one per job. */
export function deliveryJobs(tenantId: string, rows: ReadonlyArray<{ id: string; channel: DeliveryChannel }>): DeliverJob[] {
  const push = rows.filter((r) => r.channel === 'push').map((r) => r.id);
  const jobs: DeliverJob[] = [];
  for (let i = 0; i < push.length; i += NOTIFICATION_LIMITS.pushBatch) jobs.push({ tenantId, deliveryIds: push.slice(i, i + NOTIFICATION_LIMITS.pushBatch) });
  for (const r of rows) if (r.channel === 'email') jobs.push({ tenantId, deliveryIds: [r.id] });
  return jobs;
}
```

Run: `pnpm --filter @taskop/api test -- src/notifications/queues`
Expected: PASS.

- [ ] **Step 4: Write the failing fan-out test**

Append to `apps/api/test/notification-fixtures.ts` (add `import { NotificationFanout, type FanoutResult } from '../src/notifications/notification-fanout';`):

```ts
/** Runs fan-out for every unprocessed event of the tenant, oldest first, as the worker would. */
export async function fanOutAll(t: TestApp, tenantId: string): Promise<FanoutResult[]> {
  const r = await ownerQuery<{ id: string }>('select id from notification_events where tenant_id = $1 and processed_at is null order by created_at, id', [tenantId]);
  const out: FanoutResult[] = [];
  for (const { id } of r.rows) out.push(await t.app.get(NotificationFanout).run({ tenantId, eventId: id }));
  return out;
}

export interface InboxRow {
  id: string;
  event_id: string;
  type: string;
  title: string;
  body: string;
  target_kind: string;
  target_id: string | null;
  target_date: string | null;
  created_at: Date;
  read_at: Date | null;
}

/** A user's inbox, oldest first (owner connection). */
export async function inboxOf(userId: string): Promise<InboxRow[]> {
  const r = await ownerQuery<InboxRow>(
    `select id, event_id, type, title, body, target_kind, target_id, to_char(target_date, 'YYYY-MM-DD') as target_date, created_at, read_at
       from notifications where user_id = $1 order by created_at, id`,
    [userId],
  );
  return r.rows;
}

export interface DeliveryRow {
  id: string;
  notification_id: string;
  channel: 'push' | 'email';
  device_id: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_ref: string | null;
  sent_at: Date | null;
}

/** Every delivery of a user's notifications: email last, push by device (owner connection). */
export async function deliveriesOf(userId: string): Promise<DeliveryRow[]> {
  const r = await ownerQuery<DeliveryRow>(
    `select d.id, d.notification_id, d.channel, d.device_id, d.status, d.attempts, d.last_error, d.provider_ref, d.sent_at
       from notification_deliveries d join notifications n on n.id = d.notification_id
      where n.user_id = $1 order by d.channel desc, d.device_id, d.id`,
    [userId],
  );
  return r.rows;
}
```

`apps/api/test/notification-fanout.test.ts`:

```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbService } from '../src/db/db.service';
import { NotificationEvents } from '../src/notifications/notification-events';
import { NotificationFanout } from '../src/notifications/notification-fanout';
import { NotificationRecipients } from '../src/notifications/notification-recipients';
import { JobsService } from '../src/scheduling/jobs.service';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addDevice, deliveriesOf, eventRows, fanOutAll, inboxOf, staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';
import { closedRunWithProblems, createTask, newTaskBody, taskWorld } from './task-fixtures';

const rule = (over: Record<string, unknown> = {}) => ({ enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, ...over });

describe('notification fan-out', () => {
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

  it('writes the inbox row and one queued push per active device, marks the event, and queues delivery after commit', async () => {
    const w = await taskWorld(t);
    const worker = w.workers[0];
    const phone = await addDevice(w.s.tenantId, worker.id);
    const tablet = await addDevice(w.s.tenantId, worker.id);
    const old = await addDevice(w.s.tenantId, worker.id);
    await ownerQuery('update push_devices set disabled_at = now() where id = $1', [old.id]);
    const task = await createTask(w.manager.api, newTaskBody({ userId: worker.id }));
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    clock.set('2026-11-02T04:00:05Z');
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['fanned_out']);
    expect(await inboxOf(worker.id)).toEqual([
      expect.objectContaining({ type: 'task.assigned', title: 'Yeni tapşırıq', body: 'Soyuducunun qapısını təmir edin', target_kind: 'task', target_id: task.id, target_date: null, read_at: null, created_at: new Date('2026-11-02T04:00:05Z') }),
    ]);
    const deliveries = await deliveriesOf(worker.id);
    expect(deliveries.map((d) => [d.channel, d.device_id, d.status, d.attempts])).toEqual(
      [['push', phone.id, 'queued', 0], ['push', tablet.id, 'queued', 0]].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    );
    const [event] = await eventRows(w.s.tenantId);
    expect(event).toMatchObject({ outcome: 'fanned_out', attempts: 1, processed_at: new Date('2026-11-02T04:00:05Z'), last_error: null });
    expect(send).toHaveBeenCalledWith('notifications.deliver', { tenantId: w.s.tenantId, deliveryIds: expect.arrayContaining(deliveries.map((d) => d.id)) });
    expect(await t.app.get(NotificationFanout).run({ tenantId: w.s.tenantId, eventId: event!.id })).toBe('already_processed');
    expect(await inboxOf(worker.id)).toHaveLength(1);
    expect(await inboxOf(w.manager.id)).toEqual([]);
  });

  it('renders the due time in Baku time and links the occurrence by its date', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const today = (await occurrenceRows(a.id))[0]!;
    await fanOutAll(t, w.s.tenantId); // checklist.assigned
    clock.set('2026-11-02T06:30:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['fanned_out']);
    expect((await inboxOf(w.workers[0]!)).map((n) => [n.type, n.title, n.body, n.target_kind, n.target_id, n.target_date])).toEqual([
      ['checklist.assigned', 'Yeni checklist təyin edildi', 'Açılış yoxlaması — Filial 1', 'none', null, null],
      ['checklist.overdue', 'Checklist gecikir', 'Açılış yoxlaması — Filial 1. Son vaxt 10:00 idi (02.11.2026).', 'occurrence', today.id, '2026-11-02'],
    ]);
  });

  it('emails a critical problem to role holders who have an address and did not opt out', async () => {
    const run = await closedRunWithProblems(t, clock);
    const w = run.w;
    const here = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 1');
    const admin = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    await ownerQuery('update users set email_notifications = false where id = $1', [admin.id]);
    expect((await fanOutAll(t, w.s.tenantId)).sort()).toEqual(['fanned_out', 'fanned_out', 'fanned_out']);
    const managerInbox = await inboxOf(here.id);
    expect(managerInbox.map((n) => n.type).sort()).toEqual(['problem.critical', 'problem.recorded']);
    const critical = managerInbox.find((n) => n.type === 'problem.critical')!;
    expect(critical).toMatchObject({ title: 'Kritik problem!', body: 'Filial 1, İcra yoxlaması: Kondisioner xarabdır', target_kind: 'occurrence', target_id: w.occurrenceId, target_date: '2026-11-02' });
    expect((await deliveriesOf(here.id)).map((d) => [d.notification_id, d.channel])).toEqual([[critical.id, 'email']]);
    expect((await inboxOf(admin.id)).map((n) => n.type)).toEqual(['problem.critical']);
    expect(await deliveriesOf(admin.id)).toEqual([]);
    expect(await inboxOf(w.workers[0].id)).toEqual([expect.objectContaining({ type: 'checklist.assigned' })]);
  });

  it('marks disabled rules, gone targets and empty audiences as processed with their outcome', async () => {
    const w = await taskWorld(t);
    expect((await w.owner.put('/api/v1/notification-rules/task.assigned', rule({ enabled: false }))).status).toBe(200);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['disabled']);
    expect((await w.owner.delete('/api/v1/notification-rules/task.assigned')).status).toBe(200);
    // The manager assigns a task to themselves: the actor is never notified.
    await createTask(w.manager.api, newTaskBody({ userId: w.manager.id }));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['no_recipients']);
    await t.app.get(DbService).withTenant(w.s.tenantId, null, () => t.app.get(NotificationEvents).create('task.overdue', { taskId: uuidv7() }, null));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['target_gone']);
    expect((await eventRows(w.s.tenantId)).map((e) => [e.outcome, e.attempts, e.processed_at !== null])).toEqual([
      ['disabled', 1, true],
      ['no_recipients', 1, true],
      ['target_gone', 1, true],
    ]);
    expect(await inboxOf(w.workers[0].id)).toEqual([]);
  });

  it('fans a manual message out to the sender’s targets with email when asked', async () => {
    const w = await taskWorld(t);
    await ownerQuery("update users set email = $2 where id = $1", [w.workers[0].id, `isci1-${w.s.tenantId}@example.az`]);
    const payload = { title: 'Diqqət', body: 'Sabah iclas var.', userIds: [], teamIds: [w.teamId], siteIds: [], email: true };
    await t.app.get(DbService).withTenant(w.s.tenantId, w.s.ownerId, () => t.app.get(NotificationEvents).create('manual', payload, w.s.ownerId));
    expect(await fanOutAll(t, w.s.tenantId)).toEqual(['fanned_out']);
    for (const u of [w.workers[0], w.workers[1]]) {
      expect((await inboxOf(u.id)).map((n) => [n.type, n.title, n.body, n.target_kind])).toEqual([['manual', 'Diqqət', 'Sabah iclas var.', 'none']]);
    }
    expect((await deliveriesOf(w.workers[0].id)).map((d) => d.channel)).toEqual(['email']);
    expect(await deliveriesOf(w.workers[1].id)).toEqual([]);
    expect(await inboxOf(w.s.ownerId)).toEqual([]);
  });

  it('counts failed attempts and gives up after the fifth, into notifications.dead', async () => {
    const w = await taskWorld(t);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    const [event] = await eventRows(w.s.tenantId);
    vi.spyOn(t.app.get(NotificationRecipients), 'resolve').mockRejectedValue(new Error('boom'));
    const send = vi.spyOn(t.app.get(JobsService), 'send');
    const fanout = t.app.get(NotificationFanout);
    const job = { tenantId: w.s.tenantId, eventId: event!.id };
    for (let i = 1; i <= 4; i++) {
      await expect(fanout.run(job)).rejects.toThrow('boom');
      expect((await eventRows(w.s.tenantId))[0]).toMatchObject({ attempts: i, last_error: 'boom', processed_at: null });
    }
    expect(await fanout.run(job)).toBe('failed');
    expect((await eventRows(w.s.tenantId))[0]).toMatchObject({ attempts: 5, last_error: 'boom', processed_at: null, outcome: null });
    expect(send).toHaveBeenCalledWith('notifications.dead', { queue: 'notifications.fanout', ...job, error: 'boom' });
    expect(await inboxOf(w.workers[0].id)).toEqual([]);
  });
});
```

The checklist in `executionWorld` (used by `closedRunWithProblems`) is named "İcra yoxlaması"; the one in `schedulingWorld` "Açılış yoxlaması". Both worlds' first site is "Filial 1".

- [ ] **Step 5: Run it and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-fanout`
Expected: FAIL: `Cannot find module '../src/notifications/notification-fanout'`.

- [ ] **Step 6: Implement the worker**

`apps/api/src/notifications/notification-fanout.ts`:

```ts
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationRuleDto, NotificationType } from '@taskop/contracts';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notificationEvents, notifications, pushDevices, users } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { NotificationRecipients } from './notification-recipients';
import { NotificationTargets } from './notification-targets';
import { renderNotification } from './notification-templates';
import { deliveryJobs, type FanoutJob, failureText, NOTIFICATION_LIMITS, NOTIFICATION_QUEUES } from './queues';
import { NotificationRules } from './rules.service';

export const NOTIFICATION_OUTCOMES = ['fanned_out', 'disabled', 'no_recipients', 'target_gone'] as const;
export type NotificationOutcome = (typeof NOTIFICATION_OUTCOMES)[number];
export type FanoutResult = NotificationOutcome | 'already_processed' | 'missing' | 'failed';

type DeliveryInsert = typeof notificationDeliveries.$inferInsert;

/** Spec §6.1 step 4: one event → inbox rows and delivery rows, in one tenant transaction. */
@Injectable()
export class NotificationFanout implements OnModuleInit {
  private readonly logger = new Logger('NotificationFanout');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly rules: NotificationRules,
    private readonly targets: NotificationTargets,
    private readonly recipients: NotificationRecipients,
  ) {}

  onModuleInit(): void {
    this.jobs.defineWorker<FanoutJob>(
      NOTIFICATION_QUEUES.fanout,
      async (job) => {
        await this.run(job);
      },
      { retryLimit: NOTIFICATION_LIMITS.maxAttempts, deadLetter: NOTIFICATION_QUEUES.dead },
    );
  }

  /** Throws below the 5th failed attempt so pg-boss retries with backoff; gives up on the 5th (Spec decision 1). */
  async run(job: FanoutJob): Promise<FanoutResult> {
    try {
      return await this.db.withTenant(job.tenantId, null, () => this.fanOut(job));
    } catch (e) {
      const error = failureText(e);
      const attempts = await this.countFailure(job, error);
      if (attempts === null || attempts < NOTIFICATION_LIMITS.maxAttempts) throw e;
      this.logger.error(sanitiseForLog(e, null), `Fan-out of notification event ${job.eventId} failed ${attempts} times; giving up`);
      await this.jobs.send(NOTIFICATION_QUEUES.dead, { queue: NOTIFICATION_QUEUES.fanout, ...job, error });
      return 'failed';
    }
  }

  /** In its own transaction: the failed one rolled back. Null when it cannot be recorded (pg-boss then retries). */
  private async countFailure(job: FanoutJob, error: string): Promise<number | null> {
    try {
      return await this.db.withTenant(job.tenantId, null, async (tx) => {
        const [r] = await tx
          .update(notificationEvents)
          .set({ attempts: sql`${notificationEvents.attempts} + 1`, lastError: error })
          .where(and(eq(notificationEvents.id, job.eventId), isNull(notificationEvents.processedAt)))
          .returning({ attempts: notificationEvents.attempts });
        return r?.attempts ?? null;
      });
    } catch {
      return null;
    }
  }

  private async fanOut(job: FanoutJob): Promise<FanoutResult> {
    const tx = this.db.tx();
    // Locked: a second run for the same event (sweep re-send) waits, then sees processed_at.
    const [ev] = await tx.select().from(notificationEvents).where(eq(notificationEvents.id, job.eventId)).for('update');
    if (!ev) return 'missing';
    if (ev.processedAt) return 'already_processed';
    const type = ev.type as NotificationType;
    const finish = async (outcome: NotificationOutcome): Promise<NotificationOutcome> => {
      await tx
        .update(notificationEvents)
        .set({ processedAt: this.clock.now(), outcome, attempts: sql`${notificationEvents.attempts} + 1`, lastError: null })
        .where(eq(notificationEvents.id, ev.id));
      return outcome;
    };

    let rule: NotificationRuleDto | null = null;
    if (type !== 'manual') {
      rule = await this.rules.effective(type);
      if (!rule.enabled) return finish('disabled');
    }
    const target = await this.targets.load(type, ev.payload, ev.actorUserId);
    if (!target) return finish('target_gone');
    const userIds = target.kind === 'manual' ? await this.recipients.forMessage(target) : await this.recipients.resolve(rule!, target, ev.actorUserId);
    if (!userIds.length) return finish('no_recipients');

    const rendered = renderNotification(type, target);
    const push = target.kind === 'manual' ? true : rule!.push;
    const email = target.kind === 'manual' ? target.email : rule!.email;
    const now = this.clock.now();
    const inbox = await tx
      .insert(notifications)
      .values(userIds.map((userId) => ({ tenantId: ev.tenantId, eventId: ev.id, userId, type, ...rendered, createdAt: now })))
      .onConflictDoNothing({ target: [notifications.eventId, notifications.userId] })
      .returning({ id: notifications.id, userId: notifications.userId });
    const rows: DeliveryInsert[] = [];
    const delivery = (notificationId: string, channel: 'push' | 'email', deviceId: string | null): DeliveryInsert => ({
      tenantId: ev.tenantId,
      notificationId,
      channel,
      deviceId,
      createdAt: now,
      updatedAt: now,
    });
    if (inbox.length && push) {
      const devices = await tx
        .select({ id: pushDevices.id, userId: pushDevices.userId })
        .from(pushDevices)
        .where(and(inArray(pushDevices.userId, inbox.map((n) => n.userId)), isNull(pushDevices.disabledAt)))
        .orderBy(asc(pushDevices.id));
      for (const n of inbox) for (const d of devices) if (d.userId === n.userId) rows.push(delivery(n.id, 'push', d.id));
    }
    if (inbox.length && email) {
      const mailable = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, inbox.map((n) => n.userId)), isNotNull(users.email), eq(users.emailNotifications, true)));
      const ok = new Set(mailable.map((u) => u.id));
      for (const n of inbox) if (ok.has(n.userId)) rows.push(delivery(n.id, 'email', null));
    }
    const created = rows.length
      ? await tx.insert(notificationDeliveries).values(rows).returning({ id: notificationDeliveries.id, channel: notificationDeliveries.channel })
      : [];
    const outcome = await finish('fanned_out');
    const jobs = deliveryJobs(ev.tenantId, created);
    // Lost sends are picked up by notifications.sweep (rows queued for over 5 min).
    this.db.afterCommit(async () => {
      for (const j of jobs) await this.jobs.send(NOTIFICATION_QUEUES.deliver, j);
    });
    return outcome;
  }
}
```

In `apps/api/src/notifications/notifications.module.ts`, add `NotificationFanout` to `providers` (with `import { NotificationFanout } from './notification-fanout';`).

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-fanout src/notifications/queues`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/notifications apps/api/test/notification-fixtures.ts apps/api/test/notification-fanout.test.ts
git commit -m "feat(api): fan notification events out to inbox and delivery rows with attempt counting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Push sender (Expo) and the delivery worker (`notifications.deliver`)

**Files:**
- Modify: `apps/api/package.json` (dependency), `apps/api/src/config/config.ts`, `apps/api/src/config/config.test.ts`, `apps/api/.env.example`, `apps/api/src/notifications/notifications.module.ts`, `apps/api/test/notification-fixtures.ts`
- Create: `apps/api/src/notifications/push-sender.ts`, `apps/api/src/notifications/push-sender.test.ts`, `apps/api/src/notifications/notification-delivery.ts`
- Test: `apps/api/test/notification-delivery.test.ts`

**Interfaces:**
- Consumes: `expo-server-sdk` 7 (`Expo` with `chunkPushNotifications`, `sendPushNotificationsAsync`, `chunkPushNotificationReceiptIds`, `getPushNotificationReceiptsAsync`; tickets `{ status: 'ok', id } | { status: 'error', message, details?: { error? } }`; HTTP failures are plain `Error`s with `statusCode`, after two internal retries on 429); `MAILER` / `Mailer`; `notificationMail` (Task 11); `failureText`, `NOTIFICATION_LIMITS`, `NOTIFICATION_QUEUES`, `DeliverJob` (Tasks 8, 12).
- Produces:
  - Config: `EXPO_ACCESS_TOKEN?: string`, `NOTIFICATIONS_PUSH_ENABLED: boolean` (default `NODE_ENV !== 'test'`, Spec decision 11); `AppConfig` types it as `boolean`.
  - `push-sender.ts`: `PUSH_SENDER` token; `interface PushMessage { to: string; title: string; body: string; data: PushData; sound: 'default'; channelId: 'default'; priority: 'default' | 'high'; badge: number }`; `type PushTicket = { ok: true; id: string } | { ok: false; error: string | null; message: string }`; `type PushReceipt = { ok: true } | { ok: false; error: string | null; message: string }`; `interface PushSender { send(messages: PushMessage[]): Promise<PushTicket[]>; receipts(ids: string[]): Promise<Map<string, PushReceipt>> }` (both throw on HTTP failure); `class ExpoPushSender` (wraps an `ExpoClientLike`, `ExpoPushSender.create(accessToken?)`); `class FakePushSender` (`sent`, `ticketFor`, `receiptFor`, `failWith`, `reset()`); `pushSenderFor(config: AppConfig): PushSender`.
  - `HIGH_PRIORITY_TYPES` = `checklist.overdue`, `problem.critical`, `task.overdue`.
  - `NotificationDelivery.run(job: DeliverJob): Promise<void>` — the body of the `notifications.deliver` worker (`retryLimit: 5`, dead letter `notifications.dead`). Skips non-queued rows; marks `skipped` (inactive user, missing or disabled device, no address or opted out); push: `sent` + `provider_ref` per ok ticket, `failed` per error ticket (`DeviceNotRegistered` also disables the device; `InvalidCredentials`, `MessageTooBig` logged at error level); email: `sent`, or `failed` on a permanent SMTP reply (5xx); an HTTP/SMTP-temporary failure is an attempt for every row of the job: below 5 it throws, the 5th marks the rows `failed`.
  - Fixtures: `pushSender(t): FakePushSender`, `deliverAll(t, tenantId): Promise<void>`.

- [ ] **Step 1: Add the dependency and the config**

```bash
pnpm --filter @taskop/api add expo-server-sdk@^7.2.0
```

Check: `apps/api/package.json` lists `"expo-server-sdk": "^7.2.0"`, and `node -e "require('expo-server-sdk')"` run from `apps/api` prints nothing and exits 0 (Node 24 loads the ESM-only package through `require(esm)`, as it does `@taskop/contracts`).

Append to `apps/api/src/config/config.test.ts`, inside `describe('loadConfig', …)`:

```ts
  it('turns real push on except in tests, and reads the optional Expo token', () => {
    expect(loadConfig(valid).NOTIFICATIONS_PUSH_ENABLED).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: 'production' }).NOTIFICATIONS_PUSH_ENABLED).toBe(true);
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).NOTIFICATIONS_PUSH_ENABLED).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: 'test', NOTIFICATIONS_PUSH_ENABLED: 'true' }).NOTIFICATIONS_PUSH_ENABLED).toBe(true);
    expect(loadConfig({ ...valid, NOTIFICATIONS_PUSH_ENABLED: 'false' }).NOTIFICATIONS_PUSH_ENABLED).toBe(false);
    expect(loadConfig(valid).EXPO_ACCESS_TOKEN).toBeUndefined();
    expect(loadConfig({ ...valid, EXPO_ACCESS_TOKEN: 'expo-token' }).EXPO_ACCESS_TOKEN).toBe('expo-token');
  });
```

Run: `pnpm --filter @taskop/api test -- config`
Expected: FAIL: `NOTIFICATIONS_PUSH_ENABLED` is undefined.

In `apps/api/src/config/config.ts`, add to `configSchema` after `LOG_LEVEL`:

```ts
  /** Optional: enables Expo's enhanced push security when the project requires an access token (SP6 spec §6.2). */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Real Expo pushes. Unset: on, except under NODE_ENV=test, where FakePushSender records them (Spec decision 11). */
  NOTIFICATIONS_PUSH_ENABLED: z.stringbool().optional(),
```

and replace the type and the return of `loadConfig`:

```ts
export type AppConfig = Omit<z.infer<typeof configSchema>, 'NOTIFICATIONS_PUSH_ENABLED'> & { NOTIFICATIONS_PUSH_ENABLED: boolean };
```

```ts
  const c = result.data;
  return {
    ...c,
    JWT_PRIVATE_KEY: c.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'),
    JWT_PUBLIC_KEY: c.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'),
    NOTIFICATIONS_PUSH_ENABLED: c.NOTIFICATIONS_PUSH_ENABLED ?? c.NODE_ENV !== 'test',
  };
```

Append to `apps/api/.env.example` (the token line stays commented: `--env-file` keeps an empty value as `''`, which `min(1)` refuses):

```bash

# Notifications (SP6). Push goes through Expo's push service, so local dev with a development build on a real phone
# sends real pushes. Unset, NOTIFICATIONS_PUSH_ENABLED is true except under NODE_ENV=test (tests and e2e record pushes
# in FakePushSender); set it to false to only record them.
NOTIFICATIONS_PUSH_ENABLED=true
# Only if the Expo project has "enhanced push security" on: a token from expo.dev → Account settings → Access tokens.
# EXPO_ACCESS_TOKEN=
```

Run: `pnpm --filter @taskop/api test -- config`
Expected: PASS.

- [ ] **Step 2: Write the failing push-sender test**

`apps/api/src/notifications/push-sender.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { type ExpoClientLike, ExpoPushSender, FakePushSender, type PushMessage } from './push-sender';

const data = { notificationId: 'n', userId: 'u', tenantId: 't', type: 'task.assigned', targetKind: 'task', targetId: 'x', targetDate: null } as const;
const message = (to: string): PushMessage => ({ to, title: 'Yeni tapşırıq', body: 'Qapı', data, sound: 'default', channelId: 'default', priority: 'default', badge: 2 });

function client(over: Partial<ExpoClientLike> = {}): ExpoClientLike {
  return {
    chunkPushNotifications: (m) => [m],
    sendPushNotificationsAsync: vi.fn(async (m) => m.map((_, i) => ({ status: 'ok' as const, id: `ticket-${i}` }))),
    chunkPushNotificationReceiptIds: (ids) => [ids],
    getPushNotificationReceiptsAsync: vi.fn(async () => ({})),
    ...over,
  };
}

describe('ExpoPushSender', () => {
  it('sends Expo messages with every field and maps tickets in order', async () => {
    const c = client({
      sendPushNotificationsAsync: vi.fn(async () => [
        { status: 'ok' as const, id: 'a' },
        { status: 'error' as const, message: 'gone', details: { error: 'DeviceNotRegistered' as const } },
        { status: 'error' as const, message: 'odd' },
      ]),
    });
    const tickets = await new ExpoPushSender(c).send([message('ExponentPushToken[1]'), message('ExponentPushToken[2]'), message('ExponentPushToken[3]')]);
    expect(c.sendPushNotificationsAsync).toHaveBeenCalledWith([
      { to: 'ExponentPushToken[1]', title: 'Yeni tapşırıq', body: 'Qapı', data, sound: 'default', channelId: 'default', priority: 'default', badge: 2 },
      expect.objectContaining({ to: 'ExponentPushToken[2]' }),
      expect.objectContaining({ to: 'ExponentPushToken[3]' }),
    ]);
    expect(tickets).toEqual([
      { ok: true, id: 'a' },
      { ok: false, error: 'DeviceNotRegistered', message: 'gone' },
      { ok: false, error: null, message: 'odd' },
    ]);
  });

  it('lets an HTTP failure through, and reads receipts by id', async () => {
    const failing = client({ sendPushNotificationsAsync: vi.fn(async () => Promise.reject(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))) });
    await expect(new ExpoPushSender(failing).send([message('ExponentPushToken[1]')])).rejects.toThrow('Too Many Requests');
    const c = client({
      getPushNotificationReceiptsAsync: vi.fn(async () => ({
        a: { status: 'ok' as const },
        b: { status: 'error' as const, message: 'gone', details: { error: 'DeviceNotRegistered' as const } },
      })),
    });
    const receipts = await new ExpoPushSender(c).receipts(['a', 'b', 'c']);
    expect([...receipts.entries()]).toEqual([
      ['a', { ok: true }],
      ['b', { ok: false, error: 'DeviceNotRegistered', message: 'gone' }],
    ]);
    expect(await new ExpoPushSender(c).receipts([])).toEqual(new Map());
  });
});

describe('FakePushSender', () => {
  it('records messages and answers with configurable tickets and receipts', async () => {
    const fake = new FakePushSender();
    const [ticket] = await fake.send([message('ExponentPushToken[1]')]);
    expect(ticket).toMatchObject({ ok: true, id: expect.stringMatching(/^ticket-/) });
    expect(fake.sent.map((m) => m.to)).toEqual(['ExponentPushToken[1]']);
    fake.failWith = new Error('down');
    await expect(fake.send([message('x')])).rejects.toThrow('down');
    fake.reset();
    expect(fake.sent).toEqual([]);
    expect([...(await fake.receipts(['r'])).entries()]).toEqual([['r', { ok: true }]]);
  });
});
```

Run: `pnpm --filter @taskop/api test -- push-sender`
Expected: FAIL: `Cannot find module './push-sender'`.

- [ ] **Step 3: Implement the push sender**

`apps/api/src/notifications/push-sender.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { PushData } from '@taskop/contracts';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import type { AppConfig } from '../config/config';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** One Expo message per delivery (spec §6.1 step 5). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: 'default';
  /** The Android channel the phone creates at startup (Part 2). */
  channelId: 'default';
  priority: 'default' | 'high';
  badge: number;
}

export type PushTicket = { ok: true; id: string } | { ok: false; error: string | null; message: string };
export type PushReceipt = { ok: true } | { ok: false; error: string | null; message: string };

export interface PushSender {
  /** One ticket per message, in order. Throws when the request itself fails (HTTP, 429 after the SDK's retries). */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** Receipts by ticket id; ids Expo does not know (yet) are missing from the map. */
  receipts(ids: string[]): Promise<Map<string, PushReceipt>>;
}

/** The part of the SDK's Expo client this module uses, so tests can stand in for it. */
export interface ExpoClientLike {
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  chunkPushNotificationReceiptIds(ids: string[]): string[][];
  getPushNotificationReceiptsAsync(ids: string[]): Promise<{ [id: string]: ExpoPushReceipt }>;
}

const toTicket = (t: ExpoPushTicket): PushTicket => (t.status === 'ok' ? { ok: true, id: t.id } : { ok: false, error: t.details?.error ?? null, message: t.message });
const toReceipt = (r: ExpoPushReceipt): PushReceipt => (r.status === 'ok' ? { ok: true } : { ok: false, error: r.details?.error ?? null, message: r.message });

/** Expo Push Service (spec §6.2). APNs and FCM credentials live in the Expo project, not here. */
export class ExpoPushSender implements PushSender {
  constructor(private readonly client: ExpoClientLike) {}

  static create(accessToken?: string): ExpoPushSender {
    return new ExpoPushSender(new Expo(accessToken ? { accessToken } : {}));
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (const chunk of this.client.chunkPushNotifications(messages.map((m) => ({ ...m })))) {
      tickets.push(...(await this.client.sendPushNotificationsAsync(chunk)).map(toTicket));
    }
    return tickets;
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    const out = new Map<string, PushReceipt>();
    if (!ids.length) return out;
    for (const chunk of this.client.chunkPushNotificationReceiptIds(ids)) {
      const page = await this.client.getPushNotificationReceiptsAsync(chunk);
      for (const id of chunk) if (page[id]) out.set(id, toReceipt(page[id]));
    }
    return out;
  }
}

/** Records pushes instead of sending them: tests, and NOTIFICATIONS_PUSH_ENABLED=false. */
export class FakePushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  failWith: Error | null = null;
  ticketFor: (m: PushMessage) => PushTicket = () => ({ ok: true, id: `ticket-${randomUUID()}` });
  receiptFor: (id: string) => PushReceipt | undefined = () => ({ ok: true });

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return messages.map((m) => this.ticketFor(m));
  }

  async receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    const out = new Map<string, PushReceipt>();
    for (const id of ids) {
      const r = this.receiptFor(id);
      if (r) out.set(id, r);
    }
    return out;
  }

  reset(): void {
    this.sent.length = 0;
    this.failWith = null;
    this.ticketFor = () => ({ ok: true, id: `ticket-${randomUUID()}` });
    this.receiptFor = () => ({ ok: true });
  }
}

export function pushSenderFor(config: AppConfig): PushSender {
  return config.NOTIFICATIONS_PUSH_ENABLED ? ExpoPushSender.create(config.EXPO_ACCESS_TOKEN) : new FakePushSender();
}
```

If `tsc` reports that `PushMessage.data` is not assignable to `ExpoPushMessage['data']` (`Record<string, unknown>`), spread it: `messages.map((m) => ({ ...m, data: { ...m.data } }))`.

Run: `pnpm --filter @taskop/api test -- push-sender && pnpm --filter @taskop/api typecheck`
Expected: PASS.

- [ ] **Step 4: Write the failing delivery test**

Append to `apps/api/test/notification-fixtures.ts` (add `import { NotificationDelivery } from '../src/notifications/notification-delivery';` and `import { FakePushSender, PUSH_SENDER } from '../src/notifications/push-sender';`):

```ts
/** The app's push sender; FakePushSender whenever NODE_ENV=test. */
export const pushSender = (t: TestApp) => t.app.get<FakePushSender>(PUSH_SENDER);

/** Runs the delivery worker for every queued delivery of the tenant: push rows in one job, each email in its own. */
export async function deliverAll(t: TestApp, tenantId: string): Promise<void> {
  const r = await ownerQuery<{ id: string; channel: string }>("select id, channel from notification_deliveries where tenant_id = $1 and status = 'queued' order by id", [tenantId]);
  const push = r.rows.filter((d) => d.channel === 'push').map((d) => d.id);
  const delivery = t.app.get(NotificationDelivery);
  if (push.length) await delivery.run({ tenantId, deliveryIds: push });
  for (const d of r.rows.filter((x) => x.channel === 'email')) await delivery.run({ tenantId, deliveryIds: [d.id] });
}
```

`apps/api/test/notification-delivery.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationDelivery } from '../src/notifications/notification-delivery';
import { TaskJobs } from '../src/tasks/task-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addDevice, deliverAll, deliveriesOf, fanOutAll, inboxOf, pushSender, staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { createTask, newTaskBody, taskWorld } from './task-fixtures';

const T = (hhmm: string) => `2026-11-02T${hhmm}:00.000Z`;
const emailRule = { enabled: true, push: true, email: true, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null };

describe('notification delivery', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    pushSender(t).reset();
    t.mailer.sent.length = 0;
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** A task for İşçi 1, fanned out; İşçi 1 has `devices` phones. */
  async function assigned(devices = 1, body: Record<string, unknown> = {}) {
    const w = await taskWorld(t);
    const phones = [];
    for (let i = 0; i < devices; i++) phones.push(await addDevice(w.s.tenantId, w.workers[0].id));
    const task = await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }, body));
    await fanOutAll(t, w.s.tenantId);
    return { w, task, phones };
  }

  it('pushes every field to each device, with the unread count as the badge, and stores the tickets', async () => {
    const { w, task, phones } = await assigned(2);
    clock.set('2026-11-02T04:00:10Z');
    await deliverAll(t, w.s.tenantId);
    const [n] = await inboxOf(w.workers[0].id);
    expect(pushSender(t).sent).toEqual(
      phones.map((p) => ({
        to: p.token,
        title: 'Yeni tapşırıq',
        body: 'Soyuducunun qapısını təmir edin',
        sound: 'default',
        channelId: 'default',
        priority: 'default',
        badge: 1,
        data: { notificationId: n!.id, userId: w.workers[0].id, tenantId: w.s.tenantId, type: 'task.assigned', targetKind: 'task', targetId: task.id, targetDate: null },
      })),
    );
    for (const d of await deliveriesOf(w.workers[0].id)) {
      expect(d).toMatchObject({ status: 'sent', attempts: 1, last_error: null, provider_ref: expect.stringMatching(/^ticket-/), sent_at: new Date('2026-11-02T04:00:10Z') });
    }
  });

  it('sends overdue tasks with high priority', async () => {
    const { w } = await assigned(1, { dueAt: T('05:00') });
    await deliverAll(t, w.s.tenantId);
    pushSender(t).reset();
    clock.set(T('05:00'));
    await t.app.get(TaskJobs).sweepAll([w.s.tenantId]);
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    expect(pushSender(t).sent.map((m) => [m.title, m.priority, m.badge])).toEqual([['Tapşırıq gecikir', 'high', 2]]);
  });

  it('fails a row on an error ticket and disables the device only for DeviceNotRegistered', async () => {
    const { w, phones } = await assigned(2);
    const [gone, big] = phones;
    pushSender(t).ticketFor = (m) =>
      m.to === gone!.token ? { ok: false, error: 'DeviceNotRegistered', message: 'not registered' } : { ok: false, error: 'MessageTooBig', message: 'too big' };
    await deliverAll(t, w.s.tenantId);
    const rows = await deliveriesOf(w.workers[0].id);
    expect(rows.map((d) => [d.device_id, d.status, d.attempts, d.last_error])).toEqual([
      [gone!.id, 'failed', 1, 'DeviceNotRegistered: not registered'],
      [big!.id, 'failed', 1, 'MessageTooBig: too big'],
    ]);
    const disabled = await ownerQuery<{ id: string }>('select id from push_devices where user_id = $1 and disabled_at is not null', [w.workers[0].id]);
    expect(disabled.rows.map((r) => r.id)).toEqual([gone!.id]);
  });

  it('retries a failed Expo request four times and fails the rows on the fifth', async () => {
    const { w } = await assigned(1);
    pushSender(t).failWith = new Error('Expo is down');
    const [d] = await deliveriesOf(w.workers[0].id);
    const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
    for (let i = 1; i <= 4; i++) {
      await expect(t.app.get(NotificationDelivery).run(job)).rejects.toThrow('Expo is down');
      expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'queued', attempts: i, last_error: 'Expo is down' });
    }
    await t.app.get(NotificationDelivery).run(job);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'failed', attempts: 5, last_error: 'Expo is down' });
  });

  it('skips rows of a deactivated user or a disabled device', async () => {
    const { w, phones } = await assigned(1);
    const other = await assigned(1);
    await ownerQuery('update push_devices set disabled_at = now() where id = $1', [phones[0]!.id]);
    await ownerQuery("update users set status = 'deactivated' where id = $1", [other.w.workers[0].id]);
    await deliverAll(t, w.s.tenantId);
    await deliverAll(t, other.w.s.tenantId);
    expect((await deliveriesOf(w.workers[0].id)).map((d) => [d.status, d.attempts])).toEqual([['skipped', 0]]);
    expect((await deliveriesOf(other.w.workers[0].id)).map((d) => [d.status, d.attempts])).toEqual([['skipped', 0]]);
    expect(pushSender(t).sent).toEqual([]);
  });

  it('ignores deliveries that are no longer queued', async () => {
    const { w } = await assigned(1);
    const [d] = await deliveriesOf(w.workers[0].id);
    const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
    await t.app.get(NotificationDelivery).run(job);
    // The sweep re-sent the job while the first run finished, or pg-boss retried a job whose work had committed.
    await t.app.get(NotificationDelivery).run(job);
    expect(pushSender(t).sent).toHaveLength(1);
    expect((await deliveriesOf(w.workers[0].id))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  describe('email', () => {
    async function mailed() {
      const w = await taskWorld(t);
      expect((await w.owner.put('/api/v1/notification-rules/task.assigned', emailRule)).status).toBe(200);
      const manager = await staffAt(t, w.s.tenantId, w.owner, 'manager', [w.siteId], 'Menecer 2');
      const task = await createTask(w.owner, newTaskBody({ userId: manager.id }));
      await fanOutAll(t, w.s.tenantId);
      return { w, manager, task };
    }

    it('mails the title and body with a link to the task', async () => {
      const { w, manager, task } = await mailed();
      await deliverAll(t, w.s.tenantId);
      expect(t.mailer.lastTo(manager.email)).toEqual({
        to: manager.email,
        subject: 'Yeni tapşırıq',
        text: `Soyuducunun qapısını təmir edin\n\nAçmaq üçün: http://localhost:5173/tasks?task=${task.id}\n\nBu e-poçtları profil ayarlarında söndürə bilərsiniz.`,
      });
      expect((await deliveriesOf(manager.id)).map((d) => [d.channel, d.status, d.attempts])).toEqual([['email', 'sent', 1]]);
    });

    it('fails on a permanent SMTP reply, retries a temporary one, and skips a user who opted out since', async () => {
      const { w, manager } = await mailed();
      const [d] = await deliveriesOf(manager.id);
      const job = { tenantId: w.s.tenantId, deliveryIds: [d!.id] };
      const send = vi.spyOn(t.mailer, 'send').mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }));
      await expect(t.app.get(NotificationDelivery).run(job)).rejects.toThrow('connection reset');
      expect((await deliveriesOf(manager.id))[0]).toMatchObject({ status: 'queued', attempts: 1 });
      send.mockRejectedValueOnce(Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 }));
      await t.app.get(NotificationDelivery).run(job);
      expect((await deliveriesOf(manager.id))[0]).toMatchObject({ status: 'failed', attempts: 2, last_error: '550 mailbox unavailable' });

      const second = await mailed();
      await ownerQuery('update users set email_notifications = false where id = $1', [second.manager.id]);
      await deliverAll(t, second.w.s.tenantId);
      expect((await deliveriesOf(second.manager.id)).map((x) => x.status)).toEqual(['skipped']);
      expect(t.mailer.lastTo(second.manager.email)).toBeUndefined();
    });
  });
});
```

Notes for this test: `taskWorld`'s manager is linked to Filial 1; the second manager made by `mailed()` is created by the owner, who has the `all` scope, so the owner can assign them a task. `T('05:00')` with `assigned(1, { dueAt })` makes the sweep flag the task at 05:00; the badge is 2 because the first notification is still unread.

Run: `pnpm --filter @taskop/api test -- notification-delivery`
Expected: FAIL: `Cannot find module '../src/notifications/notification-delivery'`.

- [ ] **Step 5: Implement the delivery worker**

`apps/api/src/notifications/notification-delivery.ts`:

```ts
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { NotificationTargetKind, NotificationType, PushData } from '@taskop/contracts';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notifications, pushDevices, users } from '../db/schema';
import { MAILER, type Mailer } from '../mail/mailer';
import { JobsService } from '../scheduling/jobs.service';
import { notificationMail } from './notification-templates';
import { PUSH_SENDER, type PushMessage, type PushSender } from './push-sender';
import { type DeliverJob, failureText, NOTIFICATION_LIMITS, NOTIFICATION_QUEUES } from './queues';

/** Spec §6.1 step 5: these push with high priority. */
export const HIGH_PRIORITY_TYPES: ReadonlySet<NotificationType> = new Set(['checklist.overdue', 'problem.critical', 'task.overdue']);

/** Errors worth an operator's attention; every ticket error fails the row without retry (Spec decision 9). */
const LOUD_TICKET_ERRORS = new Set(['InvalidCredentials', 'MessageTooBig']);

interface Loaded {
  id: string;
  channel: 'push' | 'email';
  deviceId: string | null;
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  targetKind: NotificationTargetKind;
  targetId: string | null;
  targetDate: string | null;
  userActive: boolean;
  email: string | null;
  emailNotifications: boolean;
  expoToken: string | null;
  deviceDisabled: boolean;
}

interface PushItem extends Loaded {
  expoToken: string;
  badge: number;
}

interface EmailItem extends Loaded {
  email: string;
}

/** A 5xx SMTP reply is permanent (spec §6.6); connection errors and 4xx are worth a retry. */
const permanentSmtp = (e: unknown): boolean => {
  const code = (e as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
};

@Injectable()
export class NotificationDelivery implements OnModuleInit {
  private readonly logger = new Logger('NotificationDelivery');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.jobs.defineWorker<DeliverJob>(NOTIFICATION_QUEUES.deliver, (job) => this.run(job), {
      retryLimit: NOTIFICATION_LIMITS.maxAttempts,
      deadLetter: NOTIFICATION_QUEUES.dead,
    });
  }

  /** No transaction is held open across the Expo or SMTP call. */
  async run(job: DeliverJob): Promise<void> {
    const { push, email } = await this.db.withTenant(job.tenantId, null, () => this.load(job.deliveryIds));
    if (push.length) await this.sendPush(job.tenantId, push);
    for (const item of email) await this.sendEmail(job.tenantId, item);
  }

  /** Queued rows only; the ones that can no longer go out are marked skipped here. */
  private async load(ids: string[]): Promise<{ push: PushItem[]; email: EmailItem[] }> {
    const tx = this.db.tx();
    const rows: Loaded[] = (
      await tx
        .select({
          id: notificationDeliveries.id,
          channel: notificationDeliveries.channel,
          deviceId: notificationDeliveries.deviceId,
          notificationId: notifications.id,
          userId: notifications.userId,
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          targetKind: notifications.targetKind,
          targetId: notifications.targetId,
          targetDate: notifications.targetDate,
          userStatus: users.status,
          email: users.email,
          emailNotifications: users.emailNotifications,
          expoToken: pushDevices.expoToken,
          disabledAt: pushDevices.disabledAt,
        })
        .from(notificationDeliveries)
        .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
        .innerJoin(users, eq(users.id, notifications.userId))
        .leftJoin(pushDevices, eq(pushDevices.id, notificationDeliveries.deviceId))
        .where(and(inArray(notificationDeliveries.id, ids), eq(notificationDeliveries.status, 'queued')))
        .orderBy(notificationDeliveries.id)
    ).map((r) => ({
      ...r,
      type: r.type as NotificationType,
      userActive: r.userStatus === 'active',
      deviceDisabled: r.disabledAt !== null,
    }));
    const skip = (r: Loaded) =>
      !r.userActive || (r.channel === 'push' ? !r.expoToken || r.deviceDisabled : !r.email || !r.emailNotifications);
    const skipped = rows.filter(skip).map((r) => r.id);
    if (skipped.length) {
      await tx.update(notificationDeliveries).set({ status: 'skipped', updatedAt: this.clock.now() }).where(inArray(notificationDeliveries.id, skipped));
    }
    const live = rows.filter((r) => !skip(r));
    const pushRows = live.filter((r) => r.channel === 'push');
    const badges = new Map<string, number>();
    if (pushRows.length) {
      const counts = await tx
        .select({ userId: notifications.userId, n: count() })
        .from(notifications)
        .where(and(inArray(notifications.userId, [...new Set(pushRows.map((r) => r.userId))]), isNull(notifications.readAt)))
        .groupBy(notifications.userId);
      for (const c of counts) badges.set(c.userId, c.n);
    }
    return {
      push: pushRows.map((r) => ({ ...r, expoToken: r.expoToken!, badge: badges.get(r.userId) ?? 0 })),
      email: live.filter((r): r is EmailItem => r.channel === 'email'),
    };
  }

  private async sendPush(tenantId: string, items: PushItem[]): Promise<void> {
    const messages: PushMessage[] = items.map((i) => {
      const data: PushData = { notificationId: i.notificationId, userId: i.userId, tenantId, type: i.type, targetKind: i.targetKind, targetId: i.targetId, targetDate: i.targetDate };
      return { to: i.expoToken, title: i.title, body: i.body, data, sound: 'default', channelId: 'default', priority: HIGH_PRIORITY_TYPES.has(i.type) ? 'high' : 'default', badge: i.badge };
    });
    let tickets;
    try {
      tickets = await this.push.send(messages);
    } catch (e) {
      await this.failedAttempt(tenantId, items.map((i) => i.id), e);
      return;
    }
    await this.db.withTenant(tenantId, null, async (tx) => {
      const now = this.clock.now();
      for (const [index, item] of items.entries()) {
        const ticket = tickets[index];
        if (ticket?.ok) {
          await tx
            .update(notificationDeliveries)
            .set({ status: 'sent', providerRef: ticket.id, sentAt: now, attempts: sql`${notificationDeliveries.attempts} + 1`, lastError: null, updatedAt: now })
            .where(eq(notificationDeliveries.id, item.id));
          continue;
        }
        const error = ticket ? `${ticket.error ?? 'Error'}: ${ticket.message}` : 'Error: no ticket';
        await tx
          .update(notificationDeliveries)
          .set({ status: 'failed', attempts: sql`${notificationDeliveries.attempts} + 1`, lastError: error, updatedAt: now })
          .where(eq(notificationDeliveries.id, item.id));
        if (ticket?.error === 'DeviceNotRegistered' && item.deviceId) {
          await tx.update(pushDevices).set({ disabledAt: now }).where(eq(pushDevices.id, item.deviceId));
        }
        if (ticket?.error && LOUD_TICKET_ERRORS.has(ticket.error)) this.logger.error(`Expo refused delivery ${item.id}: ${error}`);
      }
    });
  }

  private async sendEmail(tenantId: string, item: EmailItem): Promise<void> {
    try {
      await this.mailer.send(notificationMail({ to: item.email, webUrl: this.config.WEB_URL, notification: item }));
    } catch (e) {
      if (!permanentSmtp(e)) {
        await this.failedAttempt(tenantId, [item.id], e);
        return;
      }
      await this.db.withTenant(tenantId, null, (tx) =>
        tx
          .update(notificationDeliveries)
          .set({ status: 'failed', attempts: sql`${notificationDeliveries.attempts} + 1`, lastError: failureText(e), updatedAt: this.clock.now() })
          .where(eq(notificationDeliveries.id, item.id)),
      );
      return;
    }
    await this.db.withTenant(tenantId, null, (tx) => {
      const now = this.clock.now();
      return tx
        .update(notificationDeliveries)
        .set({ status: 'sent', sentAt: now, attempts: sql`${notificationDeliveries.attempts} + 1`, lastError: null, updatedAt: now })
        .where(eq(notificationDeliveries.id, item.id));
    });
  }

  /** One attempt for every row of a failed request: the 5th marks them failed; below that the job throws for a retry. */
  private async failedAttempt(tenantId: string, ids: string[], e: unknown): Promise<void> {
    const error = failureText(e);
    const rows = await this.db.withTenant(tenantId, null, (tx) =>
      tx
        .update(notificationDeliveries)
        .set({
          attempts: sql`${notificationDeliveries.attempts} + 1`,
          lastError: error,
          status: sql`case when ${notificationDeliveries.attempts} + 1 >= ${NOTIFICATION_LIMITS.maxAttempts} then 'failed' else ${notificationDeliveries.status} end`,
          updatedAt: this.clock.now(),
        })
        .where(and(inArray(notificationDeliveries.id, ids), eq(notificationDeliveries.status, 'queued')))
        .returning({ status: notificationDeliveries.status }),
    );
    if (rows.some((r) => r.status === 'queued')) throw e;
    this.logger.error(`Delivery of ${ids.length} notification(s) failed ${NOTIFICATION_LIMITS.maxAttempts} times: ${error}`);
  }
}
```

The `case … end` result is a `notification_delivery_status`: Postgres resolves the text literal `'failed'` to the column type because the other branch is the column itself. If it reports `column "status" is of type notification_delivery_status but expression is of type text`, write `'failed'::notification_delivery_status`.

In `apps/api/src/notifications/notifications.module.ts`, add `NotificationDelivery` and the push sender to `providers` (with `import { APP_CONFIG, type AppConfig } from '../config/config';`, `import { NotificationDelivery } from './notification-delivery';`, `import { PUSH_SENDER, pushSenderFor } from './push-sender';`):

```ts
  providers: [
    NotificationEvents,
    NotificationListeners,
    NotificationRules,
    ScopeSubjects,
    NotificationTargets,
    NotificationRecipients,
    NotificationFanout,
    NotificationDelivery,
    { provide: PUSH_SENDER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => pushSenderFor(config) },
  ],
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-delivery push-sender config notification-fanout`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/.env.example apps/api/src/config apps/api/src/notifications apps/api/test/notification-fixtures.ts apps/api/test/notification-delivery.test.ts
git commit -m "feat(api): deliver notifications by Expo push and email with per-row attempts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Receipts, sweep and cleanup crons

**Files:**
- Create: `apps/api/src/notifications/notification-jobs.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`
- Test: `apps/api/test/notification-jobs.test.ts`

**Interfaces:**
- Consumes: `JobsService.define` / `send`; `tenantsWith`, `perTenant`; `PUSH_SENDER` (Task 13); `deliveryJobs`, `NOTIFICATION_LIMITS`, `NOTIFICATION_QUEUES`, `FanoutJob` (Tasks 8, 12).
- Produces `NotificationJobs` (all through `JobsService.define`: stately, per tenant, cron in UTC):
  - `receiptsAll(only?: string[]): Promise<number>` — `notifications.receipts`, `*/15 * * * *`: `sent` push rows sent 15 min–24 h ago with a ticket id; `ok` → `delivered`; `DeviceNotRegistered` → device disabled and `failed`; other errors → `failed` with `"<error>: <message>"`; ids without a receipt stay `sent`.
  - `sweepAll(only?: string[]): Promise<number>` — `notifications.sweep`, `*/5 * * * *`: re-sends `notifications.fanout` for events unprocessed for ≥ 2 min with `attempts < 5`, and `notifications.deliver` (batched like fan-out) for deliveries queued for ≥ 5 min with `attempts < 5`. Returns the number of jobs sent.
  - `cleanupAll(only?: string[]): Promise<number>` — `notifications.cleanup`, `15 4 * * *`: deletes notifications older than 90 days (deliveries cascade) and processed events older than 90 days; disables devices not seen for 180 days.
  - `NOTIFICATION_CRONS = { scan: '* * * * *', receipts: '*/15 * * * *', sweep: '*/5 * * * *', cleanup: '15 4 * * *' }` in `notification-jobs.ts`; Task 15 adds `scanAll` to the same class.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-jobs.test.ts`:

```ts
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationFanout } from '../src/notifications/notification-fanout';
import { NotificationJobs } from '../src/notifications/notification-jobs';
import { JobsService } from '../src/scheduling/jobs.service';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { addDevice, deliverAll, deliveriesOf, eventRows, fanOutAll, inboxOf, pushSender } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { createTask, newTaskBody, taskWorld } from './task-fixtures';

describe('notification crons', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: NotificationJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(NotificationJobs);
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    pushSender(t).reset();
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** İşçi 1 with two phones gets a task; both pushes are sent at 04:00. */
  async function sentPushes() {
    const w = await taskWorld(t);
    const phones = [await addDevice(w.s.tenantId, w.workers[0].id), await addDevice(w.s.tenantId, w.workers[0].id)];
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    return { w, phones };
  }

  it('reads receipts 15 minutes after sending: ok → delivered, DeviceNotRegistered → failed and the device disabled', async () => {
    const { w, phones } = await sentPushes();
    const [first, second] = await deliveriesOf(w.workers[0].id);
    pushSender(t).receiptFor = (id) =>
      id === second!.provider_ref ? { ok: false, error: 'DeviceNotRegistered', message: 'gone' } : { ok: true };
    clock.set('2026-11-02T04:14:59Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(0);
    clock.set('2026-11-02T04:15:00Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(2);
    expect((await deliveriesOf(w.workers[0].id)).map((d) => [d.id, d.status, d.last_error])).toEqual([
      [first!.id, 'delivered', null],
      [second!.id, 'failed', 'DeviceNotRegistered: gone'],
    ]);
    const disabled = await ownerQuery<{ id: string }>('select id from push_devices where user_id = $1 and disabled_at is not null', [w.workers[0].id]);
    expect(disabled.rows.map((r) => r.id)).toEqual([phones[1]!.id]);
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(0);
  });

  it('fails a row on any other receipt error, leaves rows without a receipt sent, and stops asking after 24 hours', async () => {
    const { w } = await sentPushes();
    const [first] = await deliveriesOf(w.workers[0].id);
    pushSender(t).receiptFor = (id) => (id === first!.provider_ref ? { ok: false, error: 'MessageRateExceeded', message: 'slow down' } : undefined);
    clock.set('2026-11-02T05:00:00Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(1);
    expect((await deliveriesOf(w.workers[0].id)).map((d) => [d.status, d.last_error])).toEqual([
      ['failed', 'MessageRateExceeded: slow down'],
      ['sent', null],
    ]);
    const asked: string[][] = [];
    const receipts = vi.spyOn(pushSender(t), 'receipts').mockImplementation(async (ids) => (asked.push(ids), new Map()));
    clock.set('2026-11-03T04:00:01Z');
    expect(await jobs.receiptsAll([w.s.tenantId])).toBe(0);
    expect(asked).toEqual([]);
    receipts.mockRestore();
    expect((await deliveriesOf(w.workers[0].id)).map((d) => d.status)).toEqual(['failed', 'sent']);
  });

  it('re-sends fan-out for events stuck for 2 minutes and delivery for rows queued for 5, below 5 attempts', async () => {
    const w = await taskWorld(t);
    await addDevice(w.s.tenantId, w.workers[0].id);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[1].id }));
    const [stuck, tired] = await eventRows(w.s.tenantId);
    await ownerQuery('update notification_events set attempts = 5 where id = $1', [tired!.id]);
    const send = vi.spyOn(t.app.get(JobsService), 'send').mockResolvedValue(true);
    clock.set('2026-11-02T04:01:59Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    clock.set('2026-11-02T04:02:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(send).toHaveBeenCalledWith('notifications.fanout', { tenantId: w.s.tenantId, eventId: stuck!.id });
    send.mockClear();
    clock.set(MONDAY_0800);
    // With send mocked, the fan-out's own after-commit deliver job is swallowed: the row stays queued.
    await t.app.get(NotificationFanout).run({ tenantId: w.s.tenantId, eventId: stuck!.id });
    const [queued] = await deliveriesOf(w.workers[0].id);
    clock.set('2026-11-02T04:04:59Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    clock.set('2026-11-02T04:05:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(send).toHaveBeenCalledWith('notifications.deliver', { tenantId: w.s.tenantId, deliveryIds: [queued!.id] });
    await ownerQuery('update notification_deliveries set attempts = 5 where id = $1', [queued!.id]);
    send.mockClear();
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('deletes notifications and processed events after 90 days and disables devices idle for 180', async () => {
    const w = await taskWorld(t);
    const idle = await addDevice(w.s.tenantId, w.workers[0].id);
    const fresh = await addDevice(w.s.tenantId, w.workers[1].id);
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
    await createTask(w.manager.api, newTaskBody({ userId: w.workers[1].id }));
    await fanOutAll(t, w.s.tenantId);
    const [old, recent] = await eventRows(w.s.tenantId);
    const unprocessed = uuidv7();
    await ownerQuery(
      "insert into notification_events (id, tenant_id, type, payload, created_at) values ($1, $2, 'task.overdue', '{}'::jsonb, '2026-01-01T00:00:00Z')",
      [unprocessed, w.s.tenantId],
    );
    await ownerQuery("update notification_events set created_at = '2026-08-03T03:59:59Z' where id = $1", [old!.id]);
    await ownerQuery("update notifications set created_at = '2026-08-03T03:59:59Z' where event_id = $1", [old!.id]);
    await ownerQuery("update push_devices set last_seen_at = '2026-05-06T03:59:59Z' where id = $1", [idle.id]);
    // now − 90 days = 2026-08-04T04:00Z; now − 180 days = 2026-05-06T04:00Z.
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(3);
    expect(await inboxOf(w.workers[0].id)).toEqual([]);
    expect(await deliveriesOf(w.workers[0].id)).toEqual([]);
    expect((await inboxOf(w.workers[1].id)).map((n) => n.event_id)).toEqual([recent!.id]);
    expect((await eventRows(w.s.tenantId)).map((e) => e.id).sort()).toEqual([recent!.id, unprocessed].sort());
    const devices = await ownerQuery<{ id: string; disabled: boolean }>('select id, disabled_at is not null as disabled from push_devices where id = any($1) order by id', [[idle.id, fresh.id]]);
    expect(devices.rows).toEqual([{ id: idle.id, disabled: true }, { id: fresh.id, disabled: false }]);
  });
});
```

In the sweep test the delivery row is created at 04:00 (the clock at fan-out), so it is picked up at 04:05 and not at 04:04:59.

The `2026-11-02T04:00:00Z` clock makes "90 days ago" `2026-08-04T04:00:00Z` and "180 days ago" `2026-05-06T04:00:00Z`; the test sets rows one second older than those. `cleanupAll` returns deleted notifications (1) + deleted events (1) + disabled devices (1) = 3; the unprocessed event from January stays (only processed events are deleted).

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-jobs`
Expected: FAIL: `Cannot find module '../src/notifications/notification-jobs'`.

- [ ] **Step 3: Implement**

`apps/api/src/notifications/notification-jobs.ts`:

```ts
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { perTenant, tenantsWith } from '../common/per-tenant';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notificationEvents, notifications, pushDevices } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { PUSH_SENDER, type PushSender } from './push-sender';
import { deliveryJobs, type FanoutJob, NOTIFICATION_LIMITS, NOTIFICATION_QUEUES } from './queues';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Spec §6.3 cron schedules (UTC). */
export const NOTIFICATION_CRONS = {
  scan: '* * * * *',
  receipts: '*/15 * * * *',
  sweep: '*/5 * * * *',
  cleanup: '15 4 * * *',
} as const;

/** The notification crons. One RLS transaction per tenant (perTenant). */
@Injectable()
export class NotificationJobs implements OnModuleInit {
  private readonly logger = new Logger('NotificationJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  onModuleInit(): void {
    this.jobs.define({ name: NOTIFICATION_QUEUES.receipts, cron: NOTIFICATION_CRONS.receipts, handler: (ids) => this.receiptsAll(ids) });
    this.jobs.define({ name: NOTIFICATION_QUEUES.sweep, cron: NOTIFICATION_CRONS.sweep, handler: (ids) => this.sweepAll(ids) });
    this.jobs.define({ name: NOTIFICATION_QUEUES.cleanup, cron: NOTIFICATION_CRONS.cleanup, handler: (ids) => this.cleanupAll(ids) });
  }

  /** notifications.receipts: Expo receipts for pushes sent 15 min–24 h ago (Spec decision 10). */
  async receiptsAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const latest = new Date(+now - NOTIFICATION_LIMITS.receiptDelayMinutes * MINUTE);
    const earliest = new Date(+now - NOTIFICATION_LIMITS.receiptMaxAgeHours * HOUR);
    const tenantIds = await tenantsWith(
      this.db,
      sql`select distinct tenant_id from notification_deliveries
          where channel = 'push' and status = 'sent' and sent_at <= ${latest} and sent_at > ${earliest} and provider_ref is not null`,
      only,
    );
    return perTenant(this.db, this.logger, 'Notification receipts', tenantIds, async () => {
      const tx = this.db.tx();
      const rows = await tx
        .select({ id: notificationDeliveries.id, ref: notificationDeliveries.providerRef, deviceId: notificationDeliveries.deviceId })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.channel, 'push'),
            eq(notificationDeliveries.status, 'sent'),
            lte(notificationDeliveries.sentAt, latest),
            gt(notificationDeliveries.sentAt, earliest),
            isNotNull(notificationDeliveries.providerRef),
          ),
        );
      if (!rows.length) return 0;
      const receipts = await this.push.receipts(rows.map((r) => r.ref!));
      let settled = 0;
      for (const row of rows) {
        const receipt = receipts.get(row.ref!);
        if (!receipt) continue;
        settled++;
        if (receipt.ok) {
          await tx.update(notificationDeliveries).set({ status: 'delivered', updatedAt: now }).where(eq(notificationDeliveries.id, row.id));
          continue;
        }
        await tx
          .update(notificationDeliveries)
          .set({ status: 'failed', lastError: `${receipt.error ?? 'Error'}: ${receipt.message}`, updatedAt: now })
          .where(eq(notificationDeliveries.id, row.id));
        if (receipt.error === 'DeviceNotRegistered' && row.deviceId) {
          await tx.update(pushDevices).set({ disabledAt: now }).where(eq(pushDevices.id, row.deviceId));
        }
      }
      return settled;
    });
  }

  /** notifications.sweep: re-sends jobs that were lost (a crash between commit and send, a missed after-commit). */
  async sweepAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const staleEvent = new Date(+now - NOTIFICATION_LIMITS.fanoutStaleMinutes * MINUTE);
    const staleDelivery = new Date(+now - NOTIFICATION_LIMITS.deliverStaleMinutes * MINUTE);
    const max = NOTIFICATION_LIMITS.maxAttempts;
    const tenantIds = await tenantsWith(
      this.db,
      sql`select tenant_id from notification_events where processed_at is null and attempts < ${max} and created_at <= ${staleEvent}
          union
          select tenant_id from notification_deliveries where status = 'queued' and attempts < ${max} and created_at <= ${staleDelivery}`,
      only,
    );
    return perTenant(this.db, this.logger, 'Notification sweep', tenantIds, async () => {
      const tx = this.db.tx();
      const { tenantId } = this.db.context();
      const events = await tx
        .select({ id: notificationEvents.id })
        .from(notificationEvents)
        .where(and(isNull(notificationEvents.processedAt), lt(notificationEvents.attempts, max), lte(notificationEvents.createdAt, staleEvent)))
        .orderBy(notificationEvents.createdAt);
      let sent = 0;
      for (const e of events) {
        const job: FanoutJob = { tenantId, eventId: e.id };
        await this.jobs.send(NOTIFICATION_QUEUES.fanout, job);
        sent++;
      }
      const queued = await tx
        .select({ id: notificationDeliveries.id, channel: notificationDeliveries.channel })
        .from(notificationDeliveries)
        .where(and(eq(notificationDeliveries.status, 'queued'), lt(notificationDeliveries.attempts, max), lte(notificationDeliveries.createdAt, staleDelivery)))
        .orderBy(notificationDeliveries.id);
      for (const job of deliveryJobs(tenantId, queued)) {
        await this.jobs.send(NOTIFICATION_QUEUES.deliver, job);
        sent++;
      }
      return sent;
    });
  }

  /** notifications.cleanup: 90-day retention of the inbox and processed events; 180-day idle devices are disabled. */
  async cleanupAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const retention = new Date(+now - NOTIFICATION_LIMITS.retentionDays * DAY);
    const idle = new Date(+now - NOTIFICATION_LIMITS.deviceIdleDays * DAY);
    const tenantIds = await tenantsWith(this.db, sql`select id as tenant_id from tenants`, only);
    return perTenant(this.db, this.logger, 'Notification cleanup', tenantIds, async () => {
      const tx = this.db.tx();
      // Deliveries go with their notification (ON DELETE CASCADE).
      const inbox = await tx.delete(notifications).where(lt(notifications.createdAt, retention)).returning({ id: notifications.id });
      const events = await tx
        .delete(notificationEvents)
        .where(and(isNotNull(notificationEvents.processedAt), lt(notificationEvents.createdAt, retention)))
        .returning({ id: notificationEvents.id });
      const devices = await tx
        .update(pushDevices)
        .set({ disabledAt: now })
        .where(and(isNull(pushDevices.disabledAt), lt(pushDevices.lastSeenAt, idle)))
        .returning({ id: pushDevices.id });
      return inbox.length + events.length + devices.length;
    });
  }
}
```

In `apps/api/src/notifications/notifications.module.ts`, add `NotificationJobs` to `providers` (with `import { NotificationJobs } from './notification-jobs';`).

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-jobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications apps/api/test/notification-jobs.test.ts
git commit -m "feat(api): add the notification receipts, sweep and cleanup crons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The scan cron (`checklist.available`, `checklist.due_soon`)

**Files:**
- Modify: `apps/api/src/notifications/notification-jobs.ts`
- Test: `apps/api/test/notification-scan.test.ts`

**Interfaces:**
- Consumes: `NotificationRules.effective` (Task 9); `NotificationEvents.record` (Task 8); `occurrences`, `notificationEvents`.
- Produces: `NotificationJobs.scanAll(only?: string[]): Promise<number>` — `notifications.scan`, cron `* * * * *`. Per tenant, for **enabled** rules only:
  - `checklist.available` for `pending` occurrences with `now − 15 min ≤ starts_at ≤ now`;
  - `checklist.due_soon` for `pending` occurrences with `due_at − lead ≤ now < due_at` and `due_at − lead > starts_at` (otherwise skipped: the window is shorter than the lead);
  - dedupe keys `checklist.available:<id>` / `checklist.due_soon:<id>`; occurrences that already have that event are not selected again. Returns the number of events recorded. No actor.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-scan.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationJobs } from '../src/notifications/notification-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { eventRows } from './notification-fixtures';
import { createAssignment, fixed, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';

const at = (hhmmss: string) => `2026-11-02T${hhmmss}Z`;
const rule = (over: Record<string, unknown>) => ({ enabled: true, push: true, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null, ...over });

describe('notifications.scan', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: NotificationJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(NotificationJobs);
  });
  beforeEach(() => clock.set('2026-11-02T03:00:00Z'));
  afterAll(() => t.close());

  /** Today's run 08:00–10:00 Baku (04:00Z–06:00Z), created an hour before it opens. */
  async function world(timing = fixed()) {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { timing });
    const today = (await occurrenceRows(a.id))[0]!;
    const scan = async (iso: string) => {
      clock.set(iso);
      return jobs.scanAll([w.s.tenantId]);
    };
    const scanned = async () =>
      (await eventRows(w.s.tenantId)).filter((e) => e.type === 'checklist.available' || e.type === 'checklist.due_soon').map((e) => [e.type, e.dedupe_key, e.actor_user_id, e.payload]);
    return { w, today, scan, scanned };
  }

  it('records checklist.available once when the run opens', async () => {
    const { today, scan, scanned } = await world();
    expect(await scan(at('03:59:59'))).toBe(0);
    expect(await scan(at('04:00:00'))).toBe(1);
    expect(await scan(at('04:01:00'))).toBe(0);
    expect(await scanned()).toEqual([['checklist.available', `checklist.available:${today.id}`, null, { occurrenceId: today.id }]]);
  });

  it('records nothing for runs that opened more than 15 minutes ago', async () => {
    const { scan, scanned } = await world();
    expect(await scan(at('04:15:01'))).toBe(0);
    expect(await scanned()).toEqual([]);
    const late = await world();
    expect(await late.scan(at('04:15:00'))).toBe(1);
  });

  it('records checklist.due_soon once, the lead time before the due time', async () => {
    const { today, scan, scanned } = await world();
    await scan(at('04:00:00'));
    expect(await scan(at('05:29:59'))).toBe(0);
    expect(await scan(at('05:30:00'))).toBe(1);
    expect(await scan(at('05:45:00'))).toBe(0);
    expect((await scanned()).at(-1)).toEqual(['checklist.due_soon', `checklist.due_soon:${today.id}`, null, { occurrenceId: today.id }]);
  });

  it('uses the tenant’s lead time and skips a window shorter than it', async () => {
    const long = await world();
    expect((await long.w.api.put('/api/v1/notification-rules/checklist.due_soon', rule({ leadMinutes: 60 }))).status).toBe(200);
    expect(await long.scan(at('04:59:59'))).toBe(0);
    expect(await long.scan(at('05:00:00'))).toBe(1);
    // Due 20 minutes after opening with a 30-minute lead: only checklist.available is sent.
    const short = await world(fixed('08:00', 20));
    expect(await short.scan(at('04:00:00'))).toBe(1);
    expect(await short.scan(at('04:10:00'))).toBe(0);
    expect((await short.scanned()).map(([type]) => type)).toEqual(['checklist.available']);
  });

  it('records nothing for disabled rules, or once the run is no longer pending', async () => {
    const off = await world();
    expect((await off.w.api.put('/api/v1/notification-rules/checklist.available', rule({ enabled: false }))).status).toBe(200);
    expect((await off.w.api.put('/api/v1/notification-rules/checklist.due_soon', rule({ enabled: false, leadMinutes: 30 }))).status).toBe(200);
    expect(await off.scan(at('04:00:00'))).toBe(0);
    expect(await off.scan(at('05:30:00'))).toBe(0);
    const cancelled = await world();
    const res = await cancelled.w.api.post(`/api/v1/occurrences/${cancelled.today.id}/cancel`, { reason: 'Bu gün bağlıdır' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await cancelled.scan(at('04:00:00'))).toBe(0);
  });
});
```

`fixed(startTime, dueAfterMinutes, graceMinutes)` comes from `scheduling-fixtures.ts`; `fixed('08:00', 20)` is due at 08:20 Baku. `POST /occurrences/:id/cancel` takes `{ reason }` (`cancelOccurrenceInputSchema`).

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-scan`
Expected: FAIL: `jobs.scanAll is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/notifications/notification-jobs.ts`:
- extend the drizzle import with `gte`, add `occurrences` to the schema import, and import `NotificationEvents` and `NotificationRules`:

```ts
import { and, eq, gt, gte, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { notificationDeliveries, notificationEvents, notifications, occurrences, pushDevices } from '../db/schema';
import { NotificationEvents } from './notification-events';
import { NotificationRules } from './rules.service';
```

- add two constructor parameters after `@Inject(PUSH_SENDER) private readonly push: PushSender,`:

```ts
    private readonly rules: NotificationRules,
    private readonly events: NotificationEvents,
```

- register the cron first in `onModuleInit`:

```ts
    this.jobs.define({ name: NOTIFICATION_QUEUES.scan, cron: NOTIFICATION_CRONS.scan, handler: (ids) => this.scanAll(ids) });
```

- add the method:

```ts
  /**
   * notifications.scan (spec §3.4): no status changes when a run opens or nears its due time, so this finds them.
   * Only for enabled rules; dedupe keys make each fire at most once.
   */
  async scanAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const opened = new Date(+now - NOTIFICATION_LIMITS.availableWindowMinutes * MINUTE);
    const tenantIds = await tenantsWith(this.db, sql`select distinct tenant_id from occurrences where status = 'pending' and starts_at <= ${now} and due_at > ${now}`, only);
    return perTenant(this.db, this.logger, 'Notification scan', tenantIds, async () => {
      const tx = this.db.tx();
      const notYet = (type: 'checklist.available' | 'checklist.due_soon') =>
        sql`not exists (select 1 from notification_events e where e.dedupe_key = ${`${type}:`} || ${occurrences.id}::text)`;
      let recorded = 0;
      const available = await this.rules.effective('checklist.available');
      if (available.enabled) {
        const rows = await tx
          .select({ id: occurrences.id })
          .from(occurrences)
          .where(and(eq(occurrences.status, 'pending'), lte(occurrences.startsAt, now), gte(occurrences.startsAt, opened), notYet('checklist.available')))
          .orderBy(occurrences.startsAt, occurrences.id);
        for (const r of rows) {
          await this.events.record('checklist.available', { occurrenceId: r.id }, null, `checklist.available:${r.id}`);
          recorded++;
        }
      }
      const dueSoon = await this.rules.effective('checklist.due_soon');
      if (dueSoon.enabled && dueSoon.leadMinutes) {
        const lead = dueSoon.leadMinutes;
        const rows = await tx
          .select({ id: occurrences.id })
          .from(occurrences)
          .where(
            and(
              eq(occurrences.status, 'pending'),
              gt(occurrences.dueAt, now),
              lte(occurrences.dueAt, new Date(+now + lead * MINUTE)),
              // A window shorter than the lead: the available notice covers it.
              sql`${occurrences.dueAt} - make_interval(mins => ${lead}) > ${occurrences.startsAt}`,
              notYet('checklist.due_soon'),
            ),
          )
          .orderBy(occurrences.dueAt, occurrences.id);
        for (const r of rows) {
          await this.events.record('checklist.due_soon', { occurrenceId: r.id }, null, `checklist.due_soon:${r.id}`);
          recorded++;
        }
      }
      return recorded;
    });
  }
```

`record` never throws, so one bad row never blocks the rest; a duplicate (a concurrent scan) is a no-op on the dedupe index. The `tenantsWith` query needs no index beyond `occurrences_status_due_idx`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-scan notification-jobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications/notification-jobs.ts apps/api/test/notification-scan.test.ts
git commit -m "feat(api): scan for opened and nearly due checklists every minute" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Inbox, unread count in `/me/sync`, email preference, push devices and deactivation

**Files:**
- Create: `apps/api/src/notifications/inbox.service.ts`, `apps/api/src/notifications/me-notifications.controller.ts`
- Modify: `apps/api/src/notifications/dto.ts`, `apps/api/src/notifications/notification-listeners.ts`, `apps/api/src/notifications/notifications.module.ts`, `apps/api/src/executions/sync.service.ts`, `apps/api/src/executions/executions.module.ts`, `apps/api/src/auth/me.service.ts`
- Test: `apps/api/test/notification-inbox.test.ts`

**Interfaces:**
- Consumes: `notificationListQuerySchema`, `registerPushDeviceSchema`, `updatePreferencesSchema`, `pageOf`, `notificationItemSchema`, `unreadCountSchema`, `preferencesSchema` (Task 1); `notifications`, `pushDevices`, `users.emailNotifications` (Task 5); `db.platform` (the RLS-bypassing pool), `ParseIdPipe`, `CurrentPrincipal`.
- Produces:
  - `InboxService`: `list(p: Principal, q: NotificationListQuery output): Promise<Page<NotificationItem>>` (keyset `(created_at, id)` descending, Spec decision 15); `unreadCount(userId: string): Promise<number>`; `markRead(userId: string, id: string): Promise<void>` (404 for another user's or an unknown id; idempotent); `markAllRead(userId: string): Promise<void>`; `registerDevice(p: Principal, input): Promise<void>` (token claim through `db.platform`, then upsert clearing `disabled_at`); `removeDevice(p: Principal, token: string): Promise<void>`; `updatePreferences(p: Principal, input): Promise<Preferences>`.
  - Routes (any signed-in user): `GET /me/notifications`, `GET /me/notifications/unread-count`, `POST /me/notifications/:id/read` (204), `POST /me/notifications/read-all` (204), `PUT /me/push-devices` (204), `DELETE /me/push-devices/:token` (204), `PATCH /me/preferences` (200, `Preferences`).
  - `GET /me/sync` returns the caller's real `unreadNotifications`; `GET /me` returns `user.emailNotifications` from the column (replacing the Task 2 interim values).
  - `NotificationListeners` disables a user's devices when `user.access_changed` finds them deactivated (spec §6.5).
  - `NotificationsModule` exports `InboxService`; `ExecutionsModule` imports `NotificationsModule`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-inbox.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, signupTenant } from './fixtures';
import { addDevice, deliveriesOf, fanOutAll } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { createTask, newTaskBody, taskWorld } from './task-fixtures';

const token = (n: number) => `ExponentPushToken[shared-${n}-${Math.random().toString(36).slice(2)}]`;

/** `count` inbox rows for one user, each from its own processed event, all at `at` (owner connection). */
async function seedInbox(tenantId: string, userId: string, count: number, at: string, title = 'Mesaj'): Promise<string[]> {
  const r = await ownerQuery<{ id: string }>(
    `with e as (
       insert into notification_events (id, tenant_id, type, payload, created_at, processed_at, outcome)
       select gen_random_uuid(), $1, 'manual', '{}'::jsonb, $3, $3, 'fanned_out' from generate_series(1, $2)
       returning id)
     insert into notifications (id, tenant_id, event_id, user_id, type, title, body, target_kind, created_at)
     select gen_random_uuid(), $1, e.id, $4, 'manual', $5, 'Mətn', 'none', $3 from e
     returning id`,
    [tenantId, count, at, userId, title],
  );
  return r.rows.map((x) => x.id);
}

const devicesOf = async (userId: string) =>
  (await ownerQuery<{ expo_token: string; platform: string; last_seen_at: Date; disabled: boolean }>(
    'select expo_token, platform, last_seen_at, disabled_at is not null as disabled from push_devices where user_id = $1 order by expo_token',
    [userId],
  )).rows;

describe('inbox, preferences and push devices', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('pages by (created_at, id) without repeating or skipping rows of the same instant', async () => {
    const w = await taskWorld(t);
    const me = w.workers[0];
    const same = await seedInbox(w.s.tenantId, me.id, 35, '2026-11-01T10:00:00Z');
    const [newest] = await seedInbox(w.s.tenantId, me.id, 1, '2026-11-02T10:00:00Z', 'Ən yeni');
    await seedInbox(w.s.tenantId, w.workers[1].id, 3, '2026-11-02T11:00:00Z');
    const first = await me.api.get('/api/v1/me/notifications');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(30);
    expect(first.body.items[0]).toEqual({
      id: newest, type: 'manual', title: 'Ən yeni', body: 'Mətn', targetKind: 'none', targetId: null, targetDate: null, createdAt: '2026-11-02T10:00:00.000Z', readAt: null,
    });
    const second = await me.api.get(`/api/v1/me/notifications?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(6);
    expect(second.body.nextCursor).toBeNull();
    const seen = [...first.body.items, ...second.body.items].map((n: { id: string }) => n.id);
    expect(new Set(seen).size).toBe(36);
    expect([...seen].sort()).toEqual([newest!, ...same].sort());
    expect((await me.api.get('/api/v1/me/notifications?limit=101')).status).toBe(400);
  });

  it('counts unread rows, marks one or all read, and only ever touches the caller’s rows', async () => {
    const w = await taskWorld(t);
    const me = w.workers[0];
    const [a, b, c] = await seedInbox(w.s.tenantId, me.id, 3, '2026-11-01T10:00:00Z');
    const [theirs] = await seedInbox(w.s.tenantId, w.workers[1].id, 1, '2026-11-01T10:00:00Z');
    expect((await me.api.get('/api/v1/me/notifications/unread-count')).body).toEqual({ count: 3 });
    expect((await me.api.get('/api/v1/me/sync')).body.unreadNotifications).toBe(3);
    clock.set('2026-11-02T05:00:00Z');
    expect((await me.api.post(`/api/v1/me/notifications/${a}/read`)).status).toBe(204);
    expect((await me.api.post(`/api/v1/me/notifications/${a}/read`)).status).toBe(204);
    expect((await ownerQuery<{ read_at: Date }>('select read_at from notifications where id = $1', [a])).rows[0]!.read_at).toEqual(new Date('2026-11-02T05:00:00Z'));
    expect((await me.api.post(`/api/v1/me/notifications/${theirs}/read`)).status).toBe(404);
    expect((await me.api.post('/api/v1/me/notifications/not-an-id/read')).status).toBe(404);
    expect((await me.api.get('/api/v1/me/notifications?unread=true')).body.items.map((n: { id: string }) => n.id).sort()).toEqual([b, c].sort());
    expect((await me.api.get('/api/v1/me/notifications?unread=false')).body.items).toHaveLength(3);
    expect((await me.api.post('/api/v1/me/notifications/read-all')).status).toBe(204);
    expect((await me.api.get('/api/v1/me/notifications/unread-count')).body).toEqual({ count: 0 });
    expect((await me.api.get('/api/v1/me/sync')).body.unreadNotifications).toBe(0);
    expect((await w.workers[1].api.get('/api/v1/me/notifications/unread-count')).body).toEqual({ count: 1 });
  });

  it('switches email notifications for the caller only, and reports them on GET /me', async () => {
    const w = await taskWorld(t);
    expect((await w.manager.api.get('/api/v1/me')).body.user.emailNotifications).toBe(true);
    const res = await w.manager.api.patch('/api/v1/me/preferences', { emailNotifications: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ emailNotifications: false });
    expect((await w.manager.api.get('/api/v1/me')).body.user.emailNotifications).toBe(false);
    expect((await w.owner.get('/api/v1/me')).body.user.emailNotifications).toBe(true);
    // A worker without an email address can still set it; it has no effect.
    expect((await w.workers[0].api.patch('/api/v1/me/preferences', { emailNotifications: false })).body).toEqual({ emailNotifications: false });
    expect((await w.workers[0].api.patch('/api/v1/me/preferences', {})).status).toBe(400);
  });

  it('registers a device idempotently, re-enables it, and removes it', async () => {
    const w = await taskWorld(t);
    const me = w.workers[0];
    const tok = token(1);
    expect((await me.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    await ownerQuery('update push_devices set disabled_at = now() where expo_token = $1', [tok]);
    clock.set('2026-11-02T06:00:00Z');
    expect((await me.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'ios' })).status).toBe(204);
    expect(await devicesOf(me.id)).toEqual([{ expo_token: tok, platform: 'ios', last_seen_at: new Date('2026-11-02T06:00:00Z'), disabled: false }]);
    expect((await me.api.put('/api/v1/me/push-devices', { expoToken: 'not-a-token', platform: 'ios' })).status).toBe(400);
    expect((await me.api.delete(`/api/v1/me/push-devices/${encodeURIComponent(tok)}`)).status).toBe(204);
    expect(await devicesOf(me.id)).toEqual([]);
    expect((await me.api.delete(`/api/v1/me/push-devices/${encodeURIComponent(tok)}`)).status).toBe(204);
  });

  it('claims a token from another user of the tenant and from another tenant', async () => {
    const w = await taskWorld(t);
    const [first, second] = w.workers;
    const tok = token(2);
    expect((await first.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    // The same phone, now signed in as İşçi 2 (İşçi 1's logout call failed).
    expect((await second.api.put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    expect(await devicesOf(first.id)).toEqual([]);
    expect((await devicesOf(second.id)).map((d) => d.expo_token)).toEqual([tok]);
    // İşçi 1's own deletion no longer touches the phone that İşçi 2 now holds.
    expect((await first.api.delete(`/api/v1/me/push-devices/${encodeURIComponent(tok)}`)).status).toBe(204);
    expect((await devicesOf(second.id)).map((d) => d.expo_token)).toEqual([tok]);
    // Then someone of another organisation signs in on it.
    const other = await signupTenant(t);
    expect((await as(t, other.accessToken).put('/api/v1/me/push-devices', { expoToken: tok, platform: 'android' })).status).toBe(204);
    expect(await devicesOf(second.id)).toEqual([]);
    expect((await devicesOf(other.ownerId)).map((d) => d.expo_token)).toEqual([tok]);
    await createTask(w.manager.api, newTaskBody({ userId: second.id }));
    await fanOutAll(t, w.s.tenantId);
    expect(await deliveriesOf(second.id)).toEqual([]);
  });

  it('disables a deactivated user’s devices', async () => {
    const w = await taskWorld(t);
    const phone = await addDevice(w.s.tenantId, w.workers[0].id);
    const other = await addDevice(w.s.tenantId, w.workers[1].id);
    expect((await w.owner.post(`/api/v1/users/${w.workers[0].id}/deactivate`)).status).toBe(200);
    const rows = await ownerQuery<{ id: string; disabled: boolean }>('select id, disabled_at is not null as disabled from push_devices where id = any($1) order by id', [[phone.id, other.id]]);
    expect(rows.rows).toEqual([{ id: phone.id, disabled: true }, { id: other.id, disabled: false }]);
  });

  it('needs a signed-in user', async () => {
    const s = await signupTenant(t);
    expect((await t.http().get('/api/v1/me/notifications')).status).toBe(401);
    expect((await as(t, s.accessToken).get('/api/v1/me/notifications')).body).toEqual({ items: [], nextCursor: null });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-inbox`
Expected: FAIL: `GET /api/v1/me/notifications` answers 404.

- [ ] **Step 3: DTOs and the service**

Append to `apps/api/src/notifications/dto.ts` (extend the contracts import with `notificationItemSchema`, `notificationListQuerySchema`, `pageOf`, `preferencesSchema`, `registerPushDeviceSchema`, `unreadCountSchema`, `updatePreferencesSchema`):

```ts
export class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}
export class NotificationPageResponse extends createZodDto(pageOf(notificationItemSchema)) {}
export class UnreadCountResponse extends createZodDto(unreadCountSchema) {}
export class RegisterPushDeviceDto extends createZodDto(registerPushDeviceSchema) {}
export class UpdatePreferencesDto extends createZodDto(updatePreferencesSchema) {}
export class PreferencesResponse extends createZodDto(preferencesSchema) {}
```

`apps/api/src/notifications/inbox.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { NotificationItem, NotificationType, Page, Preferences } from '@taskop/contracts';
import { and, count, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { notifications, pushDevices, users } from '../db/schema';
import type { NotificationListQueryDto, RegisterPushDeviceDto, UpdatePreferencesDto } from './dto';

type InboxRow = typeof notifications.$inferSelect;

const toItem = (n: InboxRow): NotificationItem => ({
  id: n.id,
  type: n.type as NotificationType,
  title: n.title,
  body: n.body,
  targetKind: n.targetKind,
  targetId: n.targetId,
  targetDate: n.targetDate,
  createdAt: n.createdAt.toISOString(),
  readAt: n.readAt?.toISOString() ?? null,
});

/** Spec §6.4 "Current user": only ever the caller's own rows. */
@Injectable()
export class InboxService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  /** Newest first, keyset on (created_at, id) so rows of one instant never repeat or vanish between pages. */
  async list(p: Principal, q: NotificationListQueryDto): Promise<Page<NotificationItem>> {
    const conds = [eq(notifications.userId, p.userId)];
    if (q.unread === true) conds.push(isNull(notifications.readAt));
    if (q.cursor) {
      conds.push(sql`(${notifications.createdAt}, ${notifications.id}) < (select c.created_at, c.id from notifications c where c.id = ${q.cursor} and c.user_id = ${p.userId})`);
    }
    const rows = await this.db
      .tx()
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toItem);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async unreadCount(userId: string): Promise<number> {
    const [r] = await this.db
      .tx()
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return r?.n ?? 0;
  }

  /** Idempotent; another user's row is as unknown as a made-up id. */
  async markRead(userId: string, id: string): Promise<void> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
    if (!row) throw new AppError('NOT_FOUND');
    if (!row.readAt) await tx.update(notifications).set({ readAt: this.clock.now() }).where(eq(notifications.id, id));
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .tx()
      .update(notifications)
      .set({ readAt: this.clock.now() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  /**
   * Token claim (spec §6.4): rows with this token that belong to anyone else, in any tenant, are deleted first through
   * the platform pool (RLS would hide other tenants), then the caller's row is upserted and re-enabled.
   */
  async registerDevice(p: Principal, input: RegisterPushDeviceDto): Promise<void> {
    await this.db.platform
      .delete(pushDevices)
      .where(and(eq(pushDevices.expoToken, input.expoToken), or(ne(pushDevices.tenantId, p.tenantId), ne(pushDevices.userId, p.userId))));
    const now = this.clock.now();
    await this.db
      .tx()
      .insert(pushDevices)
      .values({ tenantId: p.tenantId, userId: p.userId, expoToken: input.expoToken, platform: input.platform, createdAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: pushDevices.expoToken, set: { platform: input.platform, lastSeenAt: now, disabledAt: null } });
  }

  /** The caller's own row only; 204 whether or not it existed. */
  async removeDevice(p: Principal, token: string): Promise<void> {
    await this.db
      .tx()
      .delete(pushDevices)
      .where(and(eq(pushDevices.expoToken, token), eq(pushDevices.userId, p.userId)));
  }

  async updatePreferences(p: Principal, input: UpdatePreferencesDto): Promise<Preferences> {
    const [row] = await this.db
      .tx()
      .update(users)
      .set({ emailNotifications: input.emailNotifications, updatedAt: this.clock.now() })
      .where(eq(users.id, p.userId))
      .returning({ emailNotifications: users.emailNotifications });
    return { emailNotifications: row!.emailNotifications };
  }
}
```

- [ ] **Step 4: The controller, the listener, the module and the sync and profile fields**

`apps/api/src/notifications/me-notifications.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { NotificationItem, Page, Preferences, UnreadCount } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import {
  NotificationListQueryDto,
  NotificationPageResponse,
  PreferencesResponse,
  RegisterPushDeviceDto,
  UnreadCountResponse,
  UpdatePreferencesDto,
} from './dto';
import { InboxService } from './inbox.service';

/** Spec §6.4 "Current user": any signed-in user, own rows only. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me')
export class MeNotificationsController {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  @Get('notifications')
  @ApiOkResponse({ type: NotificationPageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: NotificationListQueryDto): Promise<Page<NotificationItem>> {
    return this.inbox.list(p, q);
  }

  @Get('notifications/unread-count')
  @ApiOkResponse({ type: UnreadCountResponse })
  async unreadCount(@CurrentPrincipal() p: Principal): Promise<UnreadCount> {
    return { count: await this.inbox.unreadCount(p.userId) };
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  markAllRead(@CurrentPrincipal() p: Principal): Promise<void> {
    return this.inbox.markAllRead(p.userId);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  markRead(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<void> {
    return this.inbox.markRead(p.userId, id);
  }

  @Put('push-devices')
  @HttpCode(204)
  registerDevice(@CurrentPrincipal() p: Principal, @Body() body: RegisterPushDeviceDto): Promise<void> {
    return this.inbox.registerDevice(p, body);
  }

  @Delete('push-devices/:token')
  @HttpCode(204)
  removeDevice(@CurrentPrincipal() p: Principal, @Param('token') token: string): Promise<void> {
    return this.inbox.removeDevice(p, token);
  }

  @Patch('preferences')
  @ApiOkResponse({ type: PreferencesResponse })
  updatePreferences(@CurrentPrincipal() p: Principal, @Body() body: UpdatePreferencesDto): Promise<Preferences> {
    return this.inbox.updatePreferences(p, body);
  }
}
```

In `apps/api/src/notifications/notification-listeners.ts`:
- imports become:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { pushDevices, tasks, users } from '../db/schema';
```

- add `private readonly clock: Clock,` as the last constructor parameter;
- in `onModuleInit` add:

```ts
    this.events.on('user.access_changed', (e) => this.onAccessChanged(e.userId));
```

- add the method:

```ts
  /** Spec §6.5: a deactivated user's phones stop receiving pushes. Reactivation re-enables nothing; the phone re-registers. */
  private async onAccessChanged(userId: string): Promise<void> {
    const tx = this.db.tx();
    const [u] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (u?.status !== 'deactivated') return;
    await tx
      .update(pushDevices)
      .set({ disabledAt: this.clock.now() })
      .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.disabledAt)));
  }
```

In `apps/api/src/notifications/notifications.module.ts`: add `MeNotificationsController` to `controllers`, `InboxService` to `providers` and `exports`:

```ts
  controllers: [NotificationRulesController, MeNotificationsController],
```

```ts
  exports: [NotificationEvents, NotificationRules, InboxService],
```

(with `import { InboxService } from './inbox.service';` and `import { MeNotificationsController } from './me-notifications.controller';`; `InboxService` also goes into `providers`).

In `apps/api/src/executions/executions.module.ts`, import `NotificationsModule` from `../notifications/notifications.module` and add it to `imports`:

```ts
  imports: [SchedulingModule, TasksModule, NotificationsModule],
```

In `apps/api/src/executions/sync.service.ts`:
- import `import { InboxService } from '../notifications/inbox.service';`
- add `private readonly inbox: InboxService,` as the last constructor parameter;
- the returned object ends with:

```ts
      ...(await this.taskSync.forUser(p, q.knownTaskIds, now)),
      unreadNotifications: await this.inbox.unreadCount(p.userId),
    };
```

In `apps/api/src/auth/me.service.ts`, the interim line becomes:

```ts
        emailNotifications: row.user.emailNotifications,
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-inbox executions-sync tasks-sync users auth-login`
Expected: PASS. The 401 comes from the global auth guard before any route.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notifications apps/api/src/executions/sync.service.ts apps/api/src/executions/executions.module.ts apps/api/src/auth/me.service.ts apps/api/test/notification-inbox.test.ts
git commit -m "feat(api): add the inbox, unread count, email preference, push device claim and deactivation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Manual messages: options, preview, send, history and detail

**Files:**
- Create: `apps/api/src/notifications/messages.service.ts`, `apps/api/src/notifications/message-queries.ts`, `apps/api/src/notifications/messages.controller.ts`
- Modify: `apps/api/src/notifications/dto.ts`, `apps/api/src/notifications/notifications.module.ts`
- Test: `apps/api/test/notification-messages.test.ts`

**Interfaces:**
- Consumes: `sendMessageSchema`, `messagePreviewSchema`, `messageSummarySchema`, `messageDetailSchema`, `messageListQuerySchema`, `messageTargetOptionsQuerySchema`, `messageTargetOptionsSchema`, `MESSAGE_LIMITS`, `aggregateDeliveryStatus`, `DELIVERY_STATUSES` (Task 1); `NotificationEvents.create` (Task 8); `NotificationRecipients.expandMessage` (Task 10); `ScopeService.usersFilter`, `SchedulingScope.writableSites`, `AuditService.record`, `escapeLike`.
- Produces:
  - `MessagesService`: `options(p: Principal, q?: string): Promise<MessageTargetOptions>`, `preview(p: Principal, input): Promise<MessagePreview>`, `send(p: Principal, input): Promise<MessageSummary>`. Selected ids outside the sender's scope → `403 FORBIDDEN` (Spec decision 13); 0 recipients → `400 VALIDATION_FAILED` `fields.userIds = 'notifications.issues.noRecipients'`; > 1000 → `fields.userIds = 'notifications.issues.tooManyRecipients'` (send only); `send` records a `manual` event (actor = sender) and audits `notification.message_sent` (entity type `notification_message`, entity id = event id).
  - `MessageQueries`: `list(p, q): Promise<Page<MessageSummary>>` (newest first; `notifications.manage` holders see every manual message, others their own), `summary(p, id)`, `detail(p, id): Promise<MessageDetail>` (`404` for a message the caller may not list).
  - Routes (all `notifications.send`): `GET /notifications/messages/options`, `POST /notifications/messages/preview` (200), `POST /notifications/messages` (201), `GET /notifications/messages`, `GET /notifications/messages/:id`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/notification-messages.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { roleIdOf, siteTypeIdOf } from './fixtures';
import { addDevice, deliverAll, eventRows, fanOutAll, inboxOf, pushSender, staffAt } from './notification-fixtures';
import { ownerQuery } from './owner-db';
import { MONDAY_0800 } from './scheduling-fixtures';
import { taskWorld } from './task-fixtures';

const zero = { queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 };
const message = (over: Record<string, unknown>) => ({ title: 'Diqqət', body: 'Sabah 09:00-da iclas var.', ...over });

describe('manual messages', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => {
    clock.set(MONDAY_0800);
    pushSender(t).reset();
  });
  afterAll(() => t.close());

  /** taskWorld plus a team "Uzaq" with only İşçi 3 (Filial 2), outside the manager's Filial 1 scope. */
  async function world() {
    const w = await taskWorld(t);
    const far = await w.owner.post('/api/v1/teams', { name: 'Uzaq' });
    expect((await w.owner.put(`/api/v1/teams/${far.body.id}/members`, { userIds: [w.workers[2].id] })).status).toBe(200);
    return { ...w, farTeamId: far.body.id as string };
  }

  it('offers only users, teams and sites inside the sender’s scope', async () => {
    const w = await world();
    const res = await w.manager.api.get('/api/v1/notifications/messages/options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      users: [
        { id: w.workers[0].id, fullName: 'İşçi 1', jobTitle: null },
        { id: w.workers[1].id, fullName: 'İşçi 2', jobTitle: null },
      ],
      teams: [{ id: w.teamId, name: 'Texniki xidmət', memberCount: 2 }],
      sites: [{ id: w.siteId, name: 'Filial 1' }],
    });
    const filtered = await w.manager.api.get(`/api/v1/notifications/messages/options?q=${encodeURIComponent('çi 2')}`);
    expect(filtered.body.users.map((u: { id: string }) => u.id)).toEqual([w.workers[1].id]);
    expect(filtered.body.teams).toEqual([]);
    expect(filtered.body.sites).toEqual([{ id: w.siteId, name: 'Filial 1' }]);
    const all = (await w.owner.get('/api/v1/notifications/messages/options')).body;
    expect(all.users.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([w.workers[2].id, w.manager.id]));
    expect(all.users.map((u: { id: string }) => u.id)).not.toContain(w.s.ownerId);
    expect(all.teams.map((x: { name: string }) => x.name)).toEqual(['Texniki xidmət', 'Uzaq']);
  });

  it('previews the recipient count and refuses ids outside the scope', async () => {
    const w = await world();
    const preview = (body: object) => w.manager.api.post('/api/v1/notifications/messages/preview', message(body));
    expect((await preview({ teamIds: [w.teamId] })).body).toEqual({ recipientCount: 2 });
    expect((await preview({ siteIds: [w.siteId], userIds: [w.workers[0].id] })).body).toEqual({ recipientCount: 2 });
    for (const body of [{ userIds: [w.workers[2].id] }, { teamIds: [w.farTeamId] }, { siteIds: [w.otherSiteId] }]) {
      const res = await preview(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const none = await preview({});
    expect(none.status).toBe(400);
    expect(none.body.error.fields).toEqual({ userIds: 'notifications.issues.noTargets' });
  });

  it('sends: records a manual event by the sender, audits it, and answers with an unprocessed summary', async () => {
    const w = await world();
    const res = await w.manager.api.post('/api/v1/notifications/messages', message({ teamIds: [w.teamId], email: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [event] = await eventRows(w.s.tenantId, 'manual');
    expect(res.body).toEqual({
      id: event!.id, title: 'Diqqət', body: 'Sabah 09:00-da iclas var.', sender: { id: w.manager.id, fullName: 'Menecer' }, sentAt: '2026-11-02T04:00:00.000Z',
      emailRequested: true, processed: false, recipientCount: 0, readCount: 0, push: zero, email: zero,
    });
    expect(event).toMatchObject({ actor_user_id: w.manager.id, payload: { title: 'Diqqət', body: 'Sabah 09:00-da iclas var.', userIds: [], teamIds: [w.teamId], siteIds: [], email: true } });
    const audit = await ownerQuery<{ action: string; entity_type: string; entity_id: string; actor_user_id: string; after: { recipientCount: number } }>(
      "select action, entity_type, entity_id, actor_user_id, after from audit_log where tenant_id = $1 and action = 'notification.message_sent'",
      [w.s.tenantId],
    );
    expect(audit.rows).toEqual([{ action: 'notification.message_sent', entity_type: 'notification_message', entity_id: event!.id, actor_user_id: w.manager.id, after: expect.objectContaining({ recipientCount: 2 }) }]);
    await fanOutAll(t, w.s.tenantId);
    expect((await inboxOf(w.workers[0].id)).map((n) => [n.type, n.title])).toEqual([['manual', 'Diqqət']]);
    expect(await inboxOf(w.manager.id)).toEqual([]);
  });

  it('refuses a send that reaches nobody or more than 1000 people', async () => {
    const w = await world();
    const typeId = await siteTypeIdOf(w.s.tenantId);
    const empty = (await w.owner.post('/api/v1/sites', { parentId: w.siteId, typeId, name: 'Boş anbar' })).body.id as string;
    expect((await w.manager.api.post('/api/v1/notifications/messages/preview', message({ siteIds: [empty] }))).body).toEqual({ recipientCount: 0 });
    const nobody = await w.manager.api.post('/api/v1/notifications/messages', message({ siteIds: [empty] }));
    expect(nobody.status).toBe(400);
    expect(nobody.body.error.fields).toEqual({ userIds: 'notifications.issues.noRecipients' });
    const big = (await w.owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Böyük filial' })).body.id as string;
    const suffix = randomBytes(4).toString('hex');
    await ownerQuery(
      `with u as (
         insert into users (id, tenant_id, full_name, role_id, kind, username, status)
         select gen_random_uuid(), $1, 'Toplu ' || g, $2, 'worker', 'bulk-' || g || '-' || $4, 'active' from generate_series(1, 1001) g
         returning id)
       insert into user_sites (tenant_id, user_id, site_id) select $1, u.id, $3 from u`,
      [w.s.tenantId, await roleIdOf(w.s.tenantId, 'worker'), big, suffix],
    );
    expect((await w.owner.post('/api/v1/notifications/messages/preview', message({ siteIds: [big] }))).body).toEqual({ recipientCount: 1001 });
    const tooMany = await w.owner.post('/api/v1/notifications/messages', message({ siteIds: [big] }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.fields).toEqual({ userIds: 'notifications.issues.tooManyRecipients' });
    expect(await eventRows(w.s.tenantId, 'manual')).toEqual([]);
  });

  it('lists a sender’s own messages, every message for notifications.manage, with per-recipient counts', async () => {
    const w = await world();
    await addDevice(w.s.tenantId, w.workers[0].id);
    const mine = (await w.manager.api.post('/api/v1/notifications/messages', message({ teamIds: [w.teamId] }))).body.id as string;
    clock.set('2026-11-02T04:05:00Z');
    const owners = (await w.owner.post('/api/v1/notifications/messages', message({ title: 'Hamıya', userIds: [w.workers[2].id] }))).body.id as string;
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    expect((await w.workers[1].api.post(`/api/v1/me/notifications/${(await inboxOf(w.workers[1].id))[0]!.id}/read`)).status).toBe(204);
    const managerList = await w.manager.api.get('/api/v1/notifications/messages');
    expect(managerList.body.items.map((m: { id: string }) => m.id)).toEqual([mine]);
    expect(managerList.body.items[0]).toMatchObject({ processed: true, recipientCount: 2, readCount: 1, push: { ...zero, sent: 1 }, email: zero });
    const ownerList = await w.owner.get('/api/v1/notifications/messages?limit=1');
    expect(ownerList.body.items.map((m: { id: string }) => m.id)).toEqual([owners]);
    const next = await w.owner.get(`/api/v1/notifications/messages?limit=1&cursor=${ownerList.body.nextCursor}`);
    expect(next.body).toMatchObject({ items: [expect.objectContaining({ id: mine })], nextCursor: null });
    expect((await w.manager.api.get(`/api/v1/notifications/messages/${owners}`)).status).toBe(404);
    expect((await w.owner.get(`/api/v1/notifications/messages/${mine}`)).status).toBe(200);
    expect((await w.workers[0].api.get('/api/v1/notifications/messages')).status).toBe(403);
    expect((await w.workers[0].api.get('/api/v1/notifications/messages/options')).status).toBe(403);
    expect((await w.workers[0].api.post('/api/v1/notifications/messages', message({ userIds: [w.workers[1].id] }))).status).toBe(403);
  });

  it('details each recipient’s read state and per-channel status with the last error', async () => {
    const w = await world();
    const phone = await addDevice(w.s.tenantId, w.workers[0].id);
    const admin = await staffAt(t, w.s.tenantId, w.owner, 'admin', [], 'Admin');
    pushSender(t).ticketFor = (m) => (m.to === phone.token ? { ok: false, error: 'DeviceNotRegistered', message: 'gone' } : { ok: true, id: 'x' });
    const id = (await admin.api.post('/api/v1/notifications/messages', message({ teamIds: [w.teamId], userIds: [w.manager.id], siteIds: [w.siteId], email: true }))).body.id as string;
    await fanOutAll(t, w.s.tenantId);
    await deliverAll(t, w.s.tenantId);
    const res = await admin.api.get(`/api/v1/notifications/messages/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.targets).toEqual({
      users: [{ id: w.manager.id, fullName: 'Menecer' }],
      teams: [{ id: w.teamId, name: 'Texniki xidmət' }],
      sites: [{ id: w.siteId, name: 'Filial 1' }],
    });
    // Ordered by full name in the database collation; compare as a set so the test does not depend on how "İ" sorts.
    expect(res.body.recipients).toHaveLength(3);
    expect(res.body.recipients).toEqual(expect.arrayContaining([
      { user: { id: w.workers[0].id, fullName: 'İşçi 1' }, readAt: null, push: { status: 'failed', devices: 1, lastError: 'DeviceNotRegistered: gone' }, email: { status: null, lastError: null } },
      { user: { id: w.workers[1].id, fullName: 'İşçi 2' }, readAt: null, push: { status: null, devices: 0, lastError: null }, email: { status: null, lastError: null } },
      { user: { id: w.manager.id, fullName: 'Menecer' }, readAt: null, push: { status: null, devices: 0, lastError: null }, email: { status: 'sent', lastError: null } },
    ]));
    expect(res.body).toMatchObject({ recipientCount: 3, push: { ...zero, failed: 1 }, email: { ...zero, sent: 1 } });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- notification-messages`
Expected: FAIL: `GET /api/v1/notifications/messages/options` answers 404.

- [ ] **Step 3: DTOs**

Append to `apps/api/src/notifications/dto.ts` (extend the contracts import with `messageDetailSchema`, `messageListQuerySchema`, `messagePreviewSchema`, `messageSummarySchema`, `messageTargetOptionsQuerySchema`, `messageTargetOptionsSchema`, `sendMessageSchema`):

```ts
export class SendMessageDto extends createZodDto(sendMessageSchema) {}
export class MessageListQueryDto extends createZodDto(messageListQuerySchema) {}
export class MessageTargetOptionsQueryDto extends createZodDto(messageTargetOptionsQuerySchema) {}
export class MessagePreviewResponse extends createZodDto(messagePreviewSchema) {}
export class MessageSummaryResponse extends createZodDto(messageSummarySchema) {}
export class MessagePageResponse extends createZodDto(pageOf(messageSummarySchema)) {}
export class MessageDetailResponse extends createZodDto(messageDetailSchema) {}
export class MessageTargetOptionsResponse extends createZodDto(messageTargetOptionsSchema) {}
```

- [ ] **Step 4: Queries**

`apps/api/src/notifications/message-queries.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  aggregateDeliveryStatus,
  type DeliveryChannel,
  type DeliveryCounts,
  type DeliveryStatus,
  type MessageDetail,
  type MessageRecipient,
  type MessageSummary,
  type Page,
} from '@taskop/contracts';
import { and, asc, count, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { notificationDeliveries, notificationEvents, notifications, sites, teams, users } from '../db/schema';
import type { ManualPayload } from './payloads';

const zero = (): DeliveryCounts => ({ queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 });

interface EventRow {
  id: string;
  payload: unknown;
  createdAt: Date;
  processedAt: Date | null;
  senderId: string | null;
  senderName: string | null;
}

/** Spec §6.4 "Manual messages" reads. Counts are per recipient, using aggregateDeliveryStatus's order. */
@Injectable()
export class MessageQueries {
  constructor(private readonly db: DbService) {}

  async list(p: Principal, q: { cursor?: string; limit: number }): Promise<Page<MessageSummary>> {
    const conds: (SQL | undefined)[] = [this.visible(p)];
    if (q.cursor) {
      conds.push(sql`(${notificationEvents.createdAt}, ${notificationEvents.id}) < (select c.created_at, c.id from notification_events c where c.id = ${q.cursor})`);
    }
    const rows = await this.select()
      .where(and(...conds))
      .orderBy(desc(notificationEvents.createdAt), desc(notificationEvents.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return { items: await this.summaries(page), nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async summary(p: Principal, id: string): Promise<MessageSummary> {
    const [row] = await this.select().where(and(eq(notificationEvents.id, id), this.visible(p)));
    if (!row) throw new AppError('NOT_FOUND');
    return (await this.summaries([row]))[0]!;
  }

  async detail(p: Principal, id: string): Promise<MessageDetail> {
    const summary = await this.summary(p, id);
    const tx = this.db.tx();
    const [ev] = await tx.select({ payload: notificationEvents.payload }).from(notificationEvents).where(eq(notificationEvents.id, id));
    const payload = ev!.payload as ManualPayload;
    const targets = {
      users: payload.userIds.length
        ? await tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, payload.userIds)).orderBy(asc(users.fullName), asc(users.id))
        : [],
      teams: payload.teamIds.length
        ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, payload.teamIds)).orderBy(asc(teams.name), asc(teams.id))
        : [],
      sites: payload.siteIds.length
        ? await tx.select({ id: sites.id, name: sites.name }).from(sites).where(inArray(sites.id, payload.siteIds)).orderBy(asc(sites.name), asc(sites.id))
        : [],
    };
    const rows = await tx
      .select({ id: notifications.id, userId: users.id, fullName: users.fullName, readAt: notifications.readAt })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(eq(notifications.eventId, id))
      .orderBy(asc(users.fullName), asc(users.id));
    const deliveries = rows.length
      ? await tx
          .select({ notificationId: notificationDeliveries.notificationId, channel: notificationDeliveries.channel, status: notificationDeliveries.status, lastError: notificationDeliveries.lastError })
          .from(notificationDeliveries)
          .where(inArray(notificationDeliveries.notificationId, rows.map((r) => r.id)))
          .orderBy(asc(notificationDeliveries.id))
      : [];
    const channel = (notificationId: string, c: DeliveryChannel) => {
      const mine = deliveries.filter((d) => d.notificationId === notificationId && d.channel === c);
      const status = aggregateDeliveryStatus(mine.map((d) => d.status));
      const lastError = (mine.find((d) => d.status === status && d.lastError) ?? mine.find((d) => d.lastError))?.lastError ?? null;
      return { status, lastError, devices: mine.length };
    };
    const recipients: MessageRecipient[] = rows.map((r) => {
      const push = channel(r.id, 'push');
      const email = channel(r.id, 'email');
      return {
        user: { id: r.userId, fullName: r.fullName },
        readAt: r.readAt?.toISOString() ?? null,
        push: { status: push.status, devices: push.devices, lastError: push.lastError },
        email: { status: email.status, lastError: email.lastError },
      };
    });
    return { ...summary, targets, recipients };
  }

  /** Manual messages only; notifications.manage sees the tenant's, other senders their own (spec §6.4). */
  private visible(p: Principal): SQL {
    return and(eq(notificationEvents.type, 'manual'), p.permissions.has('notifications.manage') ? undefined : eq(notificationEvents.actorUserId, p.userId))!;
  }

  private select() {
    return this.db
      .tx()
      .select({
        id: notificationEvents.id,
        payload: notificationEvents.payload,
        createdAt: notificationEvents.createdAt,
        processedAt: notificationEvents.processedAt,
        senderId: users.id,
        senderName: users.fullName,
      })
      .from(notificationEvents)
      .leftJoin(users, eq(users.id, notificationEvents.actorUserId))
      .$dynamic();
  }

  private async summaries(rows: EventRow[]): Promise<MessageSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const tx = this.db.tx();
    const totals = new Map(
      (
        await tx
          .select({ eventId: notifications.eventId, recipients: count(), read: count(notifications.readAt) })
          .from(notifications)
          .where(inArray(notifications.eventId, ids))
          .groupBy(notifications.eventId)
      ).map((r) => [r.eventId, r]),
    );
    // One status per recipient and channel (the best of its deliveries), then counted per message.
    const rollup = await tx.execute<{ event_id: string; channel: DeliveryChannel; status: DeliveryStatus; n: number }>(sql`
      select x.event_id, x.channel, x.status, count(*)::int as n
        from (select notifications.event_id, d.channel,
                     (array_agg(d.status order by array_position(array['delivered','sent','queued','failed','skipped']::text[], d.status::text)))[1] as status
                from notifications
                join notification_deliveries d on d.notification_id = notifications.id
               where ${inArray(notifications.eventId, ids)}
               group by notifications.event_id, notifications.id, d.channel) x
       group by x.event_id, x.channel, x.status`);
    const counts = new Map<string, { push: DeliveryCounts; email: DeliveryCounts }>();
    for (const r of rollup.rows) {
      const entry = counts.get(r.event_id) ?? { push: zero(), email: zero() };
      entry[r.channel][r.status] = r.n;
      counts.set(r.event_id, entry);
    }
    return rows.map((r) => {
      const payload = r.payload as ManualPayload;
      const total = totals.get(r.id);
      const c = counts.get(r.id) ?? { push: zero(), email: zero() };
      return {
        id: r.id,
        title: payload.title,
        body: payload.body,
        sender: r.senderId ? { id: r.senderId, fullName: r.senderName! } : null,
        sentAt: r.createdAt.toISOString(),
        emailRequested: payload.email,
        processed: r.processedAt !== null,
        recipientCount: total?.recipients ?? 0,
        readCount: total?.read ?? 0,
        push: c.push,
        email: c.email,
      };
    });
  }
}
```

- [ ] **Step 5: Commands and options**

`apps/api/src/notifications/messages.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { MESSAGE_LIMITS, type MessagePreview, type MessageSummary, type MessageTargetOptions } from '@taskop/contracts';
import { and, asc, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { ScopeService } from '../common/scope.service';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { sites, teams, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { SendMessageDto } from './dto';
import { MessageQueries } from './message-queries';
import { NotificationEvents } from './notification-events';
import { NotificationRecipients } from './notification-recipients';
import type { ManualPayload } from './payloads';

const unique = (ids: string[]) => [...new Set(ids)];

/** FR-15.08 (spec §6.4): messages to users, teams and sites inside the sender's data scope. */
@Injectable()
export class MessagesService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly siteScope: SchedulingScope,
    private readonly recipients: NotificationRecipients,
    private readonly events: NotificationEvents,
    private readonly audit: AuditService,
    private readonly queries: MessageQueries,
  ) {}

  /** The picker (Spec decision 13): active users but the sender, active teams with active members in scope, active sites in scope. */
  async options(p: Principal, q: string | undefined): Promise<MessageTargetOptions> {
    const tx = this.db.tx();
    const like = q ? `%${escapeLike(q)}%` : null;
    const people = await tx
      .select({ id: users.id, fullName: users.fullName, jobTitle: users.jobTitle })
      .from(users)
      .where(and(eq(users.status, 'active'), ne(users.id, p.userId), this.scope.usersFilter(p), like ? ilike(users.fullName, like) : undefined))
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(50);
    const inScope = this.scope.usersFilter(p) ?? sql`true`;
    const members = sql<number>`(select count(*)::int from user_teams ut join users on users.id = ut.user_id where ut.team_id = ${teams.id} and users.status = 'active' and ${inScope})`;
    const groups = await tx
      .select({ id: teams.id, name: teams.name, memberCount: members })
      .from(teams)
      .where(and(eq(teams.active, true), sql`${members} > 0`, like ? ilike(teams.name, like) : undefined))
      .orderBy(asc(teams.name), asc(teams.id))
      .limit(50);
    const places = await tx
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.active, true), this.siteScope.writableSites(p)))
      .orderBy(asc(sites.name), asc(sites.id))
      .limit(200);
    return { users: people, teams: groups, sites: places };
  }

  async preview(p: Principal, input: SendMessageDto): Promise<MessagePreview> {
    await this.assertInScope(p, input);
    return { recipientCount: (await this.expand(p, input)).length };
  }

  async send(p: Principal, input: SendMessageDto): Promise<MessageSummary> {
    await this.assertInScope(p, input);
    const recipientCount = (await this.expand(p, input)).length;
    if (recipientCount === 0) throw new AppError('VALIDATION_FAILED', { fields: { userIds: 'notifications.issues.noRecipients' } });
    if (recipientCount > MESSAGE_LIMITS.maxRecipients) throw new AppError('VALIDATION_FAILED', { fields: { userIds: 'notifications.issues.tooManyRecipients' } });
    const payload: ManualPayload = {
      title: input.title,
      body: input.body,
      userIds: unique(input.userIds),
      teamIds: unique(input.teamIds),
      siteIds: unique(input.siteIds),
      email: input.email,
    };
    // create (not record): the sender must learn of a failure.
    const eventId = (await this.events.create('manual', payload, p.userId))!;
    await this.audit.record({
      action: 'notification.message_sent',
      entityType: 'notification_message',
      entityId: eventId,
      after: { title: payload.title, recipientCount, email: payload.email, userIds: payload.userIds, teamIds: payload.teamIds, siteIds: payload.siteIds },
    });
    return this.queries.summary(p, eventId);
  }

  private expand(p: Principal, input: SendMessageDto): Promise<string[]> {
    return this.recipients.expandMessage(p, { userIds: unique(input.userIds), teamIds: unique(input.teamIds), siteIds: unique(input.siteIds) });
  }

  /** Every selected id must be one the picker could offer (any status): otherwise 403. */
  private async assertInScope(p: Principal, input: SendMessageDto): Promise<void> {
    const tx = this.db.tx();
    const userIds = unique(input.userIds);
    if (userIds.length) {
      const found = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, userIds), this.scope.usersFilter(p)));
      if (found.length !== userIds.length) throw new AppError('FORBIDDEN');
    }
    const teamIds = unique(input.teamIds);
    if (teamIds.length) {
      const filter = this.scope.usersFilter(p);
      const inScope = filter ? sql`exists (select 1 from user_teams ut join users on users.id = ut.user_id where ut.team_id = ${teams.id} and ${filter})` : undefined;
      const found = await tx.select({ id: teams.id }).from(teams).where(and(inArray(teams.id, teamIds), inScope));
      if (found.length !== teamIds.length) throw new AppError('FORBIDDEN');
    }
    const siteIds = unique(input.siteIds);
    if (siteIds.length) {
      const found = await tx.select({ id: sites.id }).from(sites).where(and(inArray(sites.id, siteIds), this.siteScope.writableSites(p)));
      if (found.length !== siteIds.length) throw new AppError('FORBIDDEN');
    }
  }
}
```

- [ ] **Step 6: Controller and module**

`apps/api/src/notifications/messages.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MessageDetail, MessagePreview, MessageSummary, MessageTargetOptions, Page } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import {
  MessageDetailResponse,
  MessageListQueryDto,
  MessagePageResponse,
  MessagePreviewResponse,
  MessageSummaryResponse,
  MessageTargetOptionsQueryDto,
  MessageTargetOptionsResponse,
  SendMessageDto,
} from './dto';
import { MessageQueries } from './message-queries';
import { MessagesService } from './messages.service';

/** Spec §6.4 "Manual messages" (notifications.send). */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/messages')
@RequirePermission('notifications.send')
export class MessagesController {
  constructor(
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(MessageQueries) private readonly queries: MessageQueries,
  ) {}

  /** Declared before `:id`, so "options" is never parsed as an id. */
  @Get('options')
  @ApiOkResponse({ type: MessageTargetOptionsResponse })
  options(@CurrentPrincipal() p: Principal, @Query() q: MessageTargetOptionsQueryDto): Promise<MessageTargetOptions> {
    return this.messages.options(p, q.q);
  }

  @Post('preview')
  @HttpCode(200)
  @ApiOkResponse({ type: MessagePreviewResponse })
  preview(@CurrentPrincipal() p: Principal, @Body() body: SendMessageDto): Promise<MessagePreview> {
    return this.messages.preview(p, body);
  }

  @Post()
  @ApiCreatedResponse({ type: MessageSummaryResponse })
  send(@CurrentPrincipal() p: Principal, @Body() body: SendMessageDto): Promise<MessageSummary> {
    return this.messages.send(p, body);
  }

  @Get()
  @ApiOkResponse({ type: MessagePageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: MessageListQueryDto): Promise<Page<MessageSummary>> {
    return this.queries.list(p, q);
  }

  @Get(':id')
  @ApiOkResponse({ type: MessageDetailResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<MessageDetail> {
    return this.queries.detail(p, id);
  }
}
```

In `apps/api/src/notifications/notifications.module.ts`: add `MessagesController` to `controllers`, and `MessagesService`, `MessageQueries` to `providers` (with their imports). The module now reads:

```ts
@Module({
  imports: [SchedulingModule, TasksModule],
  controllers: [NotificationRulesController, MeNotificationsController, MessagesController],
  providers: [
    NotificationEvents,
    NotificationListeners,
    NotificationRules,
    ScopeSubjects,
    NotificationTargets,
    NotificationRecipients,
    NotificationFanout,
    NotificationDelivery,
    NotificationJobs,
    InboxService,
    MessagesService,
    MessageQueries,
    { provide: PUSH_SENDER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => pushSenderFor(config) },
  ],
  exports: [NotificationEvents, NotificationRules, InboxService],
})
export class NotificationsModule {}
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- notification-messages`
Expected: PASS. In the detail test the manager has an email address (staff) and is opted in, so only they get an email; İşçi 1's only device answers `DeviceNotRegistered`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/notifications apps/api/test/notification-messages.test.ts
git commit -m "feat(api): send manual messages to users, teams and sites in scope, with history and delivery detail" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Real-queue wiring, OpenAPI, the demo seed and the full run

**Files:**
- Modify: `apps/api/test/jobs-wiring.test.ts`, `apps/api/test/openapi.test.ts`, `apps/api/src/db/scripts/seed.ts`, `apps/api/test/seed-demo.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - A wiring test that runs `notifications.fanout` and `notifications.deliver` through real pg-boss queues (the path Part 3's Playwright test relies on: an action's notification appears within seconds when `JOBS_ENABLED=true`).
  - The cron test also checks the four notification schedules and the two standard worker queues.
  - `seedDemoNotifications(tx, tenantId, ownerId)`: a processed "Xoş gəlmisiniz" message from the owner in elvin's and Leyla's inboxes, once, so Part 2 and Part 3 have something to show locally.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/jobs-wiring.test.ts`, add `import { addDevice, deliveriesOf, inboxOf } from './notification-fixtures';` and append inside `describe('pg-boss wiring', …)`:

```ts
  it('fans out and delivers a notification through real queues', async () => {
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
    try {
      const w = await taskWorld(t);
      await addDevice(w.s.tenantId, w.workers[0].id);
      await createTask(w.manager.api, newTaskBody({ userId: w.workers[0].id }));
      await expect.poll(async () => (await inboxOf(w.workers[0].id)).map((n) => n.type), { timeout: 20_000, interval: 250 }).toEqual(['task.assigned']);
      await expect.poll(async () => (await deliveriesOf(w.workers[0].id)).map((d) => d.status), { timeout: 20_000, interval: 250 }).toEqual(['sent']);
    } finally {
      await t.close();
    }
  });
```

and extend `registers cron schedules only while JOBS_CRON is on and uses stately queues`. After the existing `policies` assertion (inside the `try` of the `on` app) add:

```ts
      const notificationSchedules = await ownerQuery<{ name: string }>("select name from pgboss.schedule where name like 'notifications.%' order by name");
      expect(notificationSchedules.rows.map((r) => r.name)).toEqual(['notifications.cleanup', 'notifications.receipts', 'notifications.scan', 'notifications.sweep']);
      const workers = await ownerQuery<{ name: string; policy: string }>("select name, policy from pgboss.queue where name in ('notifications.fanout', 'notifications.deliver', 'notifications.dead') order by name");
      expect(workers.rows).toEqual([
        { name: 'notifications.dead', policy: 'standard' },
        { name: 'notifications.deliver', policy: 'standard' },
        { name: 'notifications.fanout', policy: 'standard' },
      ]);
```

and after the existing `expect(await schedules()).toEqual([]);` of the `off` app add:

```ts
      expect((await ownerQuery("select 1 from pgboss.schedule where name like 'notifications.%'")).rowCount).toBe(0);
```

The `past` clock (2020) makes the notification crons no-ops for every other test's data: nothing was sent, opened or created before 2020.

In `apps/api/test/openapi.test.ts`, append:

```ts
  it('documents the notification paths', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/me/notifications',
        '/api/v1/me/notifications/unread-count',
        '/api/v1/me/notifications/read-all',
        '/api/v1/me/notifications/{id}/read',
        '/api/v1/me/push-devices',
        '/api/v1/me/push-devices/{token}',
        '/api/v1/me/preferences',
        '/api/v1/notification-rules',
        '/api/v1/notification-rules/{type}',
        '/api/v1/notifications/messages',
        '/api/v1/notifications/messages/options',
        '/api/v1/notifications/messages/preview',
        '/api/v1/notifications/messages/{id}',
      ]),
    );
  });
```

In `apps/api/test/seed-demo.test.ts`, append inside `describe('demo seed', …)`:

```ts
  it('puts one processed welcome message in elvin’s and Leyla’s inboxes, once', async () => {
    await seed(inject('db').ownerUrl);
    await seed(inject('db').ownerUrl);
    const r = await ownerQuery<{ who: string; title: string; target_kind: string; read: boolean; outcome: string; actor: string }>(
      `select coalesce(u.username, u.email) as who, n.title, n.target_kind, n.read_at is not null as read, e.outcome, a.email as actor
         from notifications n
         join notification_events e on e.id = n.event_id
         join users u on u.id = n.user_id
         join users a on a.id = e.actor_user_id
         join tenants t on t.id = n.tenant_id
        where t.org_code = 'demo'
        order by 1`,
    );
    expect(r.rows).toEqual([
      { who: 'elvin', title: 'Xoş gəlmisiniz', target_kind: 'none', read: false, outcome: 'fanned_out', actor: 'owner@demo.taskop.az' },
      { who: 'manager@demo.taskop.az', title: 'Xoş gəlmisiniz', target_kind: 'none', read: false, outcome: 'fanned_out', actor: 'owner@demo.taskop.az' },
    ]);
  }, 60_000);
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/api test -- jobs-wiring openapi seed-demo`
Expected: the real-queue and OpenAPI tests PASS already (Tasks 6–17 built them); the cron test PASSES too; `seed-demo` FAILS: the welcome message query returns `[]`. (If the real-queue test fails, a worker is not wired: check `NotificationFanout.onModuleInit` and `NotificationDelivery.onModuleInit` call `defineWorker`.)

- [ ] **Step 3: Seed the welcome message**

In `apps/api/src/db/scripts/seed.ts`, add after `seedDemoTasks`:

```ts
/** Idempotent: a processed manual message from the owner in elvin's and Leyla's inboxes (no deliveries). */
async function seedDemoNotifications(tx: Tx, tenantId: string, ownerId: string): Promise<void> {
  const existing = await tx
    .select({ id: schema.notificationEvents.id })
    .from(schema.notificationEvents)
    .where(and(eq(schema.notificationEvents.tenantId, tenantId), eq(schema.notificationEvents.type, 'manual')))
    .limit(1);
  if (existing.length) return;
  const people = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), or(eq(schema.users.username, 'elvin'), eq(schema.users.email, 'manager@demo.taskop.az'))));
  if (!people.length) return;
  const title = 'Xoş gəlmisiniz';
  const body = 'Yeni işlər, gecikmələr və problemlər haqqında bildirişləri burada görəcəksiniz.';
  const now = new Date();
  const eventId = uuidv7();
  await tx.insert(schema.notificationEvents).values({
    id: eventId,
    tenantId,
    type: 'manual',
    payload: { title, body, userIds: people.map((p) => p.id), teamIds: [], siteIds: [], email: false },
    actorUserId: ownerId,
    createdAt: now,
    processedAt: now,
    outcome: 'fanned_out',
    attempts: 1,
  });
  await tx
    .insert(schema.notifications)
    .values(people.map((p) => ({ id: uuidv7(), tenantId, eventId, userId: p.id, type: 'manual', title, body, targetKind: 'none' as const, createdAt: now })));
}
```

Change the file's `drizzle-orm` import to `import { and, eq, inArray, or } from 'drizzle-orm';`. In `seed()`, call it after `seedDemoTasks` in both branches:

```ts
        await seedDemoTasks(tx, existing.id);
        await seedDemoNotifications(tx, existing.id, owner.id);
```

```ts
    await seedDemoTasks(tx, tenantId);
    await seedDemoNotifications(tx, tenantId, ownerId);
```

and add a line to the summary printed at the end:

```ts
  console.log('  Notifications: a welcome message in elvin\'s and Leyla\'s inboxes (phone bell, web bell)');
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test`
Expected: PASS, every API test file including the eleven new ones. The mobile and web checks are run by Parts 2 and 3 after their Task 1 (see Task 2, **Fixtures in the apps**).

- [ ] **Step 5: Try it locally**

```bash
docker compose up -d
pnpm --filter @taskop/api db:setup
pnpm --filter @taskop/api db:seed
pnpm --filter @taskop/api dev
```

Then, in another terminal, sign in as the worker and read the inbox:

```bash
TOKEN=$(curl -s localhost:3000/api/v1/auth/login/worker -H 'content-type: application/json' \
  -d '{"orgCode":"demo","username":"elvin","secret":"482915","client":"mobile"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s localhost:3000/api/v1/me/notifications -H "Authorization: Bearer $TOKEN"
curl -s localhost:3000/api/v1/me/notifications/unread-count -H "Authorization: Bearer $TOKEN"
```

Expected: one item titled "Xoş gəlmisiniz" and `{"count":1}`. Mailpit (http://localhost:8025) receives an email when Leyla's critical-problem rule fires on a new critical problem.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/jobs-wiring.test.ts apps/api/test/openapi.test.ts apps/api/test/seed-demo.test.ts apps/api/src/db/scripts/seed.ts
git commit -m "test(api): run notifications through real queues, document the paths, seed a welcome message" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (spec section → task):
- §3.1 catalogue, defaults → Task 1 (`NOTIFICATION_TYPES`, `DEFAULT_RULES`); `task.accepted` not notified, `task.submitted` only awaiting review → Task 8.
- §3.2 rules, lead time, role ids, deleted roles → Tasks 1, 5 (`notification_rules_lead_ck`), 9.
- §3.3 recipients: direct audiences, role + scope, active only, actor, dedupe, team before/after accept → Task 10.
- §3.4 `available` / `due_soon`, 15-minute guard, short-window skip, dedupe keys → Task 15.
- §4 contracts (`notifications.ts`, `sync.ts`, `permissions.ts`, `audit.ts`, `auth.ts`) → Tasks 1–2; i18n → Task 3; client → Task 4.
- §5 tables, indexes, `users.email_notifications`, permission seeding → Task 5.
- §6.1 step 1 record (savepoint, swallow, after-commit enqueue) → Task 8; step 2 listeners → Task 8; step 3 new domain events → Task 7; step 4 fan-out → Task 12 (targets and recipients Task 10, templates Task 11); step 5 deliver → Task 13.
- §6.2 `PUSH_SENDER`, `ExpoPushSender`, `FakePushSender`, `EXPO_ACCESS_TOKEN`, `NOTIFICATIONS_PUSH_ENABLED` (documented in `.env.example`) → Task 13.
- §6.3 `defineWorker`, `send`, `notifications.dead` → Task 6; the four crons → Tasks 14–15; wiring → Task 18.
- §6.4 current-user endpoints, token claim, `me/sync` → Task 16; rules endpoints → Task 9; messages (options, preview, send, list, detail, 403, 1000 cap, audit) → Task 17.
- §6.5 deactivation disables devices → Task 16.
- §6.6 error table: record failure (Task 8), fan-out retries and dead letter (Task 12), outcomes (Task 12), Expo HTTP failure and 429 (Task 13, attempt per row), `DeviceNotRegistered` (Tasks 13–14), `InvalidCredentials` / `MessageTooBig` logged (Task 13), SMTP temporary / permanent (Task 13), skipped (Task 13).
- §9 API tests: every listed unit and integration item has a test in the task named above.
- §7, §8 (mobile, web) → Parts 2 and 3; their Task 1 repairs the app fixtures broken by Task 2 (Spec decision 25).

**Placeholder scan:** every code step carries the code; the two places where the toolchain could disagree (Zod literal arrays in Task 1; the Expo `data` type and the enum `case` in Task 13) name the exact alternative line to use.

**Type consistency:** `FanoutJob`, `DeliverJob`, `NOTIFICATION_QUEUES`, `NOTIFICATION_LIMITS`, `failureText` (Task 8) and `deliveryJobs` (Task 12) live in `queues.ts`; `PayloadOf` / `ManualPayload` in `payloads.ts`; `ScopeSubject = TaskReader` (Task 10) is what `expandMessage` takes and a `Principal` satisfies (Task 17); `NotificationRules.effective` returns `NotificationRuleDto` everywhere (Tasks 9, 10, 12, 15); `NotificationRecipients.resolve(rule, target, actor)` has the same argument order in Tasks 10 and 12; fixtures `staffAt`, `addDevice`, `eventRows`, `inboxOf`, `deliveriesOf`, `fanOutAll`, `deliverAll`, `pushSender` are defined before their first use (Tasks 5, 9, 12, 13).

**Review Focus:** each of the five lines has its test in the owning task: Task 16 (token claim, keyset paging), Task 8 (pending → missed), Task 13 (replayed delivery), Tasks 11–12 (timezone).
