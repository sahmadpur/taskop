# Taskop Mobile Execution — Part 1: Contracts, Storage & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let workers start, answer and complete occurrences from the phone (online or offline, with photo/video evidence and problem flags), and let managers read the results, by adding execution contracts, i18n strings, the `@taskop/api-client` methods, the executions/media/problems tables, SeaweedFS storage behind an `S3Service`, and every API endpoint of the sub-project 4 spec §6.

**Architecture:**
- **Pure execution logic** lives in `@taskop/contracts` so the phone and the API compute the same thing: `progress`, `deriveProblems`, `answerIssues` and `mediaLimitFor`, next to the command schemas, the read models and `MEDIA_LIMITS`.
- **One new NestJS module, `executions`**, imports `SchedulingModule`. Scheduling never imports the executions module; it only reads the `executions` table, through the pure row mappers in `executions/mappers.ts`.
  - `ExecutionsService` handles the three upload commands (claim, answers, complete). Every command is idempotent through client-generated UUIDv7 IDs.
  - `MediaService` registers media, issues presigned URLs and confirms uploads. `MediaJobs` runs the daily `media.cleanup`.
  - `SyncService` builds `GET /me/sync`. `ExecutionQueries` and `ProblemsService` serve the web reads.
  - `ExecutionAccess` decides who may read an execution: its executor, or a user with `assignments.view` whose data scope covers the occurrence.
- **Scheduling stays the owner of occurrences.** `OccurrenceWriter` gains `pinVersions` and `applyTransitions`. `EligibilityService.canStart` gains `allowMissed`. The per-minute sweep also moves `started | in_progress → partial`. `JobsService` gains `define()` so other modules can add pg-boss jobs.
- **Lock order** for every command that touches an occurrence: the occurrence row first (`FOR UPDATE`), then the execution row. The sweep uses `FOR UPDATE SKIP LOCKED` on occurrences, so it never blocks a command and never double-moves a row.
- **Storage:** SeaweedFS replaces MinIO in `docker-compose.yml`. A global `S3Service` (AWS SDK v3) runs HEAD and DELETE against `S3_ENDPOINT` and signs URLs against `S3_PUBLIC_ENDPOINT`.

**Tech Stack:** Node 24, TypeScript 7, NestJS 12, nestjs-zod 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18, pg-boss 12, **`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`** (new), **SeaweedFS** (`chrislusf/seaweedfs`, new), Vitest 5, Testcontainers (Postgres, plus **`testcontainers`** for SeaweedFS, new), supertest.

**Spec:** `docs/superpowers/specs/2026-10-09-mobile-execution-design.md`

**This plan is Part 1 of 3:**
- Part 1 (this file): contracts, i18n strings for errors, states, reasons, issues and flags, the API client, storage, DB, API, seed.
- Part 2 (`apps/mobile`) and Part 3 (`apps/web`) are written against the section **Interfaces for Parts 2 and 3** below. They can start once **Tasks 1–5** are merged into the feature branch: those tasks need nothing from the API and give both apps every type, schema, pure function, i18n key and client method. Parts 2 and 3 need Tasks 6–17 merged before their integration and end-to-end tests run against a real API.

**Deployment plan note (not a task).** `docs/superpowers/specs/2026-10-09-deployment-design.md` exists only on `origin/claude/remaining-phases-72a9e6` (PR #2), not in this worktree. Whoever merges PR #2 after this sub-project applies these doc-only edits there:
- §5 "Presigned photo and video uploads": replace "e.g. `files.taskop.app` (exact routing decided in sub-project 4; signed URLs include the host name)" with "on `files.taskop.app`. The Caddyfile gets `files.taskop.app { reverse_proxy seaweedfs:8333 }`. Caddy's `reverse_proxy` keeps the original `Host` header by default, which S3 signatures need; do not add `header_up Host`."
- §7: replace the `S3_*` row's value "added in sub-project 4" with `S3_ENDPOINT=http://seaweedfs:8333`, `S3_PUBLIC_ENDPOINT=https://files.taskop.app`, `S3_BUCKET=taskop-media`, `S3_ACCESS_KEY` / `S3_SECRET_KEY` (random, 32+ characters, also written into the server's `s3.json`), `S3_FORCE_PATH_STYLE=true`.
- §8 "Questions for sub-project 4's design": replace the four bullets with the answers: videos 720p, at most 60 s and 60 MB, no compression beyond camera settings; photos resized to 1600 px long edge, JPEG quality 0.7, at most 5 MB; files kept indefinitely until SP9 (retention per plan); media never uploaded is deleted from storage after 14 days (`media.cleanup`); the disk-usage alert stays in §10.
- §13: mark items 2 and 3 as closed ("answered in the sub-project 4 spec §1 and §9").
- §14: in the DNS checkbox, change "(and `files.taskop.app` if chosen)" to "and `files.taskop.app`".

## Global Constraints

- The product name is **Taskop**. Packages are `@taskop/*`. Azerbaijani (`az`) is the only locale.
- Install new packages with `pnpm add <pkg>@latest`. This part adds exactly three: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (dependencies of `apps/api`), and `testcontainers` (dev dependency of `apps/api`). Nothing S3-related exists yet; `apps/api/package.json` has no `@aws-sdk/*` or `minio` package.
- IDs:
  - `executions.id` and `execution_media.id` are **client-generated UUIDv7** and have no database default.
  - `execution_problems.id` is server-generated (UUIDv7 default).
- Every new table has `tenant_id uuid not null`, RLS `FORCE`d with the usual `nullif(current_setting('app.tenant_id', true), '')::uuid` policy, and composite `(tenant_id, x_id)` foreign keys.
- Grants:
  - `taskop_app` and `taskop_platform` get `SELECT, INSERT, UPDATE` on `executions` and `execution_media`, and no `DELETE`.
  - `execution_problems` also gets `DELETE`, because its rows are derived from the answers and rewritten while the execution is active (see Spec decisions below).
- Limits (spec §1, §4, §6), exactly:
  - Answers document: ≤ 1,000,000 bytes serialised (UTF-8 JSON). Problem note: 1–2,000 characters. Manual problem media: ≤ 5. Evidence photos (or videos) on a non-media item: ≤ 5.
  - Media:
    - Photo: long edge 1600 px, JPEG quality 0.7, ≤ 5 MB (5,242,880 bytes).
    - Video: 720p (short edge ≤ 720), ≤ 60 s, ≤ 60 MB (62,914,560 bytes).
    - MIME types: `image/jpeg`, `image/png` (photo), `video/mp4`, `video/quicktime` (video).
  - Presigned PUT valid **15 min** (900 s) with `Content-Type` and `Content-Length` signed. Presigned GET valid **5 min** (300 s).
  - Pending media: storage object deleted by `media.cleanup` after **14 days**.
  - Device time:
    - A device time later than server receipt + **2 min** → `422 CLOCK_INVALID`.
    - A clock offset with `|clientOffsetMs| > 5 min` → `clock_suspect` (sticky).
    - Early start: `startedAt < starts_at` while the server receipt is at or after `starts_at` → clamped to `starts_at`. More than **5 min** early also sets `clock_suspect`.
    - `clientOffsetMs` is an integer within ±2,000,000,000.
  - Sync window: occurrences whose window overlaps `[now − 1 day, now + 3 days]`. Finished executions are returned for **24 h**.
  - Problems list range: ≤ **92 days**.
- Storage keys: `t/{tenantId}/e/{executionId}/{mediaId}.{ext}`, where `ext` is `jpg | png | mp4 | mov`. Bucket `taskop-media`, private.
- Every error body is `{ error: { code, messageKey, fields, retryAfterSeconds, requestId, issues?, currentRevision?, userIds?, missing? } }`.
- New error codes and HTTP statuses:
  - `REQUIREMENTS_UNMET` 422 (with `missing`)
  - `EXECUTION_NOT_ACTIVE` 409
  - `NOT_EXECUTOR` 403
  - `CLOCK_INVALID` 422
  - `MEDIA_TYPE_INVALID` 422
  - `MEDIA_TOO_LARGE` 422
  - `MEDIA_LIMIT_REACHED` 422
  - `MEDIA_NOT_FOUND_IN_STORAGE` 422
  - `EVIDENCE_LIVE_ONLY` 422
  - Answer validation uses the existing `VALIDATION_FAILED`, which is **400** in this codebase (the spec says 422; the existing mapping wins), with `issues`.
- **A claim rejection is not an error:** `POST /executions` always answers `200` with `state: 'rejected'` and a `reason` from `ALREADY_CLAIMED | NOT_ASSIGNED | NOT_STARTABLE | NOT_YET_OPEN | CLOSED | NOT_ON_SHIFT`.
- Every occurrence status change writes one `occurrence_status_history` row per transition, at the **device** time, in the same transaction, and emits `occurrence.status_changed`. Rows from client commands carry the executor as `actor_user_id`. Late syncs carry `reason = 'late_sync'` (`missed → started`, `partial → completed`).
- Client commands, media URL issuing and rejected claims are **not** written to `audit_log`. Rejected claims are logged at `info`.
- No permission keys are added. Reads use `assignments.view` within the data scope, or being the executor.
- S3 signatures always use the real time (`Date.now()`), never the injectable `Clock`: storage checks them against its own clock.
- No test sleeps to wait for wall-clock time. Use `FakeClock`. Only the pg-boss wiring tests poll, with a timeout.
- Tests that need SeaweedFS live only in `apps/api/test/storage.test.ts` and `apps/api/test/executions-storage.test.ts`. Each starts its own container in `beforeAll`. Every other test uses dummy `S3_*` values: presigning works offline, and nothing else calls storage.

### Spec decisions this plan makes (ambiguities resolved)

1. **Media is registered through the outbox before any answers that reference it.** `RegisterMediaCommand` is an outbox command (spec §4). The phone sends it before the answers or complete command that lists the media ID. The media queue only uploads and confirms; it calls register again only to get a fresh URL. An answer that references an unregistered media ID is a `400 VALIDATION_FAILED` with issue `executions.issues.unknownMedia`.
2. **Stale revisions are checked before state.** A `PUT /answers` with `rev ≤ answers_rev` returns `200 { stale: true }` even after completion. Only a newer `rev` on a `completed` (or late-completed `partial`) execution is `409 EXECUTION_NOT_ACTIVE`.
3. **A swept `partial` execution (no `completed_at`) still accepts answers whose `deviceTime < closes_at`.** They were captured inside the window and arrived late. They update answers, progress, score and problems; the state stays `partial`. Answers with `deviceTime ≥ closes_at` are `409`. This matches the spec's revival rule for completions.
4. **Early start.** The spec says "`startedAt < starts_at − 5 min` → clamped, suspect", but leaves 0–5 min early undefined. This plan clamps any early `startedAt` to `starts_at` when the server has already seen the window open, and sets `clock_suspect` only when it is more than 5 min early. If the server receipt is itself before `starts_at`, nothing is clamped and `canStart` answers `NOT_YET_OPEN`.
5. **Problem media cap at registration.** A medium with `itemId: null` (problem-only) cannot be tied to one problem when it is registered. Registration therefore caps null-item media per execution at `5 × item count of the pinned version`. The exact "≤ 5 per manual problem" is enforced by `answerSchema` (`problem.mediaIds.max(5)`).
6. **Evidence media cap on non-media items** is `MEDIA_LIMITS.evidencePerItem = 5` per kind. It applies only when the item allows that evidence: `evidence.photo|video !== 'none'`, or a rule that requires it. Otherwise the limit is 0 and registration answers `MEDIA_LIMIT_REACHED`.
7. **`execution_problems` may be deleted by the app account.** The spec says "no DELETE" on the three tables, but also "rewritten from the answers on every accepted save". Rows are upserted on `(execution_id, item_id, source)`, which keeps `id` and `created_at` stable, and vanished ones are deleted. `executions` and `execution_media` stay without `DELETE`.
8. **`execution_media.storage_purged_at`** (new nullable column) records that `media.cleanup` deleted the object. This way the daily job never retries the same rows, and the row itself stays `pending` as the spec says. A later successful confirm clears it.
9. **`progress().requiredMissing`** is `requirements(content, answers).length`, so it counts every completion blocker: missing answers, evidence, notes and media counts.
10. **`DerivedProblem.note`** is `string | null` (not optional), to match the nullable DB column.
11. **A completion from `started` goes straight to `completed`** (or `partial`), which the spec's `started | in_progress → completed` allows. Only `PUT /answers` writes `started → in_progress`.
12. **A failed completion stores nothing.** `REQUIREMENTS_UNMET` rolls the transaction back, including the answers sent with it. The phone keeps its local answers, and the earlier answers commands already stored them.
13. **The occurrence list gains `executionBrief`** (executor name, state, progress, score percent, late, clock suspect) so the web schedule list can show the spec §8 badges and columns. The detail gains `execution` and `rejectedExecutions` (spec §6.8).
14. **The sync list leaves out `cancelled` occurrences.** An occurrence missing from a sync was cancelled or reassigned. The phone keeps local occurrences that still have unsynced local executions.
15. **The new read endpoints are tenant-only.** `GET /executions/:id`, `GET /problems` and `GET /media/:id/url` have no platform-admin variant in this sub-project; it is recorded as a follow-up. The occurrence detail's `execution` summaries reach platform admins through the existing platform routes.

## Review Focus

These are the five input classes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **A claim replayed after the server already rejected it.** The outbox retries a claim whose response was lost. Meanwhile the winner's claim was released by support. The replay must return the stored rejection and must not re-evaluate it, insert a second row or move the occurrence. Pinned in Task 9 (`a claim replayed after the server rejected it returns the stored rejection`).
2. **A completion arriving before its earlier answers command.** An answers command fails on a network blip, and the completion (which carries the full answers) syncs first. The older answers command must then be ignored as stale, not refused with `409`, which would park it red on the sync screen. Pinned in Task 12 (`a stale answers command arriving after completion is ignored, not refused`).
3. **Media confirm called before the PUT finished.** `POST /media/:id/uploaded` races the upload. It must answer `MEDIA_NOT_FOUND_IN_STORAGE`, keep the row `pending`, and succeed when retried after the PUT. Pinned in Task 15 (`confirming before the PUT finished is refused and can be retried`).
4. **A worker removed from the snapshot after starting.** A manager unlinks the worker from the site mid-execution. The executor must still save, complete and see the occurrence in `/me/sync`. Pinned in Task 12 (`a worker removed from the snapshot after starting can still answer and complete`) and Task 14 (`keeps an active execution in sync after the worker leaves the snapshot`).
5. **The sweep racing a completion at `closes_at`.** The phone completes at 10:59:59 offline. The sweep moves the execution to `partial` at 11:00, and the completion arrives at 11:30. It must revive the execution to `completed` with a `late_sync` history row. A completion at exactly `closes_at` must stay `partial`. Pinned in Task 13 (`a completion just before closes_at revives an execution the sweep made partial`, `a completion at exactly closes_at stays partial`).

---

## File Structure

```
docker-compose.yml                         minio → seaweedfs + seaweedfs-init (bucket taskop-media)
docker/seaweedfs/s3.json                   local S3 identity (dev credentials)
README.md                                  storage note
.github/workflows/ci.yml                   + S3_* env for the e2e job's API
packages/contracts/src/
  checklist-logic.ts                       + ManualProblem, Answer.problem
  execution-logic.ts                       states, rejection reasons, problem sources, missing/progress/score schemas,
                                           progress(), deriveProblems()
  execution-logic.test.ts
  executions.ts                            MEDIA_LIMITS, EXECUTION_LIMITS, issue codes, answer schemas, evidenceAllows,
                                           mediaLimitFor, answerIssues, command + result schemas
  executions.test.ts
  execution-summary.ts                     executionBriefSchema, executionSummarySchema (imported by occurrences.ts)
  execution-views.ts                       sync query/response, execution detail, media DTO, problems list
  execution-views.test.ts
  occurrences.ts                           + executionBrief, + execution / rejectedExecutions on the detail
  errors.ts                                + 9 codes, + missing on the error body
  index.ts                                 + exports
packages/i18n/src/az/
  executions.ts                            states, claimRejections, issues, sources, severities, flags, media labels
  errors.ts, index.ts, ../i18n.test.ts
packages/api-client/src/
  endpoints.ts                             + createExecutionsApi (sync, executions, media, problems)
  errors.ts, client.ts                     + ApiError.missing
  client.test.ts
apps/api/
  package.json                             + @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, testcontainers (dev)
  .env.example                             + S3_*
  drizzle/0007_executions.sql              (generated)
  drizzle/0008_executions_security.sql     (custom: RLS, grants)
  src/config/config.ts (+ config.test.ts)  + S3_* keys
  src/storage/s3.service.ts, storage.module.ts
  src/db/schema.ts                         + 7 enums, occurrences.checklist_version_id, 3 tables
  src/common/app-error.ts                  + details.missing
  src/common/error.filter.ts               + executions.* field keys
  src/scheduling/
    occurrence-writer.ts                   + pinVersions, applyTransitions
    eligibility.service.ts                 + allowMissed
    occurrence-jobs.ts                     + sweepOpenExecutions (started | in_progress → partial)
    jobs.service.ts                        + define(), runNow(any defined queue)
    occurrence-executions.ts               execution summaries for the occurrence detail
    occurrence-queries.ts, mappers.ts      + executionBrief
    occurrences.service.ts                 + execution, rejectedExecutions
    scheduling.module.ts                   + exports
  src/executions/
    device-time.ts (+ device-time.test.ts) assertDeviceTimes, clampStart
    execution-lookups.ts                   pinned content, claim holders, media kinds
    execution-access.ts                    executor or assignments.view in scope
    problem-writer.ts                      upsert/delete execution_problems from answers
    mappers.ts                             row → DTO
    dto.ts
    executions.service.ts                  claim, saveAnswers, complete
    executions.controller.ts               POST /executions, PUT /:id/answers, POST /:id/complete, POST /:id/media, GET /:id
    media.service.ts, media.controller.ts  register, confirm, view URL
    media-jobs.ts                          media.cleanup
    sync.service.ts, sync.controller.ts    GET /me/sync
    execution-queries.ts                   GET /executions/:id
    problems.service.ts, problems.controller.ts  GET /problems
    executions.module.ts
  src/app.module.ts                        + StorageModule, ExecutionsModule
  src/db/scripts/seed.ts                   + demo partial execution with two problems
  test/app.ts                              + dummy S3_* in testEnv
  test/seaweedfs.ts                        SeaweedFS Testcontainer + bucket
  test/execution-fixtures.ts
  test/storage.test.ts, executions-db.test.ts, occurrence-writer.test.ts, executions-claim.test.ts,
  executions-media.test.ts, executions-answers.test.ts, executions-complete.test.ts, executions-sweep.test.ts,
  executions-sync.test.ts, executions-storage.test.ts, executions-read.test.ts, executions-scope.test.ts,
  executions-isolation.test.ts, seed-demo.test.ts, openapi.test.ts (extended)
apps/web/src/features/scheduling/
  schedule-page.test.tsx, assignment-pages.test.tsx   fixtures gain executionBrief / execution fields
docs/superpowers/execution-follow-ups.md
```

---
## Interfaces for Parts 2 and 3

Everything below is exported from `@taskop/contracts`, `@taskop/i18n` or `@taskop/api-client` once **Tasks 1–5** are merged. Parts 2 and 3 import these names exactly. All instants are ISO-8601 UTC strings; local dates are `YYYY-MM-DD`.

### `@taskop/contracts`

**Execution logic** (`execution-logic.ts`, Task 1):
- `EXECUTION_STATES = ['active', 'completed', 'partial', 'rejected']`, `executionStateSchema`, `type ExecutionState`
- `CLAIM_REJECTION_REASONS = ['ALREADY_CLAIMED', 'NOT_ASSIGNED', 'NOT_STARTABLE', 'NOT_YET_OPEN', 'CLOSED', 'NOT_ON_SHIFT']`, `claimRejectionReasonSchema`, `type ClaimRejectionReason`
- `PROBLEM_SOURCES = ['rule', 'manual']`, `problemSourceSchema`, `type ProblemSource`, `problemSeveritySchema` (over the existing `PROBLEM_SEVERITIES`)
- `MISSING_KINDS`, `missingSchema` (`{ itemId, kind }`, the existing `Missing` type)
- `progressSchema`, `type ExecutionProgress = { answered: number; total: number; requiredMissing: number }`
- `scoreSchema` (the existing `ScoreResult` shape)
- `interface DerivedProblem { itemId: string; source: ProblemSource; severity: ProblemSeverity; note: string | null; mediaIds: string[] }`
- `progress(content: ChecklistContent, answers: Answers): ExecutionProgress`
  - Covers visible items only. `requiredMissing = requirements(content, answers).length`.
- `deriveProblems(content: ChecklistContent, answers: Answers): DerivedProblem[]`
  - Visible items only, in visible order; for one item, the rule problem comes before the manual one.
  - A rule problem's `note` is the answer's `note` (or null) and its `mediaIds` are the answer's photos then videos.
- In `checklist-logic.ts`: `interface ManualProblem { severity: ProblemSeverity; note: string; mediaIds: string[] }` and `Answer.problem?: ManualProblem`

**Limits, answers and commands** (`executions.ts`, Task 2):
- `MEDIA_KINDS = ['photo', 'video']`, `mediaKindSchema`, `type MediaKind`
- `MEDIA_SOURCES = ['camera', 'gallery']`, `mediaSourceSchema`, `type MediaSource`
- `MEDIA_STATUSES = ['pending', 'uploaded']`, `mediaStatusSchema`, `type MediaStatus`
- `MEDIA_LIMITS`:
  - Photo: `photoLongEdge: 1600`, `jpegQuality: 0.7`, `photoMaxBytes: 5242880`
  - Video: `videoMaxSeconds: 60`, `videoMaxBytes: 62914560`, `videoMaxShortEdge: 720`
  - `mimeTypes: { photo: ['image/jpeg', 'image/png'], video: ['video/mp4', 'video/quicktime'] }`
  - `extensions: { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/quicktime': 'mov' }`
  - Caps: `problemMaxMedia: 5`, `evidencePerItem: 5`
  - Lifetimes: `uploadUrlTtlSeconds: 900`, `downloadUrlTtlSeconds: 300`, `pendingCleanupDays: 14`
- `EXECUTION_LIMITS`:
  - Sizes: `answersBytes: 1000000`, `problemNote: 2000`, `answerNote: 2000`
  - Clock: `clockFutureToleranceMs: 120000`, `clockSkewMs: 300000`, `earlyStartToleranceMs: 300000`
  - Ranges: `syncPastDays: 1`, `syncFutureDays: 3`, `syncFinishedHours: 24`, `problemsMaxDays: 92`
- `EXECUTION_ISSUE_CODES` (full i18n keys), `type ExecutionIssueCode`:
  - `executions.issues.unknownItem`, `invalidValue`, `unknownOption`, `unknownMedia`, `tooManyMedia`, `answersTooLarge`, `rangeTooLong` (each prefixed with `executions.issues.`)
- `manualProblemSchema`, `answerSchema` (strict), `answersSchema` (record of item ID → answer, ≤ 1 MB)
- `evidenceAllows(item: Item, kind: MediaKind): boolean`
- `mediaLimitFor(item: Item, kind: MediaKind): number`
  - A media item of that kind → its `maxCount`; a media item of the other kind → 0.
  - Otherwise `MEDIA_LIMITS.evidencePerItem` when `evidenceAllows`, else 0.
- `answerIssues(content: ChecklistContent, answers: Answers, media: ReadonlyMap<string, MediaKind>): ContentIssue[]`
  - `media` maps the media IDs registered on the execution to their kind.
  - Issue paths start with `['answers', itemId, …]`.
- `deviceInfoSchema` (`{ platform: 'ios' | 'android'; osVersion; appVersion }`), `type DeviceInfo`
- Commands. Every command has `deviceTime` (ISO) and `clientOffsetMs` (int, ±2e9):
  - `claimCommandSchema` / `type ClaimCommand`: `{ id, occurrenceId, startedAt, deviceTime, clientOffsetMs, device }`
  - `saveAnswersCommandSchema` / `type SaveAnswersCommand`: `{ rev ≥ 1, answers, deviceTime, clientOffsetMs }`
  - `completeCommandSchema` / `type CompleteCommand`: the answers command plus `completedAt`
  - `registerMediaCommandSchema` / `type RegisterMediaCommand`: `{ id, itemId: uuid | null, kind, source, mime, bytes, width?, height?, durationMs?, capturedAt, deviceTime, clientOffsetMs }`
- Results:
  - `claimRefSchema` / `type ClaimRef = { executionId; executorUserId; executorName }`
  - `claimResultSchema` / `type ClaimResult = { executionId; state: ExecutionState; reason: ClaimRejectionReason | null; claim: ClaimRef | null; checklistVersionId; startedAt; clockSuspect }`
  - `saveAnswersResultSchema` / `type SaveAnswersResult = { executionId; rev; stale: boolean; state; progress }`
  - `completeResultSchema` / `type CompleteResult = { executionId; state; completedAt: string | null; late; progress; score: ScoreResult | null }`
  - `mediaUploadTicketSchema` / `type MediaUploadTicket = { mediaId; status: MediaStatus; uploadUrl; headers: Record<string, string>; expiresAt }`
    - `headers` is `{ 'Content-Type', 'Content-Length' }`; the phone must PUT with exactly these.
  - `mediaConfirmResultSchema` / `type MediaConfirmResult = { mediaId; status; uploadedAt: string | null }`
  - `mediaUrlSchema` / `type MediaUrl = { url; expiresAt }`

**Read models** (`execution-summary.ts`, `execution-views.ts`, `occurrences.ts`, Task 3):
- `executionBriefSchema` / `type ExecutionBrief = { executionId; executorName; state; progress; scorePercent: number | null; late; clockSuspect }`
- `executionSummarySchema` / `type ExecutionSummary`:
  - Identity: `{ id, executor: { id, fullName }, state, rejectedReason }`
  - Times: `startedAt, startedReceivedAt, completedAt, completedReceivedAt`
  - Flags: `late, clockSuspect`
  - Counts: `progress, scorePercent, problemCount, mediaPending`
- `OccurrenceDto.executionBrief: ExecutionBrief | null`. This is the counted execution.
- `OccurrenceDetail.execution: ExecutionSummary | null` and `OccurrenceDetail.rejectedExecutions: ExecutionSummary[]`
- `syncQuerySchema` (`knownVersionIds`: comma-separated UUIDs, ≤ 200) and `type SyncQuery`
- `syncOccurrenceSchema` / `type SyncOccurrence`:
  - `{ id, checklistId, checklistName, siteId, siteName, shiftName, localDate, startsAt, dueAt, closesAt, status, checklistVersionId, claim: ClaimRef | null }`
- `syncChecklistVersionSchema` / `type SyncChecklistVersion = { id; checklistId; number; schemaVersion: number; content: unknown }`
  - The phone checks `schemaVersion ≤ 1`, then parses `content` with `parseDraftContent`.
- `myExecutionSchema` / `type MyExecution`:
  - `{ id, occurrenceId, checklistVersionId, state, rejectedReason, startedAt, completedAt, answers, answersRev, progress, late, clockSuspect, mediaPending }`
- `syncResponseSchema` / `type SyncResponse = { serverTime; occurrences: SyncOccurrence[]; checklistVersions: SyncChecklistVersion[]; executions: MyExecution[] }`
- `executionMediaDtoSchema` / `type ExecutionMediaDto`:
  - `{ id, itemId, kind, source, mime, bytes, width, height, durationMs, capturedAt, capturedBy: { id, fullName }, status, uploadedAt }`
- `executionProblemSchema` / `type ExecutionProblem = { id; itemId; source; severity; note; mediaIds; createdAt }`
- `executionDetailSchema` / `type ExecutionDetail`: `ExecutionSummary` plus:
  - The occurrence and version: `occurrence: OccurrenceDto`, `checklistVersionId`, `versionNumber`, `content: ChecklistContent`
  - The answers: `answers`, `answersRev`, `score`
  - Device data: `clockOffsetMs`, `device`, `lastSyncedAt`
  - `media: ExecutionMediaDto[]`, `problems: ExecutionProblem[]`
- `problemDtoSchema` / `type ProblemDto`:
  - Where: `{ id, executionId, occurrenceId, localDate, siteId, siteName, checklistId, checklistName }`
  - What: `{ itemId, itemLabel, source, severity, note, mediaIds, executorName, createdAt }`
- `problemListQuerySchema` / `type ProblemListQuery`:
  - `{ from, to, siteId?, checklistId?, severity?, source?, cursor?, limit? }`
  - A range over 92 days fails with `fields.to = 'executions.issues.rangeTooLong'`.

**Errors** (Task 3):
- `ErrorCode` adds `REQUIREMENTS_UNMET`, `EXECUTION_NOT_ACTIVE`, `NOT_EXECUTOR`, `CLOCK_INVALID`, `MEDIA_TYPE_INVALID`, `MEDIA_TOO_LARGE`, `MEDIA_LIMIT_REACHED`, `MEDIA_NOT_FOUND_IN_STORAGE` and `EVIDENCE_LIVE_ONLY`.
- `errorBodySchema.error.missing?: Missing[]`

### `@taskop/i18n` (Task 4)

- `az.errors.<CODE>` for the 9 new codes. `CLOCK_INVALID` is "Telefonun saatını yoxlayın."
- `az.executions`:
  - `states.<ExecutionState>`
  - `claimRejections.<ClaimRejectionReason>`
  - `alreadyClaimedBy` ("Bu checklist artıq {{name}} tərəfindən icra olunur")
  - `issues.<code without prefix>`
  - `problemSources.<ProblemSource>`, `severities.<ProblemSeverity>`
  - `flags.{ late, partial, clockSuspect, mediaPending }` (`mediaPending` takes `{{count}}`)
  - `mediaKinds.<MediaKind>`, `mediaSources.<MediaSource>`
- Part 2 adds phone UI strings to `az.mobile`. Part 3 adds web UI strings to `az.executions` (new keys only; it never renames these).

### `@taskop/api-client` (Task 5)

`createTaskopApi(c)` now also spreads `createExecutionsApi(c)`, which is also exported on its own with `type ExecutionsApi`:

| Method | HTTP | Returns |
|---|---|---|
| `sync.pull(knownVersionIds: string[] = [])` | `GET /me/sync?knownVersionIds=a,b` | `SyncResponse` |
| `executions.claim(body: ClaimCommand)` | `POST /executions` | `ClaimResult` (200 also for rejections) |
| `executions.saveAnswers(id: string, body: SaveAnswersCommand)` | `PUT /executions/:id/answers` | `SaveAnswersResult` |
| `executions.complete(id: string, body: CompleteCommand)` | `POST /executions/:id/complete` | `CompleteResult` |
| `executions.registerMedia(executionId: string, body: RegisterMediaCommand)` | `POST /executions/:id/media` | `MediaUploadTicket` |
| `executions.get(id: string)` | `GET /executions/:id` | `ExecutionDetail` |
| `media.confirmUploaded(id: string)` | `POST /media/:id/uploaded` | `MediaConfirmResult` |
| `media.url(id: string)` | `GET /media/:id/url` | `MediaUrl` |
| `problems.list(query: ProblemListQuery)` | `GET /problems` | `Page<ProblemDto>` |

- `ApiError.missing: Missing[] | null` is set on `REQUIREMENTS_UNMET`.
- The upload itself (`PUT uploadUrl` with `ticket.headers`) is a plain `fetch` / `FileSystem.uploadAsync` in the phone's media queue, not an api-client call.

### Server behaviour Parts 2 and 3 rely on

- **Outbox order per execution:** claim → register media → answers (latest `rev` only) → complete.
  - Every command is idempotent: replaying returns the stored result, and a stale answers `rev` returns `{ stale: true }`.
  - A `4xx` is permanent. Network errors and `5xx` are retryable. A concurrent duplicate of the same claim may produce one `500`; the retry then returns the stored result.
- **Rejected claims** keep accepting answers, media and completion. They are stored and never counted.
- **Reads:** `GET /executions/:id` and `GET /media/:id/url` answer `404` to anyone who is neither the executor nor an `assignments.view` holder whose scope covers the occurrence.

---
### Task 1: Execution logic: `progress`, `deriveProblems`, states and manual problems

