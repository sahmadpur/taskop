# Taskop — Sub-project 4: Mobile Execution, Offline Sync & Evidence — Design Spec

- **Date:** 2026-10-09
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf` — FR-09.11–12, FR-10.01–15, FR-11.01–02 (remaining statuses), FR-12.01–08, FR-13.01–03/05, BR-11–13, NFR-06.04–05, NFR-08.04–05, NFR-10.01–02/04
- **Builds on:** `2026-10-07-foundation-design.md` (tenancy, RLS, auth, mobile login), `2026-10-08-checklist-builder-design.md` (checklist content, `visibleItems`/`requirements`/`computeScore`), `2026-10-09-scheduling-assignment-design.md` (occurrences, `canStart`, sweep, `/me/occurrences`), `2026-10-09-deployment-design.md` (SeaweedFS, `files.taskop.app`)

## 1. Context and decisions

Sub-project 3 creates occurrences ("Opening checklist, Baku branch 1, Tue 08:00–10:00, for Aysel and Murad"). Sub-project 4 lets a worker **execute** them on the phone: see their list, start one (which locks it for the other assignees), answer it with follow-ups, photo/video evidence and problem flags, and complete it — online or offline. Results sync to the server with the actual device times, and managers see them read-only on the web.

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| Problems | **Record only.** SP4 records problems (rule-flagged or manual, with note and media) and shows them. Owner, fix-by date and resolution (FR-13.07–09) move to SP5; notifying managers (FR-13.04) to SP6. |
| Offline architecture | **Local SQLite + command outbox.** Client-generated UUIDv7 IDs make every command idempotent. Data flows down (occurrences, checklist versions) and up (executions, media). No sync-engine library. |
| Claim conflict (NFR-06.05) | **First claim to reach the server wins.** Online starts claim immediately. An offline start is provisional; if someone else holds the claim when it syncs, the late execution is stored as `rejected` with all its answers and media (nothing lost) and does not count. |
| Device time (BR-11) | **Trusted within bounds.** Device start/complete times decide on-time, late, partial and missed. Server receipt times are stored beside them. Clock offset is measured at each sync; a skew > 5 min marks the execution `clock_suspect`. |
| Partial | **Automatic at window close.** An execution started but not completed by `closes_at` becomes `partial`; answers are kept and locked. No manual "finish incomplete". |
| Media limits | **Lean.** Photos resized on the phone to 1600 px long edge, JPEG quality 0.7. Video recorded at 720p, max 60 s, no extra compression library. Files kept indefinitely; retention per plan comes with SP9. |
| Upload host | **`files.taskop.app`** (its own subdomain, because S3 signatures cover the path). Locally the phone uses the Mac's LAN IP on port 8333. |
| Version pinning | The occurrence pins the checklist version current when it is **first downloaded or started**, so offline execution uses exactly the content the phone holds. |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A worker sees their occurrences on the phone, grouped as now / in progress / upcoming / done, with overdue ones marked (FR-10.01–02).
2. A worker can start an occurrence; for shared occurrences only one execution counts (FR-09.11, BR-13), and the executor is recorded (FR-09.12).
3. The worker answers all SP2 item types with follow-ups, evidence rules, live-only camera enforcement and manual problem flags, sees progress, and can complete only when requirements are met (FR-08.06, FR-10.03–08, FR-12, FR-13.01–03).
4. Everything in goal 3 works without a connection, survives an app kill, and syncs automatically when the connection returns, keeping device and server times separately (FR-10.09–15, BR-11, NFR-06.04, NFR-08.04–05).
5. Statuses `started`, `in_progress`, `completed` and `partial` are set with history rows (FR-11).
6. Photos and videos are stored privately in SeaweedFS, uploaded directly from the phone with presigned URLs, and only viewable through short-lived presigned GETs after a permission check (NFR-10.01–02, NFR-10.04).
7. Managers see an execution's answers, evidence, problems, times and flags in the web schedule drawer, and a read-only problems list.

**Non-goals:**

- Problem owner, due date, resolution workflow (SP5); alerts and push (SP6)
- Corrections to completed executions, audit statuses `audit_pending`/`audited` (SP8)
- Score reports and dashboards (SP7)
- Background sync while the app is closed; sync on app open/foreground only
- Web editing of executions; executing checklists on the web
- Retention policies per plan (SP9); video compression beyond camera quality settings

## 3. Statuses

SP3 already defines the full `occurrence_status` enum and sets `pending`, `overdue`, `missed`, `cancelled`. SP4 adds:

| Transition | Trigger |
|---|---|
| `pending | overdue → started` | A claim is accepted (§6.2). |
| `missed → started` | A claim from a late-synced offline execution whose device `startedAt < closes_at` (history `reason = 'late_sync'`). |
| `started → in_progress` | The first answers are stored. |
| `started | in_progress → completed` | Completion accepted with device `completedAt < closes_at`. |
| `started | in_progress → partial` | Sweep at `closes_at` (§6.5), or completion with `completedAt ≥ closes_at`. |
| `partial → completed` | A late-synced completion with device `completedAt < closes_at` (history `reason = 'late_sync'`). |

- **Late** is not a status: `executions.late = completedAt ≥ due_at` (or `startedAt ≥ due_at` while not completed).
- When a late-synced execution jumps several states at once, one history row is written per transition with the device time as `at`, as SP3 does for `pending → overdue → missed`.
- History rows written from client commands carry the executor as `actor_user_id`.
- `occurrence.status_changed` domain events are emitted for every transition, as in SP3.

## 4. Shared contracts (`packages/contracts`)

New file `packages/contracts/src/executions.ts` (Zod):

- **`Answer` extension:** an optional `problem?: { severity: 'normal' | 'critical', note: string (1–2,000), mediaIds: uuid[] (≤ 5) }` per item for manual problems (FR-13.01–03). Photo and video arrays already hold media IDs (SP2).
- **`ExecutionAnswersDoc`:** `Answers` limited to 1 MB serialised; keys must be item IDs of the pinned version.
- **Command schemas:** `ClaimCommand`, `SaveAnswersCommand`, `CompleteCommand`, `RegisterMediaCommand` (§6), each with `deviceTime` (ISO) and `clientOffsetMs` (int).
- **`deriveProblems(content, answers)`** returns `{ itemId, source: 'rule' | 'manual', severity, note?, mediaIds }[]` for visible items: rule problems from `computeScore` plus manual ones. Pure, shared by phone and API.
- **`progress(content, answers)`** returns `{ answered, total, requiredMissing }` over visible items (FR-10.07).
- **`MEDIA_LIMITS`:** photo long edge 1600, JPEG quality 0.7, photo ≤ 5 MB, video ≤ 60 s, ≤ 60 MB, 720p; allowed MIME types `image/jpeg`, `image/png` (gallery), `video/mp4`, `video/quicktime`.
- Sync response schema (`SyncResponse`, §6.1).

## 5. Data model

Foundation rules apply: UUIDv7 IDs, `timestamptz` in UTC, `tenant_id` leading indexes, RLS with `FORCE ROW LEVEL SECURITY`, composite FKs including `tenant_id`.

### 5.1 Changes to existing tables

- **`occurrences`:** add `checklist_version_id?` → `checklist_versions` (composite FK). Set once, at first download by an assignee or at claim, to `checklists.current_version_id`; never changed afterwards.

### 5.2 New tables

**`executions`**
- `id` (client-generated UUIDv7), `tenant_id`, `occurrence_id`, `checklist_version_id`, `executor_user_id`
- `state`: `active | completed | partial | rejected`; `rejected_reason?`: `ALREADY_CLAIMED | NOT_ASSIGNED | NOT_STARTABLE | NOT_YET_OPEN | CLOSED | NOT_ON_SHIFT`
- `started_at` (device, after bounds), `started_received_at` (server)
- `completed_at?` (device), `completed_received_at?` (server)
- `last_synced_at`
- `answers jsonb not null default '{}'`, `answers_rev int not null default 0`
- `progress jsonb` (`{answered, total, requiredMissing}`), `score jsonb?` (`computeScore` result)
- `late bool not null default false`
- `clock_offset_ms int?` (last reported), `clock_suspect bool not null default false`
- `device jsonb` (`{ platform, osVersion, appVersion }`)
- `created_at`, `updated_at`
- **Claim lock:** partial unique index `(occurrence_id) where state <> 'rejected'`. Index `(tenant_id, executor_user_id, started_at)`.

**`execution_media`**
- `id` (client-generated), `tenant_id`, `execution_id`, `item_id?` (null = attached only to a manual problem; the problem's item is in the answers), `kind`: `photo | video`, `source`: `camera | gallery`
- `mime`, `bytes`, `width?`, `height?`, `duration_ms?`
- `captured_at` (device), `captured_by_user_id` (FR-12.08)
- `storage_key` (`t/{tenantId}/e/{executionId}/{mediaId}.{ext}`)
- `status`: `pending | uploaded`, `uploaded_at?`, `created_at`
- Index `(tenant_id, execution_id)`, `(tenant_id, status, created_at)`.

**`execution_problems`**
- `id`, `tenant_id`, `execution_id`, `occurrence_id`, `site_id`, `checklist_id`, `item_id`
- `source`: `rule | manual`, `severity`: `normal | critical`, `note?`, `media_ids uuid[]`
- `created_at`, `updated_at`
- Unique `(execution_id, item_id, source)`. Rewritten from the answers on every accepted save and on completion; frozen once the execution leaves `active`. Not written for `rejected` executions. SP5 adds owner, due date and resolution columns.
- Index `(tenant_id, site_id, created_at)`, `(tenant_id, severity, created_at)`.

### 5.3 Migration

Adds the column, tables, RLS policies and grants (`taskop_app`: `SELECT, INSERT, UPDATE` on the three tables; no `DELETE`).

## 6. Sync protocol and API

All endpoints are under `/api/v1`, follow the Foundation conventions and run in the tenant transaction. Every upload command is idempotent: replaying it returns the stored result.

### 6.1 Download: `GET /me/sync?knownVersionIds=…`

Any authenticated user. Returns:

- `serverTime`
- `occurrences`: those whose snapshot includes the caller and whose window overlaps `[now − 1 day, now + 3 days]`, plus any whose execution by the caller is still `active`. Fields: id, checklist id and name, site id and name, shift name, `localDate`, `startsAt`, `dueAt`, `closesAt`, `status`, `checklistVersionId` (pinned now if null), `claim: { executionId, executorUserId, executorName } | null`.
- `checklistVersions`: the pinned versions the request did not list in `knownVersionIds` (content + version number).
- `executions`: the caller's executions in state `active`, and those finished in the last 24 h, with answers and `answers_rev` (lets a reinstall or a second phone resume).

`/me/occurrences` (SP3) stays for the web.

### 6.2 Claim: `POST /executions`

`{ id, occurrenceId, startedAt, deviceTime, clientOffsetMs, device }`

1. Replay of a known `id` → the stored result.
2. Bounds (§6.6) on `startedAt`.
3. If another execution already holds the claim → `ALREADY_CLAIMED`.
4. Otherwise `canStart(occurrenceId, me, startedAt)`, with `NOT_STARTABLE` relaxed for `missed` occurrences (a `startedAt ≥ closes_at` still fails as `CLOSED`).
5. Insert the execution as `active`, or as `rejected` with the reason from step 3 or 4. A unique violation on the claim lock (a concurrent claim won the race) → insert it as `rejected` with `ALREADY_CLAIMED`.
6. On success, transition the occurrence (§3) and pin its version if needed.

A rejection is a normal `200 { state: 'rejected', reason, claim }` response, not an error, so the outbox moves on. Rejected executions still accept answers and media (stored, never counted) so nothing the worker did is lost.

### 6.3 Answers: `PUT /executions/:id/answers`

`{ rev, answers, deviceTime, clientOffsetMs }`

- Caller must be the executor. `rev ≤ answers_rev` → `200` with the stored `rev` (stale, ignored).
- `active` executions: store answers, recompute `progress`, `score`, `execution_problems`; first save moves the occurrence to `in_progress`.
- `rejected` executions: store answers only. `completed`/`partial`: `409 EXECUTION_NOT_ACTIVE`.
- Answers are validated against the pinned version (unknown item IDs, wrong value types, media IDs that don't belong to this execution → `422 VALIDATION_FAILED`).

### 6.4 Completion: `POST /executions/:id/complete`

`{ rev, answers, completedAt, deviceTime, clientOffsetMs }`

- Saves the answers as in §6.3, then runs `requirements()` on the pinned version. Registered media count toward required evidence whether or not the upload has finished. Missing items → `422 REQUIREMENTS_UNMET { missing: Missing[] }`.
- `completedAt < closes_at` → execution `completed`, occurrence `completed`. Otherwise → `partial`.
- `late = completedAt ≥ due_at`. Final `score` and problems are frozen.
- On a `partial` execution (swept while the phone was offline) with `completedAt < closes_at`, the completion is accepted and revives it (§3).

### 6.5 Sweep

The existing per-minute `occurrences.sweep` adds: `started | in_progress → partial` where `closes_at ≤ now`, setting the execution to `partial`. A later completion may revive it (§6.4).

### 6.6 Device time bounds

- A device time later than server receipt + 2 min → `422 CLOCK_INVALID` (the phone shows "Telefonun saatını yoxlayın").
- `startedAt < starts_at − 5 min` → clamped to `starts_at`, `clock_suspect = true`.
- `|clientOffsetMs| > 5 min` on any command → `clock_suspect = true` (sticky).
- `clientOffsetMs` is the device clock minus `serverTime`, measured by the phone at its last successful `/me/sync`.

### 6.7 Media

- **`POST /executions/:id/media`** `{ id, itemId?, kind, source, mime, bytes, width?, height?, durationMs?, capturedAt }` → registers the row as `pending` and returns `{ uploadUrl, headers, expiresAt }`, a presigned PUT valid 15 min with `Content-Type` and `Content-Length` bound. Calling it again for the same `id` returns a fresh URL. Checks: caller is executor; `MEDIA_TYPE_INVALID`; `MEDIA_TOO_LARGE`; per-item `maxCount` and the 5-media cap on problems → `MEDIA_LIMIT_REACHED`; `source = 'gallery'` on a live-only item → `EVIDENCE_LIVE_ONLY`.
- **`POST /media/:id/uploaded`** → `HEAD` on the object; size and type must match the registration, else `422 MEDIA_NOT_FOUND_IN_STORAGE`. Sets `uploaded`.
- **`GET /media/:id/url`** → presigned GET valid 5 min. Allowed for the executor, and for users with `assignments.view` whose data scope covers the occurrence.
- Executions expose `mediaPending: number`.
- **`media.cleanup`** (pg-boss, daily): deletes storage objects for media still `pending` after 14 days and logs a warning. The rows stay, marked as never uploaded via `status = 'pending'`.

Live-only (FR-12.05–06) is enforced on the phone (camera only) and checked on the server through `source`. A modified client could lie about `source`; this is accepted as the limit of what a server can verify.

### 6.8 Web read endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /occurrences/:id` (extended) | assignments.view | Adds `execution` (the counted one) and `rejectedExecutions[]` summaries |
| `GET /executions/:id` | assignments.view, or executor | Answers, pinned version content, media list, problems, times, flags |
| `GET /problems` | assignments.view | Filters: `siteId`, `severity`, `checklistId`, `from`, `to` (≤ 92 days), `source`; cursor pagination; data scope applies via the occurrence |

