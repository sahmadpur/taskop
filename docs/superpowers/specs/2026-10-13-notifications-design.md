# Taskop — Sub-project 6: Notifications — Design Spec

- **Date:** 2026-10-13
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf` — FR-15.01–09, NFR-11.01–03, FR-13.04 (problem → manager), FR-14.10 (task completion → creator), FR-25.01 (received notifications on mobile); risks B-11, B-12, I-09
- **Builds on:** `2026-10-07-foundation-design.md` (tenancy, RLS, roles, data scopes, teams, mailer), `2026-10-09-scheduling-assignment-design.md` (`JobsService`, `DomainEvents`, `occurrence.status_changed`, `SchedulingScope`), `2026-10-09-mobile-execution-design.md` (`execution_problems`, `me/sync`), `2026-10-12-tasks-design.md` (`task.*` events, `TaskScope`), `2026-10-09-deployment-design.md` (Resend SMTP, EAS on a free account)

## 1. Context and decisions

Sub-projects 3–5 emit domain events with no listeners. Sub-project 6 turns them into notifications so that people learn about work and incidents without polling the app: workers about new and due checklists and tasks, managers about overdue work and problems, task creators about completion, and everyone about messages an admin sends by hand. A failing notification never blocks checklist or task work.

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| Channels | **Mobile push + in-app inbox (mobile and web) + email.** In-app is always on for an enabled rule; push and email are switched per rule. |
| Architecture | **Event outbox with asynchronous fan-out.** The business transaction only inserts one `notification_events` row; pg-boss jobs resolve recipients, write the inbox, and deliver. |
| Push provider | **Expo Push Service** (`expo-server-sdk`), free; APNs and FCM credentials are uploaded to Expo once. No direct FCM/APNs client. |
| Manager / admin recipients | **Roles + scope.** A tenant rule lists roles per event type; recipients are active holders of those roles whose data scope can see the item. |
| Tenant rules (FR-15.09) | Per event type: enabled, push, email, direct-audience toggles, roles, and (due-soon only) lead time. Defaults live in code; a tenant row overrides them. |
| User control (B-12) | **Email opt-out only.** Push is muted with the phone's OS settings; the inbox always records. |
| Manual messages (FR-15.08) | **Users, teams and sites**, expanded to active users at send time and limited to the sender's data scope. New permission `notifications.send`. |
| Reminder lead time (FR-15.04) | **One tenant-wide value** on the due-soon rule: 15, 30 (default), 60 or 120 minutes. |
| "New checklist assigned" (FR-15.02) | **Both:** once when a user is added to an assignment (`checklist.assigned`) and each time an occurrence opens at `starts_at` (`checklist.available`, switchable). |
| Web freshness | **Polling** (TanStack Query, 30 s and on focus). No realtime transport. |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. The mobile app registers for Expo push and receives push for the event types in §3; tapping one opens its occurrence or task (FR-15.01).
2. Assignees are told about new assignments, newly available checklists, approaching due times and overdue checklists (FR-15.02, 15.04, 15.05).
3. Holders of the configured roles in scope are told about overdue and missed checklists and about problems, with critical problems separate (FR-15.06, 15.07, FR-13.04).
4. Task assignees and creators are told about assignment, submission, rejection, completion, overdue and cancellation (FR-15.03, FR-14.10).
5. A `notifications.send` holder sends a message to users, teams and sites in scope, and sees per-recipient delivery status (FR-15.08, NFR-11.02).
6. A `notifications.manage` holder edits the tenant's rules on the web (FR-15.09).
7. Every user has an inbox on mobile and web with unread counts and mark-read (FR-25.01).
8. Notification work never fails or slows a business transaction beyond one insert; deliveries store their status and are retried (NFR-11.01–03).

**Non-goals:**

- Quiet hours, digests, SMS, realtime web delivery
- Per-user, per-event, per-channel preferences (only email opt-out)
- Notification analytics and reports (SP7 may read the tables)
- Subscription-expiry notices (BR-01.07, SP9)
- Per-assignment reminder lead times
- Translations other than Azerbaijani

## 3. Event catalogue and rules

### 3.1 Event types

| Key | Fires when | Default audience | Default channels | Target |
|---|---|---|---|---|
| `checklist.assigned` | users are added to an assignment (create or update) | the added users | push | none |
| `checklist.available` | an occurrence reaches `starts_at` and is still `pending` | occurrence assignees | push | occurrence |
| `checklist.due_soon` | `due_at − lead` arrives and the occurrence is still `pending` | occurrence assignees | push | occurrence |
| `checklist.overdue` | `occurrence.status_changed` to `overdue` | assignees + Manager role | push | occurrence |
| `checklist.missed` | `occurrence.status_changed` to `missed` | Manager + Admin roles | in-app | occurrence |
| `problem.recorded` | a new `normal` problem row | Manager role | push | occurrence (execution tab) |
| `problem.critical` | a new `critical` problem row | Manager + Admin roles | push + email | occurrence (execution tab) |
| `task.assigned` | `task.assigned` (create and reassignment) | assignee user, or active members of the assignee team | push | task |
| `task.submitted` | `task.submitted` (awaiting review) | creator | push | task |
| `task.rejected` | `task.rejected` | assignee | push | task |
| `task.completed` | `task.completed` | creator | push | task |
| `task.overdue` | `task.overdue` | assignee + creator | push | task |
| `task.cancelled` | `task.cancelled` | assignee (or team members if not yet accepted) | push | task |
| `manual` | a `notifications.send` holder sends a message | chosen by the sender | in-app + push, email if ticked | none |

`task.accepted` is not notified. `manual` is not governed by rules.

The catalogue (keys, applicable direct audiences, defaults) lives in `packages/contracts/src/notifications.ts` as `NOTIFICATION_TYPES` and `DEFAULT_RULES`, shared by the API and web.

### 3.2 Rules

`notification_rules` holds at most one row per tenant and event type (§5). A missing row means the default. The effective rule is the default with the row's fields laid over it:

- `enabled` — off means no event is fanned out (the scan job also skips recording, §6.3).
- `push`, `email` — channels; in-app is implied by `enabled`.
- `notify_assignees`, `notify_creator` — direct audiences. Each type only exposes the ones that apply (checklist types: assignees; task types: assignees and/or creator; problem types: none).
- `role_ids` — roles whose holders in scope also receive it. Allowed on every type except `manual`.
- `lead_minutes` — `checklist.due_soon` only; one of 15, 30, 60, 120.

### 3.3 Recipient resolution

For one event the fan-out builds a recipient set:

1. **Direct audience** from the rule's toggles:
   - occurrence assignees: `occurrence_assignees.user_id`;
   - `checklist.assigned`: the event's `addedUserIds`;
   - task assignee: `assignee_user_id`, or, while it is null, active members of `assignee_team_id`;
   - task creator: `created_by_user_id`.
2. **Role audience**: active users holding any of `role_ids`, kept only if they can see the item:
   - checklist and problem events: the role grants `assignments.view` and `SchedulingScope` covers the occurrence (site subtree, subordinate chain, own, or all);
   - task events: the role grants `tasks.view` and `TaskScope.readable` passes.
3. **Filters**: only active users; the event's `actor_user_id` is removed; duplicates collapse to one notification per user.

Channels per recipient: in-app always; push to each of the user's active devices if `push`; email if `email`, the user has an email address and `users.email_notifications` is true.

### 3.4 Timing of `available` and `due_soon`

No status change happens at these moments, so a scan job (§6.3) finds them. Each event carries a `dedupe_key` (`checklist.available:<occurrenceId>`, `checklist.due_soon:<occurrenceId>`), so it fires at most once. Guards:

- `available` is only recorded when `starts_at` is within the last 15 minutes, so a restart or first deploy does not flood people with old openings.
- `due_soon` is skipped when `due_at − lead ≤ starts_at` (the window is shorter than the lead time); the `available` notice covers it.

## 4. Shared contracts (`packages/contracts/src/notifications.ts`)

Zod v4 schemas, exported from `src/index.ts`:

- `NotificationType` enum (§3.1) and `NOTIFICATION_TYPES` metadata: group (`checklist` | `problem` | `task`), applicable direct audiences, whether `lead_minutes` applies.
- `DEFAULT_RULES: Record<RuleType, Rule>`.
- `NotificationRule`, `UpdateNotificationRuleInput`.
- `NotificationItem` (`id`, `type`, `title`, `body`, `targetKind`, `targetId`, `targetDate`, `createdAt`, `readAt`), `NotificationPage` (cursor-paged).
- `RegisterPushDeviceInput` (`expoToken`, `platform: 'ios' | 'android'`).
- `UpdatePreferencesInput` (`emailNotifications`).
- `SendMessageInput` (`title` 1–80, `body` 1–500, `userIds`, `teamIds`, `siteIds`, `email: boolean`; at least one target), `MessagePreview` (`recipientCount`), `MessageSummary`, `MessageDetail` (recipients with per-channel status and error).
- `sync.ts`: `unreadNotifications: number` added to the `me/sync` response.
- `permissions.ts`: `notifications.manage`, `notifications.send`.
- `audit.ts`: actions `notification_rule.updated`, `notification_rule.reset`, `notification.message_sent`.

## 5. Data model

Migrations `0011_notifications.sql` (tables) and `0012_notifications_security.sql` (RLS, grants, permission seeding), following the existing pattern: `tenant_id` on every table, composite FKs on `(tenant_id, id)`, the `tenant_isolation` policy with FORCE RLS.

**`notification_events`** — one row per business event.

| Column | Notes |
|---|---|
| `id`, `tenant_id` | |
| `type` | text, a `NotificationType` |
| `payload` | jsonb, ids only (e.g. `{occurrenceId}`, `{taskId}`, `{assignmentId, addedUserIds}`, `{problemId, occurrenceId}`); for `manual`: `{title, body, userIds, teamIds, siteIds, email}` |
| `actor_user_id` | nullable |
| `dedupe_key` | nullable; unique on `(tenant_id, dedupe_key)` where not null |
| `created_at`, `processed_at` | `processed_at` null until fan-out finishes |
| `outcome` | nullable text: `fanned_out`, `disabled`, `no_recipients`, `target_gone` |
| `attempts`, `last_error` | fan-out bookkeeping |

Index on `(created_at) where processed_at is null` for the sweeper.

**`notifications`** — the inbox, one row per recipient.

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `event_id`, `user_id` | unique `(event_id, user_id)` |
| `type` | copy of the event type |
| `title`, `body` | rendered in Azerbaijani at fan-out; stable if names change later |
| `target_kind` | `occurrence` \| `task` \| `none` |
| `target_id`, `target_date` | `target_date` is the occurrence `local_date`, for the web schedule link |
| `created_at`, `read_at` | |

Indexes: `(tenant_id, user_id, created_at desc)`; `(tenant_id, user_id) where read_at is null`.

**`notification_deliveries`** — one row per channel target (NFR-11.02).

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `notification_id` | |
| `channel` | `push` \| `email` |
| `device_id` | push only |
| `status` | `queued` → `sent` → `delivered`, or `failed`, or `skipped` |
| `attempts`, `last_error`, `provider_ref` | `provider_ref` is the Expo ticket id |
| `created_at`, `sent_at`, `updated_at` | |

Index on `(status, sent_at) where channel = 'push' and status = 'sent'` for receipts; on `(status, created_at) where status = 'queued'` for the sweeper.

**`push_devices`**

| Column | Notes |
|---|---|
| `id`, `tenant_id`, `user_id` | |
| `expo_token` | **unique across all tenants** |
| `platform` | `ios` \| `android` |
| `created_at`, `last_seen_at`, `disabled_at` | |

**`notification_rules`**

| Column | Notes |
|---|---|
| `tenant_id`, `type` | primary key |
| `enabled`, `push`, `email`, `notify_assignees`, `notify_creator` | booleans |
| `role_ids` | uuid[] |
| `lead_minutes` | nullable int |
| `updated_at`, `updated_by` | |

Deleted role ids are dropped from `role_ids` when read and on the next save.

**`users.email_notifications`** — boolean, not null, default true.

**Permissions seeding:** `notifications.manage` → owner, admin; `notifications.send` → owner, admin, manager. Custom roles get them through the roles UI.

## 6. API (`apps/api/src/notifications/`)

A `NotificationsModule` that depends on the scheduling, tasks and users modules only through `DomainEvents`, scope services and the DB.

### 6.1 Pipeline

1. **Record — in the business transaction.** `NotificationEvents.record(type, payload, actorUserId, dedupeKey?)`:
   - inserts one `notification_events` row inside a savepoint with `ON CONFLICT DO NOTHING`;
   - on any error, rolls back to the savepoint, logs at error level and returns, so the business change still commits (NFR-11.01);
   - registers `db.afterCommit(() => jobs.send('notifications.fanout', { tenantId, eventId }))`.
2. **Listeners** (`notification-listeners.ts`) map domain events to `record` calls:
   - `occurrence.status_changed` with `to = overdue` / `missed` → `checklist.overdue` / `checklist.missed` (dedupe `checklist.overdue:<id>`, `checklist.missed:<id>`);
   - `assignment.assignees_changed` → `checklist.assigned`;
   - `problem.recorded` → `problem.recorded` or `problem.critical` by severity (dedupe `problem:<problemId>`);
   - `task.assigned`, `task.submitted`, `task.rejected`, `task.completed`, `task.overdue`, `task.cancelled` → the same keys (no dedupe; each transition is a new event).
3. **New domain events** added to `DomainEventMap`:
   - `assignment.assignees_changed { tenantId, assignmentId, addedUserIds, actorUserId }`, emitted by `AssignmentsService` on create and on updates that add assignees;
   - `problem.recorded { tenantId, problemId, occurrenceId, severity, actorUserId }`, emitted by `ProblemWriter.rewrite` for rows it **inserts** (not for re-saves of existing problems).
4. **Fan-out** — worker `notifications.fanout`, run in `db.withTenant(tenantId, null)`:
   - load the event; return if `processed_at` is set; increment `attempts` (on the 5th failure the error is stored in `last_error` and the job lands in `notifications.dead`);
   - merge the rule; if disabled, mark processed with `outcome = disabled`;
   - load the target (occurrence with checklist and site names, or task); if gone, `outcome = target_gone`;
   - resolve recipients (§3.3); if none, `outcome = no_recipients`;
   - render title and body (`notification-templates.ts`, next to `mail/templates.ts`);
   - insert `notifications` and `notification_deliveries` (`ON CONFLICT DO NOTHING`), set `processed_at`, `outcome = fanned_out`;
   - after commit, send `notifications.deliver` jobs: push deliveries in batches of ≤100, email deliveries one per job.
5. **Deliver** — worker `notifications.deliver`:
   - skips deliveries not `queued`, and marks `skipped` those whose user became inactive or whose device was disabled;
   - **push:** one Expo message per delivery with `title`, `body`, `sound: 'default'`, `channelId: 'default'`, `priority: 'high'` for `checklist.overdue`, `problem.critical` and `task.overdue`, `badge` = the user's unread count, `data = { notificationId, userId, targetKind, targetId }`; stores each ticket id in `provider_ref` and sets `sent`, or `failed` with the ticket error;
   - **email:** the existing `MAILER` with a plain-text template (subject = title, body + a link to the web target); sets `sent` or throws for retry;
   - each attempt increments `attempts` on the row; a failing attempt below 5 stores `last_error` and throws so pg-boss retries with backoff; the 5th failing attempt marks the row `failed` and returns without throwing (NFR-11.03).

### 6.2 Providers and configuration

- `PUSH_SENDER` token with `ExpoPushSender` (wraps `expo-server-sdk`, chunked sends, receipt fetch) and `FakePushSender` (records messages, returns ok tickets; used in tests and when `NOTIFICATIONS_PUSH_ENABLED=false`).
- Email goes through the existing `MAILER`: Mailpit locally, Resend SMTP in production.
- Config: `EXPO_ACCESS_TOKEN` (optional; enables Expo's enhanced security if set), `NOTIFICATIONS_PUSH_ENABLED` (default `true` in production, `false` in test).

### 6.3 Jobs

`JobsService` gains `defineWorker(queue, handler, opts)` and `send(queue, data)`, using the existing policy (retry with backoff) and a new dead-letter queue `notifications.dead`, logged at error level.

| Queue | Kind | Schedule | Work |
|---|---|---|---|
| `notifications.fanout` | worker | — | §6.1 step 4; `retryLimit: 5` |
| `notifications.deliver` | worker | — | §6.1 step 5; `retryLimit: 5`, backoff |
| `notifications.scan` | cron, per tenant | every minute | records `checklist.available` and `checklist.due_soon` (§3.4), only for enabled rules |
| `notifications.receipts` | cron | every 15 min | fetches Expo receipts for `sent` push rows older than 15 min: `ok` → `delivered`; `DeviceNotRegistered` → disable the device, `failed`; other errors → `failed` with the message |
| `notifications.sweep` | cron | every 5 min | re-sends `fanout` for events unprocessed after 2 min with `attempts < 5`, and `deliver` for deliveries `queued` for over 5 min with `attempts < 5` |
| `notifications.cleanup` | cron | nightly 04:15 UTC | deletes notifications (and their deliveries) and processed events older than 90 days; disables devices not seen for 180 days |

### 6.4 Endpoints

All under `/api/v1`, using the existing guards, tenant interceptor and zod validation.

**Current user** (any signed-in user):

| Method | Path | Notes |
|---|---|---|
| GET | `/me/notifications?cursor&unread` | newest first, 30 per page |
| GET | `/me/notifications/unread-count` | `{ count }` |
| POST | `/me/notifications/:id/read` | idempotent |
| POST | `/me/notifications/read-all` | marks all unread as read |
| PUT | `/me/push-devices` | `RegisterPushDeviceInput`; claims the token (below) |
| DELETE | `/me/push-devices/:token` | removes the caller's own device row |
| PATCH | `/me/preferences` | `{ emailNotifications }` |

`GET /me/sync` adds `unreadNotifications`.

**Token claim:** `PUT /me/push-devices` first deletes any row with the same `expo_token` that belongs to another user or tenant (through the platform pool, since RLS hides other tenants), then upserts the caller's row and sets `last_seen_at`. A shared phone therefore never receives the previous user's notifications.

**Rules** (`notifications.manage`):

| Method | Path | Notes |
|---|---|---|
| GET | `/notification-rules` | every rule type, effective values + `isDefault` |
| PUT | `/notification-rules/:type` | full rule; audited `notification_rule.updated` |
| DELETE | `/notification-rules/:type` | back to default; audited `notification_rule.reset` |

**Manual messages** (`notifications.send`):

| Method | Path | Notes |
|---|---|---|
| POST | `/notifications/messages/preview` | `SendMessageInput` → `{ recipientCount }` |
| POST | `/notifications/messages` | records a `manual` event (actor = sender); audited `notification.message_sent` |
| GET | `/notifications/messages` | the tenant's manual messages, newest first, with sent / delivered / failed counts; `notifications.manage` holders see all, other senders only their own |
| GET | `/notifications/messages/:id` | recipients with per-channel status and `last_error` |

Recipients of a manual message = selected users ∪ active members of selected active teams ∪ users attached to the selected sites or any site in their subtree, then filtered to active users within the sender's `ScopeService.usersFilter`, minus the sender. Picker options only offer users, teams and sites inside the sender's scope; ids outside it are refused with 403. A message may reach at most 1000 recipients; larger sends are refused with a validation error.

### 6.5 User lifecycle

The `user.access_changed` listener disables the user's push devices when the user is deactivated. Logout on mobile deletes the device (§7.2); the token claim covers a failed logout call.

### 6.6 Errors

| Case | Handling |
|---|---|
| `record` insert fails | logged and swallowed inside the savepoint; business change commits |
| Fan-out throws | pg-boss retries up to 5 times, then `notifications.dead`; `attempts` and `last_error` on the event |
| Target deleted / no recipients / rule disabled | event marked processed with the matching `outcome`; not an error |
| Expo HTTP failure for a batch | job throws and retries |
| Expo ticket error `DeviceNotRegistered` | device disabled, delivery `failed`, no retry |
| Expo ticket errors `InvalidCredentials`, `MessageTooBig` | delivery `failed`, logged at error level |
| Expo rate limit (429) | job throws; pg-boss backoff |
| SMTP temporary failure | job throws and retries |
| SMTP permanent (5xx) | delivery `failed` |
| Recipient inactive or device disabled at delivery | delivery `skipped` |

Bursts (many occurrences turning overdue in one sweep) produce one event per occurrence, deduplicated, with push sent in chunks of 100; this is enough at pilot scale.

## 7. Mobile app (`apps/mobile`)

### 7.1 Setup

- Add `expo-notifications` and `expo-device` (latest for Expo SDK 57) and the `expo-notifications` config plugin in `app.json`.
- Add `eas.json` (profiles `development`, `preview`, `production` as in the deployment spec) and the EAS `projectId` in `app.json` `extra.eas` (`eas init` on the free account).
- Create an Android notification channel `default` with high importance at startup.
- `Notifications.setNotificationHandler` shows banners, sound and list entries in the foreground.

### 7.2 Registration (`src/notifications/push-registration.ts`)

- After login and at each start while signed in: if `Device.isDevice`, request permission (once; respect a denial), get the Expo push token with the `projectId`, and call `PUT /me/push-devices`. Failures are logged and retried at the next start; they never block login.
- On logout, before the session is cleared: `DELETE /me/push-devices/:token`, best-effort with a short timeout.
- Simulators and denied permission skip registration silently.

### 7.3 Receiving and tapping (`src/notifications/notification-router.ts`)

- **Foreground receipt:** trigger a sync (`manual` trigger) so the unread count and any new work arrive.
- **Tap** (listener plus `getLastNotificationResponseAsync` for a cold start):
  - if `data.userId` is not the signed-in user → open the inbox only;
  - `occurrence` → run a sync, then open `/execution/[occurrenceId]` if the occurrence is in the local store; otherwise open the inbox;
  - `task` → open `/task/[id]`;
  - `none` → open the inbox.
- After each sync, set the app-icon badge with `setBadgeCountAsync(unreadNotifications)`. Clear it on logout.

### 7.4 Screens

- **Home header bell** with an unread badge (from the sync count) → new stack route `/notifications`.
- **Inbox screen** (`app/(app)/notifications.tsx`): online-only list from `GET /me/notifications`, pull to refresh, infinite scroll, unread rows bold, "Hamısını oxunmuş et". Tapping a row marks it read and opens its target as in §7.3. Offline, a short message says the list needs a connection.
- **Profile:** an email notifications switch (`PATCH /me/preferences`) and the push permission state; when denied, a button opens the OS settings.

## 8. Web app (`apps/web`)

- **Bell** in `src/layouts/app-shell.tsx`, left of the user name: unread badge from `GET /me/notifications/unread-count` (refetch every 30 s and on window focus). Clicking opens a popover with the 10 latest, "Hamısını oxunmuş et" and "Hamısına bax". A row marks itself read and navigates:
  - `occurrence` → `/schedule?date=<targetDate>&occurrence=<id>` (problem types add `&tab=execution`);
  - `task` → `/tasks?task=<id>`;
  - `none` → stays in the inbox.
- **`/notifications` page:** paged full inbox with an "unread only" filter.
- **Settings → "Bildirişlər" tab** (`notifications.manage`): the Settings page gains two tabs, "Təşkilat" (the existing organisation form) and "Bildirişlər". Rows grouped Checklist / Problem / Task. Each row has the enabled switch, push and email checkboxes, the applicable direct-audience toggles, a roles multi-select, and for due-soon a lead-time select. Each row saves on its own; "Defolta qaytar" deletes the override. A badge marks rows that differ from the default.
- **"Mesajlar" page** (new nav item, `notifications.send`):
  - compose: users, teams and sites pickers (scope-limited options), title, body, email checkbox; "Göndər" calls preview and opens a confirm dialog "N nəfərə göndəriləcək";
  - history table: date, sender, title, recipient count, sent / delivered / failed;
  - detail: each recipient with in-app read state and per-channel status and error.
- **User menu → "Bildiriş ayarları"** dialog with the email switch.
- **i18n:** strings in `packages/i18n/src/az/notifications.ts`, shared by web and mobile.

## 9. Testing

**API unit (Vitest):**
- rule merging over defaults, including deleted role ids and `lead_minutes` validation;
- recipient resolution: each direct audience, role + each scope type (`all`, `site_subtree`, `subordinates`, `own`), missing view permission, actor exclusion, deduplication, inactive users, team tasks before and after accept;
- templates for every type;
- manual recipient expansion: teams, site subtrees, scope filtering, 1000 cap.

**API integration (real Postgres):**
- a listener's event row commits with the business change; a forced `record` failure leaves the business change committed;
- `problem.recorded` fires for new problems only, not re-saves;
- `assignment.assignees_changed` fires on create and on added assignees only;
- fan-out writes inbox and delivery rows; outcomes `disabled`, `target_gone`, `no_recipients`;
- RLS isolation of all new tables;
- token claim across users and tenants;
- scan: `available` and `due_soon` fire once, respect the 15-minute guard and the short-window skip;
- deliver with `FakePushSender` and the test mailer: statuses, retries, `skipped`;
- receipts: `ok`, `DeviceNotRegistered`, other errors;
- sweeper re-enqueue and attempt cap; cleanup.

**Mobile (Jest):** registration (device vs simulator, permission granted/denied, failure does not block login), logout deregistration, tap routing including cold start and user mismatch, badge update after sync, inbox screen (online, offline, mark read, mark all), profile switch.

**Web (Vitest + Testing Library):** bell count and popover, navigation per target kind, `/notifications` page, rules table (edit, reset, lead time, roles), compose with preview and confirm, history and detail.

**End-to-end (Playwright):** an admin changes the `task.assigned` rule, sends a manual message to a team; a member signs in and sees both notifications in the bell and marks them read.

**Manual device checklist (for the user):** real push on iOS and Android development builds; foreground banner; tap from a closed app opens the occurrence and the task; logout stops push; switching users on one phone sends only to the new user; denied permission shows in Profile; a critical problem sends an email to Mailpit.

## 10. Implementation plans

Three plans, as in SP4 and SP5:

1. **`2026-10-13-notifications-1-api.md`** — contracts, migrations, `JobsService` extension, new domain events, pipeline, jobs, endpoints, audit. The first tasks (contracts, migrations, endpoints' shapes) unblock plans 2 and 3.
2. **`2026-10-13-notifications-2-mobile.md`** — Expo setup, registration, tap routing, badge, inbox, profile.
3. **`2026-10-13-notifications-3-web.md`** — bell, inbox page, rules tab, messages page, preferences dialog, e2e.

**Accounts needed from the user before the device checklist:** an APNs key from the Apple Developer account, a Firebase project with FCM (V1 service-account key), both uploaded to Expo, and `eas init` for the `projectId`.

## 11. Requirement traceability

| Requirement | Where |
|---|---|
| FR-15.01 | Expo push (§6.1, §6.2, §7) |
| FR-15.02 | `checklist.assigned`, `checklist.available` (§3.1, §3.4) |
| FR-15.03 | `task.assigned` (§3.1) |
| FR-15.04 | `checklist.due_soon`, tenant lead time (§3.2, §3.4) |
| FR-15.05 | `checklist.overdue` → assignees (§3.1) |
| FR-15.06 | `checklist.overdue` / `checklist.missed` → roles in scope (§3.1, §3.3) |
| FR-15.07, FR-13.04 | `problem.recorded`, `problem.critical` (§3.1, §6.1) |
| FR-15.08 | Manual messages (§6.4, §8) |
| FR-15.09 | `notification_rules`, settings tab (§3.2, §5, §8) |
| FR-14.10 | `task.completed` → creator (§3.1) |
| FR-25.01 | Mobile inbox (§7.4) |
| NFR-11.01 | Savepointed outbox insert, async fan-out and delivery (§6.1) |
| NFR-11.02 | `notification_deliveries`, message detail (§5, §8) |
| NFR-11.03 | pg-boss retries, sweeper, receipts (§6.3) |
| B-12 | Tenant rules, email opt-out, dedupe, actor exclusion (§3) |

## 12. Open items for later sub-projects

- SP7: notification volumes and delivery failure rates could feed an admin dashboard from `notification_deliveries`.
- SP8: corrections and audit events may add their own notification types to the catalogue.
- SP9: subscription-expiry notice (BR-01.07) as a new type; per-plan limits on manual messages.
- Later, if asked for: quiet hours, digests, per-event user preferences, realtime web delivery, SMS.