**Files:**
- Create: `packages/contracts/src/execution-logic.ts`
- Test: `packages/contracts/src/execution-logic.test.ts`
- Modify: `packages/contracts/src/checklist-logic.ts`, `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `visibleItems`, `requirements`, `computeScore`, `isAnswered`, `Answers`, `MissingKind` from `checklist-logic.ts`; `PROBLEM_SEVERITIES`, `ProblemSeverity`, `ChecklistContent` from `checklist-content.ts`; `idSchema` from `common.ts`.
- Produces:
  - `EXECUTION_STATES`, `executionStateSchema`, `ExecutionState`
  - `CLAIM_REJECTION_REASONS`, `claimRejectionReasonSchema`, `ClaimRejectionReason`
  - `PROBLEM_SOURCES`, `problemSourceSchema`, `ProblemSource`, `problemSeveritySchema`
  - `MISSING_KINDS`, `missingSchema`, `progressSchema`, `ExecutionProgress`, `scoreSchema`
  - `DerivedProblem`, `progress(content, answers)`, `deriveProblems(content, answers)`
  - In `checklist-logic.ts`: `ManualProblem` and `Answer.problem?`

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/execution-logic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  type Answers,
  blankContent,
  type ChecklistContent,
  deriveProblems,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  progress,
  type YesNoItem,
} from './index.js';

const M1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e51';
const M2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e52';

/** problem (yes → critical + photo + follow-up comment), temp (outside 2–8 → normal + note), photo (required), note (optional). */
function fixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true };
  const comment = newItem('comment');
  comment.label = 'Təsvir edin';
  onYes.then.followUps.push(comment);
  problem.rules.push(onYes);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  out.then.requireNote = true;
  temp.rules.push(out);
  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  const note = newItem('text');
  note.label = 'Qeyd';
  note.required = false;
  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo, note] }] };
  return { content, problem, yes, no, comment, temp, photo, note };
}

describe('progress', () => {
  it('counts visible items, answered ones and every completion blocker', () => {
    const f = fixture();
    expect(progress(f.content, {})).toEqual({ answered: 0, total: 4, requiredMissing: 3 });
    // "yes" shows the comment (5 visible) and requires a photo on the problem item.
    expect(progress(f.content, { [f.problem.id]: { optionIds: [f.yes.id] } })).toEqual({ answered: 1, total: 5, requiredMissing: 4 });
    const done: Answers = {
      [f.problem.id]: { optionIds: [f.no.id] },
      [f.temp.id]: { number: 5 },
      [f.photo.id]: { photos: [M1] },
    };
    expect(progress(f.content, done)).toEqual({ answered: 3, total: 4, requiredMissing: 0 });
  });

  it('ignores answers to hidden follow-ups', () => {
    const f = fixture();
    expect(progress(f.content, { [f.problem.id]: { optionIds: [f.no.id] }, [f.comment.id]: { text: 'köhnə' } })).toEqual({ answered: 1, total: 4, requiredMissing: 2 });
  });
});

describe('deriveProblems', () => {
  const f = fixture();
  it.each<[string, Answers, ReturnType<typeof deriveProblems>]>([
    ['no answers', {}, []],
    [
      'a rule problem carries the answer note and its evidence',
      { [f.problem.id]: { optionIds: [f.yes.id], photos: [M1], videos: [M2], note: ' Su axır ' } },
      [{ itemId: f.problem.id, source: 'rule', severity: 'critical', note: 'Su axır', mediaIds: [M1, M2] }],
    ],
    ['a number out of range', { [f.temp.id]: { number: 10 } }, [{ itemId: f.temp.id, source: 'rule', severity: 'normal', note: null, mediaIds: [] }]],
    [
      'a manual problem on a good answer',
      { [f.temp.id]: { number: 5, problem: { severity: 'critical', note: 'Termometr köhnədir', mediaIds: [M1] } } },
      [{ itemId: f.temp.id, source: 'manual', severity: 'critical', note: 'Termometr köhnədir', mediaIds: [M1] }],
    ],
    [
      'rule before manual on the same item, in visible order',
      {
        [f.problem.id]: { optionIds: [f.yes.id] },
        [f.temp.id]: { number: 10, note: 'isti', problem: { severity: 'normal', note: 'Kondisioner xarabdır', mediaIds: [] } },
      },
      [
        { itemId: f.problem.id, source: 'rule', severity: 'critical', note: null, mediaIds: [] },
        { itemId: f.temp.id, source: 'rule', severity: 'normal', note: 'isti', mediaIds: [] },
        { itemId: f.temp.id, source: 'manual', severity: 'normal', note: 'Kondisioner xarabdır', mediaIds: [] },
      ],
    ],
    [
      'a manual problem on a hidden follow-up is ignored',
      { [f.problem.id]: { optionIds: [f.no.id] }, [f.comment.id]: { text: 'x', problem: { severity: 'normal', note: 'gizli', mediaIds: [] } } },
      [],
    ],
  ])('%s', (_name, answers, expected) => {
    expect(deriveProblems(f.content, answers)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- execution-logic`
Expected: FAIL, because `progress` and `deriveProblems` are not exported from `./index.js`.

- [ ] **Step 3: Extend `Answer` with a manual problem**

In `packages/contracts/src/checklist-logic.ts`, add before `export interface Answer`:

```ts
/** A problem the worker flags by hand on an item (FR-13.01–03). */
export interface ManualProblem {
  severity: ProblemSeverity;
  note: string;
  mediaIds: string[];
}
```

and add the last field to `Answer`:

```ts
  note?: string;
  problem?: ManualProblem;
}
```

- [ ] **Step 4: Implement**

`packages/contracts/src/execution-logic.ts`:

```ts
import { z } from 'zod';
import { type ChecklistContent, PROBLEM_SEVERITIES, type ProblemSeverity } from './checklist-content.js';
import { type Answers, computeScore, isAnswered, type MissingKind, requirements, visibleItems } from './checklist-logic.js';
import { idSchema } from './common.js';

export const EXECUTION_STATES = ['active', 'completed', 'partial', 'rejected'] as const;
export const executionStateSchema = z.enum(EXECUTION_STATES);
export type ExecutionState = z.infer<typeof executionStateSchema>;

/** Why a claim was stored as rejected (spec §5.2). The strings are also i18n keys under executions.claimRejections. */
export const CLAIM_REJECTION_REASONS = ['ALREADY_CLAIMED', 'NOT_ASSIGNED', 'NOT_STARTABLE', 'NOT_YET_OPEN', 'CLOSED', 'NOT_ON_SHIFT'] as const;
export const claimRejectionReasonSchema = z.enum(CLAIM_REJECTION_REASONS);
export type ClaimRejectionReason = z.infer<typeof claimRejectionReasonSchema>;

export const PROBLEM_SOURCES = ['rule', 'manual'] as const;
export const problemSourceSchema = z.enum(PROBLEM_SOURCES);
export type ProblemSource = z.infer<typeof problemSourceSchema>;
export const problemSeveritySchema = z.enum(PROBLEM_SEVERITIES);

export const MISSING_KINDS = ['answer', 'photo', 'video', 'note', 'mediaCount'] as const satisfies readonly MissingKind[];
export const missingSchema = z.object({ itemId: idSchema, kind: z.enum(MISSING_KINDS) });

export const progressSchema = z.object({ answered: z.number().int(), total: z.number().int(), requiredMissing: z.number().int() });
export type ExecutionProgress = z.infer<typeof progressSchema>;

export const scoreSchema = z.object({
  earned: z.number(),
  possible: z.number(),
  percent: z.number().nullable(),
  problems: z.array(z.object({ itemId: idSchema, severity: problemSeveritySchema })),
});

export interface DerivedProblem {
  itemId: string;
  source: ProblemSource;
  severity: ProblemSeverity;
  note: string | null;
  mediaIds: string[];
}

/** FR-10.07, over visible items. `requiredMissing` counts every completion blocker (`requirements`). */
export function progress(content: ChecklistContent, answers: Answers): ExecutionProgress {
  const visible = visibleItems(content, answers);
  return {
    answered: visible.filter((v) => isAnswered(v.item, answers[v.item.id])).length,
    total: visible.length,
    requiredMissing: requirements(content, answers).length,
  };
}

/**
 * Problems of visible items (FR-13.01–03, spec §4): rule problems from `computeScore`, then manual ones.
 * Pure, so the phone and the API derive exactly the same list.
 */
export function deriveProblems(content: ChecklistContent, answers: Answers): DerivedProblem[] {
  const ruleSeverity = new Map(computeScore(content, answers).problems.map((p) => [p.itemId, p.severity]));
  const out: DerivedProblem[] = [];
  for (const { item } of visibleItems(content, answers)) {
    const a = answers[item.id];
    const severity = ruleSeverity.get(item.id);
    if (severity) {
      out.push({ itemId: item.id, source: 'rule', severity, note: a?.note?.trim() || null, mediaIds: [...(a?.photos ?? []), ...(a?.videos ?? [])] });
    }
    if (a?.problem) {
      out.push({ itemId: item.id, source: 'manual', severity: a.problem.severity, note: a.problem.note, mediaIds: [...a.problem.mediaIds] });
    }
  }
  return out;
}
```

Add to `packages/contracts/src/index.ts`, after `checklist-logic.js`:

```ts
export * from './execution-logic.js';
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test -- execution-logic checklist-logic && pnpm --filter @taskop/contracts typecheck`
Expected: PASS (2 progress cases, 6 deriveProblems cases; the existing checklist-logic tests are unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/execution-logic.ts packages/contracts/src/execution-logic.test.ts packages/contracts/src/checklist-logic.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add execution progress, problem derivation and execution states" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Media limits, answer validation and command schemas

**Files:**
- Create: `packages/contracts/src/executions.ts`
- Test: `packages/contracts/src/executions.test.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/runtime.d.ts`

**Interfaces:**
- Consumes: Task 1; `walkItems`, `hasRules`, `Item`, `ChecklistContent`, `ContentIssue`, `CONTENT_LIMITS`, `PROBLEM_SEVERITIES` from `checklist-content.ts`; `idSchema`, `isoDateTimeSchema` from `common.ts`.
- Produces: everything listed under "Limits, answers and commands" in **Interfaces for Parts 2 and 3**.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/executions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  answerIssues,
  type Answers,
  answersSchema,
  blankContent,
  type ChecklistContent,
  claimCommandSchema,
  type MediaKind,
  mediaLimitFor,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  registerMediaCommandSchema,
  type YesNoItem,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const P1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e51';
const P2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e52';
const P3 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e53';
const V1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e54';
const media = new Map<string, MediaKind>([[P1, 'photo'], [P2, 'photo'], [P3, 'photo'], [V1, 'video']]);

function fixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const rule = newRule(problem);
  rule.when = { kind: 'options', optionIds: [problem.options[0].id] };
  rule.then = { ...rule.then, problem: 'critical', requirePhoto: true };
  problem.rules.push(rule);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  temp.min = -50;
  temp.max = 50;
  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  if (photo.type === 'photo') photo.maxCount = 2;
  const note = newItem('text');
  note.label = 'Qeyd';
  const day = newItem('datetime');
  day.label = 'Tarix';
  if (day.type === 'datetime') day.mode = 'date';
  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo, note, day] }] };
  return { content, problem, temp, photo, note, day };
}

describe('answers schema', () => {
  it('accepts a manual problem and rejects unknown fields, empty notes and more than 5 problem media', () => {
    expect(answersSchema.safeParse({ [ID]: { optionIds: [ID], problem: { severity: 'normal', note: 'Qırıqdır', mediaIds: [P1] } } }).success).toBe(true);
    expect(answersSchema.safeParse({ [ID]: { bogus: 1 } }).success).toBe(false);
    expect(answersSchema.safeParse({ [ID]: { problem: { severity: 'normal', note: '  ', mediaIds: [] } } }).success).toBe(false);
    expect(answersSchema.safeParse({ [ID]: { problem: { severity: 'normal', note: 'x', mediaIds: Array(6).fill(P1) } } }).success).toBe(false);
    expect(answersSchema.safeParse({ 'not-a-uuid': {} }).success).toBe(false);
  });

  it('limits the serialised document to 1 MB', () => {
    const big = Object.fromEntries(Array.from({ length: 520 }, () => [globalThis.crypto.randomUUID(), { note: 'x'.repeat(2000) }]));
    const r = answersSchema.safeParse(big);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('executions.issues.answersTooLarge');
  });
});

describe('answerIssues', () => {
  const f = fixture();
  const code = (answers: Answers) => answerIssues(f.content, answers, media).map((i) => [i.path.join('.'), i.code]);
  it.each<[string, () => Answers, string[][]]>([
    ['valid answers', () => ({ [f.problem.id]: { optionIds: [f.problem.options[0].id], photos: [P1] }, [f.temp.id]: { number: 5 }, [f.photo.id]: { photos: [P1, P2] }, [f.day.id]: { datetime: '2026-11-02' } }), []],
    ['an unknown item', () => ({ [ID]: { text: 'x' } }), [[`answers.${ID}`, 'executions.issues.unknownItem']]],
    ['an option of another item', () => ({ [f.problem.id]: { optionIds: [ID] } }), [[`answers.${f.problem.id}.optionIds`, 'executions.issues.unknownOption']]],
    ['two options on yes/no', () => ({ [f.problem.id]: { optionIds: f.problem.options.map((o) => o.id) } }), [[`answers.${f.problem.id}.optionIds`, 'executions.issues.invalidValue']]],
    ['a number out of range', () => ({ [f.temp.id]: { number: 60 } }), [[`answers.${f.temp.id}.number`, 'executions.issues.invalidValue']]],
    ['text on a number item', () => ({ [f.temp.id]: { text: '5' } }), [[`answers.${f.temp.id}.text`, 'executions.issues.invalidValue']]],
    ['text over maxLength', () => ({ [f.note.id]: { text: 'x'.repeat(501) } }), [[`answers.${f.note.id}.text`, 'executions.issues.invalidValue']]],
    ['a datetime in the wrong format', () => ({ [f.day.id]: { datetime: '2026-11-02T08:00' } }), [[`answers.${f.day.id}.datetime`, 'executions.issues.invalidValue']]],
    ['photos on an item without photo evidence', () => ({ [f.note.id]: { text: 'x', photos: [P1] } }), [[`answers.${f.note.id}.photos`, 'executions.issues.invalidValue']]],
    ['more photos than maxCount', () => ({ [f.photo.id]: { photos: [P1, P2, P3] } }), [[`answers.${f.photo.id}.photos`, 'executions.issues.tooManyMedia']]],
    ['an unregistered media id', () => ({ [f.photo.id]: { photos: [ID] } }), [[`answers.${f.photo.id}.photos.0`, 'executions.issues.unknownMedia']]],
    ['a video id among photos', () => ({ [f.photo.id]: { photos: [V1] } }), [[`answers.${f.photo.id}.photos.0`, 'executions.issues.unknownMedia']]],
    [
      'an unregistered problem medium',
      () => ({ [f.temp.id]: { number: 5, problem: { severity: 'normal', note: 'x', mediaIds: [P1, ID] } } }),
      [[`answers.${f.temp.id}.problem.mediaIds.1`, 'executions.issues.unknownMedia']],
    ],
  ])('%s', (_name, answers, expected) => {
    expect(code(answers())).toEqual(expected);
  });
});

describe('mediaLimitFor', () => {
  const f = fixture();
  it('uses maxCount for media items and the evidence cap elsewhere', () => {
    expect(mediaLimitFor(f.photo, 'photo')).toBe(2);
    expect(mediaLimitFor(f.photo, 'video')).toBe(0);
    expect(mediaLimitFor(f.problem, 'photo')).toBe(5);
    expect(mediaLimitFor(f.problem, 'video')).toBe(0);
    expect(mediaLimitFor(f.note, 'photo')).toBe(0);
  });
});