### 6.9 Error codes

All codes are i18n keys: `REQUIREMENTS_UNMET`, `EXECUTION_NOT_ACTIVE`, `NOT_EXECUTOR`, `CLOCK_INVALID`, `MEDIA_TYPE_INVALID`, `MEDIA_TOO_LARGE`, `MEDIA_LIMIT_REACHED`, `MEDIA_NOT_FOUND_IN_STORAGE`, `EVIDENCE_LIVE_ONLY`, plus the claim rejection reasons in §5.2.

### 6.10 Audit

Client commands are not written to the audit log (status history and execution rows already record them). Media URL issuing is not audited. Rejected claims are logged at `info` with pino.

## 7. Mobile app

### 7.1 Dependencies

Expo SDK 57 modules, used through development builds (not Expo Go): `expo-sqlite` (with SQLCipher via its config plugin), `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-network`, `expo-video`. The SQLCipher key is random per install and kept in SecureStore (FR-10.10).

### 7.2 Offline layer (`apps/mobile/src/offline/`)

- **`db.ts`:** schema and forward-only migrations for `occurrences`, `checklist_versions`, `executions`, `media`, `outbox`, `meta` (clock offset, last sync time, user id). Data is scoped to the signed-in user; signing in as someone else clears it.
- **`execution-store.ts`:** start, answer, attach media, flag problem, complete. Every action writes SQLite and appends an outbox command in one SQLite transaction. Uses `visibleItems`, `requirements`, `computeScore`, `progress`, `deriveProblems` from contracts.
- **`sync-engine.ts`:**
  - Runs on app start, on reconnect, on returning to the foreground, every 30 s while online, and 2 s after a local write.
  - Sends the outbox oldest first. A network error or 5xx stops the run with exponential backoff (5 s → 5 min). A 4xx marks that command `failed`, keeps it visible on the sync screen and moves on; a `failed` answers command is superseded by the next one for the same execution.
  - Answer commands for the same execution are collapsed so only the latest `rev` is sent.
  - Then pulls `/me/sync`, updates the local occurrences and claims, and records `clientOffsetMs`.
  - If a claim comes back `rejected`, the execution is marked rejected locally and the worker sees "Bu checklist artıq {name} tərəfindən icra olunur".