describe('commands', () => {
  it('parses a claim and a problem-only media registration', () => {
    const claim = { id: ID, occurrenceId: ID, startedAt: '2026-11-02T04:05:00.000Z', deviceTime: '2026-11-02T04:05:00.000Z', clientOffsetMs: 1200, device: { platform: 'ios', osVersion: '26.0', appVersion: '1.0.0' } };
    expect(claimCommandSchema.safeParse(claim).success).toBe(true);
    expect(claimCommandSchema.safeParse({ ...claim, clientOffsetMs: 1.5 }).success).toBe(false);
    expect(claimCommandSchema.safeParse({ ...claim, clientOffsetMs: 3_000_000_000 }).success).toBe(false);
    const media = { id: ID, itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 1000, capturedAt: claim.startedAt, deviceTime: claim.startedAt, clientOffsetMs: 0 };
    expect(registerMediaCommandSchema.safeParse(media).success).toBe(true);
    expect(registerMediaCommandSchema.safeParse({ ...media, bytes: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- executions.test`
Expected: FAIL, because `answerIssues`, `answersSchema` and the command schemas are not exported.

- [ ] **Step 3: Implement**

`packages/contracts/src/executions.ts`:

```ts
import { z } from 'zod';
import { type ChecklistContent, CONTENT_LIMITS, type ContentIssue, hasRules, type Item, PROBLEM_SEVERITIES, walkItems } from './checklist-content.js';
import type { Answers } from './checklist-logic.js';
import { idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, progressSchema, scoreSchema } from './execution-logic.js';

const MB = 1024 * 1024;

export const MEDIA_KINDS = ['photo', 'video'] as const;
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;
export const MEDIA_SOURCES = ['camera', 'gallery'] as const;
export const mediaSourceSchema = z.enum(MEDIA_SOURCES);
export type MediaSource = z.infer<typeof mediaSourceSchema>;
export const MEDIA_STATUSES = ['pending', 'uploaded'] as const;
export const mediaStatusSchema = z.enum(MEDIA_STATUSES);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

/** Spec §1, §4, §6.7. The phone resizes and records within these; the API refuses anything beyond them. */
export const MEDIA_LIMITS = {
  photoLongEdge: 1600,
  jpegQuality: 0.7,
  photoMaxBytes: 5 * MB,
  videoMaxSeconds: 60,
  videoMaxBytes: 60 * MB,
  /** 720p: the short edge of a video frame. */
  videoMaxShortEdge: 720,
  mimeTypes: { photo: ['image/jpeg', 'image/png'], video: ['video/mp4', 'video/quicktime'] },
  extensions: { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/quicktime': 'mov' },
  problemMaxMedia: 5,
  /** Evidence photos (or videos) on an item that is not itself a photo or video item. */
  evidencePerItem: 5,
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
  pendingCleanupDays: 14,
} as const;

export const EXECUTION_LIMITS = {
  answersBytes: 1_000_000,
  problemNote: 2000,
  answerNote: 2000,
  /** A device time later than server receipt + 2 min is CLOCK_INVALID (spec §6.6). */
  clockFutureToleranceMs: 2 * 60_000,
  /** |clientOffsetMs| above this marks the execution clock_suspect. */
  clockSkewMs: 5 * 60_000,
  /** Starting more than this before starts_at marks the execution clock_suspect. */
  earlyStartToleranceMs: 5 * 60_000,
  syncPastDays: 1,
  syncFutureDays: 3,
  syncFinishedHours: 24,
  problemsMaxDays: 92,
} as const;

export const EXECUTION_ISSUE_CODES = [
  'executions.issues.unknownItem',
  'executions.issues.invalidValue',
  'executions.issues.unknownOption',
  'executions.issues.unknownMedia',
  'executions.issues.tooManyMedia',
  'executions.issues.answersTooLarge',
  'executions.issues.rangeTooLong',
] as const;
export type ExecutionIssueCode = (typeof EXECUTION_ISSUE_CODES)[number];

export const manualProblemSchema = z.object({
  severity: z.enum(PROBLEM_SEVERITIES),
  note: z.string().trim().min(1).max(EXECUTION_LIMITS.problemNote),
  mediaIds: z.array(idSchema).max(MEDIA_LIMITS.problemMaxMedia),
});

/** One item's answer (SP2 `Answer` plus the manual problem). Unknown fields are refused. */
export const answerSchema = z.strictObject({
  optionIds: z.array(idSchema).max(CONTENT_LIMITS.options).optional(),
  number: z.number().optional(),
  text: z.string().max(5000).optional(),
  datetime: z.string().max(40).optional(),
  photos: z.array(idSchema).max(20).optional(),
  videos: z.array(idSchema).max(5).optional(),
  note: z.string().max(EXECUTION_LIMITS.answerNote).optional(),
  problem: manualProblemSchema.optional(),
});

/** `ExecutionAnswersDoc` (spec §4): item ID → answer, at most 1 MB serialised. */
export const answersSchema = z.record(idSchema, answerSchema).superRefine((v, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(v)).length > EXECUTION_LIMITS.answersBytes) {
    ctx.addIssue({ code: 'custom', message: 'executions.issues.answersTooLarge' });
  }
});

/** May this item carry evidence of this kind (beyond being a photo/video item itself)? */
export function evidenceAllows(item: Item, kind: MediaKind): boolean {
  if (item.evidence[kind] !== 'none') return true;
  return hasRules(item) && item.rules.some((r) => (kind === 'photo' ? r.then.requirePhoto : r.then.requireVideo));
}

/** How many media of `kind` an item's answer may hold (also the server's MEDIA_LIMIT_REACHED cap). */
export function mediaLimitFor(item: Item, kind: MediaKind): number {
  if (item.type === 'photo' || item.type === 'video') return item.type === kind ? item.maxCount : 0;
  return evidenceAllows(item, kind) ? MEDIA_LIMITS.evidencePerItem : 0;
}

const DATETIME_FORMATS = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
} as const;

/**
 * Checks answers against the pinned version (spec §6.3): item IDs, value types, options, limits and media IDs.
 * `media` maps the media IDs registered on the execution to their kind. Answers to hidden items are allowed.
 */
export function answerIssues(content: ChecklistContent, answers: Answers, media: ReadonlyMap<string, MediaKind>): ContentIssue[] {
  const items = new Map<string, Item>();
  walkItems(content, (item) => items.set(item.id, item));
  const issues: ContentIssue[] = [];
  const add = (path: (string | number)[], code: ExecutionIssueCode) => issues.push({ path: ['answers', ...path], code });
  for (const [itemId, a] of Object.entries(answers)) {
    const item = items.get(itemId);
    if (!item) {
      add([itemId], 'executions.issues.unknownItem');
      continue;
    }
    if (!a) continue;
    if (a.optionIds !== undefined) {
      if (!('options' in item)) add([itemId, 'optionIds'], 'executions.issues.invalidValue');
      else if (a.optionIds.some((id) => !(item.options as ReadonlyArray<{ id: string }>).some((o) => o.id === id))) add([itemId, 'optionIds'], 'executions.issues.unknownOption');
      else if (item.type !== 'multi_choice' && a.optionIds.length > 1) add([itemId, 'optionIds'], 'executions.issues.invalidValue');
    }
    if (a.number !== undefined && (item.type !== 'number' || (item.min !== null && a.number < item.min) || (item.max !== null && a.number > item.max))) {
      add([itemId, 'number'], 'executions.issues.invalidValue');
    }
    if (a.text !== undefined && ((item.type !== 'text' && item.type !== 'comment') || a.text.length > item.maxLength)) {
      add([itemId, 'text'], 'executions.issues.invalidValue');
    }
    if (a.datetime !== undefined && (item.type !== 'datetime' || !DATETIME_FORMATS[item.mode].test(a.datetime))) {
      add([itemId, 'datetime'], 'executions.issues.invalidValue');
    }
    for (const [field, kind] of [['photos', 'photo'], ['videos', 'video']] as const) {
      const ids = a[field];
      if (ids === undefined) continue;
      const limit = mediaLimitFor(item, kind);
      if (limit === 0) add([itemId, field], 'executions.issues.invalidValue');
      else if (ids.length > limit) add([itemId, field], 'executions.issues.tooManyMedia');
      ids.forEach((id, i) => {
        if (media.get(id) !== kind) add([itemId, field, i], 'executions.issues.unknownMedia');
      });
    }
    a.problem?.mediaIds.forEach((id, i) => {
      if (!media.has(id)) add([itemId, 'problem', 'mediaIds', i], 'executions.issues.unknownMedia');
    });
  }
  return issues;
}

export const deviceInfoSchema = z.object({ platform: z.enum(['ios', 'android']), osVersion: z.string().max(50), appVersion: z.string().max(50) });
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/** Every upload command carries the device time and the offset measured at the last sync (spec §6.6). */
const commandTiming = {
  deviceTime: isoDateTimeSchema,
  clientOffsetMs: z.number().int().min(-2_000_000_000).max(2_000_000_000),
};

export const claimCommandSchema = z.object({ id: idSchema, occurrenceId: idSchema, startedAt: isoDateTimeSchema, device: deviceInfoSchema, ...commandTiming });
export type ClaimCommand = z.input<typeof claimCommandSchema>;

export const saveAnswersCommandSchema = z.object({ rev: z.number().int().min(1), answers: answersSchema, ...commandTiming });
export type SaveAnswersCommand = z.input<typeof saveAnswersCommandSchema>;

export const completeCommandSchema = saveAnswersCommandSchema.extend({ completedAt: isoDateTimeSchema });
export type CompleteCommand = z.input<typeof completeCommandSchema>;

export const registerMediaCommandSchema = z.object({
  id: idSchema,
  /** null = attached only to a manual problem; the problem's item is in the answers. */
  itemId: idSchema.nullable(),
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  mime: z.string().max(100),
  bytes: z.number().int().min(1),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  capturedAt: isoDateTimeSchema,
  ...commandTiming,
});
export type RegisterMediaCommand = z.input<typeof registerMediaCommandSchema>;

export const claimRefSchema = z.object({ executionId: idSchema, executorUserId: idSchema, executorName: z.string() });
export type ClaimRef = z.infer<typeof claimRefSchema>;

export const claimResultSchema = z.object({
  executionId: idSchema,
  state: executionStateSchema,
  reason: claimRejectionReasonSchema.nullable(),
  /** Who holds the claim now (the caller when accepted). */
  claim: claimRefSchema.nullable(),
  checklistVersionId: idSchema,
  /** After clamping (spec §6.6). */
  startedAt: isoDateTimeSchema,
  clockSuspect: z.boolean(),
});
export type ClaimResult = z.infer<typeof claimResultSchema>;

export const saveAnswersResultSchema = z.object({
  executionId: idSchema,
  /** The stored revision; with `stale: true` the command was ignored. */
  rev: z.number().int(),
  stale: z.boolean(),
  state: executionStateSchema,
  progress: progressSchema,
});
export type SaveAnswersResult = z.infer<typeof saveAnswersResultSchema>;

export const completeResultSchema = z.object({
  executionId: idSchema,
  state: executionStateSchema,
  completedAt: isoDateTimeSchema.nullable(),
  late: z.boolean(),
  progress: progressSchema,
  score: scoreSchema.nullable(),
});
export type CompleteResult = z.infer<typeof completeResultSchema>;

export const mediaUploadTicketSchema = z.object({
  mediaId: idSchema,
  status: mediaStatusSchema,
  /** Presigned PUT, valid 15 min; send exactly `headers`. */
  uploadUrl: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: isoDateTimeSchema,
});
export type MediaUploadTicket = z.infer<typeof mediaUploadTicketSchema>;

export const mediaConfirmResultSchema = z.object({ mediaId: idSchema, status: mediaStatusSchema, uploadedAt: isoDateTimeSchema.nullable() });
export type MediaConfirmResult = z.infer<typeof mediaConfirmResultSchema>;

export const mediaUrlSchema = z.object({ url: z.url(), expiresAt: isoDateTimeSchema });
export type MediaUrl = z.infer<typeof mediaUrlSchema>;
```

The contracts compile against `lib: ES2023` only, so declare `TextEncoder` next to the other runtime globals. In `packages/contracts/src/runtime.d.ts`, add inside `declare global { … }`:

```ts
  // Node, browsers and Hermes (React Native ≥ 0.74) all provide it.
  var TextEncoder: { new (): { encode(input: string): Uint8Array } };
```

Add to `packages/contracts/src/index.ts`, after `execution-logic.js`:

```ts
export * from './executions.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test -- executions.test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS (13 `answerIssues` cases included).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/executions.ts packages/contracts/src/executions.test.ts packages/contracts/src/index.ts packages/contracts/src/runtime.d.ts
git commit -m "feat(contracts): add media limits, answer validation and execution command schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Read models, occurrence extensions and error codes

**Files:**
- Create: `packages/contracts/src/execution-summary.ts`, `packages/contracts/src/execution-views.ts`
- Test: `packages/contracts/src/execution-views.test.ts`
- Modify:
  - `packages/contracts/src/occurrences.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/index.ts`
  - `apps/api/src/scheduling/mappers.ts`, `apps/api/src/scheduling/occurrences.service.ts`
  - `apps/web/src/features/scheduling/schedule-page.test.tsx`, `apps/web/src/features/scheduling/assignment-pages.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–2; `occurrenceDtoSchema`, `occurrenceStatusSchema`, `userRefSchema` from `occurrences.ts`; `checklistContentSchema`; `localDateSchema`, `dayNumber`; `cursorQuerySchema`.
- Produces: everything listed under "Read models" and "Errors" in **Interfaces for Parts 2 and 3**.
  - The API's `toOccurrenceDto` returns `executionBrief: null` and `OccurrencesService.get` returns `execution: null, rejectedExecutions: []` until Task 16 fills them.
  - The import order matters: `execution-summary.ts` imports nothing from `occurrences.ts`, so `occurrences.ts → execution-summary.ts` is not a cycle.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/execution-views.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ERROR_HTTP_STATUS,
  errorBodySchema,
  occurrenceDetailSchema,
  occurrenceDtoSchema,
  problemListQuerySchema,
  syncQuerySchema,
  syncResponseSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const ID2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e50';
const occurrence = {
  id: ID, assignmentId: ID, assignmentName: null, checklistId: ID, checklistName: 'Açılış', siteId: ID, siteName: 'Filial', shiftId: null, shiftName: null,
  localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z',
  status: 'completed', statusChangedAt: '2026-11-02T05:00:00.000Z', cancelReason: null, assigneeIds: [ID], unassigned: false,
};
const progress = { answered: 3, total: 4, requiredMissing: 0 };

describe('execution read models', () => {
  it('splits known version ids and caps the problems range at 92 days', () => {
    expect(syncQuerySchema.parse({ knownVersionIds: `${ID},${ID2}` }).knownVersionIds).toEqual([ID, ID2]);
    expect(syncQuerySchema.parse({}).knownVersionIds).toEqual([]);
    expect(syncQuerySchema.safeParse({ knownVersionIds: 'x' }).success).toBe(false);
    expect(problemListQuerySchema.safeParse({ from: '2026-11-01', to: '2027-01-31' }).success).toBe(true);
    const long = problemListQuerySchema.safeParse({ from: '2026-11-01', to: '2027-02-01' });
    expect(long.success).toBe(false);
    expect(long.error!.issues[0]).toMatchObject({ path: ['to'], message: 'executions.issues.rangeTooLong' });
  });

  it('adds the counted execution to occurrences and the summaries to the detail', () => {
    expect(occurrenceDtoSchema.safeParse(occurrence).success).toBe(false);
    const brief = { executionId: ID, executorName: 'Aysel', state: 'completed', progress, scorePercent: 87.5, late: false, clockSuspect: false };
    expect(occurrenceDtoSchema.parse({ ...occurrence, executionBrief: brief }).executionBrief).toEqual(brief);
    const summary = {
      id: ID, executor: { id: ID, fullName: 'Aysel' }, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED',
      startedAt: '2026-11-02T04:10:00.000Z', startedReceivedAt: '2026-11-02T09:00:00.000Z', completedAt: null, completedReceivedAt: null,
      late: false, clockSuspect: false, progress, scorePercent: null, problemCount: 0, mediaPending: 2,
    };
    const detail = occurrenceDetailSchema.parse({ ...occurrence, executionBrief: null, assignees: [], history: [], execution: null, rejectedExecutions: [summary] });
    expect(detail.rejectedExecutions[0]!.rejectedReason).toBe('ALREADY_CLAIMED');
  });

  it('keeps checklist content opaque in a sync response, so a newer schemaVersion still parses', () => {
    const r = syncResponseSchema.parse({
      serverTime: '2026-11-02T04:00:00.000Z',
      occurrences: [],
      checklistVersions: [{ id: ID, checklistId: ID, number: 3, schemaVersion: 2, content: { schemaVersion: 2, anything: true } }],
      executions: [],
    });
    expect(r.checklistVersions[0]!.content).toEqual({ schemaVersion: 2, anything: true });
  });

  it('registers the execution error codes and the missing detail', () => {
    expect(ERROR_HTTP_STATUS.REQUIREMENTS_UNMET).toBe(422);
    expect(ERROR_HTTP_STATUS.EXECUTION_NOT_ACTIVE).toBe(409);
    expect(ERROR_HTTP_STATUS.NOT_EXECUTOR).toBe(403);
    expect(ERROR_HTTP_STATUS.CLOCK_INVALID).toBe(422);
    expect(ERROR_HTTP_STATUS.MEDIA_NOT_FOUND_IN_STORAGE).toBe(422);
    const body = { error: { code: 'REQUIREMENTS_UNMET', messageKey: 'errors.REQUIREMENTS_UNMET', fields: null, retryAfterSeconds: null, requestId: null, missing: [{ itemId: ID, kind: 'photo' }] } };
    expect(errorBodySchema.parse(body).error.missing).toEqual([{ itemId: ID, kind: 'photo' }]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- execution-views`
Expected: FAIL, because `syncQuerySchema` and `problemListQuerySchema` are undefined.

- [ ] **Step 3: Implement the read models**

`packages/contracts/src/execution-summary.ts`:

```ts
import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, progressSchema } from './execution-logic.js';

/** The counted execution of an occurrence, for list rows (spec §8 badges and columns). */
export const executionBriefSchema = z.object({
  executionId: idSchema,
  executorName: z.string(),
  state: executionStateSchema,
  progress: progressSchema,
  scorePercent: z.number().nullable(),
  late: z.boolean(),
  clockSuspect: z.boolean(),
});
export type ExecutionBrief = z.infer<typeof executionBriefSchema>;

/** One execution of an occurrence, counted or rejected (spec §6.8). Device times first, server receipt beside them. */
export const executionSummarySchema = z.object({
  id: idSchema,
  executor: z.object({ id: idSchema, fullName: z.string() }),
  state: executionStateSchema,
  rejectedReason: claimRejectionReasonSchema.nullable(),
  startedAt: isoDateTimeSchema,
  startedReceivedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  completedReceivedAt: isoDateTimeSchema.nullable(),
  late: z.boolean(),
  clockSuspect: z.boolean(),
  progress: progressSchema,
  scorePercent: z.number().nullable(),
  problemCount: z.number().int(),
  mediaPending: z.number().int(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;
```

`packages/contracts/src/execution-views.ts`:

```ts
import { z } from 'zod';
import { checklistContentSchema } from './checklist-content.js';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { claimRejectionReasonSchema, executionStateSchema, problemSeveritySchema, problemSourceSchema, progressSchema, scoreSchema } from './execution-logic.js';
import { executionSummarySchema } from './execution-summary.js';
import { answerSchema, claimRefSchema, deviceInfoSchema, EXECUTION_LIMITS, mediaKindSchema, mediaSourceSchema, mediaStatusSchema } from './executions.js';
import { occurrenceDtoSchema, occurrenceStatusSchema, userRefSchema } from './occurrences.js';
import { dayNumber, localDateSchema } from './scheduling-time.js';

/** `knownVersionIds=a,b` in the query string: versions the phone already holds. */
export const syncQuerySchema = z.object({
  knownVersionIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : []))
    .pipe(z.array(idSchema).max(200)),
});
export type SyncQuery = z.input<typeof syncQuerySchema>;

export const syncOccurrenceSchema = z.object({
  id: idSchema,
  checklistId: idSchema,
  checklistName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  shiftName: z.string().nullable(),
  localDate: localDateSchema,
  startsAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
  closesAt: isoDateTimeSchema,
  status: occurrenceStatusSchema,
  /** Pinned at the first download or claim; never changes afterwards (spec §5.1). */
  checklistVersionId: idSchema,
  claim: claimRefSchema.nullable(),
});
export type SyncOccurrence = z.infer<typeof syncOccurrenceSchema>;

/** `content` stays opaque so an old app can still sync and then refuse a newer `schemaVersion` ("Tətbiqi yeniləyin"). */
export const syncChecklistVersionSchema = z.object({
  id: idSchema,
  checklistId: idSchema,
  number: z.number().int(),
  schemaVersion: z.number().int(),
  content: z.unknown(),
});
export type SyncChecklistVersion = z.infer<typeof syncChecklistVersionSchema>;

const storedAnswersSchema = z.record(z.string(), answerSchema);

export const myExecutionSchema = z.object({
  id: idSchema,
  occurrenceId: idSchema,
  checklistVersionId: idSchema,
  state: executionStateSchema,
  rejectedReason: claimRejectionReasonSchema.nullable(),
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  answers: storedAnswersSchema,
  answersRev: z.number().int(),
  progress: progressSchema,
  late: z.boolean(),
  clockSuspect: z.boolean(),
  mediaPending: z.number().int(),
});
export type MyExecution = z.infer<typeof myExecutionSchema>;

export const syncResponseSchema = z.object({
  serverTime: isoDateTimeSchema,
  occurrences: z.array(syncOccurrenceSchema),
  checklistVersions: z.array(syncChecklistVersionSchema),
  executions: z.array(myExecutionSchema),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export const executionMediaDtoSchema = z.object({
  id: idSchema,
  itemId: idSchema.nullable(),
  kind: mediaKindSchema,
  source: mediaSourceSchema,
  mime: z.string(),
  bytes: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  capturedAt: isoDateTimeSchema,
  capturedBy: userRefSchema,
  status: mediaStatusSchema,
  uploadedAt: isoDateTimeSchema.nullable(),
});
export type ExecutionMediaDto = z.infer<typeof executionMediaDtoSchema>;

export const executionProblemSchema = z.object({
  id: idSchema,
  itemId: idSchema,
  source: problemSourceSchema,
  severity: problemSeveritySchema,
  note: z.string().nullable(),
  mediaIds: z.array(idSchema),
  createdAt: isoDateTimeSchema,
});
export type ExecutionProblem = z.infer<typeof executionProblemSchema>;

export const executionDetailSchema = executionSummarySchema.extend({
  occurrence: occurrenceDtoSchema,
  checklistVersionId: idSchema,
  versionNumber: z.number().int(),
  content: checklistContentSchema,
  answers: storedAnswersSchema,
  answersRev: z.number().int(),
  score: scoreSchema.nullable(),
  clockOffsetMs: z.number().int().nullable(),
  device: deviceInfoSchema,
  lastSyncedAt: isoDateTimeSchema,
  media: z.array(executionMediaDtoSchema),
  problems: z.array(executionProblemSchema),
});
export type ExecutionDetail = z.infer<typeof executionDetailSchema>;

export const problemDtoSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  occurrenceId: idSchema,
  localDate: localDateSchema,
  siteId: idSchema,
  siteName: z.string(),
  checklistId: idSchema,
  checklistName: z.string(),
  itemId: idSchema,
  /** From the pinned version; null if the item cannot be found there. */
  itemLabel: z.string().nullable(),
  source: problemSourceSchema,
  severity: problemSeveritySchema,
  note: z.string().nullable(),
  mediaIds: z.array(idSchema),
  executorName: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ProblemDto = z.infer<typeof problemDtoSchema>;

export const problemListQuerySchema = cursorQuerySchema
  .extend({
    from: localDateSchema,
    to: localDateSchema,
    siteId: idSchema.optional(),
    checklistId: idSchema.optional(),
    severity: problemSeveritySchema.optional(),
    source: problemSourceSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > EXECUTION_LIMITS.problemsMaxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'executions.issues.rangeTooLong' });
  });
export type ProblemListQuery = z.input<typeof problemListQuerySchema>;
```

In `packages/contracts/src/occurrences.ts`:
- Add `import { executionBriefSchema, executionSummarySchema } from './execution-summary.js';`
- Add the last field of `occurrenceDtoSchema` (after `unassigned`):

```ts
  /** The counted execution (not rejected), or null (SP4 spec §8). */
  executionBrief: executionBriefSchema.nullable(),
```

- Replace `occurrenceDetailSchema` with:

```ts
export const occurrenceDetailSchema = occurrenceDtoSchema.extend({
  assignees: z.array(userRefSchema),
  history: z.array(occurrenceHistoryEntrySchema),
  /** The counted execution (SP4 spec §6.8). */
  execution: executionSummarySchema.nullable(),
  /** Executions whose claim lost; stored, never counted. */
  rejectedExecutions: z.array(executionSummarySchema),
});
```

Add to `packages/contracts/src/index.ts`, after `executions.js`:

```ts
export * from './execution-summary.js';
export * from './execution-views.js';
```

- [ ] **Step 4: Add the error codes**

In `packages/contracts/src/errors.ts`:
- Add `import { missingSchema } from './execution-logic.js';`
- Add to `ErrorCode`, just before `INTERNAL`:

```ts
  REQUIREMENTS_UNMET: 'REQUIREMENTS_UNMET',
  EXECUTION_NOT_ACTIVE: 'EXECUTION_NOT_ACTIVE',
  NOT_EXECUTOR: 'NOT_EXECUTOR',
  CLOCK_INVALID: 'CLOCK_INVALID',
  MEDIA_TYPE_INVALID: 'MEDIA_TYPE_INVALID',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  MEDIA_LIMIT_REACHED: 'MEDIA_LIMIT_REACHED',
  MEDIA_NOT_FOUND_IN_STORAGE: 'MEDIA_NOT_FOUND_IN_STORAGE',
  EVIDENCE_LIVE_ONLY: 'EVIDENCE_LIVE_ONLY',
```

- Add to `ERROR_HTTP_STATUS`, just before `INTERNAL: 500`:

```ts
  REQUIREMENTS_UNMET: 422,
  EXECUTION_NOT_ACTIVE: 409,
  NOT_EXECUTOR: 403,
  CLOCK_INVALID: 422,
  MEDIA_TYPE_INVALID: 422,
  MEDIA_TOO_LARGE: 422,
  MEDIA_LIMIT_REACHED: 422,
  MEDIA_NOT_FOUND_IN_STORAGE: 422,
  EVIDENCE_LIVE_ONLY: 422,
```

- In `errorBodySchema`, after `userIds`, add:

```ts
    /** REQUIREMENTS_UNMET: what still blocks completion. */
    missing: z.array(missingSchema).optional(),
```

- [ ] **Step 5: Keep the API and the web compiling**

In `apps/api/src/scheduling/mappers.ts`, add the last property of the object returned by `toOccurrenceDto`:

```ts
  unassigned: (r.o.status === 'pending' || r.o.status === 'overdue') && r.assigneeIds.length === 0,
  // Read from the executions table once it exists (OccurrenceQueries.select).
  executionBrief: null,
});
```

In `apps/api/src/scheduling/occurrences.service.ts`, `get` returns:

```ts
    return { ...toOccurrenceDto(row), assignees, history: history.map(toHistoryEntry), execution: null, rejectedExecutions: [] };
```

In `apps/web/src/features/scheduling/schedule-page.test.tsx`:
- In `occ()`, change `assigneeIds: ['u1'], unassigned: false, ...over,` to `assigneeIds: ['u1'], unassigned: false, executionBrief: null, ...over,`.
- In the `occurrences.get` mock, add `execution: null, rejectedExecutions: [],` after `history: [...]`.
- Change the `occurrences.cancel` mock to `{ ...occ({ status: 'cancelled' }), assignees: [], history: [], execution: null, rejectedExecutions: [] }`.

In `apps/web/src/features/scheduling/assignment-pages.test.tsx`, in the `upcoming` item, change `assigneeIds: ['u1'], unassigned: false },` to `assigneeIds: ['u1'], unassigned: false, executionBrief: null },`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web test -- scheduling`
Expected: PASS. The existing `errors.test.ts` still maps every code to a status ≥ 400.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src apps/api/src/scheduling/mappers.ts apps/api/src/scheduling/occurrences.service.ts apps/web/src/features/scheduling/schedule-page.test.tsx apps/web/src/features/scheduling/assignment-pages.test.tsx
git commit -m "feat(contracts): add sync, execution and problem read models and execution error codes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Azerbaijani strings for execution errors, states, reasons, issues and flags

**Files:**
- Create: `packages/i18n/src/az/executions.ts`
- Modify: `packages/i18n/src/az/errors.ts`, `packages/i18n/src/az/index.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `EXECUTION_STATES`, `CLAIM_REJECTION_REASONS`, `EXECUTION_ISSUE_CODES`, `PROBLEM_SOURCES`, `PROBLEM_SEVERITIES`, `MEDIA_KINDS`, `MEDIA_SOURCES` and the 9 new error codes (Tasks 1–3).
- Produces: `az.executions` with `states`, `claimRejections`, `alreadyClaimedBy`, `issues`, `problemSources`, `severities`, `flags`, `mediaKinds`, `mediaSources`. Part 3 adds web UI keys to the same file; Part 2 adds phone strings to `az.mobile`.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`. Extend the `@taskop/contracts` import with `CLAIM_REJECTION_REASONS`, `EXECUTION_ISSUE_CODES`, `EXECUTION_STATES`, `MEDIA_KINDS`, `MEDIA_SOURCES`, `PROBLEM_SEVERITIES` and `PROBLEM_SOURCES`:

```ts
describe('execution translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);

  it('translates states, claim rejections, issue codes, sources, severities and media labels', () => {
    for (const s of EXECUTION_STATES) expect(az.executions.states[s], s).toBeTypeOf('string');
    for (const r of CLAIM_REJECTION_REASONS) expect(az.executions.claimRejections[r], r).toBeTypeOf('string');
    for (const code of EXECUTION_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
    for (const s of PROBLEM_SOURCES) expect(az.executions.problemSources[s], s).toBeTypeOf('string');
    for (const s of PROBLEM_SEVERITIES) expect(az.executions.severities[s], s).toBeTypeOf('string');
    for (const k of MEDIA_KINDS) expect(az.executions.mediaKinds[k], k).toBeTypeOf('string');
    for (const k of MEDIA_SOURCES) expect(az.executions.mediaSources[k], k).toBeTypeOf('string');
  });

  it('uses the spec wording for the clock and the lost claim', () => {
    expect(az.errors.CLOCK_INVALID).toBe('Telefonun saatını yoxlayın.');
    expect(az.executions.alreadyClaimedBy.replace('{{name}}', 'Murad')).toBe('Bu checklist artıq Murad tərəfindən icra olunur');
    expect(az.executions.flags.mediaPending).toContain('{{count}}');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.executions` is undefined, and the error-code test fails for the 9 new codes.

- [ ] **Step 3: Implement**

`packages/i18n/src/az/executions.ts`:

```ts
export default {
  states: {
    active: 'İcra olunur',
    completed: 'Tamamlanıb',
    partial: 'Yarımçıq',
    rejected: 'Rədd edilib',
  },
  claimRejections: {
    ALREADY_CLAIMED: 'Bu checklist artıq başqa əməkdaş tərəfindən icra olunur.',
    NOT_ASSIGNED: 'Bu checklist sizə təyin olunmayıb.',
    NOT_STARTABLE: 'Bu checklist artıq başladıla bilməz.',
    NOT_YET_OPEN: 'İcra vaxtı hələ başlamayıb.',
    CLOSED: 'İcra vaxtı bitib.',
    NOT_ON_SHIFT: 'Bu gün bu növbədə işləmirsiniz.',
  },
  alreadyClaimedBy: 'Bu checklist artıq {{name}} tərəfindən icra olunur',
  issues: {
    unknownItem: 'Bu sual checklistin bu versiyasında yoxdur.',
    invalidValue: 'Cavab bu sual üçün uyğun deyil.',
    unknownOption: 'Seçilmiş variant bu suala aid deyil.',
    unknownMedia: 'Fayl bu icraya aid deyil və ya hələ qeydiyyatdan keçməyib.',
    tooManyMedia: 'Bu sual üçün çox fayl əlavə olunub.',
    answersTooLarge: 'Cavablar çox böyükdür.',
    rangeTooLong: 'Tarix aralığı çox uzundur (ən çox 92 gün).',
  },
  problemSources: { rule: 'Qayda üzrə', manual: 'Əl ilə qeyd' },
  severities: { normal: 'Adi', critical: 'Kritik' },
  flags: {
    late: 'Gecikib',
    partial: 'Yarımçıq',
    clockSuspect: 'Telefon saatı şübhəlidir',
    mediaPending: '{{count}} fayl hələ yüklənməyib',
  },
  mediaKinds: { photo: 'Foto', video: 'Video' },
  mediaSources: { camera: 'Kamera', gallery: 'Qalereya' },
} as const;
```

In `packages/i18n/src/az/errors.ts`, add before `INTERNAL`:

```ts
  REQUIREMENTS_UNMET: 'Tamamlamaq üçün tələb olunan bütün sahələri doldurun.',
  EXECUTION_NOT_ACTIVE: 'Bu icra artıq bağlanıb və dəyişdirilə bilməz.',
  NOT_EXECUTOR: 'Bu icranı yalnız onu başladan əməkdaş dəyişə bilər.',
  CLOCK_INVALID: 'Telefonun saatını yoxlayın.',
  MEDIA_TYPE_INVALID: 'Bu fayl növü dəstəklənmir.',
  MEDIA_TOO_LARGE: 'Fayl çox böyükdür.',
  MEDIA_LIMIT_REACHED: 'Bu sual üçün fayl limiti dolub.',
  MEDIA_NOT_FOUND_IN_STORAGE: 'Fayl hələ tam yüklənməyib.',
  EVIDENCE_LIVE_ONLY: 'Bu sual üçün yalnız kamera ilə çəkilmiş foto və ya video qəbul olunur.',
```

In `packages/i18n/src/az/index.ts`, import `executions from './executions.js'` and add `executions` to the `az` object after `errors`:

```ts
export const az = { common, errors, executions, audit, auth, checklists, mobile, nav, platform, roles, scheduling, settings, sites, teams, users } as const;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add Azerbaijani strings for execution errors, states, claim rejections and flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API client methods for sync, executions, media and problems

**Files:**
- Modify: `packages/api-client/src/endpoints.ts`, `packages/api-client/src/errors.ts`, `packages/api-client/src/client.ts`, `packages/api-client/src/client.test.ts`

**Interfaces:**
- Consumes: the schemas and types of Tasks 2–3.
- Produces:
  - `createExecutionsApi(c: ApiClient)`, `type ExecutionsApi`, and the methods in the table under **Interfaces for Parts 2 and 3**, spread into `createTaskopApi`.
  - `ApiError.missing: Missing[] | null`, as the 10th constructor parameter.

- [ ] **Step 1: Write the failing test**

Append to `packages/api-client/src/client.test.ts`:

```ts
describe('execution endpoints', () => {
  async function authed(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const store = memoryTokenStore();
    await store.save({ accessToken: 'a1', refreshToken: null });
    return setup(handler, 'mobile', store);
  }
  const progress = { answered: 0, total: 3, requiredMissing: 3 };

  it('builds every path, method and body', async () => {
    const calls: string[] = [];
    const { api } = await authed((url, init) => {
      calls.push(`${init.method} ${url} ${init.body ?? ''}`);
      if (url.includes('/me/sync')) return json(200, { serverTime: '2026-11-02T04:00:00.000Z', occurrences: [], checklistVersions: [], executions: [] });
      if (url.endsWith('/answers')) return json(200, { executionId: id, rev: 2, stale: false, state: 'active', progress });
      if (url.endsWith('/complete')) return json(200, { executionId: id, state: 'completed', completedAt: '2026-11-02T05:00:00.000Z', late: false, progress, score: null });
      if (url.endsWith(`/executions/${id}/media`)) return json(200, { mediaId: id, status: 'pending', uploadUrl: 'http://files.test/x', headers: { 'Content-Type': 'image/jpeg' }, expiresAt: '2026-11-02T04:15:00.000Z' });
      if (url.endsWith('/uploaded')) return json(200, { mediaId: id, status: 'uploaded', uploadedAt: '2026-11-02T04:01:00.000Z' });
      if (url.endsWith('/url')) return json(200, { url: 'http://files.test/x', expiresAt: '2026-11-02T04:05:00.000Z' });
      if (url.includes('/problems')) return json(200, { items: [], nextCursor: null });
      return json(200, { executionId: id, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: { executionId: id, executorUserId: id, executorName: 'Murad' }, checklistVersionId: id, startedAt: '2026-11-02T04:00:00.000Z', clockSuspect: false });
    });
    const t = createTaskopApi(api);
    const now = '2026-11-02T04:00:00.000Z';
    await t.sync.pull([id, id]);
    await t.sync.pull();
    const claim = await t.executions.claim({ id, occurrenceId: id, startedAt: now, deviceTime: now, clientOffsetMs: 0, device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' } });
    expect(claim).toMatchObject({ state: 'rejected', reason: 'ALREADY_CLAIMED', claim: { executorName: 'Murad' } });
    await t.executions.saveAnswers(id, { rev: 2, answers: {}, deviceTime: now, clientOffsetMs: 0 });
    await t.executions.complete(id, { rev: 3, answers: {}, completedAt: now, deviceTime: now, clientOffsetMs: 0 });
    await t.executions.registerMedia(id, { id, itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, capturedAt: now, deviceTime: now, clientOffsetMs: 0 });
    await t.media.confirmUploaded(id);
    await t.media.url(id);
    await t.problems.list({ from: '2026-11-01', to: '2026-11-30', severity: 'critical' });
    expect(calls.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
      `GET /api/v1/me/sync?knownVersionIds=${id}%2C${id}`,
      'GET /api/v1/me/sync',
      'POST /api/v1/executions',
      `PUT /api/v1/executions/${id}/answers`,
      `POST /api/v1/executions/${id}/complete`,
      `POST /api/v1/executions/${id}/media`,
      `POST /api/v1/media/${id}/uploaded`,
      `GET /api/v1/media/${id}/url`,
      'GET /api/v1/problems?from=2026-11-01&to=2026-11-30&severity=critical',
    ]);
  });

  it('exposes the missing requirements on REQUIREMENTS_UNMET', async () => {
    const { api } = await authed(() =>
      json(422, { error: { code: 'REQUIREMENTS_UNMET', messageKey: 'errors.REQUIREMENTS_UNMET', fields: null, retryAfterSeconds: null, requestId: 'r1', missing: [{ itemId: id, kind: 'photo' }] } }),
    );
    const now = '2026-11-02T04:00:00.000Z';
    await expect(createTaskopApi(api).executions.complete(id, { rev: 1, answers: {}, completedAt: now, deviceTime: now, clientOffsetMs: 0 })).rejects.toMatchObject({
      code: 'REQUIREMENTS_UNMET',
      missing: [{ itemId: id, kind: 'photo' }],
    });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/api-client test`
Expected: FAIL: `t.sync` is undefined.

- [ ] **Step 3: Implement**

In `packages/api-client/src/errors.ts`:
- Import `Missing` as a type from `@taskop/contracts`.
- Add a last constructor parameter after `userIds`:

```ts
    /** REQUIREMENTS_UNMET: what still blocks completion. */
    readonly missing: Missing[] | null = null,
```

In `packages/api-client/src/client.ts`, in `toApiError`, pass the new detail:

```ts
  return new ApiError(res.status, e.code, e.messageKey, e.fields, e.retryAfterSeconds, e.requestId, e.issues ?? null, e.currentRevision ?? null, e.userIds ?? null, e.missing ?? null);
```

In `packages/api-client/src/endpoints.ts`, add these to the `@taskop/contracts` import:

```ts
  type ClaimCommand,
  claimResultSchema,
  type CompleteCommand,
  completeResultSchema,
  executionDetailSchema,
  mediaConfirmResultSchema,
  mediaUploadTicketSchema,
  mediaUrlSchema,
  problemDtoSchema,
  type ProblemListQuery,
  type RegisterMediaCommand,
  type SaveAnswersCommand,
  saveAnswersResultSchema,
  syncResponseSchema,
```

add `...createExecutionsApi(c),` as the last line of the object returned by `createTaskopApi` (after `...createSchedulingApi(c),`), and append:

```ts
/** Sub-project 4: the phone's sync and upload commands, and the web's execution and problem reads. */
export function createExecutionsApi(c: ApiClient) {
  return {
    sync: {
      pull: (knownVersionIds: string[] = []) =>
        c.request('GET', '/me/sync', { query: { knownVersionIds: knownVersionIds.join(',') }, schema: syncResponseSchema }),
    },
    executions: {
      claim: (body: ClaimCommand) => c.request('POST', '/executions', { body, schema: claimResultSchema }),
      saveAnswers: (id: string, body: SaveAnswersCommand) => c.request('PUT', `/executions/${id}/answers`, { body, schema: saveAnswersResultSchema }),
      complete: (id: string, body: CompleteCommand) => c.request('POST', `/executions/${id}/complete`, { body, schema: completeResultSchema }),
      registerMedia: (executionId: string, body: RegisterMediaCommand) =>
        c.request('POST', `/executions/${executionId}/media`, { body, schema: mediaUploadTicketSchema }),
      get: (id: string) => c.request('GET', `/executions/${id}`, { schema: executionDetailSchema }),
    },
    media: {
      confirmUploaded: (id: string) => c.request('POST', `/media/${id}/uploaded`, { body: {}, schema: mediaConfirmResultSchema }),
      url: (id: string) => c.request('GET', `/media/${id}/url`, { schema: mediaUrlSchema }),
    },
    problems: {
      list: (query: ProblemListQuery) => c.request('GET', '/problems', { query: q(query), schema: pageOf(problemDtoSchema) }),
    },
  };
}
export type ExecutionsApi = ReturnType<typeof createExecutionsApi>;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api-client test && pnpm --filter @taskop/api-client typecheck && pnpm --filter @taskop/api-client build && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. The empty `knownVersionIds` is dropped from the query string by `toQueryString`.

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add sync, execution, media and problem endpoints" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: SeaweedFS storage and `S3Service`

**Files:**
- Create:
  - `docker/seaweedfs/s3.json`
  - `apps/api/src/storage/s3.service.ts`, `apps/api/src/storage/storage.module.ts`
  - `apps/api/test/seaweedfs.ts`
- Test: `apps/api/test/storage.test.ts`, `apps/api/src/config/config.test.ts`
- Modify: `docker-compose.yml`, `README.md`, `.github/workflows/ci.yml`, `apps/api/package.json` (adds the AWS SDK and `testcontainers`), `apps/api/src/config/config.ts`, `apps/api/.env.example`, `apps/api/src/app.module.ts`, `apps/api/test/app.ts`

**Interfaces:**
- Produces:
  - Config:
    - `S3_ENDPOINT` (url): server-side calls.
    - `S3_PUBLIC_ENDPOINT` (url): what presigned URLs are signed against.
    - `S3_BUCKET` (default `taskop-media`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
    - `S3_FORCE_PATH_STYLE` (default `true`).
  - `S3Service` (global, from `StorageModule`):
    - `presignPut(key: string, contentType: string, contentLength: number): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>`
    - `presignGet(key: string): Promise<{ url: string; expiresAt: Date }>`
    - `head(key: string): Promise<{ contentLength: number; contentType: string | null } | null>`
    - `delete(key: string): Promise<void>`
  - Test helpers:
    - `startSeaweedfs(): Promise<Seaweed>`, where `Seaweed = { env: Record<string, string>; stop(): Promise<void> }`. The bucket already exists when it returns.
    - `testEnv` now includes dummy `S3_*` values. `S3_PUBLIC_ENDPOINT` is `http://files.taskop.test`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/config/config.test.ts`. Extend `valid` with:

```ts
  S3_ENDPOINT: 'http://localhost:8333',
  S3_PUBLIC_ENDPOINT: 'http://192.168.1.20:8333',
  S3_ACCESS_KEY: 'taskop',
  S3_SECRET_KEY: 'taskop_dev_password',
```

and add the test:

```ts
  it('reads storage settings with defaults and requires the endpoints', () => {
    const c = loadConfig(valid);
    expect([c.S3_BUCKET, c.S3_FORCE_PATH_STYLE, c.S3_PUBLIC_ENDPOINT]).toEqual(['taskop-media', true, 'http://192.168.1.20:8333']);
    expect(() => loadConfig({ ...valid, S3_ENDPOINT: undefined })).toThrow(/S3_ENDPOINT/);
  });
```

`apps/api/test/seaweedfs.ts`:

```ts
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait } from 'testcontainers';

const ACCESS_KEY = 'taskop-test';
const SECRET_KEY = 'taskop-test-secret';
const BUCKET = 'taskop-media';
const S3_JSON = JSON.stringify({
  identities: [{ name: 'taskop', credentials: [{ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'] }],
});

export interface Seaweed {
  /** The S3_* overrides for createTestApp / testEnv. */
  env: Record<string, string>;
  stop: () => Promise<void>;
}

/** One SeaweedFS (master + volume + filer + S3 gateway) with the private bucket created. Only storage tests use it. */
export async function startSeaweedfs(): Promise<Seaweed> {
  const container = await new GenericContainer('chrislusf/seaweedfs:latest')
    .withCopyContentToContainer([{ content: S3_JSON, target: '/etc/seaweedfs/s3.json' }])
    .withCommand(['server', '-s3', '-s3.config=/etc/seaweedfs/s3.json', '-dir=/data'])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(8333)}`;
  const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });
  // The S3 port opens before the master and volume server are ready: retry until the bucket exists.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      break;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') break;
      if (Date.now() > deadline) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  s3.destroy();
  return {
    env: { S3_ENDPOINT: endpoint, S3_PUBLIC_ENDPOINT: endpoint, S3_BUCKET: BUCKET, S3_ACCESS_KEY: ACCESS_KEY, S3_SECRET_KEY: SECRET_KEY, S3_FORCE_PATH_STYLE: 'true' },
    stop: async () => {
      await container.stop();
    },
  };
}
```

`apps/api/test/storage.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config';
import { S3Service } from '../src/storage/s3.service';
import { testEnv } from './app';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

describe('S3Service against SeaweedFS', () => {
  let sw: Seaweed;
  let s3: S3Service;
  beforeAll(async () => {
    sw = await startSeaweedfs();
    s3 = new S3Service(loadConfig(testEnv(sw.env)));
  });
  afterAll(async () => {
    s3?.onModuleDestroy();
    await sw?.stop();
  });

  it('uploads through a presigned PUT, reads it back through a presigned GET and deletes it', async () => {
    const key = `t/test/e/test/${crypto.randomUUID()}.jpg`;
    const body = Buffer.alloc(1234, 7);
    const put = await s3.presignPut(key, 'image/jpeg', body.length);
    // Spec §6.7: Content-Type and Content-Length are bound by the signature.
    expect(new URL(put.url).searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(put.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Content-Length': '1234' });
    expect(+put.expiresAt - Date.now()).toBeGreaterThan(14 * 60_000);
    const res = await fetch(put.url, { method: 'PUT', body, headers: { 'Content-Type': 'image/jpeg' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await s3.head(key)).toEqual({ contentLength: 1234, contentType: 'image/jpeg' });
    const get = await s3.presignGet(key);
    expect(+get.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const down = await fetch(get.url);
    expect(Buffer.from(await down.arrayBuffer())).toEqual(body);
    await s3.delete(key);
    expect(await s3.head(key)).toBeNull();
  });

  it('keeps the bucket private', async () => {
    expect((await fetch(`${sw.env.S3_ENDPOINT}/taskop-media/anything.jpg`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- config storage`
Expected: FAIL: `testcontainers` and `../src/storage/s3.service` cannot be resolved, and `S3_BUCKET` is undefined.

- [ ] **Step 3: Install the packages**

```bash
pnpm --filter @taskop/api add @aws-sdk/client-s3@latest @aws-sdk/s3-request-presigner@latest
pnpm --filter @taskop/api add -D testcontainers@latest
```

Both AWS packages must end up on the same version line; pnpm resolves `@latest` for each at the same moment, so check that `apps/api/package.json` shows matching versions.

- [ ] **Step 4: Add the config**

In `apps/api/src/config/config.ts`, add to `configSchema` (before `LOG_LEVEL`):

```ts
  /** Server-side S3 calls (HEAD, DELETE), e.g. http://seaweedfs:8333 (spec §9). */
  S3_ENDPOINT: z.url(),
  /** The host phones and browsers reach; presigned URLs are signed against it (S3 signatures cover the host). */
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(3).default('taskop-media'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
```

Append to `apps/api/.env.example`:

```
# Photo/video storage (SeaweedFS from docker-compose; credentials in docker/seaweedfs/s3.json).
S3_ENDPOINT=http://localhost:8333
# Phones upload here directly. On a physical phone use your Mac's LAN IP, e.g. http://192.168.1.20:8333
S3_PUBLIC_ENDPOINT=http://localhost:8333
S3_BUCKET=taskop-media
S3_ACCESS_KEY=taskop
S3_SECRET_KEY=taskop_dev_password
S3_FORCE_PATH_STYLE=true
```

In `apps/api/test/app.ts`, add to `testEnv` (before `...overrides`):

```ts
    // Presigning works offline; only the storage tests override these with a real SeaweedFS.
    S3_ENDPOINT: 'http://127.0.0.1:9',
    S3_PUBLIC_ENDPOINT: 'http://files.taskop.test',
    S3_BUCKET: 'taskop-media',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test-secret',
    S3_FORCE_PATH_STYLE: 'true',
```

In `.github/workflows/ci.yml`, the `e2e` job starts the API, which now needs the storage settings. Add to its `env:` block, after `LOG_LEVEL: warn`:

```yaml
      # The API only needs these to boot; the e2e flow (Part 3) drives executions through the API without uploads.
      S3_ENDPOINT: http://localhost:8333
      S3_PUBLIC_ENDPOINT: http://localhost:8333
      S3_ACCESS_KEY: ci
      S3_SECRET_KEY: ci-secret
```

The `build` job's `pnpm test` starts the SeaweedFS Testcontainer like the Postgres one; GitHub's Ubuntu runners have Docker.

- [ ] **Step 5: Implement the service**

`apps/api/src/storage/s3.service.ts`:

```ts
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { MEDIA_LIMITS } from '@taskop/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config';

export interface PresignedPut {
  url: string;
  /** Exactly what the client must send with the PUT. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StoredObject {
  contentLength: number;
  contentType: string | null;
}

const isNotFound = (e: unknown): boolean => {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return err?.name === 'NotFound' || err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
};

/**
 * The only code that talks to object storage (spec §9). HEAD and DELETE go to S3_ENDPOINT; presigned URLs are signed
 * against S3_PUBLIC_ENDPOINT, because the signature covers the host the phone or browser will use.
 * Signatures use the real time, never the injectable Clock: storage checks them against its own clock.
 */
@Injectable()
export class S3Service implements OnModuleDestroy {
  private readonly internal: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const base: S3ClientConfig = {
      region: 'us-east-1',
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // Newer SDKs add CRC32 checksum parameters to every PutObject; S3-compatible stores and presigned PUTs need them off.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    this.internal = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.publicClient = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT });
    this.bucket = config.S3_BUCKET;
  }

  /** Presigned PUT valid 15 min with Content-Type and Content-Length bound (spec §6.7). */
  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    const expiresIn = MEDIA_LIMITS.uploadUrlTtlSeconds;
    const url = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      // The presigner leaves content-type unsigned by default; signableHeaders brings both back in.
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return { url, headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) }, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  /** Presigned GET valid 5 min; callers check permissions first. */
  async presignGet(key: string): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = MEDIA_LIMITS.downloadUrlTtlSeconds;
    const url = await getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  /** null when the object does not exist (yet). */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const r = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentLength: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /** Idempotent: deleting a missing object succeeds. */
  async delete(key: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onModuleDestroy(): void {
    this.internal.destroy();
    this.publicClient.destroy();
  }
}
```

`apps/api/src/storage/storage.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';

@Global()
@Module({ providers: [S3Service], exports: [S3Service] })
export class StorageModule {}
```

In `apps/api/src/app.module.ts`, import `StorageModule` from `'./storage/storage.module'` and add it to `imports` right after `CommonModule`.

- [ ] **Step 6: Replace MinIO with SeaweedFS for local development**

`docker/seaweedfs/s3.json`:

```json
{
  "identities": [
    {
      "name": "taskop",
      "credentials": [{ "accessKey": "taskop", "secretKey": "taskop_dev_password" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
```

In `docker-compose.yml`, replace the `minio` service with:

```yaml
  seaweedfs:
    image: chrislusf/seaweedfs:latest
    command: server -s3 -s3.config=/etc/seaweedfs/s3.json -dir=/data
    ports: ['8333:8333']
    volumes:
      - seaweedfsdata:/data
      - ./docker/seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro
  # One-off: creates the private bucket; exits once it exists (restarts until SeaweedFS answers).
  seaweedfs-init:
    image: amazon/aws-cli:latest
    depends_on: [seaweedfs]
    restart: on-failure
    environment:
      AWS_ACCESS_KEY_ID: taskop
      AWS_SECRET_ACCESS_KEY: taskop_dev_password
      AWS_DEFAULT_REGION: us-east-1
    entrypoint:
      - sh
      - -c
      - aws --endpoint-url http://seaweedfs:8333 s3api head-bucket --bucket taskop-media || aws --endpoint-url http://seaweedfs:8333 s3api create-bucket --bucket taskop-media
```

and in `volumes:` replace `miniodata: {}` with `seaweedfsdata: {}`.

In `README.md`:
- Under "First run", after `- Mail catcher (Mailpit): http://localhost:8025`, add:

```markdown
- File storage (SeaweedFS, S3 API): http://localhost:8333, private bucket `taskop-media` (created by `seaweedfs-init`). Dev credentials are in `docker/seaweedfs/s3.json`.
```

- Under "Mobile (Expo)", add:

```markdown
Photo and video uploads go straight from the phone to storage. On a physical phone set both `EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:3000` (mobile `.env`) and `S3_PUBLIC_ENDPOINT=http://<mac-lan-ip>:8333` (API `.env`).
```

- [ ] **Step 7: Check the SeaweedFS command against the current image, then run the tests**

The `-s3.config` flag and `server -s3` are documented in the SeaweedFS wiki ("Amazon S3 API", "S3 Credentials"), but flags do change between releases. Verify them first:

```bash
docker run --rm chrislusf/seaweedfs:latest server -h 2>&1 | grep -E -- '-s3( |$)|-s3\.config|-dir'
```

Expected: lines for `-s3`, `-s3.config` and `-dir`. If `-s3.config` is missing, the image has renamed it. Use the flag name the help prints, both in `docker-compose.yml` and in `test/seaweedfs.ts`.

```bash
docker compose up -d seaweedfs seaweedfs-init && sleep 5 && docker compose logs seaweedfs-init | tail -3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8333/taskop-media/x.jpg
```

Expected: the init log shows the bucket created (or `head-bucket` succeeding on a re-run), and `curl` prints `403` because the bucket is private.

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- config storage health`
Expected: PASS. The first run pulls the SeaweedFS image.
- If `X-Amz-SignedHeaders` lacks `content-length`, the installed SDK no longer puts the header on the request before presigning. Keep the assertion, because spec §6.7 requires the binding. Find which middleware drops the header with a breakpoint in `S3RequestPresigner.presign`; it is not something to remove from the test. The HEAD size check in Task 15 still catches a wrong size either way.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml docker/seaweedfs/s3.json README.md .github/workflows/ci.yml apps/api/package.json pnpm-lock.yaml apps/api/.env.example apps/api/src/config apps/api/src/storage apps/api/src/app.module.ts apps/api/test/app.ts apps/api/test/seaweedfs.ts apps/api/test/storage.test.ts
git commit -m "feat(api): replace MinIO with SeaweedFS and add the S3 storage service" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Executions, media and problems tables

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0007_executions.sql` (generated), `apps/api/drizzle/0008_executions_security.sql` (custom)
- Test: `apps/api/test/executions-db.test.ts`

**Interfaces:**
- Produces Drizzle enums and tables, used by every later API task:
  - Enums: `executionState`, `claimRejectionReason`, `mediaKind`, `mediaSource`, `mediaStatus`, `problemSource`, `problemSeverity`
  - `occurrences.checklistVersionId` (nullable, composite FK to `checklist_versions`)
  - `executions`. The partial unique index `executions_claim_uq` on `(occurrence_id) where state <> 'rejected'` is the claim lock, and Task 9 targets it with `ON CONFLICT DO NOTHING`.
  - `executionMedia`, with `storagePurgedAt`
  - `executionProblems`, with unique `execution_problems_item_uq (execution_id, item_id, source)`, the target of Task 11's upsert
- Column types: `timestamptz` columns are `Date`. `answers`, `progress`, `score` and `device` are `jsonb`. `media_ids` is `uuid[]`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-db.test.ts`:

```ts
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestApp, type TestApp } from './app';
import { signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

const TABLES = ['executions', 'execution_media', 'execution_problems'];

async function asApp<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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

/** A raw site, published version, assignment and occurrence (no API), so the execution tables can be exercised alone. */
async function seedOccurrence(tenantId: string, ownerId: string) {
  const typeId = await siteTypeIdOf(tenantId);
  const one = async (text: string, params: unknown[]) => (await ownerQuery<{ id: string }>(text, params)).rows[0]!.id;
  const siteId = await one("insert into sites (id, tenant_id, type_id, name, path) values (gen_random_uuid(), $1, $2, 'S', 'x') returning id", [tenantId, typeId]);
  const checklistId = await one("insert into checklists (id, tenant_id, name, created_by_user_id) values (gen_random_uuid(), $1, 'C', $2) returning id", [tenantId, ownerId]);
  const versionId = await one(
    `insert into checklist_versions (id, tenant_id, checklist_id, state, number, content, created_by_user_id, published_by_user_id, published_at)
     values (gen_random_uuid(), $1, $2, 'published', 1, '{}'::jsonb, $3, $3, now()) returning id`,
    [tenantId, checklistId, ownerId],
  );
  const assignmentId = await one(
    `insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, created_by_user_id)
     values (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, '{}'::jsonb, $4) returning id`,
    [tenantId, checklistId, siteId, ownerId],
  );
  const occurrenceId = await one(
    `insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, checklist_version_id)
     values (gen_random_uuid(), $1, $2, $3, $4, '2026-11-02', '2026-11-02T04:00Z', '2026-11-02T06:00Z', '2026-11-02T07:00Z', $5) returning id`,
    [tenantId, assignmentId, checklistId, siteId, versionId],
  );
  const execution = (state: string, reason: string | null = null) =>
    ownerQuery<{ id: string }>(
      `insert into executions (id, tenant_id, occurrence_id, checklist_version_id, executor_user_id, state, rejected_reason,
                               started_at, started_received_at, last_synced_at, progress, device)
       values ($1, $2, $3, $4, $5, $6, $7, now(), now(), now(), '{"answered":0,"total":1,"requiredMissing":1}', '{"platform":"ios","osVersion":"26","appVersion":"1"}')
       returning id`,
      [uuidv7(), tenantId, occurrenceId, versionId, ownerId, state, reason],
    );
  return { siteId, checklistId, occurrenceId, execution };
}

describe('execution tables', () => {
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

  it('allows one counted execution per occurrence but any number of rejected ones', async () => {
    const s = await signupTenant(t);
    const { execution } = await seedOccurrence(s.tenantId, s.ownerId);
    await execution('active');
    await execution('rejected', 'ALREADY_CLAIMED');
    await execution('rejected', 'NOT_ON_SHIFT');
    await expect(execution('completed')).rejects.toThrow(/executions_claim_uq/);
  });

  it('requires a reason exactly when rejected', async () => {
    const s = await signupTenant(t);
    const { execution } = await seedOccurrence(s.tenantId, s.ownerId);
    await expect(execution('rejected')).rejects.toThrow(/executions_rejected_ck/);
    await expect(execution('active', 'CLOSED')).rejects.toThrow(/executions_rejected_ck/);
  });

  it('hides another tenant’s executions and lets the app account delete only problems', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { execution, occurrenceId, siteId, checklistId } = await seedOccurrence(a.tenantId, a.ownerId);
    const executionId = (await execution('active')).rows[0]!.id;
    await ownerQuery(
      `insert into execution_problems (id, tenant_id, execution_id, occurrence_id, site_id, checklist_id, item_id, source, severity, media_ids)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, gen_random_uuid(), 'manual', 'critical', '{}')`,
      [a.tenantId, executionId, occurrenceId, siteId, checklistId],
    );
    expect((await asApp(b.tenantId, (c) => c.query('select id from executions'))).rowCount).toBe(0);
    await asApp(a.tenantId, async (c) => {
      expect((await c.query('select id from executions')).rowCount).toBe(1);
      expect((await c.query('delete from execution_problems')).rowCount).toBe(1);
      await c.query('savepoint sp');
      await expect(c.query('delete from executions')).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint sp');
      await expect(c.query('delete from execution_media')).rejects.toThrow(/permission denied/);
    });
  });

  it('pins occurrences only to versions of the same tenant', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { occurrenceId } = await seedOccurrence(a.tenantId, a.ownerId);
    const foreign = await seedOccurrence(b.tenantId, b.ownerId);
    const foreignVersion = (await ownerQuery<{ v: string }>('select checklist_version_id as v from occurrences where id = $1', [foreign.occurrenceId])).rows[0]!.v;
    await expect(ownerQuery('update occurrences set checklist_version_id = $1 where id = $2', [foreignVersion, occurrenceId])).rejects.toThrow(/occurrences_version_fk/);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-db`
Expected: FAIL: the `checklist_version_id` column and the `executions` relation do not exist.

- [ ] **Step 3: Add the tables to the Drizzle schema**

In `apps/api/src/db/schema.ts`:

1. In the `occurrences` table, add the column after `cancelReason`:

```ts
    // Pinned at the first download by an assignee or at the claim, then never changed (SP4 spec §5.1).
    checklistVersionId: uuid('checklist_version_id'),
```

and the foreign key after `occurrences_shift_fk`:

```ts
    foreignKey({ columns: [t.tenantId, t.checklistVersionId], foreignColumns: [checklistVersions.tenantId, checklistVersions.id], name: 'occurrences_version_fk' }),
```

2. Append at the end of the file:

```ts
// Must match EXECUTION_STATES, CLAIM_REJECTION_REASONS, MEDIA_*, PROBLEM_SOURCES and PROBLEM_SEVERITIES in @taskop/contracts.
export const executionState = pgEnum('execution_state', ['active', 'completed', 'partial', 'rejected']);
export const claimRejectionReason = pgEnum('claim_rejection_reason', ['ALREADY_CLAIMED', 'NOT_ASSIGNED', 'NOT_STARTABLE', 'NOT_YET_OPEN', 'CLOSED', 'NOT_ON_SHIFT']);
export const mediaKind = pgEnum('media_kind', ['photo', 'video']);
export const mediaSource = pgEnum('media_source', ['camera', 'gallery']);
export const mediaStatus = pgEnum('media_status', ['pending', 'uploaded']);
export const problemSource = pgEnum('problem_source', ['rule', 'manual']);
export const problemSeverity = pgEnum('problem_severity', ['normal', 'critical']);

/** One attempt to execute an occurrence (SP4 spec §5.2). The id is generated on the phone, so every command is idempotent. */
export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    checklistVersionId: uuid('checklist_version_id').notNull(),
    executorUserId: uuid('executor_user_id').notNull(),
    state: executionState('state').notNull(),
    rejectedReason: claimRejectionReason('rejected_reason'),
    // Device times (after bounds), with the server receipt times beside them (BR-11).
    startedAt: ts('started_at').notNull(),
    startedReceivedAt: ts('started_received_at').notNull(),
    completedAt: ts('completed_at'),
    completedReceivedAt: ts('completed_received_at'),
    lastSyncedAt: ts('last_synced_at').notNull(),
    answers: jsonb('answers').notNull().default({}),
    answersRev: integer('answers_rev').notNull().default(0),
    progress: jsonb('progress').notNull(),
    score: jsonb('score'),
    late: boolean('late').notNull().default(false),
    clockOffsetMs: integer('clock_offset_ms'),
    clockSuspect: boolean('clock_suspect').notNull().default(false),
    device: jsonb('device').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('executions_tenant_id_uq').on(t.tenantId, t.id),
    // The claim lock (FR-09.11, BR-13): one counted execution per occurrence; rejected ones are kept beside it.
    uniqueIndex('executions_claim_uq').on(t.occurrenceId).where(sql`state <> 'rejected'`),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'executions_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistVersionId], foreignColumns: [checklistVersions.tenantId, checklistVersions.id], name: 'executions_version_fk' }),
    foreignKey({ columns: [t.tenantId, t.executorUserId], foreignColumns: [users.tenantId, users.id], name: 'executions_executor_fk' }),
    check('executions_rejected_ck', sql`(${t.state} = 'rejected') = (${t.rejectedReason} is not null)`),
    index('executions_executor_idx').on(t.tenantId, t.executorUserId, t.startedAt),
    index('executions_occurrence_idx').on(t.tenantId, t.occurrenceId),
  ],
);

/** Photos and videos (FR-12). The file itself lives in object storage under storage_key. */
export const executionMedia = pgTable(
  'execution_media',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    // null = attached only to a manual problem.
    itemId: uuid('item_id'),
    kind: mediaKind('kind').notNull(),
    source: mediaSource('source').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    capturedAt: ts('captured_at').notNull(),
    capturedByUserId: uuid('captured_by_user_id').notNull(),
    storageKey: text('storage_key').notNull(),
    status: mediaStatus('status').notNull().default('pending'),
    uploadedAt: ts('uploaded_at'),
    // Set by media.cleanup when it deleted the object of a never-uploaded medium.
    storagePurgedAt: ts('storage_purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('execution_media_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_media_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.capturedByUserId], foreignColumns: [users.tenantId, users.id], name: 'execution_media_captured_by_fk' }),
    index('execution_media_execution_idx').on(t.tenantId, t.executionId),
    index('execution_media_status_idx').on(t.tenantId, t.status, t.createdAt),
  ],
);

/** Rule and manual problems of counted executions (FR-13), derived from the answers; frozen once the execution closes. */
export const executionProblems = pgTable(
  'execution_problems',
  {
    id: id(),
    tenantId: tenantId(),
    executionId: uuid('execution_id').notNull(),
    occurrenceId: uuid('occurrence_id').notNull(),
    siteId: uuid('site_id').notNull(),
    checklistId: uuid('checklist_id').notNull(),
    itemId: uuid('item_id').notNull(),
    source: problemSource('source').notNull(),
    severity: problemSeverity('severity').notNull(),
    note: text('note'),
    mediaIds: uuid('media_ids').array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('execution_problems_item_uq').on(t.executionId, t.itemId, t.source),
    foreignKey({ columns: [t.tenantId, t.executionId], foreignColumns: [executions.tenantId, executions.id], name: 'execution_problems_execution_fk' }),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'execution_problems_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'execution_problems_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'execution_problems_checklist_fk' }),
    index('execution_problems_site_idx').on(t.tenantId, t.siteId, t.createdAt),
    index('execution_problems_severity_idx').on(t.tenantId, t.severity, t.createdAt),
  ],
);
```

- [ ] **Step 4: Generate the migrations**

```bash
pnpm --filter @taskop/api exec drizzle-kit generate --name executions
pnpm --filter @taskop/api exec drizzle-kit generate --custom --name executions_security
```

Check the output:
- `apps/api/drizzle/0007_executions.sql` contains:
  - the 7 `CREATE TYPE`s and the 3 `CREATE TABLE`s
  - `ALTER TABLE "occurrences" ADD COLUMN "checklist_version_id" uuid` and the `occurrences_version_fk` constraint
  - the check, and the indexes
- The claim index ends in `WHERE state <> 'rejected'`.
- `0008_executions_security.sql` is created empty.

Write `apps/api/drizzle/0008_executions_security.sql`:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['executions','execution_media','execution_problems']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Executions and media are never deleted (SP4 spec §5.3); a never-uploaded medium keeps its row.
GRANT SELECT, INSERT, UPDATE ON executions, execution_media TO taskop_app, taskop_platform;
--> statement-breakpoint
-- Problems are derived from the answers and rewritten on every accepted save while the execution is active.
GRANT SELECT, INSERT, UPDATE, DELETE ON execution_problems TO taskop_app, taskop_platform;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-db scheduling-db`
Expected: PASS. The global test setup applies the new migrations to a fresh container.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/executions-db.test.ts
git commit -m "feat(api): add executions, media and problems tables with the claim lock and RLS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Scheduling hooks: version pinning, multi-step transitions and `canStart` for missed occurrences

**Files:**
- Create: `apps/api/test/execution-fixtures.ts` (first helpers; Task 9 extends it)
- Modify: `apps/api/src/scheduling/occurrence-writer.ts`, `apps/api/src/scheduling/eligibility.service.ts`, `apps/api/src/scheduling/scheduling.module.ts`
- Test: `apps/api/test/occurrence-writer.test.ts`

**Interfaces:**
- Consumes: `occurrences.checklistVersionId` (Task 7); `OccurrenceWriter.recordTransitions`, `Transition`.
- Produces:
  - `OccurrenceWriter.pinVersions(occurrenceIds: string[]): Promise<void>`. It sets `checklist_version_id = checklists.current_version_id` where it is still null, and never changes a pinned one.
  - `OccurrenceWriter.applyTransitions(steps: Transition[]): Promise<void>`
    - `steps` all belong to one occurrence, in order.
    - It sets the status to the last `to` and `status_changed_at` to the last `at`, then writes one history row and one `occurrence.status_changed` event per step.
  - `EligibilityService.canStart(occurrenceId, userId, at, opts?: { allowMissed?: boolean })`. With `allowMissed`, a `missed` occurrence is startable; `CLOSED`, `NOT_YET_OPEN` and `NOT_ON_SHIFT` still apply.
  - `SchedulingModule` exports `EligibilityService`, `OccurrenceWriter`, `OccurrenceQueries` and `SchedulingScope`.
  - Test helper `publishNextVersion(api, checklistId, content): Promise<string>` (returns the new version id).

- [ ] **Step 1: Write the failing test**

`apps/api/test/execution-fixtures.ts`:

```ts
import type { ChecklistContent } from '@taskop/contracts';
import { expect } from 'vitest';
import type { Api } from './scheduling-fixtures';

/** Opens a draft from the current version, saves `content` and publishes it; returns the new version id. */
export async function publishNextVersion(api: Api, checklistId: string, content: ChecklistContent): Promise<string> {
  expect((await api.post(`/api/v1/checklists/${checklistId}/draft`, {})).status).toBe(201);
  expect((await api.put(`/api/v1/checklists/${checklistId}/draft`, { content, revision: 1 })).status).toBe(200);
  const res = await api.post(`/api/v1/checklists/${checklistId}/publish`, { revision: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id as string;
}
```

`apps/api/test/occurrence-writer.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { DbService } from '../src/db/db.service';
import { EligibilityService } from '../src/scheduling/eligibility.service';
import { OccurrenceWriter } from '../src/scheduling/occurrence-writer';
import { createTestApp, type TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { publishNextVersion } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';

const versionOf = async (occurrenceId: string) =>
  (await ownerQuery<{ v: string | null }>('select checklist_version_id as v from occurrences where id = $1', [occurrenceId])).rows[0]!.v;

describe('scheduling hooks for executions', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('pins the current version once and never changes it', async () => {
    const w = await schedulingWorld(t);
    const [first, second] = await occurrenceRows((await createAssignment(w)).id);
    const writer = t.app.get(OccurrenceWriter);
    const inTenant = <T>(fn: () => Promise<T>) => t.app.get(DbService).withTenant(w.s.tenantId, w.s.ownerId, fn);
    const v1 = (await ownerQuery<{ v: string }>('select current_version_id as v from checklists where id = $1', [w.checklistId])).rows[0]!.v;
    await inTenant(() => writer.pinVersions([first!.id]));
    expect(await versionOf(first!.id)).toBe(v1);
    expect(await versionOf(second!.id)).toBeNull();
    const v2 = await publishNextVersion(w.api, w.checklistId, sampleContent());
    await inTenant(() => writer.pinVersions([first!.id, second!.id]));
    expect(await versionOf(first!.id)).toBe(v1);
    expect(await versionOf(second!.id)).toBe(v2);
  });

  it('applies several transitions with one history row and one event each', async () => {
    const w = await schedulingWorld(t);
    const first = (await occurrenceRows((await createAssignment(w)).id))[0]!;
    const seen: string[] = [];
    const off = t.app.get(DomainEvents).on('occurrence.status_changed', (e) => {
      if (e.occurrenceId === first.id) seen.push(`${e.from}->${e.to}@${e.at.toISOString()}`);
    });
    try {
      await t.app.get(DbService).withTenant(w.s.tenantId, w.workers[0]!, () =>
        t.app.get(OccurrenceWriter).applyTransitions([
          { occurrenceId: first.id, from: 'pending', to: 'started', at: new Date('2026-11-02T04:05:00Z') },
          { occurrenceId: first.id, from: 'started', to: 'in_progress', at: new Date('2026-11-02T04:10:00Z'), reason: 'late_sync' },
        ]),
      );
    } finally {
      off();
    }
    expect(seen).toEqual(['pending->started@2026-11-02T04:05:00.000Z', 'started->in_progress@2026-11-02T04:10:00.000Z']);
    const occ = await ownerQuery<{ status: string; status_changed_at: Date }>('select status, status_changed_at from occurrences where id = $1', [first.id]);
    expect(occ.rows[0]).toEqual({ status: 'in_progress', status_changed_at: new Date('2026-11-02T04:10:00Z') });
    const history = await ownerQuery<{ to_status: string; actor_user_id: string; reason: string | null }>(
      'select to_status, actor_user_id, reason from occurrence_status_history where occurrence_id = $1 order by id',
      [first.id],
    );
    expect(history.rows.slice(1)).toEqual([
      { to_status: 'started', actor_user_id: w.workers[0], reason: null },
      { to_status: 'in_progress', actor_user_id: w.workers[0], reason: 'late_sync' },
    ]);
  });

  it('lets a missed occurrence start only when asked to, and never after it closed', async () => {
    const w = await schedulingWorld(t);
    const [first, second] = await occurrenceRows((await createAssignment(w)).id);
    await ownerQuery("update occurrences set status = 'missed' where id = $1", [first!.id]);
    await ownerQuery("update occurrences set status = 'cancelled' where id = $1", [second!.id]);
    const elig = t.app.get(EligibilityService);
    const w0 = w.workers[0]!;
    const check = (id: string, iso: string, allowMissed?: boolean) =>
      t.app.get(DbService).withTenant(w.s.tenantId, null, () => elig.canStart(id, w0, new Date(iso), allowMissed === undefined ? undefined : { allowMissed }));
    expect(await check(first!.id, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
    expect(await check(first!.id, '2026-11-02T04:30:00Z', true)).toEqual({ ok: true, late: false });
    expect(await check(first!.id, '2026-11-02T06:30:00Z', true)).toEqual({ ok: true, late: true });
    expect(await check(first!.id, '2026-11-02T07:00:00Z', true)).toEqual({ ok: false, reason: 'CLOSED' });
    expect(await check(second!.id, '2026-11-03T04:30:00Z', true)).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- occurrence-writer`
Expected: FAIL: `writer.pinVersions is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/scheduling/occurrence-writer.ts`, add these two methods after `regenerate`:

```ts
  /**
   * Pins the checklist version that is current now on occurrences that have none yet (SP4 spec §5.1):
   * at the first download by an assignee or at the claim. A pinned version never changes.
   */
  async pinVersions(occurrenceIds: string[]): Promise<void> {
    if (!occurrenceIds.length) return;
    await this.db.tx().execute(sql`
      update occurrences set checklist_version_id = c.current_version_id
        from checklists c
       where c.id = occurrences.checklist_id
         and occurrences.checklist_version_id is null
         and c.current_version_id is not null
         and ${inArray(occurrences.id, occurrenceIds)}`);
  }

  /**
   * Moves one occurrence through `steps` in order (SP4 spec §3): the status becomes the last `to` at the last `at`,
   * and every step gets its own history row and event, so a late sync that jumps several states stays readable.
   */
  async applyTransitions(steps: Transition[]): Promise<void> {
    const last = steps[steps.length - 1];
    if (!last) return;
    await this.db
      .tx()
      .update(occurrences)
      .set({ status: last.to, statusChangedAt: last.at, updatedAt: this.clock.now() })
      .where(eq(occurrences.id, last.occurrenceId));
    await this.recordTransitions(steps);
  }
```

In `apps/api/src/scheduling/eligibility.service.ts`, replace the `canStart` signature and the status check:

```ts
  /** `allowMissed`: a late-synced offline start may revive a missed occurrence (SP4 spec §6.2); every other rule still applies. */
  async canStart(occurrenceId: string, userId: string, at: Date, opts: { allowMissed?: boolean } = {}): Promise<CanStartResult> {
```

```ts
    const startable = o.status === 'pending' || o.status === 'overdue' || (opts.allowMissed === true && o.status === 'missed');
    if (!startable) return { ok: false, reason: 'NOT_STARTABLE' };
```

In `apps/api/src/scheduling/scheduling.module.ts`, replace the `exports` line with:

```ts
  exports: [EligibilityService, OccurrenceWriter, OccurrenceQueries, SchedulingScope],
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- occurrence-writer test/occurrences.test.ts occurrence-jobs`
Expected: PASS. The SP3 `canStart` test still passes unchanged, because `opts` defaults to `{}`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduling apps/api/test/execution-fixtures.ts apps/api/test/occurrence-writer.test.ts
git commit -m "feat(api): pin checklist versions, apply multi-step transitions and allow missed starts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Executions module, device-time bounds and the claim

**Files:**
- Create:
  - `apps/api/src/executions/device-time.ts` (+ `device-time.test.ts`)
  - `apps/api/src/executions/execution-lookups.ts`, `apps/api/src/executions/dto.ts`
  - `apps/api/src/executions/executions.service.ts`, `apps/api/src/executions/executions.controller.ts`, `apps/api/src/executions/executions.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/test/execution-fixtures.ts`
- Test: `apps/api/test/executions-claim.test.ts`

**Interfaces:**
- Consumes: Task 8 (`pinVersions`, `applyTransitions`, `canStart` with `allowMissed`); `claimCommandSchema`, `claimResultSchema`, `progress`, `EXECUTION_LIMITS` (contracts); `storedContent` from `../checklists/content`.
- Produces:
  - `assertDeviceTimes(times: Date[], receivedAt: Date, clientOffsetMs: number): { clockSuspect: boolean }`. It throws `AppError('CLOCK_INVALID')`.
  - `clampStart(startedAt: Date, startsAt: Date, receivedAt: Date): { startedAt: Date; clockSuspect: boolean }`
  - `ExecutionLookups`:
    - `content(versionId): Promise<ChecklistContent>`
    - `claims(occurrenceIds): Promise<Map<string, ClaimRef>>`
  - `ExecutionsService.claim(p: Principal, cmd: ClaimCommandDto): Promise<ClaimResult>`
  - Types `ExecutionRow = typeof executions.$inferSelect` and `OccurrenceRow = typeof occurrences.$inferSelect`, exported from `executions.service.ts`.
  - Route `POST /executions` (any authenticated tenant user; always 200).
  - Test fixtures:
    - `executionContent()`, `executionWorld(t, opts?)` (two logged-in workers on one daily 08:00–10:00 (+1 h grace) assignment of a published 4-item checklist)
    - `occurrenceOn`, `claimBody`, `claimOk`, `historyOf`, `executionRow`, `DEVICE`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/executions/device-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertDeviceTimes, clampStart } from './device-time';

const at = (iso: string) => new Date(iso);

describe('device time bounds (spec §6.6)', () => {
  it('accepts device times up to 2 minutes ahead and flags offsets over 5 minutes', () => {
    const rx = at('2026-11-02T04:10:00Z');
    expect(assertDeviceTimes([at('2026-11-02T04:12:00Z')], rx, 300_000)).toEqual({ clockSuspect: false });
    expect(assertDeviceTimes([at('2026-11-01T04:12:00Z')], rx, -300_001)).toEqual({ clockSuspect: true });
    expect(() => assertDeviceTimes([at('2026-11-02T04:00:00Z'), at('2026-11-02T04:12:00.001Z')], rx, 0)).toThrow('CLOCK_INVALID');
  });

  it('clamps an early start only once the window is open on the server', () => {
    const starts = at('2026-11-02T04:00:00Z');
    expect(clampStart(at('2026-11-02T03:56:00Z'), starts, at('2026-11-02T04:01:00Z'))).toEqual({ startedAt: starts, clockSuspect: false });
    expect(clampStart(at('2026-11-02T03:54:59Z'), starts, at('2026-11-02T04:01:00Z'))).toEqual({ startedAt: starts, clockSuspect: true });
    expect(clampStart(at('2026-11-02T03:50:00Z'), starts, at('2026-11-02T03:55:00Z'))).toEqual({ startedAt: at('2026-11-02T03:50:00Z'), clockSuspect: false });
    expect(clampStart(at('2026-11-02T04:05:00Z'), starts, at('2026-11-02T04:06:00Z'))).toEqual({ startedAt: at('2026-11-02T04:05:00Z'), clockSuspect: false });
  });
});
```

Append to `apps/api/test/execution-fixtures.ts` (merge the imports with the existing ones at the top of the file):

```ts
import {
  type Answers,
  blankContent,
  type ChecklistContent,
  type ClaimCommand,
  type ExecutionProgress,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type PhotoItem,
  type YesNoItem,
} from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import type { TestApp } from './app';
import { as, createUserDirect, loginWorker, type SignedUpTenant, signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';
import { daily, fixed, TODAY } from './scheduling-fixtures';

/**
 * problem (yes → critical problem, photo required, follow-up comment), temp (−50…50; outside 2–8 → normal problem,
 * note required), photo (required, 1–2, live only), note (optional text).
 */
export function executionContent() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true };
  const comment = newItem('comment');
  comment.label = 'Təsvir edin';
  onYes.then.followUps.push(comment);
  problem.rules.push(onYes);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  temp.min = -50;
  temp.max = 50;
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  out.then.requireNote = true;
  temp.rules.push(out);
  const photo = newItem('photo') as PhotoItem;
  photo.label = 'Ümumi görünüş';
  photo.minCount = 1;
  photo.maxCount = 2;
  photo.evidence = { ...photo.evidence, liveOnly: true };
  const note = newItem('text');
  note.label = 'Qeyd';
  note.required = false;
  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo, note] }] };
  return { content, problem, yes, no, comment, temp, photo, note };
}
export type ExecutionContent = ReturnType<typeof executionContent>;

export interface TestWorker {
  id: string;
  api: Api;
}

export interface ExecutionWorld {
  s: SignedUpTenant;
  owner: Api;
  siteId: string;
  otherSiteId: string;
  checklistId: string;
  versionId: string;
  assignmentId: string;
  /** İşçi 1 and İşçi 2, linked to siteId, logged in on mobile. */
  workers: [TestWorker, TestWorker];
  c: ExecutionContent;
  /** The occurrence on `date`: with the default timing 08:00–10:00 Baku, closing 11:00 (04:00Z / 06:00Z / 07:00Z). */
  occurrenceId: string;
}

export async function occurrenceOn(assignmentId: string, date: string): Promise<string> {
  const r = await ownerQuery<{ id: string }>("select id from occurrences where assignment_id = $1 and local_date = $2 and status <> 'cancelled'", [assignmentId, date]);
  expect(r.rows).toHaveLength(1);
  return r.rows[0]!.id;
}

/** Create it while the clock is at or before the window of `date`, so that occurrence is materialised. */
export async function executionWorld(t: TestApp, opts: { date?: string; timing?: Record<string, unknown> } = {}): Promise<ExecutionWorld> {
  const s = await signupTenant(t);
  const owner = as(t, s.accessToken);
  const typeId = await siteTypeIdOf(s.tenantId);
  const siteId = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 1' })).body.id as string;
  const otherSiteId = (await owner.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 2' })).body.id as string;
  const workers: TestWorker[] = [];
  for (const fullName of ['İşçi 1', 'İşçi 2']) {
    const u = await createUserDirect(t, s.tenantId, { fullName });
    expect((await owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] })).status).toBe(200);
    workers.push({ id: u.id, api: as(t, (await loginWorker(t, s.orgCode, u.username!, u.secret)).accessToken) });
  }
  const c = executionContent();
  const checklistId = (await owner.post('/api/v1/checklists', { name: 'İcra yoxlaması' })).body.id as string;
  await owner.put(`/api/v1/checklists/${checklistId}/draft`, { content: c.content, revision: 1 });
  const published = await owner.post(`/api/v1/checklists/${checklistId}/publish`, { revision: 2 });
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  const date = opts.date ?? TODAY;
  const res = await owner.post('/api/v1/assignments', {
    checklistId,
    siteId,
    assigneeIds: workers.map((w) => w.id),
    schedule: daily(date),
    timing: opts.timing ?? fixed(),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const assignmentId = res.body.id as string;
  return {
    s,
    owner,
    siteId,
    otherSiteId,
    checklistId,
    versionId: published.body.id as string,
    assignmentId,
    workers: workers as [TestWorker, TestWorker],
    c,
    occurrenceId: await occurrenceOn(assignmentId, date),
  };
}

export const DEVICE = { platform: 'android', osVersion: '15', appVersion: '1.0.0' } as const;

/** deviceTime defaults to startedAt: the phone sends the claim as soon as it is online. */
export const claimBody = (occurrenceId: string, startedAt: string, extra: Partial<ClaimCommand> = {}): ClaimCommand => ({
  id: uuidv7(),
  occurrenceId,
  startedAt,
  deviceTime: startedAt,
  clientOffsetMs: 0,
  device: DEVICE,
  ...extra,
});

export async function claimOk(api: Api, occurrenceId: string, startedAt: string): Promise<string> {
  const res = await api.post('/api/v1/executions', claimBody(occurrenceId, startedAt));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.state).toBe('active');
  return res.body.executionId as string;
}

/** [from, to, at, reason, actor user id] in insertion order (ids are monotonic UUIDv7). */
export type HistoryRow = [string | null, string, string, string | null, string | null];
export async function historyOf(occurrenceId: string): Promise<HistoryRow[]> {
  const r = await ownerQuery<{ from_status: string | null; to_status: string; at: Date; reason: string | null; actor_user_id: string | null }>(
    'select from_status, to_status, at, reason, actor_user_id from occurrence_status_history where occurrence_id = $1 order by id',
    [occurrenceId],
  );
  return r.rows.map((h) => [h.from_status, h.to_status, h.at.toISOString(), h.reason, h.actor_user_id]);
}

export interface ExecutionDbRow {
  id: string;
  state: string;
  rejected_reason: string | null;
  executor_user_id: string;
  started_at: Date;
  started_received_at: Date;
  completed_at: Date | null;
  completed_received_at: Date | null;
  answers: Answers;
  answers_rev: number;
  progress: ExecutionProgress;
  score: { percent: number | null; problems: unknown[] } | null;
  late: boolean;
  clock_suspect: boolean;
  clock_offset_ms: number | null;
}

export async function executionRow(id: string): Promise<ExecutionDbRow> {
  return (await ownerQuery<ExecutionDbRow>('select * from executions where id = $1', [id])).rows[0]!;
}
```

`apps/api/test/executions-claim.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { claimBody, claimOk, executionRow, executionWorld, historyOf, occurrenceOn } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, daily, MONDAY_0800, TODAY } from './scheduling-fixtures';

const TUESDAY = '2026-11-03';
const WEDNESDAY = '2026-11-04';
const statusOf = async (id: string) => (await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [id])).rows[0]!.status;

describe('claims (POST /executions)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('starts an occurrence, pins its version and records the executor', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    clock.set('2026-11-02T04:10:00Z');
    const body = claimBody(w.occurrenceId, '2026-11-02T04:05:00.000Z');
    const res = await w0.api.post('/api/v1/executions', body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId: body.id,
      state: 'active',
      reason: null,
      claim: { executionId: body.id, executorUserId: w0.id, executorName: 'İşçi 1' },
      checklistVersionId: w.versionId,
      startedAt: '2026-11-02T04:05:00.000Z',
      clockSuspect: false,
    });
    const occ = await ownerQuery<{ status: string; v: string }>('select status, checklist_version_id as v from occurrences where id = $1', [w.occurrenceId]);
    expect(occ.rows[0]).toEqual({ status: 'started', v: w.versionId });
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['pending', 'started', '2026-11-02T04:05:00.000Z', null, w0.id]);
    const row = await executionRow(body.id);
    expect(row).toMatchObject({ state: 'active', executor_user_id: w0.id, late: false, answers_rev: 0, progress: { answered: 0, total: 4, requiredMissing: 3 } });
    expect(row.started_received_at.toISOString()).toBe('2026-11-02T04:10:00.000Z');
  });

  it('lets exactly one of two concurrent claims win', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:10:00Z');
    const [a, b] = await Promise.all(w.workers.map((x) => x.api.post('/api/v1/executions', claimBody(w.occurrenceId, '2026-11-02T04:09:00.000Z'))));
    expect([a!.status, b!.status]).toEqual([200, 200]);
    expect([a!.body.state, b!.body.state].sort()).toEqual(['active', 'rejected']);
    const [winner, loser] = a!.body.state === 'active' ? [a!.body, b!.body] : [b!.body, a!.body];
    expect(loser).toMatchObject({ reason: 'ALREADY_CLAIMED', claim: { executionId: winner.executionId } });
    const states = await ownerQuery<{ state: string }>('select state from executions where occurrence_id = $1 order by state', [w.occurrenceId]);
    expect(states.rows.map((r) => r.state)).toEqual(['active', 'rejected']);
    expect((await historyOf(w.occurrenceId)).filter((h) => h[1] === 'started')).toHaveLength(1);
  });

  it('stores a later offline claim as rejected, even when its device start was earlier', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:30:00Z');
    await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:20:00.000Z');
    const late = claimBody(w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const res = await w1.api.post('/api/v1/executions', late);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'rejected', reason: 'ALREADY_CLAIMED', claim: { executorUserId: w0.id, executorName: 'İşçi 1' } });
    expect(await executionRow(late.id)).toMatchObject({ state: 'rejected', rejected_reason: 'ALREADY_CLAIMED', executor_user_id: w1.id });
  });

  it('a claim replayed after the server rejected it returns the stored rejection', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:30:00Z');
    const winner = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:20:00.000Z');
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:25:00.000Z');
    expect((await w1.api.post('/api/v1/executions', lost)).body).toMatchObject({ state: 'rejected', reason: 'ALREADY_CLAIMED' });
    // Support releases the winner's claim: a fresh evaluation would now accept the lost claim.
    await ownerQuery("update executions set state = 'rejected', rejected_reason = 'NOT_STARTABLE' where id = $1", [winner]);
    await ownerQuery("update occurrences set status = 'pending' where id = $1", [w.occurrenceId]);
    const replay = await w1.api.post('/api/v1/executions', lost);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ executionId: lost.id, state: 'rejected', reason: 'ALREADY_CLAIMED', claim: null });
    expect((await ownerQuery('select id from executions where occurrence_id = $1', [w.occurrenceId])).rowCount).toBe(2);
    expect(await statusOf(w.occurrenceId)).toBe('pending');
  });

  it('replays an accepted claim without a second history row, and refuses the same id from someone else', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:10:00Z');
    const body = claimBody(w.occurrenceId, '2026-11-02T04:05:00.000Z');
    const first = await w.workers[0].api.post('/api/v1/executions', body);
    const again = await w.workers[0].api.post('/api/v1/executions', body);
    expect(again.body).toEqual(first.body);
    expect((await historyOf(w.occurrenceId)).filter((h) => h[1] === 'started')).toHaveLength(1);
    const stolen = await w.workers[1].api.post('/api/v1/executions', body);
    expect([stolen.status, stolen.body.error.code]).toEqual([403, 'NOT_EXECUTOR']);
  });

  it('stores every canStart failure as a rejected claim', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const outsiderApi = as(t, (await loginWorker(t, w.s.orgCode, outsider.username!, outsider.secret)).accessToken);
    const tuesday = await occurrenceOn(w.assignmentId, TUESDAY);
    const wednesday = await occurrenceOn(w.assignmentId, WEDNESDAY);
    expect((await w.owner.post(`/api/v1/occurrences/${wednesday}/cancel`, { reason: 'Bayram' })).status).toBe(200);
    const shift = (await w.owner.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id as string;
    await w.owner.put('/api/v1/roster', { siteId: w.siteId, from: TODAY, to: TODAY, rows: [{ userId: w0.id, shiftId: shift, date: TODAY }] });
    const shiftAssignment = await w.owner.post('/api/v1/assignments', {
      checklistId: w.checklistId,
      siteId: w.siteId,
      assigneeIds: [w0.id],
      schedule: daily(),
      timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 },
    });
    expect(shiftAssignment.status, JSON.stringify(shiftAssignment.body)).toBe(201);
    const shiftOccurrence = await occurrenceOn(shiftAssignment.body.id, TODAY);
    await ownerQuery('delete from shift_roster where user_id = $1', [w0.id]);

    const reasonOf = async (api: Api, occurrenceId: string, at: string) => {
      clock.set(at);
      const res = await api.post('/api/v1/executions', claimBody(occurrenceId, at));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.state).toBe('rejected');
      return res.body.reason as string;
    };
    expect(await reasonOf(outsiderApi, w.occurrenceId, '2026-11-02T04:30:00.000Z')).toBe('NOT_ASSIGNED');
    expect(await reasonOf(w0.api, shiftOccurrence, '2026-11-02T04:30:00.000Z')).toBe('NOT_ON_SHIFT');
    expect(await reasonOf(w0.api, tuesday, '2026-11-02T05:00:00.000Z')).toBe('NOT_YET_OPEN');
    expect(await reasonOf(w0.api, tuesday, '2026-11-03T07:30:00.000Z')).toBe('CLOSED');
    expect(await reasonOf(w0.api, wednesday, '2026-11-04T04:30:00.000Z')).toBe('NOT_STARTABLE');
    const unknown = await w0.api.post('/api/v1/executions', claimBody('0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', '2026-11-04T04:30:00.000Z'));
    expect(unknown.status).toBe(404);
  });

  it('revives a missed occurrence from a late-synced offline start, but not one started after it closed', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    const tuesday = await occurrenceOn(w.assignmentId, TUESDAY);
    clock.set('2026-11-03T08:00:00Z');
    await t.app.get(OccurrenceJobs).sweepAll([w.s.tenantId]);
    expect(await statusOf(w.occurrenceId)).toBe('missed');
    const res = await w0.api.post('/api/v1/executions', claimBody(w.occurrenceId, '2026-11-02T04:30:00.000Z'));
    expect(res.body).toMatchObject({ state: 'active', reason: null });
    expect((await historyOf(w.occurrenceId)).slice(1)).toEqual([
      ['pending', 'overdue', '2026-11-02T06:00:00.000Z', null, null],
      ['overdue', 'missed', '2026-11-02T07:00:00.000Z', null, null],
      ['missed', 'started', '2026-11-02T04:30:00.000Z', 'late_sync', w0.id],
    ]);
    const closed = await w1.api.post('/api/v1/executions', claimBody(tuesday, '2026-11-03T07:30:00.000Z'));
    expect(closed.body).toMatchObject({ state: 'rejected', reason: 'CLOSED' });
    expect(await statusOf(tuesday)).toBe('missed');
  });

  it('refuses device times more than 2 minutes ahead of the server and stores nothing', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:10:00Z');
    for (const body of [
      claimBody(w.occurrenceId, '2026-11-02T04:12:00.001Z'),
      claimBody(w.occurrenceId, '2026-11-02T04:05:00.000Z', { deviceTime: '2026-11-02T04:12:30.000Z' }),
    ]) {
      const res = await api.post('/api/v1/executions', body);
      expect([res.status, res.body.error.code]).toEqual([422, 'CLOCK_INVALID']);
    }
    expect((await ownerQuery('select id from executions where occurrence_id = $1', [w.occurrenceId])).rowCount).toBe(0);
    expect((await api.post('/api/v1/executions', claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z'))).body.state).toBe('active');
  });

  it.each([
    ['2026-11-02T03:58:00.000Z', 0, '2026-11-02T04:00:00.000Z', false],
    ['2026-11-02T03:50:00.000Z', 0, '2026-11-02T04:00:00.000Z', true],
    ['2026-11-02T04:05:00.000Z', 6 * 60_000, '2026-11-02T04:05:00.000Z', true],
    ['2026-11-02T04:05:00.000Z', -4 * 60_000, '2026-11-02T04:05:00.000Z', false],
  ])('stores start %s with offset %d as %s, clock suspect %s', async (startedAt, clientOffsetMs, stored, suspect) => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:10:00Z');
    const res = await w.workers[0].api.post('/api/v1/executions', claimBody(w.occurrenceId, startedAt, { clientOffsetMs }));
    expect(res.body).toMatchObject({ state: 'active', startedAt: stored, clockSuspect: suspect });
    expect((await historyOf(w.occurrenceId)).at(-1)![2]).toBe(stored);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/api test -- device-time executions-claim`
Expected: FAIL: `./device-time` does not exist and `POST /api/v1/executions` returns 404.

- [ ] **Step 3: Implement the bounds and the lookups**

`apps/api/src/executions/device-time.ts`:

```ts
import { EXECUTION_LIMITS } from '@taskop/contracts';
import { AppError } from '../common/app-error';

/**
 * Device times are trusted within bounds (BR-11, spec §6.6): none may be later than server receipt + 2 min, and a
 * clock offset over 5 min (measured by the phone at its last sync) marks the execution clock_suspect.
 */
export function assertDeviceTimes(times: Date[], receivedAt: Date, clientOffsetMs: number): { clockSuspect: boolean } {
  const limit = +receivedAt + EXECUTION_LIMITS.clockFutureToleranceMs;
  if (times.some((t) => +t > limit)) throw new AppError('CLOCK_INVALID');
  return { clockSuspect: Math.abs(clientOffsetMs) > EXECUTION_LIMITS.clockSkewMs };
}

/**
 * A start before the window opens is clamped to starts_at when the server has seen the window open (a slow device
 * clock); more than 5 min early is also clock_suspect. Before the window opens on the server, nothing is clamped
 * and canStart answers NOT_YET_OPEN.
 */
export function clampStart(startedAt: Date, startsAt: Date, receivedAt: Date): { startedAt: Date; clockSuspect: boolean } {
  if (startedAt >= startsAt || receivedAt < startsAt) return { startedAt, clockSuspect: false };
  return { startedAt: startsAt, clockSuspect: +startedAt < +startsAt - EXECUTION_LIMITS.earlyStartToleranceMs };
}
```

`apps/api/src/executions/execution-lookups.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ChecklistContent, ClaimRef } from '@taskop/contracts';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { storedContent } from '../checklists/content';
import { DbService } from '../db/db.service';
import { checklistVersions, executions, users } from '../db/schema';

/** Small reads shared by the execution services. Run inside the tenant transaction. */
@Injectable()
export class ExecutionLookups {
  constructor(private readonly db: DbService) {}

  async content(versionId: string): Promise<ChecklistContent> {
    const [v] = await this.db.tx().select({ content: checklistVersions.content }).from(checklistVersions).where(eq(checklistVersions.id, versionId));
    if (!v) throw new Error(`Checklist version ${versionId} not found`);
    return storedContent(v.content);
  }

  /** Who holds the claim (the counted, non-rejected execution) of each occurrence. */
  async claims(occurrenceIds: string[]): Promise<Map<string, ClaimRef>> {
    if (!occurrenceIds.length) return new Map();
    const rows = await this.db
      .tx()
      .select({ occurrenceId: executions.occurrenceId, executionId: executions.id, executorUserId: executions.executorUserId, executorName: users.fullName })
      .from(executions)
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .where(and(inArray(executions.occurrenceId, occurrenceIds), ne(executions.state, 'rejected')));
    return new Map(rows.map(({ occurrenceId, ...claim }) => [occurrenceId, claim]));
  }
}
```

- [ ] **Step 4: Implement the claim**

`apps/api/src/executions/dto.ts`:

```ts
import { claimCommandSchema, claimResultSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ClaimCommandDto extends createZodDto(claimCommandSchema) {}
export class ClaimResultResponse extends createZodDto(claimResultSchema) {}
```

`apps/api/src/executions/executions.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { type ClaimRejectionReason, type ClaimResult, progress } from '@taskop/contracts';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { executions, occurrences } from '../db/schema';
import { EligibilityService } from '../scheduling/eligibility.service';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import { assertDeviceTimes, clampStart } from './device-time';
import type { ClaimCommandDto } from './dto';
import { ExecutionLookups } from './execution-lookups';

export type ExecutionRow = typeof executions.$inferSelect;
export type OccurrenceRow = typeof occurrences.$inferSelect;

/**
 * The phone's upload commands (spec §6.2–6.4). Each runs in the request's tenant transaction and is idempotent.
 * Lock order: the occurrence row, then the execution row (the sweep skips locked occurrences).
 */
@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger('ExecutionsService');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly eligibility: EligibilityService,
    private readonly writer: OccurrenceWriter,
    private readonly lookups: ExecutionLookups,
  ) {}

  /** First claim to reach the server wins (NFR-06.05); a loser is stored as rejected and answered with 200. */
  async claim(p: Principal, cmd: ClaimCommandDto): Promise<ClaimResult> {
    const tx = this.db.tx();
    const receivedAt = this.clock.now();
    const [known] = await tx.select().from(executions).where(eq(executions.id, cmd.id));
    if (known) {
      if (known.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
      return this.claimResult(known);
    }
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), new Date(cmd.startedAt)], receivedAt, cmd.clientOffsetMs);
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, cmd.occurrenceId)).for('update');
    if (!o) throw new AppError('NOT_FOUND');
    const start = clampStart(new Date(cmd.startedAt), o.startsAt, receivedAt);

    let reason: ClaimRejectionReason | null = (await this.lookups.claims([o.id])).has(o.id) ? 'ALREADY_CLAIMED' : null;
    if (!reason) {
      const r = await this.eligibility.canStart(o.id, p.userId, start.startedAt, { allowMissed: true });
      if (!r.ok) reason = r.reason === 'NOT_FOUND' ? 'NOT_STARTABLE' : r.reason;
    }

    const versionId = await this.pinnedVersion(o);
    const content = await this.lookups.content(versionId);
    const values = {
      id: cmd.id,
      tenantId: p.tenantId,
      occurrenceId: o.id,
      checklistVersionId: versionId,
      executorUserId: p.userId,
      startedAt: start.startedAt,
      startedReceivedAt: receivedAt,
      lastSyncedAt: receivedAt,
      progress: progress(content, {}),
      late: start.startedAt >= o.dueAt,
      clockOffsetMs: cmd.clientOffsetMs,
      clockSuspect: bounds.clockSuspect || start.clockSuspect,
      device: cmd.device,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    };
    let row: ExecutionRow | undefined;
    if (!reason) {
      // The occurrence lock already serialises claims; the partial unique index is the last line of defence.
      [row] = await tx
        .insert(executions)
        .values({ ...values, state: 'active' })
        .onConflictDoNothing({ target: executions.occurrenceId, where: sql`state <> 'rejected'` })
        .returning();
      if (!row) reason = 'ALREADY_CLAIMED';
    }
    if (!row) {
      [row] = await tx.insert(executions).values({ ...values, state: 'rejected', rejectedReason: reason }).returning();
      this.logger.log({ executionId: cmd.id, occurrenceId: o.id, userId: p.userId, reason }, 'Claim rejected');
    } else {
      await this.writer.applyTransitions([
        { occurrenceId: o.id, from: o.status, to: 'started', at: start.startedAt, reason: o.status === 'missed' ? 'late_sync' : null },
      ]);
    }
    return this.claimResult(row!);
  }

  /** The occurrence's pinned version, pinning the current one first if needed (spec §5.1). */
  private async pinnedVersion(o: OccurrenceRow): Promise<string> {
    if (o.checklistVersionId) return o.checklistVersionId;
    await this.writer.pinVersions([o.id]);
    const [row] = await this.db.tx().select({ v: occurrences.checklistVersionId }).from(occurrences).where(eq(occurrences.id, o.id));
    if (!row?.v) throw new AppError('CHECKLIST_NOT_PUBLISHED');
    return row.v;
  }

  private async claimResult(e: ExecutionRow): Promise<ClaimResult> {
    return {
      executionId: e.id,
      state: e.state,
      reason: e.rejectedReason,
      claim: (await this.lookups.claims([e.occurrenceId])).get(e.occurrenceId) ?? null,
      checklistVersionId: e.checklistVersionId,
      startedAt: e.startedAt.toISOString(),
      clockSuspect: e.clockSuspect,
    };
  }
}
```

`apps/api/src/executions/executions.controller.ts`:

```ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { ClaimResult } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import type { Principal } from '../common/request';
import { ClaimCommandDto, ClaimResultResponse } from './dto';
import { ExecutionsService } from './executions.service';

/** Upload commands from the phone (spec §6). Any authenticated tenant user; the service checks the executor. */
@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(@Inject(ExecutionsService) private readonly executions: ExecutionsService) {}

  /** A rejected claim is a normal 200 so the outbox moves on (spec §6.2). */
  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: ClaimResultResponse })
  claim(@CurrentPrincipal() p: Principal, @Body() body: ClaimCommandDto): Promise<ClaimResult> {
    return this.executions.claim(p, body);
  }
}
```

`apps/api/src/executions/executions.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ExecutionLookups } from './execution-lookups';
import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';

/** Sub-project 4: execution, evidence and problems. Depends on scheduling, never the other way round. */
@Module({
  imports: [SchedulingModule],
  controllers: [ExecutionsController],
  providers: [ExecutionsService, ExecutionLookups],
})
export class ExecutionsModule {}
```

In `apps/api/src/app.module.ts`, import `ExecutionsModule` from `'./executions/executions.module'` and add it to `imports` after `SchedulingModule`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- device-time executions-claim`
Expected: PASS (13 claim cases, the 4 `it.each` rows included).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/executions apps/api/src/app.module.ts apps/api/test/execution-fixtures.ts apps/api/test/executions-claim.test.ts
git commit -m "feat(api): claim occurrences with first-to-server wins, device-time bounds and late-sync revival" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Media registration with presigned upload URLs

**Files:**
- Create: `apps/api/src/executions/media.service.ts`
- Modify: `apps/api/src/executions/execution-lookups.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.controller.ts`, `apps/api/src/executions/executions.module.ts`, `apps/api/test/execution-fixtures.ts`
- Test: `apps/api/test/executions-media.test.ts`

**Interfaces:**
- Consumes: `S3Service.presignPut` (Task 6); `MEDIA_LIMITS`, `mediaLimitFor`, `countItems`, `walkItems` (contracts); `assertDeviceTimes` (Task 9).
- Produces:
  - `findItem(content: ChecklistContent, itemId: string): Item | undefined` in `execution-lookups.ts`
  - `MediaService.register(p, executionId, cmd: RegisterMediaCommandDto): Promise<MediaUploadTicket>`
  - Route `POST /executions/:id/media` (200)
  - Check order: executor → replay of a known `id` (fresh URL, no other checks) → device times → `EXECUTION_NOT_ACTIVE` for completed/partial → MIME → size/duration/resolution → item, kind, live-only and count.
  - Test fixtures: `photoBody(itemId, extra?)`, `registerPhoto(api, executionId, itemId, extra?): Promise<string>`, `answersBody(rev, answers, deviceTime, extra?)`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/execution-fixtures.ts`:

```ts
/** A 1000-byte camera JPEG captured at Monday 08:20 Baku (04:20Z). */
export const photoBody = (itemId: string | null, extra: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  itemId,
  kind: 'photo',
  source: 'camera',
  mime: 'image/jpeg',
  bytes: 1000,
  width: 1600,
  height: 1200,
  capturedAt: '2026-11-02T04:20:00.000Z',
  deviceTime: '2026-11-02T04:20:00.000Z',
  clientOffsetMs: 0,
  ...extra,
});

export async function registerPhoto(api: Api, executionId: string, itemId: string | null, extra: Record<string, unknown> = {}): Promise<string> {
  const body = photoBody(itemId, extra);
  const res = await api.post(`/api/v1/executions/${executionId}/media`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return body.id;
}

export const answersBody = (rev: number, answers: Answers, deviceTime: string, extra: Record<string, unknown> = {}) => ({ rev, answers, deviceTime, clientOffsetMs: 0, ...extra });
```

`apps/api/test/executions-media.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimBody, claimOk, executionWorld, photoBody } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

describe('media registration (POST /executions/:id/media)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 started at 08:10 Baku; now is 08:20. */
  async function started() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    return { w, executionId, api: w.workers[0].api };
  }
  const register = (api: Api, executionId: string, body: object) => api.post(`/api/v1/executions/${executionId}/media`, body);

  it('registers a pending photo and returns a presigned PUT against the public host; a repeat gives a fresh URL', async () => {
    const { w, executionId, api } = await started();
    const body = photoBody(w.c.photo.id);
    const res = await register(api, executionId, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mediaId: body.id, status: 'pending', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '1000' } });
    const key = `t/${w.s.tenantId}/e/${executionId}/${body.id}.jpg`;
    expect(res.body.uploadUrl.startsWith(`http://files.taskop.test/taskop-media/${key}?`)).toBe(true);
    const row = await ownerQuery('select status, captured_by_user_id, item_id, storage_key, source from execution_media where id = $1', [body.id]);
    expect(row.rows[0]).toEqual({ status: 'pending', captured_by_user_id: w.workers[0].id, item_id: w.c.photo.id, storage_key: key, source: 'camera' });
    const again = await register(api, executionId, body);
    expect([again.status, again.body.mediaId]).toEqual([200, body.id]);
    expect((await ownerQuery('select id from execution_media where execution_id = $1', [executionId])).rowCount).toBe(1);
  });

  it.each([
    ['a GIF', { mime: 'image/gif' }, 'MEDIA_TYPE_INVALID'],
    ['a video on a photo item', { kind: 'video', mime: 'video/mp4', durationMs: 5000, width: 1280, height: 720 }, 'MEDIA_TYPE_INVALID'],
    ['a photo over 5 MB', { bytes: 5 * 1024 * 1024 + 1 }, 'MEDIA_TOO_LARGE'],
    ['a video over 60 s', { itemId: null, kind: 'video', mime: 'video/mp4', durationMs: 60_001, width: 1280, height: 720 }, 'MEDIA_TOO_LARGE'],
    ['a 1080p video', { itemId: null, kind: 'video', mime: 'video/mp4', durationMs: 10_000, width: 1920, height: 1080 }, 'MEDIA_TOO_LARGE'],
    ['a gallery photo on a live-only item', { source: 'gallery' }, 'EVIDENCE_LIVE_ONLY'],
  ])('refuses %s', async (_name, extra, code) => {
    const { w, executionId, api } = await started();
    const res = await register(api, executionId, photoBody(w.c.photo.id, extra));
    expect([res.status, res.body.error.code]).toEqual([422, code]);
  });

  it('caps media per item and refuses evidence the item does not take', async () => {
    const { w, executionId, api } = await started();
    expect((await register(api, executionId, photoBody(w.c.photo.id))).status).toBe(200);
    expect((await register(api, executionId, photoBody(w.c.photo.id))).status).toBe(200);
    const third = await register(api, executionId, photoBody(w.c.photo.id));
    expect([third.status, third.body.error.code]).toEqual([422, 'MEDIA_LIMIT_REACHED']);
    expect((await register(api, executionId, photoBody(w.c.note.id))).body.error.code).toBe('MEDIA_LIMIT_REACHED');
    // The problem item takes photo evidence through its rule, and is not live-only.
    expect((await register(api, executionId, photoBody(w.c.problem.id, { source: 'gallery' }))).status).toBe(200);
    expect((await register(api, executionId, photoBody(null))).status).toBe(200);
    const unknown = await register(api, executionId, photoBody('0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f'));
    expect([unknown.status, unknown.body.error.fields]).toEqual([400, { itemId: 'executions.issues.unknownItem' }]);
  });

  it('lets only the executor register, also on a rejected claim, and checks the device clock', async () => {
    const { w, executionId } = await started();
    const w1 = w.workers[1];
    expect((await register(w1.api, executionId, photoBody(w.c.photo.id))).body.error.code).toBe('NOT_EXECUTOR');
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:15:00.000Z');
    expect((await w1.api.post('/api/v1/executions', lost)).body.state).toBe('rejected');
    expect((await register(w1.api, lost.id, photoBody(w.c.photo.id))).status).toBe(200);
    const ahead = await register(w1.api, lost.id, photoBody(w.c.photo.id, { capturedAt: '2026-11-02T04:30:00.000Z' }));
    expect([ahead.status, ahead.body.error.code]).toEqual([422, 'CLOCK_INVALID']);
    expect((await register(w1.api, '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', photoBody(null))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-media`
Expected: FAIL: `POST /api/v1/executions/:id/media` returns 404 for every case.

- [ ] **Step 3: Implement**

Append to `apps/api/src/executions/execution-lookups.ts` (add `Item` and `walkItems` to the contracts import):

```ts
export function findItem(content: ChecklistContent, itemId: string): Item | undefined {
  let found: Item | undefined;
  walkItems(content, (item) => {
    if (item.id === itemId) found = item;
  });
  return found;
}
```

Add to `apps/api/src/executions/dto.ts` (extend the contracts import with `registerMediaCommandSchema` and `mediaUploadTicketSchema`):

```ts
export class RegisterMediaCommandDto extends createZodDto(registerMediaCommandSchema) {}
export class MediaUploadTicketResponse extends createZodDto(mediaUploadTicketSchema) {}
```

`apps/api/src/executions/media.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { countItems, MEDIA_LIMITS, mediaLimitFor, type MediaUploadTicket } from '@taskop/contracts';
import { and, count, eq, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { executionMedia, executions } from '../db/schema';
import { S3Service } from '../storage/s3.service';
import { assertDeviceTimes } from './device-time';
import type { RegisterMediaCommandDto } from './dto';
import { ExecutionLookups, findItem } from './execution-lookups';
import type { ExecutionRow } from './executions.service';

export type MediaRow = typeof executionMedia.$inferSelect;

const tooLarge = (cmd: RegisterMediaCommandDto): boolean =>
  cmd.kind === 'photo'
    ? cmd.bytes > MEDIA_LIMITS.photoMaxBytes
    : cmd.bytes > MEDIA_LIMITS.videoMaxBytes ||
      (cmd.durationMs ?? 0) > MEDIA_LIMITS.videoMaxSeconds * 1000 ||
      Math.min(cmd.width ?? 0, cmd.height ?? 0) > MEDIA_LIMITS.videoMaxShortEdge;

/** Photos and videos (spec §6.7). The file goes straight from the phone to storage; the API only signs and checks. */
@Injectable()
export class MediaService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly s3: S3Service,
    private readonly lookups: ExecutionLookups,
  ) {}

  /** Registers the medium as pending and returns a presigned PUT; the same id again returns a fresh URL. */
  async register(p: Principal, executionId: string, cmd: RegisterMediaCommandDto): Promise<MediaUploadTicket> {
    const tx = this.db.tx();
    const receivedAt = this.clock.now();
    const [e] = await tx.select().from(executions).where(eq(executions.id, executionId)).for('update');
    if (!e) throw new AppError('NOT_FOUND');
    if (e.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
    const [known] = await tx.select().from(executionMedia).where(eq(executionMedia.id, cmd.id));
    if (known) {
      if (known.executionId !== executionId) throw new AppError('NOT_FOUND');
      return this.ticket(known);
    }
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), new Date(cmd.capturedAt)], receivedAt, cmd.clientOffsetMs);
    if (e.state === 'completed' || e.state === 'partial') throw new AppError('EXECUTION_NOT_ACTIVE');
    if (!(MEDIA_LIMITS.mimeTypes[cmd.kind] as readonly string[]).includes(cmd.mime)) throw new AppError('MEDIA_TYPE_INVALID');
    if (tooLarge(cmd)) throw new AppError('MEDIA_TOO_LARGE');
    await this.assertRoom(e, cmd);
    const ext = MEDIA_LIMITS.extensions[cmd.mime as keyof typeof MEDIA_LIMITS.extensions];
    const [row] = await tx
      .insert(executionMedia)
      .values({
        id: cmd.id,
        tenantId: p.tenantId,
        executionId,
        itemId: cmd.itemId,
        kind: cmd.kind,
        source: cmd.source,
        mime: cmd.mime,
        bytes: cmd.bytes,
        width: cmd.width ?? null,
        height: cmd.height ?? null,
        durationMs: cmd.durationMs ?? null,
        capturedAt: new Date(cmd.capturedAt),
        capturedByUserId: p.userId,
        storageKey: `t/${p.tenantId}/e/${executionId}/${cmd.id}.${ext}`,
        createdAt: receivedAt,
      })
      .returning();
    await tx
      .update(executions)
      .set({ lastSyncedAt: receivedAt, clockOffsetMs: cmd.clientOffsetMs, clockSuspect: e.clockSuspect || bounds.clockSuspect, updatedAt: receivedAt })
      .where(eq(executions.id, executionId));
    return this.ticket(row!);
  }

  /** Item, kind, live-only (FR-12.05–06) and count checks against the pinned version. */
  private async assertRoom(e: ExecutionRow, cmd: RegisterMediaCommandDto): Promise<void> {
    const content = await this.lookups.content(e.checklistVersionId);
    const tx = this.db.tx();
    if (cmd.itemId === null) {
      // Problem-only media: the exact "≤ 5 per problem" is checked on the answers; this caps storage per execution.
      const [r] = await tx.select({ n: count() }).from(executionMedia).where(and(eq(executionMedia.executionId, e.id), isNull(executionMedia.itemId)));
      if ((r?.n ?? 0) >= MEDIA_LIMITS.problemMaxMedia * countItems(content)) throw new AppError('MEDIA_LIMIT_REACHED');
      return;
    }
    const item = findItem(content, cmd.itemId);
    if (!item) throw new AppError('VALIDATION_FAILED', { fields: { itemId: 'executions.issues.unknownItem' } });
    if ((item.type === 'photo' || item.type === 'video') && item.type !== cmd.kind) throw new AppError('MEDIA_TYPE_INVALID');
    if (item.evidence.liveOnly && cmd.source === 'gallery') throw new AppError('EVIDENCE_LIVE_ONLY');
    const [r] = await tx
      .select({ n: count() })
      .from(executionMedia)
      .where(and(eq(executionMedia.executionId, e.id), eq(executionMedia.itemId, item.id), eq(executionMedia.kind, cmd.kind)));
    if ((r?.n ?? 0) >= mediaLimitFor(item, cmd.kind)) throw new AppError('MEDIA_LIMIT_REACHED');
  }

  private async ticket(m: MediaRow): Promise<MediaUploadTicket> {
    const put = await this.s3.presignPut(m.storageKey, m.mime, m.bytes);
    return { mediaId: m.id, status: m.status, uploadUrl: put.url, headers: put.headers, expiresAt: put.expiresAt.toISOString() };
  }
}
```

In `apps/api/src/executions/executions.controller.ts`:
- Add `Param` to the `@nestjs/common` import, `MediaUploadTicket` to the contracts type import, `ParseIdPipe` from `'../common/parse-id.pipe'`, `MediaService` from `'./media.service'`, and `MediaUploadTicketResponse` and `RegisterMediaCommandDto` from `'./dto'`.
- Replace the constructor and add the route:

```ts
  constructor(
    @Inject(ExecutionsService) private readonly executions: ExecutionsService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}
```

```ts
  @Post(':id/media')
  @HttpCode(200)
  @ApiOkResponse({ type: MediaUploadTicketResponse })
  registerMedia(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: RegisterMediaCommandDto): Promise<MediaUploadTicket> {
    return this.media.register(p, id, body);
  }
```

In `executions.module.ts`, add `MediaService` to `providers`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-media`
Expected: PASS (9 cases). No SeaweedFS is needed: presigning is a local computation.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/executions apps/api/test/execution-fixtures.ts apps/api/test/executions-media.test.ts
git commit -m "feat(api): register execution media with type, size, count and live-only checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Saving answers, with validation and problem rewriting

**Files:**
- Create: `apps/api/src/executions/problem-writer.ts`
- Modify:
  - `apps/api/src/executions/execution-lookups.ts`, `apps/api/src/executions/executions.service.ts`, `apps/api/src/executions/dto.ts`
  - `apps/api/src/executions/executions.controller.ts`, `apps/api/src/executions/executions.module.ts`
  - `apps/api/src/common/error.filter.ts`
- Test: `apps/api/test/executions-answers.test.ts`

**Interfaces:**
- Consumes: `answerIssues`, `deriveProblems`, `progress`, `computeScore` (contracts); `OccurrenceWriter.applyTransitions` (Task 8).
- Produces:
  - `ExecutionLookups.mediaKinds(executionId): Promise<Map<string, MediaKind>>`
  - `ProblemWriter.rewrite(e: { id; tenantId }, o: { id; siteId; checklistId }, content, answers, now): Promise<void>`
  - `ExecutionsService.saveAnswers(p, id, cmd: SaveAnswersCommandDto): Promise<SaveAnswersResult>`
  - `ExecutionsService` private helpers reused by Task 12:
    - `lockForCommand(p, id): Promise<{ e: ExecutionRow; o: OccurrenceRow }>`: occurrence lock, then execution lock, then the executor check.
    - `assertValidAnswers(content, executionId, answers): Promise<void>`
  - Route `PUT /executions/:id/answers` (200)
  - `toAppError` keeps field messages starting with `executions.` (as it already does for `errors.` and `scheduling.`).

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-answers.test.ts`:

```ts
import { type Answers, newItem } from '@taskop/contracts';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, claimOk, executionRow, executionWorld, historyOf, publishNextVersion, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const problemsOf = async (executionId: string) =>
  (
    await ownerQuery<{ item_id: string; source: string; severity: string; note: string | null; media_ids: string[] }>(
      'select item_id, source, severity, note, media_ids::text[] as media_ids from execution_problems where execution_id = $1 order by item_id, source',
      [executionId],
    )
  ).rows;

describe('answers (PUT /executions/:id/answers)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  async function started() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    return { w, executionId, api: w.workers[0].api };
  }
  const put = (api: Api, id: string, body: object) => api.put(`/api/v1/executions/${id}/answers`, body);

  it('stores answers, moves the occurrence to in_progress once and rewrites the problems', async () => {
    const { w, executionId, api } = await started();
    const { c } = w;
    const m1 = await registerPhoto(api, executionId, c.problem.id);
    const rev1 = await put(api, executionId, answersBody(1, { [c.problem.id]: { optionIds: [c.yes.id], photos: [m1] }, [c.comment.id]: { text: 'Su axır' } }, '2026-11-02T04:15:00.000Z'));
    expect(rev1.status, JSON.stringify(rev1.body)).toBe(200);
    expect(rev1.body).toEqual({ executionId, rev: 1, stale: false, state: 'active', progress: { answered: 2, total: 5, requiredMissing: 2 } });
    expect(await problemsOf(executionId)).toEqual([{ item_id: c.problem.id, source: 'rule', severity: 'critical', note: null, media_ids: [m1] }]);

    const rev2Answers: Answers = { [c.problem.id]: { optionIds: [c.no.id] }, [c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Termometr köhnədir', mediaIds: [] } } };
    const rev2 = await put(api, executionId, answersBody(2, rev2Answers, '2026-11-02T04:18:00.000Z'));
    expect(rev2.body).toMatchObject({ rev: 2, stale: false, progress: { answered: 2, total: 4, requiredMissing: 1 } });
    expect(await problemsOf(executionId)).toEqual([{ item_id: c.temp.id, source: 'manual', severity: 'normal', note: 'Termometr köhnədir', media_ids: [] }]);
    expect((await historyOf(w.occurrenceId)).slice(-2)).toEqual([
      ['pending', 'started', '2026-11-02T04:10:00.000Z', null, w.workers[0].id],
      ['started', 'in_progress', '2026-11-02T04:15:00.000Z', null, w.workers[0].id],
    ]);
    const row = await executionRow(executionId);
    expect(row.answers).toEqual(rev2Answers);
    expect(row.score).toMatchObject({ problems: [] });
  });

  it('keeps a problem’s id and creation time while it persists', async () => {
    const { w, executionId, api } = await started();
    const manual = (note: string): Answers => ({ [w.c.temp.id]: { number: 5, problem: { severity: 'critical', note, mediaIds: [] } } });
    await put(api, executionId, answersBody(1, manual('Birinci'), '2026-11-02T04:15:00.000Z'));
    const before = (await ownerQuery<{ id: string; created_at: Date }>('select id, created_at from execution_problems where execution_id = $1', [executionId])).rows;
    clock.set('2026-11-02T04:25:00Z');
    await put(api, executionId, answersBody(2, manual('İkinci'), '2026-11-02T04:24:00.000Z'));
    const after = (await ownerQuery<{ id: string; created_at: Date; note: string }>('select id, created_at, note from execution_problems where execution_id = $1', [executionId])).rows;
    expect(after).toEqual([{ ...before[0], note: 'İkinci' }]);
  });

  it('ignores a stale revision', async () => {
    const { w, executionId, api } = await started();
    await put(api, executionId, answersBody(2, { [w.c.temp.id]: { number: 4 } }, '2026-11-02T04:15:00.000Z'));
    const stale = await put(api, executionId, answersBody(1, { [w.c.temp.id]: { number: 9 } }, '2026-11-02T04:14:00.000Z'));
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ rev: 2, stale: true, state: 'active' });
    expect((await executionRow(executionId)).answers).toEqual({ [w.c.temp.id]: { number: 4 } });
  });

  it('validates against the pinned version, not the newest one', async () => {
    const { w, executionId, api } = await started();
    const next = structuredClone(w.c.content);
    const added = newItem('text');
    added.label = 'Yeni sual';
    next.sections[0]!.items.push(added);
    await publishNextVersion(w.owner, w.checklistId, next);
    const codes = async (answers: Answers) => {
      const res = await put(api, executionId, answersBody(1, answers, '2026-11-02T04:15:00.000Z'));
      expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_FAILED']);
      return res.body.error.issues.map((i: { code: string }) => i.code);
    };
    expect(await codes({ [added.id]: { text: 'x' } })).toEqual(['executions.issues.unknownItem']);
    expect(await codes({ [w.c.problem.id]: { optionIds: [w.c.temp.id] } })).toEqual(['executions.issues.unknownOption']);
    expect(await codes({ [w.c.temp.id]: { text: '5' } })).toEqual(['executions.issues.invalidValue']);
    expect(await codes({ [w.c.photo.id]: { photos: [uuidv7()] } })).toEqual(['executions.issues.unknownMedia']);
    expect((await executionRow(executionId)).answers_rev).toBe(0);
  });

  it('stores the answers of a rejected execution without counting them', async () => {
    const { w } = await started();
    const w1 = w.workers[1];
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z');
    await w1.api.post('/api/v1/executions', lost);
    const res = await put(w1.api, lost.id, answersBody(1, { [w.c.problem.id]: { optionIds: [w.c.yes.id] } }, '2026-11-02T04:16:00.000Z'));
    expect(res.body).toMatchObject({ rev: 1, stale: false, state: 'rejected', progress: { answered: 0, total: 4, requiredMissing: 3 } });
    expect((await executionRow(lost.id)).answers).toEqual({ [w.c.problem.id]: { optionIds: [w.c.yes.id] } });
    expect(await problemsOf(lost.id)).toEqual([]);
    expect((await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [w.occurrenceId])).rows[0]!.status).toBe('started');
  });

  it('lets only the executor save, and refuses more than 1 MB of answers', async () => {
    const { w, executionId, api } = await started();
    const other = await put(w.workers[1].api, executionId, answersBody(1, {}, '2026-11-02T04:15:00.000Z'));
    expect([other.status, other.body.error.code]).toEqual([403, 'NOT_EXECUTOR']);
    const big = Object.fromEntries(Array.from({ length: 520 }, () => [crypto.randomUUID(), { note: 'x'.repeat(2000) }]));
    const tooBig = await put(api, executionId, answersBody(1, big, '2026-11-02T04:15:00.000Z'));
    expect([tooBig.status, tooBig.body.error.fields]).toEqual([400, { answers: 'executions.issues.answersTooLarge' }]);
    expect((await put(api, '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', answersBody(1, {}, '2026-11-02T04:15:00.000Z'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-answers`
Expected: FAIL: `PUT /api/v1/executions/:id/answers` returns 404.

- [ ] **Step 3: Implement**

In `apps/api/src/common/error.filter.ts`, in `toAppError`, change the field-message pattern to:

```ts
      fields[key] ??= /^(errors|scheduling|executions)\./.test(issue.message) ? issue.message : 'errors.validation.invalid';
```

Add to `ExecutionLookups` (import `executionMedia` from the schema and `MediaKind` from contracts):

```ts
  /** Media registered on an execution, by id: what answers may reference (spec §6.3). */
  async mediaKinds(executionId: string): Promise<Map<string, MediaKind>> {
    const rows = await this.db.tx().select({ id: executionMedia.id, kind: executionMedia.kind }).from(executionMedia).where(eq(executionMedia.executionId, executionId));
    return new Map(rows.map((r) => [r.id, r.kind]));
  }
```

`apps/api/src/executions/problem-writer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type Answers, type ChecklistContent, deriveProblems } from '@taskop/contracts';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executionProblems } from '../db/schema';

@Injectable()
export class ProblemWriter {
  constructor(private readonly db: DbService) {}

  /**
   * Rewrites a counted execution's problems from its answers (spec §5.2). Upserting on (execution, item, source)
   * keeps a problem's id and created_at while it persists; problems that are gone are deleted.
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
      await tx
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
        });
    }
    const keep = derived.map((d) => `${d.itemId}:${d.source}`);
    await tx
      .delete(executionProblems)
      .where(
        and(
          eq(executionProblems.executionId, e.id),
          keep.length ? notInArray(sql<string>`${executionProblems.itemId}::text || ':' || ${executionProblems.source}::text`, keep) : undefined,
        ),
      );
  }
}
```

Add to `apps/api/src/executions/dto.ts` (extend the contracts import with `saveAnswersCommandSchema` and `saveAnswersResultSchema`):

```ts
export class SaveAnswersCommandDto extends createZodDto(saveAnswersCommandSchema) {}
export class SaveAnswersResultResponse extends createZodDto(saveAnswersResultSchema) {}
```

In `apps/api/src/executions/executions.service.ts`:
- Extend the contracts import with `answerIssues`, `type Answers`, `type ChecklistContent`, `computeScore`, `type ExecutionProgress` and `type SaveAnswersResult`.
- Import `ProblemWriter` from `'./problem-writer'`, and `SaveAnswersCommandDto` with `ClaimCommandDto` from `'./dto'`.
- Add `private readonly problems: ProblemWriter,` as the last constructor parameter.
- Add these methods:

```ts
  /** Spec §6.3. A stale revision is ignored before any state check, so a late, older command never fails. */
  async saveAnswers(p: Principal, id: string, cmd: SaveAnswersCommandDto): Promise<SaveAnswersResult> {
    const receivedAt = this.clock.now();
    const { e, o } = await this.lockForCommand(p, id);
    const deviceTime = new Date(cmd.deviceTime);
    const bounds = assertDeviceTimes([deviceTime], receivedAt, cmd.clientOffsetMs);
    if (cmd.rev <= e.answersRev) return this.answersResult(e, true);
    // A swept partial still takes answers captured inside the window (they synced late); nothing after it.
    if (e.state === 'completed' || (e.state === 'partial' && (e.completedAt !== null || deviceTime >= o.closesAt))) {
      throw new AppError('EXECUTION_NOT_ACTIVE');
    }
    const content = await this.lookups.content(e.checklistVersionId);
    await this.assertValidAnswers(content, e.id, cmd.answers);
    const counted = e.state !== 'rejected';
    const [row] = await this.db
      .tx()
      .update(executions)
      .set({
        answers: cmd.answers,
        answersRev: cmd.rev,
        lastSyncedAt: receivedAt,
        clockOffsetMs: cmd.clientOffsetMs,
        clockSuspect: e.clockSuspect || bounds.clockSuspect,
        updatedAt: receivedAt,
        // Rejected executions keep the answers only: stored, never counted.
        ...(counted ? { progress: progress(content, cmd.answers), score: computeScore(content, cmd.answers) } : {}),
      })
      .where(eq(executions.id, id))
      .returning();
    if (counted) {
      await this.problems.rewrite(e, o, content, cmd.answers, receivedAt);
      if (o.status === 'started') {
        await this.writer.applyTransitions([{ occurrenceId: o.id, from: 'started', to: 'in_progress', at: deviceTime > e.startedAt ? deviceTime : e.startedAt }]);
      }
    }
    return this.answersResult(row!, false);
  }

  /** Locks the occurrence, then the execution (the order every command uses), and checks the executor. */
  private async lockForCommand(p: Principal, id: string): Promise<{ e: ExecutionRow; o: OccurrenceRow }> {
    const tx = this.db.tx();
    const [found] = await tx.select({ occurrenceId: executions.occurrenceId }).from(executions).where(eq(executions.id, id));
    if (!found) throw new AppError('NOT_FOUND');
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, found.occurrenceId)).for('update');
    const [e] = await tx.select().from(executions).where(eq(executions.id, id)).for('update');
    if (e!.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
    return { e: e!, o: o! };
  }

  /** Item ids, value types and media against the pinned version (spec §6.3) → 400 VALIDATION_FAILED with issues. */
  private async assertValidAnswers(content: ChecklistContent, executionId: string, answers: Answers): Promise<void> {
    const issues = answerIssues(content, answers, await this.lookups.mediaKinds(executionId));
    if (issues.length) throw new AppError('VALIDATION_FAILED', { details: { issues } });
  }

  private answersResult(e: ExecutionRow, stale: boolean): SaveAnswersResult {
    return { executionId: e.id, rev: e.answersRev, stale, state: e.state, progress: e.progress as ExecutionProgress };
  }
```

In `executions.controller.ts`, add `Put` to the `@nestjs/common` import, `SaveAnswersResult` to the contracts type import, and `SaveAnswersCommandDto` and `SaveAnswersResultResponse` to the `./dto` import. Then add:

```ts
  @Put(':id/answers')
  @ApiOkResponse({ type: SaveAnswersResultResponse })
  saveAnswers(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: SaveAnswersCommandDto): Promise<SaveAnswersResult> {
    return this.executions.saveAnswers(p, id, body);
  }
```

In `executions.module.ts`, add `ProblemWriter` to `providers`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-answers executions-claim error.filter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/executions apps/api/src/common/error.filter.ts apps/api/test/executions-answers.test.ts
git commit -m "feat(api): save execution answers with stale-revision handling, validation and problem rewriting" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Completion

**Files:**
- Modify: `apps/api/src/executions/executions.service.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.controller.ts`, `apps/api/src/common/app-error.ts`
- Test: `apps/api/test/executions-complete.test.ts`

**Interfaces:**
- Consumes: Task 11 helpers; `requirements` (contracts).
- Produces:
  - `AppErrorDetails.missing?: Missing[]`
  - `ExecutionsService.complete(p, id, cmd: CompleteCommandDto): Promise<CompleteResult>`
    - Replay: an execution with `completed_at` returns the stored result.
    - `rejected`: stores the answers and `completed_at`, and never counts.
    - Otherwise: `REQUIREMENTS_UNMET` or `completed` / `partial`, with `late`, a frozen score and frozen problems.
    - History: `started|in_progress → completed` at `completedAt`; `partial → completed` with `late_sync`; `started|in_progress → partial` at `closes_at`.
  - Route `POST /executions/:id/complete` (200)

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-complete.test.ts`:

```ts
import { type Answers } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, claimOk, type ExecutionWorld, executionRow, executionWorld, historyOf, photoBody, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const statusOf = async (id: string) => (await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [id])).rows[0]!.status;
/** Everything required: no problem, 5 °C, one photo. */
const full = (w: ExecutionWorld, photoId: string): Answers => ({
  [w.c.problem.id]: { optionIds: [w.c.no.id] },
  [w.c.temp.id]: { number: 5 },
  [w.c.photo.id]: { photos: [photoId] },
});
const complete = (api: Api, id: string, rev: number, answers: Answers, completedAt: string) =>
  api.post(`/api/v1/executions/${id}/complete`, { rev, answers, completedAt, deviceTime: completedAt, clientOffsetMs: 0 });

describe('completion (POST /executions/:id/complete)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  async function started() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    return { w, executionId, api: w.workers[0].api };
  }

  it('refuses to complete while requirements are unmet and stores nothing', async () => {
    const { w, executionId, api } = await started();
    const res = await complete(api, executionId, 1, { [w.c.problem.id]: { optionIds: [w.c.yes.id] } }, '2026-11-02T04:20:00.000Z');
    expect([res.status, res.body.error.code]).toEqual([422, 'REQUIREMENTS_UNMET']);
    expect(res.body.error.missing).toEqual([
      { itemId: w.c.problem.id, kind: 'photo' },
      { itemId: w.c.comment.id, kind: 'answer' },
      { itemId: w.c.temp.id, kind: 'answer' },
      { itemId: w.c.photo.id, kind: 'answer' },
    ]);
    expect(await executionRow(executionId)).toMatchObject({ state: 'active', answers_rev: 0, completed_at: null });
  });

  it('completes inside the window, freezes score and problems, and counts a photo not yet uploaded', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T05:00:00Z');
    const answers = { ...full(w, photo), [w.c.temp.id]: { number: 10, note: 'Kondisioner xarabdır' } };
    const res = await complete(api, executionId, 1, answers, '2026-11-02T04:55:00.000Z');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      executionId,
      state: 'completed',
      completedAt: '2026-11-02T04:55:00.000Z',
      late: false,
      progress: { answered: 3, total: 4, requiredMissing: 0 },
      score: { earned: 1, possible: 2, percent: 50, problems: [{ itemId: w.c.temp.id, severity: 'normal' }] },
    });
    expect(await statusOf(w.occurrenceId)).toBe('completed');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['started', 'completed', '2026-11-02T04:55:00.000Z', null, w.workers[0].id]);
    expect((await executionRow(executionId)).completed_received_at!.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((await ownerQuery('select item_id, source from execution_problems where execution_id = $1', [executionId])).rows).toEqual([{ item_id: w.c.temp.id, source: 'rule' }]);

    const again = await complete(api, executionId, 1, full(w, photo), '2026-11-02T04:56:00.000Z');
    expect(again.body).toEqual(res.body);
    expect((await historyOf(w.occurrenceId)).filter((h) => h[1] === 'completed')).toHaveLength(1);
    const more = await api.post(`/api/v1/executions/${executionId}/media`, photoBody(w.c.photo.id));
    expect([more.status, more.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('marks a completion after due_at late', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T06:40:00Z');
    expect((await complete(api, executionId, 1, full(w, photo), '2026-11-02T06:30:00.000Z')).body).toMatchObject({ state: 'completed', late: true });
  });

  it('records a completion at or after closes_at as partial', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:01:00Z');
    const res = await complete(api, executionId, 1, full(w, photo), '2026-11-02T07:00:00.000Z');
    expect(res.body).toMatchObject({ state: 'partial', completedAt: '2026-11-02T07:00:00.000Z', late: true });
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['started', 'partial', '2026-11-02T07:00:00.000Z', null, w.workers[0].id]);
  });

  it('a stale answers command arriving after completion is ignored, not refused', async () => {
    const { w, executionId, api } = await started();
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    expect((await complete(api, executionId, 3, full(w, photo), '2026-11-02T04:20:00.000Z')).body.state).toBe('completed');
    const late = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(2, { [w.c.temp.id]: { number: 4 } }, '2026-11-02T04:18:00.000Z'));
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ rev: 3, stale: true, state: 'completed' });
    const newer = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(4, { [w.c.temp.id]: { number: 4 } }, '2026-11-02T04:20:00.000Z'));
    expect([newer.status, newer.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
  });

  it('a worker removed from the snapshot after starting can still answer and complete', async () => {
    const { w, executionId, api } = await started();
    expect((await w.owner.put(`/api/v1/users/${w.workers[0].id}/sites`, { siteIds: [w.otherSiteId] })).status).toBe(200);
    await ownerQuery('delete from occurrence_assignees where occurrence_id = $1 and user_id = $2', [w.occurrenceId, w.workers[0].id]);
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    expect((await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:20:00.000Z'))).status).toBe(200);
    expect((await complete(api, executionId, 2, full(w, photo), '2026-11-02T04:20:00.000Z')).body.state).toBe('completed');
  });

  it('stores the completion of a rejected execution without touching the occurrence', async () => {
    const { w } = await started();
    const w1 = w.workers[1];
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z');
    await w1.api.post('/api/v1/executions', lost);
    const res = await complete(w1.api, lost.id, 1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:19:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'rejected', completedAt: '2026-11-02T04:19:00.000Z' });
    expect(await executionRow(lost.id)).toMatchObject({ answers_rev: 1, answers: { [w.c.temp.id]: { number: 5 } } });
    expect(await statusOf(w.occurrenceId)).toBe('started');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-complete`
Expected: FAIL: `POST /api/v1/executions/:id/complete` returns 404.

- [ ] **Step 3: Implement**

In `apps/api/src/common/app-error.ts`, import `Missing` as a type from `@taskop/contracts` and extend `AppErrorDetails`:

```ts
  /** REQUIREMENTS_UNMET: what still blocks completion. */
  missing?: Missing[];
```

Add to `apps/api/src/executions/dto.ts` (extend the contracts import with `completeCommandSchema` and `completeResultSchema`):

```ts
export class CompleteCommandDto extends createZodDto(completeCommandSchema) {}
export class CompleteResultResponse extends createZodDto(completeResultSchema) {}
```

In `executions.service.ts`:
- Extend the contracts import with `type CompleteResult`, `requirements` and `type ScoreResult`.
- Import `CompleteCommandDto` from `'./dto'`.
- Add these methods:

```ts
  /**
   * Spec §6.4. Saves the answers (when newer), checks requirements on the pinned version, then decides by device time:
   * completedAt < closes_at → completed (reviving a swept partial), otherwise partial. Score and problems are frozen.
   */
  async complete(p: Principal, id: string, cmd: CompleteCommandDto): Promise<CompleteResult> {
    const receivedAt = this.clock.now();
    const { e, o } = await this.lockForCommand(p, id);
    const bounds = assertDeviceTimes([new Date(cmd.deviceTime), new Date(cmd.completedAt)], receivedAt, cmd.clientOffsetMs);
    if (e.completedAt) return this.completeResult(e);
    const content = await this.lookups.content(e.checklistVersionId);
    const fresh = cmd.rev > e.answersRev;
    if (fresh) await this.assertValidAnswers(content, e.id, cmd.answers);
    const answers: Answers = fresh ? cmd.answers : (e.answers as Answers);
    const completedAt = new Date(Math.max(+new Date(cmd.completedAt), +e.startedAt));
    const base = {
      answers,
      answersRev: fresh ? cmd.rev : e.answersRev,
      completedAt,
      completedReceivedAt: receivedAt,
      lastSyncedAt: receivedAt,
      clockOffsetMs: cmd.clientOffsetMs,
      clockSuspect: e.clockSuspect || bounds.clockSuspect,
      updatedAt: receivedAt,
    };
    const tx = this.db.tx();
    if (e.state === 'rejected') {
      const [row] = await tx.update(executions).set(base).where(eq(executions.id, id)).returning();
      return this.completeResult(row!);
    }
    const missing = requirements(content, answers);
    if (missing.length) throw new AppError('REQUIREMENTS_UNMET', { details: { missing } });
    const inWindow = completedAt < o.closesAt;
    const [row] = await tx
      .update(executions)
      .set({
        ...base,
        state: inWindow ? 'completed' : 'partial',
        progress: progress(content, answers),
        score: computeScore(content, answers),
        late: completedAt >= o.dueAt,
      })
      .where(eq(executions.id, id))
      .returning();
    await this.problems.rewrite(e, o, content, answers, receivedAt);
    if (inWindow) {
      await this.writer.applyTransitions([
        { occurrenceId: o.id, from: o.status, to: 'completed', at: completedAt, reason: o.status === 'partial' ? 'late_sync' : null },
      ]);
    } else if (o.status !== 'partial') {
      await this.writer.applyTransitions([{ occurrenceId: o.id, from: o.status, to: 'partial', at: o.closesAt }]);
    }
    return this.completeResult(row!);
  }

  private completeResult(e: ExecutionRow): CompleteResult {
    return {
      executionId: e.id,
      state: e.state,
      completedAt: e.completedAt?.toISOString() ?? null,
      late: e.late,
      progress: e.progress as ExecutionProgress,
      score: (e.score as ScoreResult | null) ?? null,
    };
  }
```

In `executions.controller.ts`, add `CompleteResult` to the contracts type import and `CompleteCommandDto` and `CompleteResultResponse` to the `./dto` import. Then add:

```ts
  @Post(':id/complete')
  @HttpCode(200)
  @ApiOkResponse({ type: CompleteResultResponse })
  complete(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string, @Body() body: CompleteCommandDto): Promise<CompleteResult> {
    return this.executions.complete(p, id, body);
  }
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-complete executions-answers`
Expected: PASS (7 completion cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/executions apps/api/src/common/app-error.ts apps/api/test/executions-complete.test.ts
git commit -m "feat(api): complete executions with requirements, late and partial outcomes and frozen problems" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The sweep moves unfinished executions to partial; late completions revive them

**Files:**
- Modify: `apps/api/src/scheduling/occurrence-jobs.ts`
- Test: `apps/api/test/executions-sweep.test.ts`

**Interfaces:**
- Consumes: `executions` table (Task 7); `OccurrenceWriter.recordTransitions`.
- Produces:
  - `OccurrenceJobs.sweepOpenExecutions(now: Date): Promise<number>`
    - It moves `started | in_progress → partial` where `closes_at ≤ now`, with `FOR UPDATE SKIP LOCKED`, and sets the counted execution to `partial`.
    - History is written at `closes_at` with the system actor.
  - `sweepAll` also finds tenants with such occurrences and returns both sweeps' counts.

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-sweep.test.ts`:

```ts
import { type Answers } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, type ExecutionWorld, executionRow, executionWorld, historyOf, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const statusOf = async (id: string) => (await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [id])).rows[0]!.status;
const full = (w: ExecutionWorld, photoId: string): Answers => ({
  [w.c.problem.id]: { optionIds: [w.c.no.id] },
  [w.c.temp.id]: { number: 5 },
  [w.c.photo.id]: { photos: [photoId] },
});
const complete = (api: Api, id: string, answers: Answers, completedAt: string) =>
  api.post(`/api/v1/executions/${id}/complete`, { rev: 5, answers, completedAt, deviceTime: completedAt, clientOffsetMs: 0 });

describe('sweep to partial and late revival', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: OccurrenceJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(OccurrenceJobs);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 started at 08:10 Baku and registered the required photo; the sweep then runs at 11:00 (closes_at). */
  async function sweptAtClose() {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const api = w.workers[0].api;
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    return { w, executionId, api, photo };
  }

  it('an unfinished execution becomes partial at closes_at, once', async () => {
    const w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await w.workers[0].api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:15:00.000Z'));
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['in_progress', 'partial', '2026-11-02T07:00:00.000Z', null, null]);
    expect(await executionRow(executionId)).toMatchObject({ state: 'partial', completed_at: null, answers_rev: 1 });
  });

  it('a completion just before closes_at revives an execution the sweep made partial', async () => {
    const { w, executionId, api, photo } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const res = await complete(api, executionId, full(w, photo), '2026-11-02T06:59:59.999Z');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ state: 'completed', completedAt: '2026-11-02T06:59:59.999Z', late: true });
    expect(await statusOf(w.occurrenceId)).toBe('completed');
    expect((await historyOf(w.occurrenceId)).slice(-2)).toEqual([
      ['started', 'partial', '2026-11-02T07:00:00.000Z', null, null],
      ['partial', 'completed', '2026-11-02T06:59:59.999Z', 'late_sync', w.workers[0].id],
    ]);
  });

  it('a completion at exactly closes_at stays partial', async () => {
    const { w, executionId, api, photo } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const res = await complete(api, executionId, full(w, photo), '2026-11-02T07:00:00.000Z');
    expect(res.body).toMatchObject({ state: 'partial', completedAt: '2026-11-02T07:00:00.000Z' });
    expect(await statusOf(w.occurrenceId)).toBe('partial');
    expect((await historyOf(w.occurrenceId)).at(-1)).toEqual(['started', 'partial', '2026-11-02T07:00:00.000Z', null, null]);
  });

  it('keeps answers captured before closes_at that arrive after the sweep, and refuses later ones', async () => {
    const { w, executionId, api } = await sweptAtClose();
    clock.set('2026-11-02T07:30:00Z');
    const inWindow = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T06:50:00.000Z'));
    expect(inWindow.status, JSON.stringify(inWindow.body)).toBe(200);
    expect(inWindow.body).toMatchObject({ rev: 1, stale: false, state: 'partial', progress: { answered: 1, total: 4, requiredMissing: 2 } });
    const after = await api.put(`/api/v1/executions/${executionId}/answers`, answersBody(2, { [w.c.temp.id]: { number: 6 } }, '2026-11-02T07:05:00.000Z'));
    expect([after.status, after.body.error.code]).toEqual([409, 'EXECUTION_NOT_ACTIVE']);
    expect(await statusOf(w.occurrenceId)).toBe('partial');
  });

  it('completes a fully offline execution of a missed occurrence in one late sync', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T09:00:00Z');
    await jobs.sweepAll([w.s.tenantId]);
    expect(await statusOf(w.occurrenceId)).toBe('missed');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:30:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id, { capturedAt: '2026-11-02T04:40:00.000Z', deviceTime: '2026-11-02T04:40:00.000Z' });
    const res = await complete(api, executionId, full(w, photo), '2026-11-02T05:00:00.000Z');
    expect(res.body).toMatchObject({ state: 'completed', late: false });
    expect((await historyOf(w.occurrenceId)).slice(-2)).toEqual([
      ['missed', 'started', '2026-11-02T04:30:00.000Z', 'late_sync', w.workers[0].id],
      ['started', 'completed', '2026-11-02T05:00:00.000Z', null, w.workers[0].id],
    ]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-sweep`
Expected: FAIL: `sweepAll` returns 0 for a started occurrence at `closes_at`.

- [ ] **Step 3: Implement**

In `apps/api/src/scheduling/occurrence-jobs.ts`:
- Change the drizzle import to `import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';` and import `executions` with `assignments` from `'../db/schema'`.
- Add after `SweptRow`:

```ts
interface OpenRow extends Record<string, unknown> {
  id: string;
  from_status: Extract<OccurrenceStatus, 'started' | 'in_progress'>;
  closes_at: Date | string;
}
```

- Replace `sweepAll` with:

```ts
  /** pending → overdue after due_at; pending | overdue → missed and started | in_progress → partial after closes_at. */
  async sweepAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const tenantIds = await this.tenantsWith(
      sql`select distinct tenant_id from occurrences
          where (status = 'pending' and due_at <= ${now}) or (status in ('overdue', 'started', 'in_progress') and closes_at <= ${now})`,
      only,
    );
    return this.perTenant(tenantIds, async () => (await this.sweepTenant(now)) + (await this.sweepOpenExecutions(now)));
  }
```

- Add after `sweepTenant`:

```ts
  /**
   * started | in_progress → partial at closes_at, with the counted execution (SP4 spec §6.5). Answers are kept;
   * a later completion with completedAt < closes_at revives it. SKIP LOCKED: a command holding the occurrence wins.
   */
  async sweepOpenExecutions(now: Date): Promise<number> {
    const tx = this.db.tx();
    const result = await tx.execute<OpenRow>(sql`
      with open as (
        select id, status, closes_at from occurrences
        where status in ('started', 'in_progress') and closes_at <= ${now}
        for update skip locked
      )
      update occurrences o
         set status = 'partial', status_changed_at = open.closes_at, updated_at = ${now}
        from open
       where o.id = open.id
      returning o.id, open.status as from_status, open.closes_at`);
    if (!result.rows.length) return 0;
    const ids = result.rows.map((r) => r.id);
    await tx
      .update(executions)
      .set({ state: 'partial', updatedAt: now })
      .where(and(inArray(executions.occurrenceId, ids), eq(executions.state, 'active')));
    await this.writer.recordTransitions(result.rows.map((r) => ({ occurrenceId: r.id, from: r.from_status, to: 'partial', at: new Date(r.closes_at) })));
    return result.rows.length;
  }
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-sweep occurrence-jobs executions-complete`
Expected: PASS. The SP3 sweep counts are unchanged, because no SP3 test has started occurrences.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduling/occurrence-jobs.ts apps/api/test/executions-sweep.test.ts
git commit -m "feat(api): sweep unfinished executions to partial at window close and revive them on late completion" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: Download sync (`GET /me/sync`)

**Files:**
- Create: `apps/api/src/executions/mappers.ts`, `apps/api/src/executions/sync.service.ts`, `apps/api/src/executions/sync.controller.ts`
- Modify: `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.module.ts`
- Test: `apps/api/test/executions-sync.test.ts`

**Interfaces:**
- Consumes: `OccurrenceQueries.select()`, `OccurrenceWriter.pinVersions`, `ExecutionLookups.claims`; `syncQuerySchema`, `syncResponseSchema`, `EXECUTION_LIMITS` (contracts).
- Produces:
  - `mediaPendingSql`: a correlated count of pending media for `"executions"."id"`, reused by Tasks 15–16.
  - `SyncService.pull(p, q: SyncQueryDto): Promise<SyncResponse>`
    - Occurrences: the caller's snapshot, not cancelled, window overlapping `[now − 1 d, now + 3 d]`, plus any occurrence with the caller's `active` execution. They are ordered by `startsAt`, and their versions are pinned.
    - Versions: every pinned version not in `knownVersionIds`.
    - Executions: the caller's, `active` or updated in the last 24 h.
  - Route `GET /me/sync` (any authenticated tenant user)

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-sync.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimOk, executionWorld, occurrenceOn, publishNextVersion, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, MONDAY_0800 } from './scheduling-fixtures';

const pull = (api: Api, known: string[] = []) => api.get(`/api/v1/me/sync${known.length ? `?knownVersionIds=${known.join(',')}` : ''}`);
const versionOf = async (id: string) => (await ownerQuery<{ v: string | null }>('select checklist_version_id as v from occurrences where id = $1', [id])).rows[0]!.v;

describe('download sync (GET /me/sync)', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('returns the caller’s occurrences in the window with pinned versions, and each version once', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    const res = await pull(w0.api);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.serverTime).toBe('2026-11-02T04:00:00.000Z');
    expect(res.body.occurrences.map((o: { localDate: string }) => o.localDate)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(res.body.occurrences[0]).toEqual({
      id: w.occurrenceId,
      checklistId: w.checklistId,
      checklistName: 'İcra yoxlaması',
      siteId: w.siteId,
      siteName: 'Filial 1',
      shiftName: null,
      localDate: '2026-11-02',
      startsAt: '2026-11-02T04:00:00.000Z',
      dueAt: '2026-11-02T06:00:00.000Z',
      closesAt: '2026-11-02T07:00:00.000Z',
      status: 'pending',
      checklistVersionId: w.versionId,
      claim: null,
    });
    expect(res.body.checklistVersions).toHaveLength(1);
    expect(res.body.checklistVersions[0]).toMatchObject({ id: w.versionId, checklistId: w.checklistId, number: 1, schemaVersion: 1 });
    expect(res.body.checklistVersions[0].content.sections[0].items).toHaveLength(4);
    expect(res.body.executions).toEqual([]);
    expect((await pull(w0.api, [w.versionId])).body.checklistVersions).toEqual([]);
    expect(await versionOf(await occurrenceOn(w.assignmentId, '2026-11-05'))).toBeNull();
  });

  it('keeps a pinned version while newer occurrences get the newer one', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    await pull(w0.api);
    const next = structuredClone(w.c.content);
    next.sections[0]!.title = 'Zal (yeni)';
    const v2 = await publishNextVersion(w.owner, w.checklistId, next);
    clock.set('2026-11-03T04:00:00Z');
    const res = await pull(w0.api, [w.versionId]);
    const byDate = Object.fromEntries(res.body.occurrences.map((o: { localDate: string; checklistVersionId: string }) => [o.localDate, o.checklistVersionId]));
    expect(byDate).toEqual({ '2026-11-02': w.versionId, '2026-11-03': w.versionId, '2026-11-04': w.versionId, '2026-11-05': v2 });
    expect(res.body.checklistVersions.map((v: { id: string }) => v.id)).toEqual([v2]);
  });

  it('shows who holds the claim, and the caller’s own executions with answers and pending uploads', async () => {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await registerPhoto(w0.api, executionId, w.c.photo.id);
    await w0.api.put(`/api/v1/executions/${executionId}/answers`, answersBody(1, { [w.c.temp.id]: { number: 5 } }, '2026-11-02T04:15:00.000Z'));
    const theirs = (await pull(w1.api)).body;
    expect(theirs.occurrences[0]).toMatchObject({ id: w.occurrenceId, status: 'in_progress', claim: { executionId, executorUserId: w0.id, executorName: 'İşçi 1' } });
    expect(theirs.executions).toEqual([]);
    expect((await pull(w0.api)).body.executions).toEqual([
      {
        id: executionId,
        occurrenceId: w.occurrenceId,
        checklistVersionId: w.versionId,
        state: 'active',
        rejectedReason: null,
        startedAt: '2026-11-02T04:10:00.000Z',
        completedAt: null,
        answers: { [w.c.temp.id]: { number: 5 } },
        answersRev: 1,
        progress: { answered: 1, total: 4, requiredMissing: 2 },
        late: false,
        clockSuspect: false,
        mediaPending: 1,
      },
    ]);
  });

  it('keeps an active execution in sync after the worker leaves the snapshot', async () => {
    const w = await executionWorld(t);
    const [w0] = w.workers;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    await ownerQuery('delete from occurrence_assignees where user_id = $1', [w0.id]);
    clock.set('2026-11-08T04:00:00Z');
    const res = (await pull(w0.api)).body;
    expect(res.occurrences.map((o: { id: string }) => o.id)).toEqual([w.occurrenceId]);
    expect(res.executions.map((x: { id: string }) => x.id)).toEqual([executionId]);
  });

  it('drops finished executions after 24 hours and gives an outsider nothing', async () => {
    const w = await executionWorld(t);
    const api = w.workers[0].api;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const photo = await registerPhoto(api, executionId, w.c.photo.id);
    const answers = { [w.c.problem.id]: { optionIds: [w.c.no.id] }, [w.c.temp.id]: { number: 5 }, [w.c.photo.id]: { photos: [photo] } };
    await api.post(`/api/v1/executions/${executionId}/complete`, { rev: 1, answers, completedAt: '2026-11-02T04:20:00.000Z', deviceTime: '2026-11-02T04:20:00.000Z', clientOffsetMs: 0 });
    clock.set('2026-11-03T04:19:00Z');
    expect((await pull(api)).body.executions.map((x: { state: string }) => x.state)).toEqual(['completed']);
    clock.set('2026-11-03T04:21:00Z');
    expect((await pull(api)).body.executions).toEqual([]);
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const outsiderApi = as(t, (await loginWorker(t, w.s.orgCode, outsider.username!, outsider.secret)).accessToken);
    expect((await pull(outsiderApi)).body).toMatchObject({ occurrences: [], checklistVersions: [], executions: [] });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-sync`
Expected: FAIL: `GET /api/v1/me/sync` returns 404.

- [ ] **Step 3: Implement**

`apps/api/src/executions/mappers.ts`:

```ts
import { sql } from 'drizzle-orm';

/** Media of the execution in the current row not yet confirmed as uploaded (spec §6.7 `mediaPending`). */
export const mediaPendingSql = sql<number>`(select count(*)::int from execution_media m where m.execution_id = "executions"."id" and m.status = 'pending')`;
```

Add to `apps/api/src/executions/dto.ts` (extend the contracts import with `syncQuerySchema` and `syncResponseSchema`):

```ts
export class SyncQueryDto extends createZodDto(syncQuerySchema) {}
export class SyncResponseDto extends createZodDto(syncResponseSchema) {}
```

`apps/api/src/executions/sync.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { EXECUTION_LIMITS, type ExecutionProgress, type MyExecution, type SyncResponse } from '@taskop/contracts';
import { and, asc, eq, getTableColumns, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklistVersions, executions, occurrences } from '../db/schema';
import { OccurrenceQueries } from '../scheduling/occurrence-queries';
import { OccurrenceWriter } from '../scheduling/occurrence-writer';
import type { SyncQueryDto } from './dto';
import { ExecutionLookups } from './execution-lookups';
import { mediaPendingSql } from './mappers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** GET /me/sync (spec §6.1): what the phone needs to work offline for the next days. */
@Injectable()
export class SyncService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly queries: OccurrenceQueries,
    private readonly writer: OccurrenceWriter,
    private readonly lookups: ExecutionLookups,
  ) {}

  async pull(p: Principal, q: SyncQueryDto): Promise<SyncResponse> {
    const tx = this.db.tx();
    const now = this.clock.now();
    const from = new Date(+now - EXECUTION_LIMITS.syncPastDays * DAY);
    const to = new Date(+now + EXECUTION_LIMITS.syncFutureDays * DAY);
    const assigned = sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${p.userId})`;
    // An executor removed from the snapshot after starting still finishes their own execution.
    const executing = sql`exists (select 1 from executions x where x.occurrence_id = ${occurrences.id} and x.executor_user_id = ${p.userId} and x.state = 'active')`;
    const ids = (
      await tx
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(or(and(assigned, ne(occurrences.status, 'cancelled'), lt(occurrences.startsAt, to), gt(occurrences.closesAt, from)), executing))
    ).map((r) => r.id);
    // The first download by an assignee pins the version (spec §5.1).
    await this.writer.pinVersions(ids);
    const rows = ids.length
      ? await this.queries.select().where(inArray(occurrences.id, ids)).orderBy(asc(occurrences.startsAt), asc(occurrences.id))
      : [];
    const claims = await this.lookups.claims(ids);
    const known = new Set(q.knownVersionIds);
    const versionIds = [...new Set(rows.map((r) => r.o.checklistVersionId).filter((v): v is string => v !== null && !known.has(v)))];
    const versions = versionIds.length
      ? await tx
          .select({ id: checklistVersions.id, checklistId: checklistVersions.checklistId, number: checklistVersions.number, content: checklistVersions.content })
          .from(checklistVersions)
          .where(inArray(checklistVersions.id, versionIds))
      : [];
    const own = await tx
      .select({ x: getTableColumns(executions), mediaPending: mediaPendingSql })
      .from(executions)
      .where(
        and(
          eq(executions.executorUserId, p.userId),
          or(eq(executions.state, 'active'), gte(executions.updatedAt, new Date(+now - EXECUTION_LIMITS.syncFinishedHours * HOUR))),
        ),
      )
      .orderBy(asc(executions.startedAt), asc(executions.id));
    return {
      serverTime: now.toISOString(),
      occurrences: rows.map((r) => ({
        id: r.o.id,
        checklistId: r.o.checklistId,
        checklistName: r.checklistName,
        siteId: r.o.siteId,
        siteName: r.siteName,
        shiftName: r.shiftName,
        localDate: r.o.localDate,
        startsAt: r.o.startsAt.toISOString(),
        dueAt: r.o.dueAt.toISOString(),
        closesAt: r.o.closesAt.toISOString(),
        status: r.o.status,
        checklistVersionId: r.o.checklistVersionId!,
        claim: claims.get(r.o.id) ?? null,
      })),
      checklistVersions: versions.map((v) => ({
        id: v.id,
        checklistId: v.checklistId,
        number: v.number!,
        schemaVersion: (v.content as { schemaVersion?: number }).schemaVersion ?? 1,
        content: v.content,
      })),
      executions: own.map(({ x, mediaPending }) => ({
        id: x.id,
        occurrenceId: x.occurrenceId,
        checklistVersionId: x.checklistVersionId,
        state: x.state,
        rejectedReason: x.rejectedReason,
        startedAt: x.startedAt.toISOString(),
        completedAt: x.completedAt?.toISOString() ?? null,
        answers: x.answers as MyExecution['answers'],
        answersRev: x.answersRev,
        progress: x.progress as ExecutionProgress,
        late: x.late,
        clockSuspect: x.clockSuspect,
        mediaPending,
      })),
    };
  }
}
```

`apps/api/src/executions/sync.controller.ts`:

```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { SyncResponse } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import type { Principal } from '../common/request';
import { SyncQueryDto, SyncResponseDto } from './dto';
import { SyncService } from './sync.service';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('me/sync')
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Get()
  @ApiOkResponse({ type: SyncResponseDto })
  pull(@CurrentPrincipal() p: Principal, @Query() q: SyncQueryDto): Promise<SyncResponse> {
    return this.sync.pull(p, q);
  }
}
```

In `executions.module.ts`, add `SyncController` to `controllers` and `SyncService` to `providers`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-sync`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/executions apps/api/test/executions-sync.test.ts
git commit -m "feat(api): add the download sync with pinned versions, claims and the caller's executions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Upload confirmation, view URLs and `media.cleanup` (SeaweedFS)

**Files:**
- Create: `apps/api/src/executions/execution-access.ts`, `apps/api/src/executions/media.controller.ts`, `apps/api/src/executions/media-jobs.ts`
- Modify:
  - `apps/api/src/executions/media.service.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.module.ts`
  - `apps/api/src/scheduling/jobs.service.ts`, `apps/api/src/scheduling/scheduling.module.ts`
- Test: `apps/api/test/executions-storage.test.ts`

**Interfaces:**
- Consumes: `S3Service.head`, `presignGet`, `delete` (Task 6); `SchedulingScope.occurrences`.
- Produces:
  - `ExecutionAccess.assertCanRead(p, executorUserId, occurrenceId): Promise<void>`
    - Passes for the executor, or for an `assignments.view` holder whose data scope covers the occurrence.
    - Anyone else gets `NOT_FOUND`.
  - `MediaService.confirmUploaded(p, mediaId): Promise<MediaConfirmResult>`
    - Executor only; idempotent.
    - HEAD must match `bytes` and `mime`, otherwise `MEDIA_NOT_FOUND_IN_STORAGE`.
    - Clears `storage_purged_at`.
  - `MediaService.viewUrl(p, mediaId): Promise<MediaUrl>`. `pending` media → `MEDIA_NOT_FOUND_IN_STORAGE`.
  - Routes `POST /media/:id/uploaded` (200) and `GET /media/:id/url`
  - `JobsService.define(def: JobDefinition)`, where `JobDefinition = { name: string; cron: string; handler(tenantIds?: string[]): Promise<unknown> }`
    - Call it from `onModuleInit`.
    - Defined jobs get the same queue options, worker and cron handling as the SP3 jobs.
    - `runNow(queue: string, tenantIds?)` accepts any defined queue.
  - `MEDIA_CLEANUP_QUEUE = 'media.cleanup'` and `MediaJobs.cleanupAll(only?: string[]): Promise<number>`
    - Runs daily at 03:30 UTC.
    - Deletes the objects of media still `pending` 14 days after registration, and sets `storage_purged_at`. The rows stay `pending`.
    - Logs a warning per medium.
  - `SchedulingModule` also exports `JobsService`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-storage.test.ts`:

```ts
import { localDateOf, type MediaUploadTicket } from '@taskop/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MEDIA_CLEANUP_QUEUE, MediaJobs } from '../src/executions/media-jobs';
import { JobsService } from '../src/scheduling/jobs.service';
import { S3Service } from '../src/storage/s3.service';
import { createTestApp, type TestApp } from './app';
import { claimOk, executionWorld, photoBody } from './execution-fixtures';
import { as, createUserDirect, loginStaff } from './fixtures';
import { ownerQuery } from './owner-db';
import { type Api, fixed } from './scheduling-fixtures';
import { type Seaweed, startSeaweedfs } from './seaweedfs';

/** Real time throughout: SeaweedFS checks signatures against its own clock. */
describe('media upload, confirmation, viewing and cleanup against SeaweedFS', () => {
  let sw: Seaweed;
  let t: TestApp;
  beforeAll(async () => {
    sw = await startSeaweedfs();
    t = await createTestApp(sw.env);
  });
  afterAll(async () => {
    await t?.close();
    await sw?.stop();
  });

  /** An occurrence open all day today (00:00–23:59 Baku) with İşçi 1's active execution. */
  async function liveExecution(app: TestApp) {
    const now = new Date();
    const w = await executionWorld(app, { date: localDateOf(now, 'Asia/Baku'), timing: fixed('00:00', 1380, 59) });
    const executionId = await claimOk(w.workers[0].api, w.occurrenceId, now.toISOString());
    return { w, executionId, api: w.workers[0].api };
  }
  async function registerBytes(api: Api, executionId: string, itemId: string | null, bytes: number) {
    const now = new Date().toISOString();
    const body = photoBody(itemId, { bytes, capturedAt: now, deviceTime: now });
    const res = await api.post(`/api/v1/executions/${executionId}/media`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { id: body.id, ticket: res.body as MediaUploadTicket };
  }
  const upload = (ticket: MediaUploadTicket, body: Buffer) =>
    fetch(ticket.uploadUrl, { method: 'PUT', body, headers: { 'Content-Type': ticket.headers['Content-Type']! } });
  const mediaRow = async (id: string) =>
    (await ownerQuery<{ status: string; storage_key: string; purged: boolean }>('select status, storage_key, storage_purged_at is not null as purged from execution_media where id = $1', [id])).rows[0]!;

  it('registers, uploads through the presigned PUT and confirms', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(2048, 1);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    expect((await upload(ticket, bytes)).status).toBe(200);
    const res = await api.post(`/api/v1/media/${id}/uploaded`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ mediaId: id, status: 'uploaded' });
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.uploadedAt).toBe(res.body.uploadedAt);
    expect((await mediaRow(id)).status).toBe('uploaded');
    expect((await w.workers[1].api.post(`/api/v1/media/${id}/uploaded`)).body.error.code).toBe('NOT_EXECUTOR');
  });

  it('confirming before the PUT finished is refused and can be retried', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(500, 2);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    const early = await api.post(`/api/v1/media/${id}/uploaded`);
    expect([early.status, early.body.error.code]).toEqual([422, 'MEDIA_NOT_FOUND_IN_STORAGE']);
    expect((await mediaRow(id)).status).toBe('pending');
    expect((await upload(ticket, bytes)).status).toBe(200);
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.status).toBe('uploaded');
  });

  it('refuses an object whose size differs from the registration', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, 1000);
    // The signed Content-Length makes storage refuse the PUT (403); if it ever accepts it, the HEAD check still does.
    expect([200, 403]).toContain((await upload(ticket, Buffer.alloc(999, 3))).status);
    expect((await api.post(`/api/v1/media/${id}/uploaded`)).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
  });

  it('issues view URLs to the executor and in-scope viewers only', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const bytes = Buffer.alloc(300, 4);
    const { id, ticket } = await registerBytes(api, executionId, w.c.photo.id, bytes.length);
    await upload(ticket, bytes);
    await api.post(`/api/v1/media/${id}/uploaded`);
    const manager = async (siteId: string) => {
      const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
      await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] });
      return as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
    };
    const mine = await api.get(`/api/v1/media/${id}/url`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(Buffer.from(await (await fetch(mine.body.url)).arrayBuffer())).toEqual(bytes);
    expect((await w.owner.get(`/api/v1/media/${id}/url`)).status).toBe(200);
    expect((await (await manager(w.siteId)).get(`/api/v1/media/${id}/url`)).status).toBe(200);
    expect((await (await manager(w.otherSiteId)).get(`/api/v1/media/${id}/url`)).status).toBe(404);
    expect((await w.workers[1].api.get(`/api/v1/media/${id}/url`)).status).toBe(404);
    const pending = await registerBytes(api, executionId, null, 10);
    expect((await api.get(`/api/v1/media/${pending.id}/url`)).body.error.code).toBe('MEDIA_NOT_FOUND_IN_STORAGE');
  });

  it('deletes the objects of media never confirmed after 14 days, once, and keeps the rows', async () => {
    const { w, executionId, api } = await liveExecution(t);
    const old = await registerBytes(api, executionId, w.c.photo.id, 10);
    const recent = await registerBytes(api, executionId, null, 10);
    expect((await upload(old.ticket, Buffer.alloc(10))).status).toBe(200);
    expect((await upload(recent.ticket, Buffer.alloc(10))).status).toBe(200);
    await ownerQuery("update execution_media set created_at = now() - interval '15 days' where id = $1", [old.id]);
    await ownerQuery("update execution_media set created_at = now() - interval '13 days' where id = $1", [recent.id]);
    const jobs = t.app.get(MediaJobs);
    const s3 = t.app.get(S3Service);
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(1);
    expect(await jobs.cleanupAll([w.s.tenantId])).toBe(0);
    const o = await mediaRow(old.id);
    expect([o.status, o.purged]).toEqual(['pending', true]);
    expect(await s3.head(o.storage_key)).toBeNull();
    const r = await mediaRow(recent.id);
    expect([r.status, r.purged]).toEqual(['pending', false]);
    expect(await s3.head(r.storage_key)).not.toBeNull();
  });

  it('runs media.cleanup through a real pg-boss queue', async () => {
    const app = await createTestApp({ ...sw.env, JOBS_ENABLED: 'true', JOBS_CRON: 'false' });
    try {
      const { w, executionId, api } = await liveExecution(app);
      const m = await registerBytes(api, executionId, null, 10);
      await ownerQuery("update execution_media set created_at = now() - interval '15 days' where id = $1", [m.id]);
      await app.app.get(JobsService).runNow(MEDIA_CLEANUP_QUEUE, [w.s.tenantId]);
      await expect.poll(async () => (await mediaRow(m.id)).purged, { timeout: 20_000, interval: 250 }).toBe(true);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-storage`
Expected: FAIL: `../src/executions/media-jobs` does not exist.

- [ ] **Step 3: Let other modules define pg-boss jobs**

In `apps/api/src/scheduling/jobs.service.ts`:
- Delete the line `type WorkQueue = typeof QUEUES.materialize | typeof QUEUES.sweep;`.
- Add after `interface JobData`:

```ts
/** A job another module runs per tenant on a cron (e.g. media.cleanup). */
export interface JobDefinition {
  name: string;
  cron: string;
  handler: (tenantIds?: string[]) => Promise<unknown>;
}
```

- Add the field `private readonly defined: JobDefinition[] = [];` after `private boss`, and this method after the constructor:

```ts
  /** Called from another provider's onModuleInit, which Nest runs before onApplicationBootstrap starts the workers. */
  define(def: JobDefinition): void {
    if (this.boss) throw new Error(`Job ${def.name} must be defined before the application starts`);
    this.defined.push(def);
  }
```

- In `onApplicationBootstrap`, after the `boss.work(QUEUES.dead, …)` block, add:

```ts
    for (const def of this.defined) {
      await this.ensureQueue(boss, def.name, { policy: 'stately', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
      await boss.work<JobData>(def.name, async ([job]) => {
        await def.handler(job?.data?.tenantIds);
      });
    }
```

- In the `if (this.config.JOBS_CRON)` branch, after the sweep schedule, add:

```ts
      for (const def of this.defined) await boss.schedule(def.name, def.cron, null, { tz: 'UTC', missed: 'once' });
```

- In the `else` branch, change the list to `for (const name of [QUEUES.materialize, QUEUES.sweep, ...this.defined.map((d) => d.name)]) {`.
- Change `runNow`'s signature to `async runNow(queue: string, tenantIds?: string[]): Promise<void> {`.

In `scheduling.module.ts`, add `JobsService` to `exports`.

- [ ] **Step 4: Implement access, confirmation, view URLs and cleanup**

`apps/api/src/executions/execution-access.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { occurrences } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';

/** Who may read an execution and its media (spec §6.7, §6.8). No new permission key. */
@Injectable()
export class ExecutionAccess {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
  ) {}

  /** The executor, or an assignments.view holder whose data scope covers the occurrence; anyone else gets 404. */
  async assertCanRead(p: Principal, executorUserId: string, occurrenceId: string): Promise<void> {
    if (p.userId === executorUserId) return;
    if (p.permissions.has('assignments.view')) {
      const [o] = await this.db
        .tx()
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(and(eq(occurrences.id, occurrenceId), this.scope.occurrences(p)));
      if (o) return;
    }
    throw new AppError('NOT_FOUND');
  }
}
```

Add to `MediaService`:
- Extend the contracts import with `type MediaConfirmResult` and `type MediaUrl`.
- Import `getTableColumns` from drizzle and `ExecutionAccess` from `'./execution-access'`.
- Add `private readonly access: ExecutionAccess,` as the last constructor parameter.
- Add these methods:

```ts
  /** POST /media/:id/uploaded: the object must exist with the registered size and type (spec §6.7). */
  async confirmUploaded(p: Principal, mediaId: string): Promise<MediaConfirmResult> {
    const tx = this.db.tx();
    const [row] = await tx
      .select({ m: getTableColumns(executionMedia), executorUserId: executions.executorUserId })
      .from(executionMedia)
      .innerJoin(executions, eq(executions.id, executionMedia.executionId))
      .where(eq(executionMedia.id, mediaId));
    if (!row) throw new AppError('NOT_FOUND');
    if (row.executorUserId !== p.userId) throw new AppError('NOT_EXECUTOR');
    if (row.m.status === 'uploaded') return { mediaId, status: 'uploaded', uploadedAt: row.m.uploadedAt?.toISOString() ?? null };
    const stored = await this.s3.head(row.m.storageKey);
    if (!stored || stored.contentLength !== row.m.bytes || stored.contentType !== row.m.mime) throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    const now = this.clock.now();
    await tx.update(executionMedia).set({ status: 'uploaded', uploadedAt: now, storagePurgedAt: null }).where(eq(executionMedia.id, mediaId));
    return { mediaId, status: 'uploaded', uploadedAt: now.toISOString() };
  }

  /** GET /media/:id/url: a 5-minute presigned GET after the permission check (NFR-10.02). */
  async viewUrl(p: Principal, mediaId: string): Promise<MediaUrl> {
    const [row] = await this.db
      .tx()
      .select({ m: getTableColumns(executionMedia), executorUserId: executions.executorUserId, occurrenceId: executions.occurrenceId })
      .from(executionMedia)
      .innerJoin(executions, eq(executions.id, executionMedia.executionId))
      .where(eq(executionMedia.id, mediaId));
    if (!row) throw new AppError('NOT_FOUND');
    await this.access.assertCanRead(p, row.executorUserId, row.occurrenceId);
    if (row.m.status !== 'uploaded') throw new AppError('MEDIA_NOT_FOUND_IN_STORAGE');
    const get = await this.s3.presignGet(row.m.storageKey);
    return { url: get.url, expiresAt: get.expiresAt.toISOString() };
  }
```

Add to `apps/api/src/executions/dto.ts` (extend the contracts import with `mediaConfirmResultSchema` and `mediaUrlSchema`):

```ts
export class MediaConfirmResultResponse extends createZodDto(mediaConfirmResultSchema) {}
export class MediaUrlResponse extends createZodDto(mediaUrlSchema) {}
```

`apps/api/src/executions/media.controller.ts`:

```ts
import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { MediaConfirmResult, MediaUrl } from '@taskop/contracts';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { MediaConfirmResultResponse, MediaUrlResponse } from './dto';
import { MediaService } from './media.service';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post(':id/uploaded')
  @HttpCode(200)
  @ApiOkResponse({ type: MediaConfirmResultResponse })
  confirm(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<MediaConfirmResult> {
    return this.media.confirmUploaded(p, id);
  }

  @Get(':id/url')
  @ApiOkResponse({ type: MediaUrlResponse })
  url(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<MediaUrl> {
    return this.media.viewUrl(p, id);
  }
}
```

`apps/api/src/executions/media-jobs.ts`:

```ts
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { MEDIA_LIMITS } from '@taskop/contracts';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService } from '../db/db.service';
import { executionMedia } from '../db/schema';
import { JobsService } from '../scheduling/jobs.service';
import { S3Service } from '../storage/s3.service';

export const MEDIA_CLEANUP_QUEUE = 'media.cleanup';
const DAY = 86_400_000;

/** media.cleanup (spec §6.7): daily, deletes storage objects of media still pending after 14 days; rows stay. */
@Injectable()
export class MediaJobs implements OnModuleInit {
  private readonly logger = new Logger('MediaJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly s3: S3Service,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    // 03:30 UTC = 07:30 in Baku, before the working day.
    this.jobs.define({ name: MEDIA_CLEANUP_QUEUE, cron: '30 3 * * *', handler: (tenantIds) => this.cleanupAll(tenantIds) });
  }

  async cleanupAll(only?: string[]): Promise<number> {
    const cutoff = new Date(+this.clock.now() - MEDIA_LIMITS.pendingCleanupDays * DAY);
    const r = await this.db.platform.execute<{ tenant_id: string }>(
      sql`select distinct tenant_id from execution_media where status = 'pending' and storage_purged_at is null and created_at <= ${cutoff}`,
    );
    const tenantIds = r.rows.map((x) => x.tenant_id).filter((id) => !only || only.includes(id));
    let total = 0;
    let failed = 0;
    for (const tenantId of tenantIds) {
      try {
        total += await this.db.withTenant(tenantId, null, () => this.cleanupTenant(cutoff));
      } catch (e) {
        failed++;
        this.logger.error(sanitiseForLog(e, null), `Media cleanup failed for tenant ${tenantId}`);
      }
    }
    if (failed) throw new Error(`Media cleanup failed for ${failed} tenant(s)`);
    return total;
  }

  private async cleanupTenant(cutoff: Date): Promise<number> {
    const tx = this.db.tx();
    const rows = await tx
      .select({ id: executionMedia.id, executionId: executionMedia.executionId, storageKey: executionMedia.storageKey })
      .from(executionMedia)
      .where(and(eq(executionMedia.status, 'pending'), isNull(executionMedia.storagePurgedAt), lte(executionMedia.createdAt, cutoff)))
      .orderBy(asc(executionMedia.id))
      .limit(1000);
    const now = this.clock.now();
    for (const m of rows) {
      await this.s3.delete(m.storageKey);
      await tx.update(executionMedia).set({ storagePurgedAt: now }).where(eq(executionMedia.id, m.id));
      this.logger.warn({ mediaId: m.id, executionId: m.executionId }, 'Medium never confirmed as uploaded; storage object deleted');
    }
    return rows.length;
  }
}
```

In `executions.module.ts`, add `MediaController` to `controllers`, and `ExecutionAccess` and `MediaJobs` to `providers`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-storage occurrence-jobs executions-media`
Expected: PASS. The SP3 pg-boss wiring test still passes, because `runNow` only widened its parameter type.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/executions apps/api/src/scheduling/jobs.service.ts apps/api/src/scheduling/scheduling.module.ts apps/api/test/executions-storage.test.ts
git commit -m "feat(api): confirm uploads, issue view URLs after permission checks and clean up never-uploaded media" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 16: Web reads: execution detail, occurrence extensions and the problems list

**Files:**
- Create:
  - `apps/api/src/scheduling/occurrence-executions.ts`
  - `apps/api/src/executions/execution-queries.ts`
  - `apps/api/src/executions/problems.service.ts`, `apps/api/src/executions/problems.controller.ts`
- Modify:
  - `apps/api/src/executions/mappers.ts`, `apps/api/src/executions/dto.ts`, `apps/api/src/executions/executions.controller.ts`, `apps/api/src/executions/executions.module.ts`
  - `apps/api/src/scheduling/occurrence-queries.ts`, `apps/api/src/scheduling/mappers.ts`, `apps/api/src/scheduling/occurrences.service.ts`, `apps/api/src/scheduling/scheduling.module.ts`
- Test: `apps/api/test/executions-read.test.ts`

**Interfaces:**
- Consumes: `ExecutionAccess` (Task 15), `SchedulingScope.occurrences`, `OccurrenceQueries`, `ExecutionLookups.content`.
- Produces:
  - In `executions/mappers.ts`:
    - `executionSummaryColumns` (select shape `{ x, executorName, problemCount, mediaPending }`), `ExecutionSummaryRow`
    - `toExecutionSummary(row): ExecutionSummary`, `toMediaDto`, `toProblemEntry`
  - `OccurrenceExecutions.forOccurrence(occurrenceId): Promise<{ execution: ExecutionSummary | null; rejectedExecutions: ExecutionSummary[] }>` (in scheduling; reads the executions table directly, so scheduling never imports the executions module)
  - `OccurrenceQueries.select()` adds `executionBrief`, and `toOccurrenceDto` maps it.
  - `ExecutionQueries.detail(p, id): Promise<ExecutionDetail>` and route `GET /executions/:id` (executor, or `assignments.view` in scope)
  - `ProblemsService.list(p, q): Promise<Page<ProblemDto>>`
    - Data scope through the occurrence.
    - Newest first, keyset cursor on `(created_at, id)`.
    - `itemLabel` comes from the pinned version.
  - Route `GET /problems` (`assignments.view`)

- [ ] **Step 1: Write the failing test**

`apps/api/test/executions-read.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimBody, claimOk, executionWorld, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff } from './fixtures';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('web reads of executions and problems', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  /** İşçi 1 completes at 08:20 with a rule and a manual problem on the temperature; İşçi 2's claim lost. */
  async function scenario() {
    const w = await executionWorld(t);
    const [w0, w1] = w.workers;
    clock.set('2026-11-02T04:20:00Z');
    const executionId = await claimOk(w0.api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    const lost = claimBody(w.occurrenceId, '2026-11-02T04:12:00.000Z');
    await w1.api.post('/api/v1/executions', lost);
    const photo = await registerPhoto(w0.api, executionId, w.c.photo.id);
    const answers = {
      [w.c.problem.id]: { optionIds: [w.c.no.id] },
      [w.c.temp.id]: { number: 10, note: 'isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [] } },
      [w.c.photo.id]: { photos: [photo] },
    };
    const res = await w0.api.post(`/api/v1/executions/${executionId}/complete`, {
      rev: 1,
      answers,
      completedAt: '2026-11-02T04:20:00.000Z',
      deviceTime: '2026-11-02T04:20:00.000Z',
      clientOffsetMs: 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return { w, executionId, lostId: lost.id, photo, answers };
  }
  async function manager(w: Awaited<ReturnType<typeof scenario>>['w'], siteId: string) {
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleKey: 'manager', emailVerified: true });
    await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds: [siteId] });
    return as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
  }

  it('adds the counted and the rejected executions to the occurrence detail and list', async () => {
    const { w, executionId, lostId } = await scenario();
    const detail = (await w.owner.get(`/api/v1/occurrences/${w.occurrenceId}`)).body;
    expect(detail.execution).toEqual({
      id: executionId,
      executor: { id: w.workers[0].id, fullName: 'İşçi 1' },
      state: 'completed',
      rejectedReason: null,
      startedAt: '2026-11-02T04:10:00.000Z',
      startedReceivedAt: '2026-11-02T04:20:00.000Z',
      completedAt: '2026-11-02T04:20:00.000Z',
      completedReceivedAt: '2026-11-02T04:20:00.000Z',
      late: false,
      clockSuspect: false,
      progress: { answered: 3, total: 4, requiredMissing: 0 },
      scorePercent: 50,
      problemCount: 2,
      mediaPending: 1,
    });
    expect(detail.rejectedExecutions).toEqual([
      expect.objectContaining({ id: lostId, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED', executor: { id: w.workers[1].id, fullName: 'İşçi 2' }, problemCount: 0 }),
    ]);
    const list = (await w.owner.get(`/api/v1/occurrences?from=2026-11-02&to=2026-11-03&assignmentId=${w.assignmentId}`)).body.items;
    expect(list[0].executionBrief).toEqual({
      executionId,
      executorName: 'İşçi 1',
      state: 'completed',
      progress: { answered: 3, total: 4, requiredMissing: 0 },
      scorePercent: 50,
      late: false,
      clockSuspect: false,
    });
    expect(list[1].executionBrief).toBeNull();
  });

  it('returns an execution to its executor and in-scope viewers only', async () => {
    const { w, executionId, lostId, photo, answers } = await scenario();
    const res = await w.owner.get(`/api/v1/executions/${executionId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: executionId,
      state: 'completed',
      versionNumber: 1,
      checklistVersionId: w.versionId,
      answers,
      answersRev: 1,
      score: { percent: 50 },
      clockOffsetMs: 0,
      device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
      occurrence: { id: w.occurrenceId, status: 'completed' },
      media: [{ id: photo, itemId: w.c.photo.id, kind: 'photo', source: 'camera', status: 'pending', capturedBy: { id: w.workers[0].id, fullName: 'İşçi 1' } }],
    });
    expect(res.body.content.sections[0].items).toHaveLength(4);
    expect(res.body.problems.map((p: { source: string; severity: string; note: string }) => [p.source, p.severity, p.note])).toEqual([
      ['rule', 'normal', 'isti'],
      ['manual', 'critical', 'Kondisioner xarabdır'],
    ]);
    expect((await w.workers[0].api.get(`/api/v1/executions/${executionId}`)).status).toBe(200);
    expect((await w.workers[1].api.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await w.workers[1].api.get(`/api/v1/executions/${lostId}`)).body).toMatchObject({ state: 'rejected', rejectedReason: 'ALREADY_CLAIMED' });
    expect((await (await manager(w, w.siteId)).get(`/api/v1/executions/${executionId}`)).status).toBe(200);
    expect((await (await manager(w, w.otherSiteId)).get(`/api/v1/executions/${executionId}`)).status).toBe(404);
  });

  it('lists problems newest first with filters, labels, a cursor and a 92-day range', async () => {
    const { w } = await scenario();
    const get = (qs: string) => w.owner.get(`/api/v1/problems?from=2026-11-01&to=2026-11-30${qs}`);
    const all = (await get('')).body;
    expect(all.items.map((p: { itemLabel: string; source: string; severity: string }) => [p.itemLabel, p.source, p.severity])).toEqual([
      ['Temperatur', 'manual', 'critical'],
      ['Temperatur', 'rule', 'normal'],
    ]);
    expect(all.items[0]).toMatchObject({
      occurrenceId: w.occurrenceId,
      localDate: '2026-11-02',
      siteId: w.siteId,
      siteName: 'Filial 1',
      checklistId: w.checklistId,
      checklistName: 'İcra yoxlaması',
      executorName: 'İşçi 1',
      note: 'Kondisioner xarabdır',
      mediaIds: [],
    });
    expect((await get('&severity=critical')).body.items).toHaveLength(1);
    expect((await get('&source=rule')).body.items).toHaveLength(1);
    expect((await get(`&siteId=${w.otherSiteId}`)).body.items).toHaveLength(0);
    expect((await get(`&checklistId=${w.checklistId}`)).body.items).toHaveLength(2);
    const page1 = (await get('&limit=1')).body;
    expect(page1.items).toHaveLength(1);
    const page2 = (await get(`&limit=1&cursor=${page1.nextCursor}`)).body;
    expect([page2.items[0].source, page2.nextCursor]).toEqual(['rule', null]);
    expect((await w.owner.get('/api/v1/problems?from=2026-12-01&to=2026-12-31')).body.items).toEqual([]);
    const long = await w.owner.get('/api/v1/problems?from=2026-11-01&to=2027-02-01');
    expect([long.status, long.body.error.fields]).toEqual([400, { to: 'executions.issues.rangeTooLong' }]);
    expect((await w.workers[0].api.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).status).toBe(403);
    expect((await (await manager(w, w.otherSiteId)).get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- executions-read`
Expected: FAIL: `detail.execution` is `null` and `GET /api/v1/executions/:id` returns 404.

- [ ] **Step 3: Add the mappers**

Replace `apps/api/src/executions/mappers.ts` with:

```ts
import type { DeviceInfo, ExecutionMediaDto, ExecutionProblem, ExecutionProgress, ExecutionSummary, ScoreResult } from '@taskop/contracts';
import { getTableColumns, sql } from 'drizzle-orm';
import { executionMedia, executionProblems, executions, users } from '../db/schema';

/** Media of the execution in the current row not yet confirmed as uploaded (spec §6.7 `mediaPending`). */
export const mediaPendingSql = sql<number>`(select count(*)::int from execution_media m where m.execution_id = "executions"."id" and m.status = 'pending')`;
export const problemCountSql = sql<number>`(select count(*)::int from execution_problems pr where pr.execution_id = "executions"."id")`;

/** Select shape for summaries: `from(executions).innerJoin(users, executor)`. */
export const executionSummaryColumns = {
  x: getTableColumns(executions),
  executorName: users.fullName,
  problemCount: problemCountSql,
  mediaPending: mediaPendingSql,
};

export interface ExecutionSummaryRow {
  x: typeof executions.$inferSelect;
  executorName: string;
  problemCount: number;
  mediaPending: number;
}

export const toExecutionSummary = (r: ExecutionSummaryRow): ExecutionSummary => ({
  id: r.x.id,
  executor: { id: r.x.executorUserId, fullName: r.executorName },
  state: r.x.state,
  rejectedReason: r.x.rejectedReason,
  startedAt: r.x.startedAt.toISOString(),
  startedReceivedAt: r.x.startedReceivedAt.toISOString(),
  completedAt: r.x.completedAt?.toISOString() ?? null,
  completedReceivedAt: r.x.completedReceivedAt?.toISOString() ?? null,
  late: r.x.late,
  clockSuspect: r.x.clockSuspect,
  progress: r.x.progress as ExecutionProgress,
  scorePercent: (r.x.score as ScoreResult | null)?.percent ?? null,
  problemCount: r.problemCount,
  mediaPending: r.mediaPending,
});

export const toMediaDto = (r: { m: typeof executionMedia.$inferSelect; capturedByName: string }): ExecutionMediaDto => ({
  id: r.m.id,
  itemId: r.m.itemId,
  kind: r.m.kind,
  source: r.m.source,
  mime: r.m.mime,
  bytes: r.m.bytes,
  width: r.m.width,
  height: r.m.height,
  durationMs: r.m.durationMs,
  capturedAt: r.m.capturedAt.toISOString(),
  capturedBy: { id: r.m.capturedByUserId, fullName: r.capturedByName },
  status: r.m.status,
  uploadedAt: r.m.uploadedAt?.toISOString() ?? null,
});

export const toProblemEntry = (p: typeof executionProblems.$inferSelect): ExecutionProblem => ({
  id: p.id,
  itemId: p.itemId,
  source: p.source,
  severity: p.severity,
  note: p.note,
  mediaIds: p.mediaIds,
  createdAt: p.createdAt.toISOString(),
});

export const asDevice = (v: unknown): DeviceInfo => v as DeviceInfo;
```

- [ ] **Step 4: Extend the occurrence reads**

`apps/api/src/scheduling/occurrence-executions.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ExecutionSummary } from '@taskop/contracts';
import { asc, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { executions, users } from '../db/schema';
import { executionSummaryColumns, toExecutionSummary } from '../executions/mappers';

/** The executions of one occurrence for its detail (SP4 spec §6.8). Plain reads; no dependency on the executions module. */
@Injectable()
export class OccurrenceExecutions {
  constructor(private readonly db: DbService) {}

  async forOccurrence(occurrenceId: string): Promise<{ execution: ExecutionSummary | null; rejectedExecutions: ExecutionSummary[] }> {
    const rows = await this.db
      .tx()
      .select(executionSummaryColumns)
      .from(executions)
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .where(eq(executions.occurrenceId, occurrenceId))
      .orderBy(asc(executions.startedAt), asc(executions.id));
    const all = rows.map(toExecutionSummary);
    return { execution: all.find((s) => s.state !== 'rejected') ?? null, rejectedExecutions: all.filter((s) => s.state === 'rejected') };
  }
}
```

In `apps/api/src/scheduling/occurrence-queries.ts`, import `type ExecutionBrief` with `OccurrenceDto` from `@taskop/contracts`, and add this field to the `select({ … })` object after `assigneeIds`:

```ts
        // The counted execution, for list badges and columns (SP4 spec §8).
        executionBrief: sql<ExecutionBrief | null>`(select json_build_object(
            'executionId', x.id, 'executorName', u.full_name, 'state', x.state, 'progress', x.progress,
            'scorePercent', (x.score->>'percent')::float8, 'late', x.late, 'clockSuspect', x.clock_suspect)
          from executions x join users u on u.id = x.executor_user_id
          where x.occurrence_id = "occurrences"."id" and x.state <> 'rejected')`,
```

In `apps/api/src/scheduling/mappers.ts`:
- Add `type ExecutionBrief` to the contracts import.
- Add `executionBrief: ExecutionBrief | null;` to `OccurrenceJoinedRow`.
- In `toOccurrenceDto`, replace `executionBrief: null,` and its comment with `executionBrief: r.executionBrief,`.

In `apps/api/src/scheduling/occurrences.service.ts`:
- Import `OccurrenceExecutions` from `'./occurrence-executions'` and add `private readonly executionsOf: OccurrenceExecutions,` as the last constructor parameter.
- In `get`, replace the return with:

```ts
    return { ...toOccurrenceDto(row), assignees, history: history.map(toHistoryEntry), ...(await this.executionsOf.forOccurrence(id)) };
```

In `scheduling.module.ts`, add `OccurrenceExecutions` to `providers`.

- [ ] **Step 5: Implement the execution detail and the problems list**

`apps/api/src/executions/execution-queries.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ExecutionDetail, ScoreResult } from '@taskop/contracts';
import { asc, eq, getTableColumns } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklistVersions, executionMedia, executionProblems, executions, occurrences, users } from '../db/schema';
import { toOccurrenceDto } from '../scheduling/mappers';
import { OccurrenceQueries } from '../scheduling/occurrence-queries';
import { ExecutionAccess } from './execution-access';
import { ExecutionLookups } from './execution-lookups';
import { asDevice, executionSummaryColumns, toExecutionSummary, toMediaDto, toProblemEntry } from './mappers';

/** GET /executions/:id (spec §6.8): everything the web drawer's "İcra" tab shows. */
@Injectable()
export class ExecutionQueries {
  constructor(
    private readonly db: DbService,
    private readonly access: ExecutionAccess,
    private readonly occurrenceQueries: OccurrenceQueries,
    private readonly lookups: ExecutionLookups,
  ) {}

  async detail(p: Principal, id: string): Promise<ExecutionDetail> {
    const tx = this.db.tx();
    const [row] = await tx.select(executionSummaryColumns).from(executions).innerJoin(users, eq(users.id, executions.executorUserId)).where(eq(executions.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    await this.access.assertCanRead(p, row.x.executorUserId, row.x.occurrenceId);
    const [occurrence] = await this.occurrenceQueries.select().where(eq(occurrences.id, row.x.occurrenceId));
    const [version] = await tx.select({ number: checklistVersions.number }).from(checklistVersions).where(eq(checklistVersions.id, row.x.checklistVersionId));
    const media = await tx
      .select({ m: getTableColumns(executionMedia), capturedByName: users.fullName })
      .from(executionMedia)
      .innerJoin(users, eq(users.id, executionMedia.capturedByUserId))
      .where(eq(executionMedia.executionId, id))
      .orderBy(asc(executionMedia.capturedAt), asc(executionMedia.id));
    const problems = await tx.select().from(executionProblems).where(eq(executionProblems.executionId, id)).orderBy(asc(executionProblems.createdAt), asc(executionProblems.id));
    return {
      ...toExecutionSummary(row),
      occurrence: toOccurrenceDto(occurrence!),
      checklistVersionId: row.x.checklistVersionId,
      versionNumber: version!.number!,
      content: await this.lookups.content(row.x.checklistVersionId),
      answers: row.x.answers as ExecutionDetail['answers'],
      answersRev: row.x.answersRev,
      score: (row.x.score as ScoreResult | null) ?? null,
      clockOffsetMs: row.x.clockOffsetMs,
      device: asDevice(row.x.device),
      lastSyncedAt: row.x.lastSyncedAt.toISOString(),
      media: media.map(toMediaDto),
      problems: problems.map(toProblemEntry),
    };
  }
}
```

`apps/api/src/executions/problems.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { type Page, type ProblemDto, walkItems } from '@taskop/contracts';
import { and, between, desc, eq, getTableColumns, type SQL, sql } from 'drizzle-orm';
import type { Principal } from '../common/request';
import { DbService } from '../db/db.service';
import { checklists, executionProblems, executions, occurrences, sites, users } from '../db/schema';
import { SchedulingScope } from '../scheduling/scheduling-scope';
import type { ProblemListQueryDto } from './dto';
import { ExecutionLookups } from './execution-lookups';

/** GET /problems (spec §6.8): read-only, newest first, data scope through the occurrence. */
@Injectable()
export class ProblemsService {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
    private readonly lookups: ExecutionLookups,
  ) {}

  async list(p: Principal, q: ProblemListQueryDto): Promise<Page<ProblemDto>> {
    const conds: (SQL | undefined)[] = [this.scope.occurrences(p), between(occurrences.localDate, q.from, q.to)];
    if (q.siteId) conds.push(eq(executionProblems.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(executionProblems.checklistId, q.checklistId));
    if (q.severity) conds.push(eq(executionProblems.severity, q.severity));
    if (q.source) conds.push(eq(executionProblems.source, q.source));
    if (q.cursor) {
      conds.push(sql`(${executionProblems.createdAt}, ${executionProblems.id}) < (select c.created_at, c.id from execution_problems c where c.id = ${q.cursor})`);
    }
    const rows = await this.db
      .tx()
      .select({
        pr: getTableColumns(executionProblems),
        localDate: occurrences.localDate,
        siteName: sites.name,
        checklistName: checklists.name,
        executorName: users.fullName,
        versionId: executions.checklistVersionId,
      })
      .from(executionProblems)
      .innerJoin(occurrences, eq(occurrences.id, executionProblems.occurrenceId))
      .innerJoin(executions, eq(executions.id, executionProblems.executionId))
      .innerJoin(users, eq(users.id, executions.executorUserId))
      .innerJoin(sites, eq(sites.id, executionProblems.siteId))
      .innerJoin(checklists, eq(checklists.id, executionProblems.checklistId))
      .where(and(...conds))
      .orderBy(desc(executionProblems.createdAt), desc(executionProblems.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const labels = new Map<string, Map<string, string>>();
    for (const versionId of new Set(page.map((r) => r.versionId))) {
      const byItem = new Map<string, string>();
      walkItems(await this.lookups.content(versionId), (item) => byItem.set(item.id, item.label));
      labels.set(versionId, byItem);
    }
    return {
      items: page.map((r) => ({
        id: r.pr.id,
        executionId: r.pr.executionId,
        occurrenceId: r.pr.occurrenceId,
        localDate: r.localDate,
        siteId: r.pr.siteId,
        siteName: r.siteName,
        checklistId: r.pr.checklistId,
        checklistName: r.checklistName,
        itemId: r.pr.itemId,
        itemLabel: labels.get(r.versionId)?.get(r.pr.itemId) ?? null,
        source: r.pr.source,
        severity: r.pr.severity,
        note: r.pr.note,
        mediaIds: r.pr.mediaIds,
        executorName: r.executorName,
        createdAt: r.pr.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.pr.id : null,
    };
  }
}
```

Add to `apps/api/src/executions/dto.ts` (extend the contracts import with `executionDetailSchema`, `pageOf`, `problemDtoSchema` and `problemListQuerySchema`):

```ts
export class ExecutionDetailResponse extends createZodDto(executionDetailSchema) {}
export class ProblemListQueryDto extends createZodDto(problemListQuerySchema) {}
export class ProblemPageResponse extends createZodDto(pageOf(problemDtoSchema)) {}
```

`apps/api/src/executions/problems.controller.ts`:

```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Page, ProblemDto } from '@taskop/contracts';
import { CurrentPrincipal, RequirePermission } from '../common/decorators';
import type { Principal } from '../common/request';
import { ProblemListQueryDto, ProblemPageResponse } from './dto';
import { ProblemsService } from './problems.service';

@ApiTags('executions')
@ApiBearerAuth()
@Controller('problems')
export class ProblemsController {
  constructor(@Inject(ProblemsService) private readonly problems: ProblemsService) {}

  @Get()
  @RequirePermission('assignments.view')
  @ApiOkResponse({ type: ProblemPageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: ProblemListQueryDto): Promise<Page<ProblemDto>> {
    return this.problems.list(p, q);
  }
}
```

In `executions.controller.ts`:
- Add `Get` to the `@nestjs/common` import and `ExecutionDetail` to the contracts type import.
- Import `ExecutionQueries` from `'./execution-queries'` and `ExecutionDetailResponse` from `'./dto'`.
- Add `@Inject(ExecutionQueries) private readonly queries: ExecutionQueries,` as the last constructor parameter, then:

```ts
  /** The executor, or assignments.view within the data scope (spec §6.8); anyone else gets 404. */
  @Get(':id')
  @ApiOkResponse({ type: ExecutionDetailResponse })
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseIdPipe) id: string): Promise<ExecutionDetail> {
    return this.queries.detail(p, id);
  }
```

In `executions.module.ts`, add `ProblemsController` to `controllers`, and `ExecutionQueries` and `ProblemsService` to `providers`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- executions-read test/occurrences.test.ts assignments scheduling-scope`
Expected: PASS. The SP3 occurrence tests are unchanged: they use `toMatchObject`, and occurrences without executions get `executionBrief: null`, `execution: null` and `rejectedExecutions: []`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/executions apps/api/src/scheduling apps/api/test/executions-read.test.ts
git commit -m "feat(api): show executions on occurrences, add execution detail and the problems list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Data scope, tenant isolation and OpenAPI for executions

**Files:**
- Test: `apps/api/test/executions-scope.test.ts`, `apps/api/test/executions-isolation.test.ts`
- Modify: `apps/api/test/openapi.test.ts`
- Modify (only if a test exposes a gap): `apps/api/src/executions/*`

**Interfaces:**
- Consumes everything from Tasks 9–16. This task adds no new production API. It pins the spec §10 scope and isolation requirements for every new endpoint.

- [ ] **Step 1: Write the scope suite**

`apps/api/test/executions-scope.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { claimOk, type ExecutionWorld, executionWorld, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, uniq } from './fixtures';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('execution data scope', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: ExecutionWorld;
  let executionId: string;
  let photo: string;
  const RANGE = 'from=2026-11-01&to=2026-11-30';
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await executionWorld(t);
    clock.set('2026-11-02T04:20:00Z');
    executionId = await claimOk(w.workers[0].api, w.occurrenceId, '2026-11-02T04:10:00.000Z');
    photo = await registerPhoto(w.workers[0].api, executionId, w.c.photo.id);
    await w.workers[0].api.put(`/api/v1/executions/${executionId}/answers`, {
      rev: 1,
      answers: { [w.c.temp.id]: { number: 5, problem: { severity: 'normal', note: 'Qapı sınıqdır', mediaIds: [] } } },
      deviceTime: '2026-11-02T04:20:00.000Z',
      clientOffsetMs: 0,
    });
  });
  afterAll(() => t.close());

  const staff = async (opts: { roleKey?: 'manager' | 'auditor'; roleId?: string }, siteIds: string[]) => {
    const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', emailVerified: true, ...opts });
    if (siteIds.length) await w.owner.put(`/api/v1/users/${u.id}/sites`, { siteIds });
    return as(t, (await loginStaff(t, u.email!, u.secret)).accessToken);
  };

  it('lets an all-scope auditor read everything and a site manager only their sites', async () => {
    const auditor = await staff({ roleKey: 'auditor' }, []);
    expect((await auditor.get(`/api/v1/executions/${executionId}`)).status).toBe(200);
    expect((await auditor.get(`/api/v1/problems?${RANGE}`)).body.items).toHaveLength(1);
    const outside = await staff({ roleKey: 'manager' }, [w.otherSiteId]);
    expect((await outside.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await outside.get(`/api/v1/media/${photo}/url`)).status).toBe(404);
    expect((await outside.get(`/api/v1/problems?${RANGE}`)).body.items).toEqual([]);
    expect((await outside.get(`/api/v1/occurrences/${w.occurrenceId}`)).status).toBe(404);
  });

  it('needs assignments.view to read someone else’s execution even with the occurrence in scope', async () => {
    const noView = (await w.owner.post('/api/v1/roles', { name: uniq('Baxmır'), dataScope: 'all', permissions: ['checklists.view'] })).body.id as string;
    const u = await staff({ roleId: noView }, []);
    expect((await u.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await u.get(`/api/v1/problems?${RANGE}`)).status).toBe(403);
  });

  it('never lets one worker read another worker’s execution or media', async () => {
    const other = w.workers[1].api;
    expect((await other.get(`/api/v1/executions/${executionId}`)).status).toBe(404);
    expect((await other.get(`/api/v1/media/${photo}/url`)).status).toBe(404);
    expect((await other.post(`/api/v1/media/${photo}/uploaded`)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Write the isolation suite**

`apps/api/test/executions-isolation.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { answersBody, claimBody, claimOk, type ExecutionWorld, executionWorld, photoBody, registerPhoto } from './execution-fixtures';
import { FakeClock } from './fake-clock';
import { MONDAY_0800 } from './scheduling-fixtures';

describe('execution tenant isolation', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let A: ExecutionWorld;
  let B: ExecutionWorld;
  const a: Record<string, string> = {};
  const at = '2026-11-02T04:20:00.000Z';
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    A = await executionWorld(t);
    B = await executionWorld(t);
    clock.set(at);
    a.execution = await claimOk(A.workers[0].api, A.occurrenceId, '2026-11-02T04:10:00.000Z');
    a.media = await registerPhoto(A.workers[0].api, a.execution, A.c.photo.id);
    await A.workers[0].api.put(`/api/v1/executions/${a.execution}/answers`, answersBody(1, { [A.c.temp.id]: { number: 30 } }, at));
  });
  afterAll(() => t.close());

  it.each([
    ['GET', () => `/api/v1/executions/${a.execution}`, undefined],
    ['PUT', () => `/api/v1/executions/${a.execution}/answers`, answersBody(2, {}, at)],
    ['POST', () => `/api/v1/executions/${a.execution}/complete`, { rev: 2, answers: {}, completedAt: at, deviceTime: at, clientOffsetMs: 0 }],
    ['POST', () => `/api/v1/executions/${a.execution}/media`, photoBody(null)],
    ['POST', () => `/api/v1/media/${a.media}/uploaded`, {}],
    ['GET', () => `/api/v1/media/${a.media}/url`, undefined],
  ] as const)('%s on a foreign id returns 404', async (method, url, body) => {
    for (const api of [B.owner, B.workers[0].api]) {
      const path = url();
      const res = method === 'GET' ? await api.get(path) : method === 'PUT' ? await api.put(path, body!) : await api.post(path, body ?? {});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('refuses a claim on a foreign occurrence and never lists the other tenant', async () => {
    expect((await B.workers[0].api.post('/api/v1/executions', claimBody(A.occurrenceId, at))).status).toBe(404);
    const sync = (await B.workers[0].api.get('/api/v1/me/sync')).body;
    expect(sync.occurrences.map((o: { id: string }) => o.id)).not.toContain(A.occurrenceId);
    expect(sync.executions).toEqual([]);
    expect((await B.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items).toEqual([]);
    expect((await A.owner.get('/api/v1/problems?from=2026-11-01&to=2026-11-30')).body.items).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Extend the OpenAPI check**

In `apps/api/test/openapi.test.ts`, add these paths to the `arrayContaining` list:

```ts
'/api/v1/me/sync', '/api/v1/executions', '/api/v1/executions/{id}', '/api/v1/executions/{id}/answers', '/api/v1/executions/{id}/complete', '/api/v1/executions/{id}/media', '/api/v1/media/{id}/uploaded', '/api/v1/media/{id}/url', '/api/v1/problems',
```

- [ ] **Step 4: Run the suites and fix gaps**

Run: `pnpm --filter @taskop/api test -- executions-scope executions-isolation openapi`
Expected: PASS. If a case fails, fix the service, not the test:
- Every read of another person's execution or media must go through `ExecutionAccess.assertCanRead`.
- Every command must find its execution or occurrence under RLS before anything else, so a foreign id is a 404.

- [ ] **Step 5: Run the whole API suite**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test`
Expected: PASS (Docker must be running: Postgres for every file, SeaweedFS for the two storage files).

- [ ] **Step 6: Commit**

```bash
git add apps/api/test apps/api/src/executions
git commit -m "test(api): pin execution data scope, tenant isolation and OpenAPI paths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Demo execution in the seed, and follow-up notes

**Files:**
- Modify: `apps/api/src/db/scripts/seed.ts`
- Test: `apps/api/test/seed-demo.test.ts`
- Create: `docs/superpowers/execution-follow-ups.md`

**Interfaces:**
- Consumes the demo tenant from `seed.ts`:
  - the assignment `Səhər təmizliyi` (daily 09:00, due after 2 h, 1 h grace) at `Anbar №1`
  - the worker `elvin`
  - the checklist `Gündəlik təmizlik yoxlaması` (current version v2)
- Produces, idempotently, a **partial** execution by elvin on yesterday's 09:00 occurrence:
  - The occurrence is created by the seed; the cron never creates closed slots.
  - Sections 1–2 are answered "Bəli". "Pis qoxu var?" = yes gives a rule problem, with its follow-up answered.
  - A manual problem is flagged on "Zibil qutuları boşaldılıb?".
  - History is written, and the version is pinned.
  - It is skipped if the tenant already has an execution, or if an occurrence for yesterday already exists.
  - This gives the web's execution tab and problems page (Part 3) data on a fresh demo database.

- [ ] **Step 1: Write the failing test**

`apps/api/test/seed-demo.test.ts`:

```ts
import { describe, expect, inject, it } from 'vitest';
import { seed } from '../src/db/scripts/seed';
import { ownerQuery } from './owner-db';

describe('demo seed', () => {
  it('seeds one partial demo execution with a rule and a manual problem, once', async () => {
    await seed(inject('db').ownerUrl);
    await seed(inject('db').ownerUrl);
    const r = await ownerQuery<{ state: string; status: string; sources: string[]; pinned: boolean; history: string[] }>(
      `select x.state, o.status, o.checklist_version_id = x.checklist_version_id as pinned,
              array(select p.source::text from execution_problems p where p.execution_id = x.id order by p.source::text) as sources,
              array(select h.to_status::text from occurrence_status_history h where h.occurrence_id = o.id order by h.id) as history
         from executions x
         join occurrences o on o.id = x.occurrence_id
         join tenants t on t.id = x.tenant_id
        where t.org_code = 'demo'`,
    );
    expect(r.rows).toEqual([{ state: 'partial', status: 'partial', sources: ['manual', 'rule'], pinned: true, history: ['pending', 'started', 'in_progress', 'partial'] }]);
  }, 60_000);
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- seed-demo`
Expected: FAIL: `r.rows` is `[]`.

- [ ] **Step 3: Add the seed function**

In `apps/api/src/db/scripts/seed.ts`:
- Extend the `@taskop/contracts` import to `import { addDays, type Answers, type ChecklistContent, computeScore, countItems, deriveProblems, localDateOf, progress, regenerateIds, zonedTimeToUtc } from '@taskop/contracts';`.
- Add after `seedDemoScheduling`:

```ts
/**
 * Idempotent: yesterday's "Səhər təmizliyi" occurrence, started by elvin and left partial by the sweep, with a rule
 * problem ("Pis qoxu var?" = yes) and a manual one, so the web's execution tab and problems page have data.
 */
async function seedDemoExecution(tx: Tx, tenantId: string): Promise<void> {
  const existing = await tx.select({ id: schema.executions.id }).from(schema.executions).where(eq(schema.executions.tenantId, tenantId)).limit(1);
  if (existing.length) return;
  const [assignment] = await tx
    .select()
    .from(schema.assignments)
    .where(and(eq(schema.assignments.tenantId, tenantId), eq(schema.assignments.name, 'Səhər təmizliyi')));
  const [elvin] = await tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.username, 'elvin')));
  if (!assignment || !elvin) return;
  const [checklist] = await tx.select({ versionId: schema.checklists.currentVersionId }).from(schema.checklists).where(eq(schema.checklists.id, assignment.checklistId));
  if (!checklist?.versionId) return;
  const [version] = await tx.select({ content: schema.checklistVersions.content }).from(schema.checklistVersions).where(eq(schema.checklistVersions.id, checklist.versionId));
  const yesterday = addDays(localDateOf(new Date(), 'Asia/Baku'), -1);
  const taken = await tx
    .select({ id: schema.occurrences.id })
    .from(schema.occurrences)
    .where(and(eq(schema.occurrences.assignmentId, assignment.id), eq(schema.occurrences.localDate, yesterday)));
  if (!version || taken.length) return;

  const content = version.content as ChecklistContent;
  const [entry, sanitary] = content.sections;
  const answers: Answers = {};
  for (const item of [...(entry?.items ?? []), ...(sanitary?.items ?? [])]) {
    if (item.type === 'yes_no') answers[item.id] = { optionIds: [item.options[0].id] };
    // "Pis qoxu var?" = yes is a problem; its follow-up asks for the source.
    if (item.type === 'yes_no' && item.label === 'Pis qoxu var?') {
      const followUp = item.rules[0]?.then.followUps[0];
      if (followUp) answers[followUp.id] = { text: 'Kanalizasiya borusundan' };
    }
    if (item.type === 'yes_no' && item.label === 'Zibil qutuları boşaldılıb?') {
      answers[item.id] = { optionIds: [item.options[0].id], problem: { severity: 'normal', note: 'Qutulardan birinin qapağı sınıqdır', mediaIds: [] } };
    }
  }

  const startsAt = zonedTimeToUtc(yesterday, 9 * 60, 'Asia/Baku');
  const dueAt = new Date(+startsAt + 120 * 60_000);
  const closesAt = new Date(+dueAt + 60 * 60_000);
  const startedAt = new Date(+startsAt + 15 * 60_000);
  const answeredAt = new Date(+startedAt + 5 * 60_000);
  const occurrenceId = uuidv7();
  await tx.insert(schema.occurrences).values({
    id: occurrenceId,
    tenantId,
    assignmentId: assignment.id,
    checklistId: assignment.checklistId,
    siteId: assignment.siteId,
    localDate: yesterday,
    startsAt,
    dueAt,
    closesAt,
    status: 'partial',
    statusChangedAt: closesAt,
    checklistVersionId: checklist.versionId,
    createdAt: startsAt,
  });
  await tx.insert(schema.occurrenceAssignees).values({ tenantId, occurrenceId, userId: elvin.id });
  await tx.insert(schema.occurrenceStatusHistory).values([
    { tenantId, occurrenceId, fromStatus: null, toStatus: 'pending', at: startsAt },
    { tenantId, occurrenceId, fromStatus: 'pending', toStatus: 'started', at: startedAt, actorUserId: elvin.id },
    { tenantId, occurrenceId, fromStatus: 'started', toStatus: 'in_progress', at: answeredAt, actorUserId: elvin.id },
    { tenantId, occurrenceId, fromStatus: 'in_progress', toStatus: 'partial', at: closesAt },
  ]);
  const executionId = uuidv7();
  await tx.insert(schema.executions).values({
    id: executionId,
    tenantId,
    occurrenceId,
    checklistVersionId: checklist.versionId,
    executorUserId: elvin.id,
    state: 'partial',
    startedAt,
    startedReceivedAt: startedAt,
    lastSyncedAt: answeredAt,
    answers,
    answersRev: 3,
    progress: progress(content, answers),
    score: computeScore(content, answers),
    clockOffsetMs: 0,
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    createdAt: startedAt,
    updatedAt: closesAt,
  });
  const problems = deriveProblems(content, answers);
  if (problems.length) {
    await tx.insert(schema.executionProblems).values(
      problems.map((p) => ({
        tenantId,
        executionId,
        occurrenceId,
        siteId: assignment.siteId,
        checklistId: assignment.checklistId,
        itemId: p.itemId,
        source: p.source,
        severity: p.severity,
        note: p.note,
        mediaIds: p.mediaIds,
        createdAt: answeredAt,
        updatedAt: answeredAt,
      })),
    );
  }
}
```

- Call it after `seedDemoScheduling` in both branches of `seed`:
  - Existing tenant: `await seedDemoExecution(tx, existing.id);` inside the `db.transaction` callback, after `seedDemoScheduling`.
  - New tenant: `await seedDemoExecution(tx, tenantId);` after `seedDemoScheduling(tx, tenantId, ownerId)`.
- Add to the final `console.log` block:

```ts
  console.log('  Execution: yesterday\'s "Səhər təmizliyi" by elvin, partial, with two problems (web schedule drawer and /problems)');
```

- [ ] **Step 4: Run the test and check the seed against the local demo database**

Run: `pnpm --filter @taskop/api test -- seed-demo seed-templates`
Expected: PASS.

Then, with the local stack from `docker compose up -d` and `apps/api/.env` filled in:

```bash
pnpm db:setup && pnpm db:seed && pnpm db:seed
```

Expected: both seed runs succeed, and the second adds nothing.

- [ ] **Step 5: Write the follow-up notes**

`docs/superpowers/execution-follow-ups.md`:

```markdown
# Mobile execution & offline sync — follow-ups

Items found while building sub-project 4 that are out of its scope. ⚑ marks the ones to look at first.

- ⚑ **Platform-admin reads.** `GET /executions/:id`, `GET /problems` and `GET /media/:id/url` are tenant-only. Platform admins see execution summaries in the occurrence drawer through the existing platform routes, but cannot open the detail or media yet. Add `platform/tenants/:tenantId/...` variants with the `route-mode` pattern if support needs them.
- ⚑ **Merge PR #2's deployment plan edits** listed in `docs/superpowers/plans/2026-10-09-mobile-execution-1-api.md` ("Deployment plan note").
- **A failed completion rolls back its answers.** `REQUIREMENTS_UNMET` discards the answers sent with the completion; the phone still has them and the earlier answers commands stored them. Store them first in a separate transaction if workers report lost edits.
- **Concurrent duplicate claims** (the same `id` sent twice in parallel) can produce one `500` from the primary-key race; the retry returns the stored result. Map `executions_pkey` to a replay if it shows up in logs.
- **Problem media cap at registration** is `5 × item count` per execution for `itemId: null` media; the exact "≤ 5 per manual problem" is enforced on the answers.
- **Problem lifecycle** (owner, due date, resolution: FR-13.07–09) → sub-project 5. **Alerts** on new problems and status changes (FR-13.04) → sub-project 6.
- **Media retention per plan** (NFR-10.03) → sub-project 9. `media.cleanup` only removes never-uploaded objects.
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/scripts/seed.ts apps/api/test/seed-demo.test.ts docs/superpowers/execution-follow-ups.md
git commit -m "feat(api): seed a demo partial execution with problems; record execution follow-ups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