- **`media-queue.ts`:** registers, uploads and confirms one file at a time, photos before videos; it resumes after an app kill. A local file is deleted only after `uploaded` and 7 days after its execution has finished syncing.

### 7.3 Screens

1. **My checklists** (replaces the placeholder home): sections *İndi* (open, overdue in red), *Davam edən*, *Gələcək* (read-only until the window opens), *Bitmiş* (today). Cards show checklist, site, window, late badge, claim badge ("Murad icra edir"). The home stat tiles get real counts.
2. **Execution:** one scrolling screen per section with a progress bar; inputs for every SP2 item type; follow-ups appear inline; evidence chips (camera-only when live-only); a ⚑ "Problem qeyd et" sheet per item (severity, note, photo/video). Autosaves on every change.
3. **Finish:** missing-requirements list (tap to jump), score preview, "Tamamla".
4. **Sync status:** a header indicator — green (all synced), amber "N gözləyir" (offline or pending), red (failed) — opening the queue with "Yenidən cəhd et" (FR-10.15).

### 7.4 Rules on the phone

- Start is offered when the local check passes: window open by device time, I am an assignee, no known claim by someone else. The shift check runs on the server.
- When the device clock passes `closes_at`, an open execution locks and shows as partial.
- Logout with unsynced data shows a blocking warning; local data is deleted only after a second confirmation.
- No background sync while the app is closed.
- Clients refuse a checklist `schemaVersion` newer than they understand (SP2 §3.2) and show "Tətbiqi yeniləyin".

## 8. Web app

- **Schedule drawer (SP3) — new "İcra" tab:**
  - executor, started and completed (device time; server receipt shown beneath when they differ by > 1 min), late / partial / clock-suspect badges, score and progress, `mediaPending`
  - answers rendered in the pinned version's layout (visible items, follow-ups indented), problems highlighted, media thumbnails with a lightbox and video player
  - a collapsed "Rədd edilmiş icralar" section for rejected executions
- **Problems page** (`/problems`, needs `assignments.view`): filters for site, severity, date range, checklist and source; each row links to the occurrence drawer. Read-only.
- Schedule list: badges for the new statuses, score and progress columns.

## 9. Storage and infrastructure

- `docker-compose.yml`: replace `minio` with SeaweedFS (`chrislusf/seaweedfs`, `weed server -s3`, S3 on port 8333, a named volume) and a one-off init container that creates the private bucket `taskop-media`.
- API `S3Service` (AWS SDK v3), configured only by `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`. Server-side calls (HEAD, DELETE) use `S3_ENDPOINT`; presigned URLs are signed against `S3_PUBLIC_ENDPOINT`.
- Local: `S3_PUBLIC_ENDPOINT=http://<mac-lan-ip>:8333`; the mobile `.env` gets `EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:3000`.
- Deployment plan update (doc only): `files.taskop.app` block in the Caddyfile (`reverse_proxy seaweedfs:8333`, preserving `Host`), §8 questions answered with this spec's limits, §13 items 2 and 3 closed.

## 10. Testing

- **Contracts (Vitest):** command and answer schemas; `deriveProblems` and `progress` table tests (rule + manual problems, hidden items excluded).
- **API integration (Vitest + Testcontainers, with a SeaweedFS container):**
  - Claims: two concurrent claims → exactly one `active`; a later offline claim → `rejected` with answers still stored; idempotent replay; every `canStart` reason; `missed` revived by a late sync with correct history rows.
  - Time bounds: `CLOCK_INVALID`, clamping, `clock_suspect`.
  - Answers: stale `rev` ignored; `in_progress` on first save; validation against the pinned version; problems rewritten.
  - Completion: `REQUIREMENTS_UNMET`; late; `completedAt ≥ closes_at` → partial; partial revived.
  - Sweep: unfinished execution → `partial`.
  - Media: register → presigned PUT → confirm; type, size, count and live-only checks; `MEDIA_NOT_FOUND_IN_STORAGE`; GET URL only for executor or in-scope viewers; cleanup job.
  - Tenant isolation and scope suites extended to every new endpoint; a worker cannot read another worker's execution.
- **Mobile (Jest):** sync engine with a fake API (ordering, backoff, 4xx parking, collapsing answer commands, rejected claim handling); DB migrations; media queue resume after restart; execution screen with follow-ups; finish screen missing list; sync indicator states.
- **Web (Vitest + Testing Library):** execution tab including rejected executions and media; problems list filters.
- **Playwright end-to-end:** seed an occurrence, claim, answer with a problem and complete through the API (standing in for the phone), then check the schedule drawer's execution tab and the problems list.
- **Manual device checklist** (run on a development build on a real phone): execute in airplane mode and sync later; live-only items refuse the gallery; kill the app mid-upload and confirm it resumes; two phones claim the same shared occurrence offline and the loser sees the rejection.

## 11. Requirement traceability

| Requirement | Where |
|---|---|
| FR-09.11 / BR-13 | Claim lock (§5.2, §6.2) |
| FR-09.12 | `executor_user_id` (§5.2) |
| FR-09.10 / BR-12 | `canStart` `NOT_ON_SHIFT` at claim (§6.2) |
| FR-10.01–02 | My checklists screen (§7.3) |
| FR-10.03–06 | Claim, answers, device + server times (§6.2–6.4) |
| FR-10.07 | `progress` (§4, §7.3) |
| FR-10.08 | Automatic status on completion (§3, §6.4) |
| FR-10.09–12 | Offline layer (§7.2) |
| FR-10.13–14 / BR-11 | Device and received times stored separately; device time decides status (§5.2, §6.6) |
| FR-10.15 | Sync indicator (§7.3) |
| FR-11.01–02 | `started`, `in_progress`, `completed`, `partial` with history (§3) |
| FR-12.01–04 | Photo/video answers and evidence rules (§6.7, §7.3) |
| FR-12.05–06 | Live-only camera and `source` check (§6.7) |
| FR-12.07–08 | `execution_media` with `captured_at`, `captured_by_user_id` (§5.2) |
| FR-13.01–03, 13.05 | Manual and rule problems (§4, §5.2, §8) |
| FR-13.04, 13.07–09 | Deferred to SP6 and SP5 |
| NFR-06.04 | Outbox, idempotent commands, rejected executions kept (§6, §7.2) |
| NFR-06.05 | First claim to reach the server wins (§1, §6.2) |
| NFR-08.04–05 | Offline execution, automatic sync (§7.2) |
| NFR-10.01–02 | Private bucket, presigned URLs after permission checks (§6.7, §9) |
| NFR-10.04 | Photo resize, 720p/60 s video (§1, §4) |

## 12. Open items for later sub-projects

- SP5: owner, due date and resolution on `execution_problems` (FR-13.07–09), probably by turning a problem into a task.
- SP6: listeners for `occurrence.status_changed` and new problems (FR-13.04, FR-15.x).
- SP7: score and problem reports from `executions.score` and `execution_problems`.
- SP8: corrections to completed executions and the audit statuses.
- SP9: media retention per plan (NFR-10.03); disk-usage alert is part of the deployment plan.
- Later: background sync when the app is closed, if workers report unsynced data piling up.
