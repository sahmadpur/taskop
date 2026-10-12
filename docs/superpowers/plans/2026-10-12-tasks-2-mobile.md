# Taskop Tasks — Part 2: Mobile App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a worker see their tasks and their teams' unaccepted tasks on the phone, accept, start, answer with text, photos and videos and complete them, online or offline, with the work surviving an app kill and syncing by itself. Let a `tasks.manage` holder create a task and review submitted tasks on the phone while online.

**Architecture:**
- **Local store, version 3** (`apps/mobile/src/offline/db.ts`). The outbox and the local media table stop belonging to executions only:
  - `outbox` names an entity (`entity_type` `execution` | `task`, `entity_id`); `media` and `media_refusals` name an owner (`owner_type`, `owner_id`), and `media.role` holds a task medium's role.
  - New tables: `tasks` (the server's copy of each task as JSON, plus the phone's `local_status`, `rev` and `sync_note`) and `task_drafts` (the response being written: submission id, text, media ids).
  - The upgrade rebuilds the three tables in one transaction, keeping every row's id and the outbox order.
- **Task logic on the phone** reuses the contracts' pure functions: `taskTransition` decides every accept, start and submit, `taskEvidenceMet` decides Tamamla.
  - `task-records.ts` holds the row-level operations every layer shares: merge a server copy, forget a task, revert it to the server's status, drop a refused medium.
  - `task-store.ts` (beside `execution-store.ts`) does each worker action in one transaction: the status or draft write plus its outbox command.
- **Sync:** the outbox stays one queue in `seq` order, so each entity's commands go in order and a medium's registration always precedes the submission that lists it. `sync-engine.ts` gains the four task commands; `media-queue.ts` registers and confirms each file at the endpoint its owner needs; the pull sends the ids of the tasks the phone holds and applies `tasks` and `removedTaskIds`.
- **Refusals** follow SP4: what no retry can fix is resolved, not parked. A task a teammate took (or that left the user) goes with a notice; a state change refreshes the task and keeps the draft read-only with a note; evidence and media refusals show on the task.
- **Screens:** a Tapşırıqlar tab (sections Komanda üçün, Mənim, Yoxlamada, Tamamlanıb, plus Yoxlama for reviewers), a task screen, and for `tasks.manage` holders the online-only Create and Review screens. Home gets a task card.

**Tech Stack:** Expo SDK 57 (React Native 0.86, React 19.2.3, TypeScript 6 in `apps/mobile`), Expo Router (typed routes), expo-sqlite (SQLCipher), expo-camera, expo-image-picker, expo-image-manipulator, expo-file-system, expo-video, i18next, Jest 29 (`jest-expo`) + React Native Testing Library 14, `node:sqlite` (tests only). **No new packages.**

**Spec:** `docs/superpowers/specs/2026-10-12-tasks-design.md` — this plan covers §7 and the mobile parts of §9. The interface source is `docs/superpowers/plans/2026-10-12-tasks-1-api.md` → **Interfaces for Parts 2 and 3**, whose *Spec decisions* override the spec where they differ.

**This plan is Part 2 of 3.** **Depends on Part 1 Tasks 1–4 merged into the feature branch** (contracts, read models and sync schemas, `az.tasks` and `az.errors` strings, `createTasksApi` and `sync.pull(knownVersionIds, knownTaskIds)`). Every test here runs against fakes; the device run in Task 12 needs Part 1 Tasks 5–18 (the real API).

## Global Constraints

- All Foundation Part 3 and SP4 Part 2 mobile constraints still apply:
  - All text comes from `@taskop/i18n`. This part adds keys under `az.mobile` only, and uses the existing `az.tasks`, `az.errors`, `az.executions` and `az.mobile` keys.
  - Touch targets are at least 44 pt. A network failure never logs the user out.
  - Native modules are never imported by code that Jest loads. Screens that import `@/features/execution/capture` are tested with `jest.mock('@/features/execution/capture', …)`.
  - Inside a `db.transaction` callback only the `tx` handle is used.
- **The shared packages ship `dist/`.** Before any mobile test or typecheck: `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build`.
- **Tests are Jest (`jest-expo`)**, run with `pnpm --filter @taskop/mobile test -- <path>`. RNTL 14's `render`, `fireEvent.*` are awaited.
- **Local database:** forward-only migrations, `PRAGMA user_version`. This part adds exactly one: version **3**. Each migration runs in one transaction with its `user_version` bump.
- **Command kinds:** `claim`, `media`, `answers`, `complete`, `task.accept`, `task.start`, `task.media`, `task.submit`.
  - The outbox is sent in `seq` order. A failed `claim`, `task.accept` or `task.start` holds back the later commands of its execution or task.
  - `task.accept`, `task.start` and `task.submit` are the **status commands**: while one is queued, a pull never overwrites the task's local status.
  - New `seq` numbers continue above every number used before the upgrade (`sqlite_sequence` is carried over).
- **Task command bodies:** `task.accept`/`task.start` `{ at }`; `task.media` `TaskMediaRegisterInput`; `task.submit` `SubmissionInput`. They carry no `deviceTime`/`clientOffsetMs` (Part 1 decision 1). Their times (`at`, `capturedAt`, `submittedAt`) are stored as device times and sent as `device time − clockOffsetMs` (the offset measured at the last `/me/sync`), as Part 1's *Server behaviour Parts 2 and 3 rely on* documents ("Device times are sent on the server's clock").
- **Atomicity:** accept, start, attach media, remove media and submit each run in **one** `db.transaction`. The draft text autosaves through `CommitInput` (500 ms after typing stops, on blur, on unmount) and writes no outbox command.
- **Task limits:** response photos ≤ `TASK_LIMITS.responsePhotos` (10), videos ≤ `TASK_LIMITS.responseVideos` (3), text ≤ `TASK_LIMITS.submissionTextMax` (5,000); instruction photos ≤ `TASK_LIMITS.instructionMedia` (5); review comment ≤ `TASK_LIMITS.commentMax` (1,000). Photo resize, JPEG quality and the 720p/60 s video limits come from SP4's capture code (`MEDIA_LIMITS`). A live-only task offers the camera only. A kind whose evidence level is `none` offers no chip.
- **Pull:** `sync.pull(knownVersionIds, knownTaskIds)` sends at most the `TASK_LIMITS.knownTaskIds` (100) most recently updated local task ids, newest `updated_at` first. The server reads only the first 100 of the list and truncates any excess (Part 1 R11, R20), so a longer list would silently lose its tail; the phone never sends more.
- **Local files:** a task medium's file is deleted **7 days** after its upload (`LOCAL_FILE_KEEP_DAYS`), or with its task.
- **Manager screens** (Create, Review, the Yoxlama section) are online-only. Offline they show `az.mobile.tasks.online` ("İnternet bağlantısı tələb olunur") and send nothing. They are shown to holders of `tasks.manage` in `session.me.permissions`. The create screen's site options are `TaskAssigneeOptions.sites` from `GET /tasks/assignees` (Part 1 decision 25), so no `sites.view` is needed.
- Commits use explicit paths (`git add <paths>`, never `-A`). Messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spec decisions (ambiguities resolved against the real code)

1. **`media_refusals` is rebuilt too**, with `owner_type`/`owner_id`. A task medium the server refuses needs the same "Server bu faylı qəbul etmədi: …" note an execution item gets, and one table serves both.
2. **The rebuild keeps `sqlite_sequence`.** SQLite drops a table's AUTOINCREMENT high-water mark with the table. The migration copies it to the new table, so a command acknowledged before the upgrade never has its number reused (the engine acknowledges by `seq`).
3. **`tasks` row:** `data` (the `SyncTask` JSON), `local_status`, `rev` (the server copy's), `sync_note`, `received_at`, `updated_at`. A server copy with a lower `rev` than the one held is ignored. Only the status commands keep `local_status` during a pull; a queued `task.media` does not.
4. **Drafts:** one per task, created on first edit with a client UUIDv7 `submission_id`. Tamamla sets `submitted_at`, which makes the draft read-only, and queues `task.submit` with that id. The draft is deleted when the server accepts the submission. After a rejection the next edit starts a new draft (new id, no media: the server refuses media linked to an earlier submission).
5. **Response media can be attached only while the task is `in_progress`** on the phone. The server also allows `accepted`, but the phone shows the response section only after "Başla".
6. **Task times are moved onto the server's clock when sent** (`at − offset`). This is Part 1's documented contract (Interfaces → *Server behaviour*, "Device times are sent on the server's clock"; decision 1): task commands carry no `clientOffsetMs`, the server applies the time as received and answers one more than 2 min ahead with `CLOCK_INVALID`. A phone whose clock runs ahead therefore never earns a permanent refusal for it.
7. **Refusals of task commands** (all `4xx` other than `401`, `408`, `429`):
   - `TASK_ALREADY_TAKEN` or `NOT_FOUND` on any task command → the task is forgotten (row, draft, commands, media rows, files) and the worker sees `az.tasks.alreadyTaken`, as Part 1 says for `404`.
   - `task.media` with any other code → the medium is dropped as in SP4, and also leaves the draft and any queued submission. The task shows "Server bu faylı qəbul etmədi: …".
   - Status commands with `TASK_STATE_INVALID`, `EVIDENCE_REQUIRED`, `EVIDENCE_LIVE_ONLY`, `VALIDATION_FAILED` or `MEDIA_LIMIT_REACHED` → the task reverts to the server's status: queued status commands go, the draft becomes unsubmitted (editable only if the task is `in_progress`, read-only otherwise), and the task shows "Server qəbul etmədi: …".
   - Any other code (`FORBIDDEN`, `CLOCK_INVALID`, …) parks the command as failed (red, "Yenidən cəhd et" / "Sil"). "Sil" on it reverts the task the same way.
8. **Pull removals wait for work in flight:** a task in `removedTaskIds` stays while a command for it is queued or one of its files is registered and still uploading. The next pull removes it once that resolves.
9. **Instruction photos go through the outbox and the media queue** (`role = 'instruction'`), queued right after `tasks.create` succeeds. A slow upload therefore survives an app kill like any other file. The phone offers photos only for instructions, as the spec says ("instruction photos").
10. **The create screen's client id is made once per screen**, so retrying after a network error repeats the same `POST /tasks` (idempotent on the id, Part 1). Photos taken for a task that was never created are deleted when the screen closes.
11. **The due date is typed as `İİİİ-AA-GG SS:DD` in the phone's local time**, with SP4's `toAnswerDatetime('datetime', …)` (SP4 decision 16, no picker dependency). Dates are shown with `formatDateTime` in the tenant's time zone.
12. **Remote media come with kind and status:** `ProblemDto.media` (Part 1 decision 24) and `SyncTask.media` / `TaskDetail.media` give each medium's `kind` and `status`. `RemoteMediaStrip` asks for URLs of `uploaded` media only and draws `pending` ones (not uploaded yet, or purged; Part 1 lists both as `pending`) as "{kind} hələ yüklənməyib" (`executions.media.pendingLabel`), so one unsigned medium never fails the whole strip.
13. **Review list:** `tasks.list({ awaitingMyReview: 'true' })` is fetched when the Tasks tab gains focus while online. The Review screen fetches `tasks.get(id)` and offers Approve/Reject only when `canReview` and the status is `awaiting_review`.
14. **Home card:** "Açıq" counts the Mənim section (my non-final tasks not in review); "Gecikmiş" counts those overdue. An overdue task is one with `overdueAt` set, or a non-final one whose `dueAt` has passed on the phone's clock.
15. **Accept and start ask for an immediate sync** (like a checklist claim): a team task's race is decided by the first accept to reach the server.
16. **Tests are Jest, not Vitest:** `apps/mobile` runs `jest-expo` (its `package.json`); this plan keeps that.
17. **The create screen's site choices come from `GET /tasks/assignees`** (`TaskAssigneeOptions.sites`: active sites writable in the caller's scope, not filtered by the search). `api.sites.list()` needs `sites.view`, which a `tasks.manage` role may lack, and could offer a site the create refuses with `SITE_OUT_OF_SCOPE`.

## Review Focus

These are the five failure modes most likely to bite real users that no spec test names. Each line gives the task and test that pin it.

1. **App killed in the middle of the version 3 upgrade.** The phone holds a day of unsynced checklist work. The upgrade must roll back as a whole, leave version 2 readable, and succeed on the next start, with nothing lost. Pinned in Task 2 (`leaves a version 2 database untouched when the app is killed during the upgrade, and upgrades on the next start`).
2. **The draft lost on a refresh.** A pull arriving while the submission is still queued must not reset the status or touch the draft; a `TASK_STATE_INVALID` (cancelled while offline) must keep the worker's text and photos, read-only, with the note. Pinned in Task 3 (`a pull never overrides the status of a queued accept, start or submission, nor touches the draft`) and Task 7 (`TASK_STATE_INVALID refreshes the task and keeps the draft, read-only, with the note`).
3. **A task reassigned away while offline, with queued media.** The worker started it, took photos and pressed Tamamla offline; meanwhile the manager reassigned it. Nothing may stay red forever or keep uploading files nobody may read. Pinned in Task 7 (`a task reassigned away while offline is removed with its queued media and files, and the notice is shown`).
4. **Creating a task offline.** The manager opens Create in a basement. The screen must say a connection is needed and send nothing; a create retried after a dropped connection must not create a second task. Pinned in Task 10 (`offline it says a connection is needed and sends nothing` and `retries a failed create with the same client id and shows the server's field error`).
5. **A stale team task after a teammate accepted it.** Two members accept the same team task offline; the loser's phone must drop the task with the notice, not show a red row or keep the task in Mənim. Pinned in Task 7 (`a teammate's earlier accept removes the team task and tells the worker`) and Task 3 (`drops tasks in removedTaskIds with their draft and files, unless work for them is still queued or uploading`).

---

## File Structure

```
packages/i18n/src/az/mobile.ts                 + tabs.tasks, sync.kinds.task.*, tasks.* (list, home card, detail, create, review)
packages/i18n/src/i18n.test.ts                 + mobile task strings
apps/mobile/
  app/(app)/_layout.tsx                        + Tapşırıqlar tab; hidden task/[id], task/new, review/[id]
  app/(app)/tasks.tsx                          Tasks tab route
  app/(app)/task/[id].tsx, task/new.tsx        task screen, create screen
  app/(app)/review/[id].tsx                    review screen
  src/offline/
    db.ts (+ db.test.ts)                       migration v3: outbox/media/media_refusals rebuilt; tasks, task_drafts
    migration-v3.test.ts                       upgrade with queued execution work, kill mid-upgrade
    outbox.ts (+ test)                         ENTITY_TYPES, entity columns, task command kinds, hold-back, queue titles
    local-model.ts                             media owner/role; TaskRow, LocalTask, DraftRow, TaskDraft
    clock.ts                                   serverTime
    task-records.ts                            mergeTask, forgetTask, removeTasks, knownTaskIds, revertTask, dropTaskMedium, taskMediaBody
    task-store.ts (+ test)                     accept, start, attachMedia, removeMedia, saveText, submit, queueInstructionMedia
    sync-pull.ts (+ test)                      tasks, removedTaskIds; returns files to delete
    sync-api.ts                                + tasks, taskMedia
    sync-engine.ts (+ test)                    task commands, server-time bodies, onTaskRemoved
    refusals.ts                                entity/owner columns; resolveExecutionRefusal, resolveTaskRefusal
    task-refusals.test.ts                      every task refusal path
    media-queue.ts (+ test)                    owner routing, task file cleanup, queue titles
    execution-store.ts, user-scope.ts          entity/owner columns; clear tasks tables
    services.ts                                tasks store, newId, files, onTaskRemoved
    offline-provider.tsx, native/create-native-services.ts   "Bu tapşırığı artıq başqası qəbul edib" alert
    testing/fixtures.ts, fake-api.ts, harness.ts, test-services.ts
  src/features/
    sync/sync-screen.tsx (+ sync.test.tsx)     titles from executions and tasks
    home/home-screen.tsx (+ test)              task card
    tasks/group-tasks.ts (+ test)              sections, sort, counts
    tasks/task-row.tsx                         row with badges; Badge
    tasks/tasks-screen.tsx (+ test)            Tapşırıqlar tab, "+" and Yoxlama for managers
    tasks/remote-media.tsx                     presigned thumbnails (instructions, problems, submissions)
    tasks/task-screen.tsx (+ test)             task detail
    tasks/create-task-screen.tsx (+ test)      Create task (online)
    tasks/review-section.tsx, review-screen.tsx (+ test)   Yoxlama (online)
```

---

### Task 1: Phone strings for the tasks tab, task screens and task sync

**Files:**
- Modify: `packages/i18n/src/az/mobile.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `az.mobile.tabs.tasks`; `az.mobile.sync.kinds.task.{accept,start,media,submit}` (so `t(\`mobile.sync.kinds.${kind}\`)` resolves `task.accept` as a nested key); `az.mobile.tasks.*` exactly as written in Step 3.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('mobile task translations', () => {
  it('labels the tasks tab, its sections, the task commands and every task screen', () => {
    expect(az.mobile.tabs.tasks).toBe('Tapşırıqlar');
    for (const k of ['accept', 'start', 'media', 'submit'] as const) expect(az.mobile.sync.kinds.task[k], k).toBeTypeOf('string');
    for (const k of ['open', 'overdue', 'title'] as const) expect(az.mobile.tasks.home[k], k).toBeTypeOf('string');
    for (const k of [
      'instructions', 'noInstructions', 'problem', 'accept', 'start', 'response', 'responsePlaceholder', 'complete', 'submitted',
      'readOnly', 'rejected', 'cancelled', 'mediaOffline', 'mediaFailed', 'notFound',
    ] as const) {
      expect(az.mobile.tasks.detail[k], k).toBeTypeOf('string');
    }
    for (const k of [
      'open', 'title', 'name', 'instructions', 'priority', 'assignee', 'search', 'teams', 'people', 'teamOption', 'site', 'noSite',
      'due', 'review', 'evidence', 'photos', 'save', 'created', 'titleRequired', 'assigneeRequired',
    ] as const) {
      expect(az.mobile.tasks.create[k], k).toBeTypeOf('string');
    }
    for (const k of ['title', 'approve', 'reject', 'comment', 'approved', 'rejected', 'submission', 'empty', 'notReviewable'] as const) {
      expect(az.mobile.tasks.review[k], k).toBeTypeOf('string');
    }
  });

  it('uses the spec wording', () => {
    expect(az.mobile.tasks.sections).toEqual({ team: 'Komanda üçün', mine: 'Mənim', inReview: 'Yoxlamada', done: 'Tamamlanıb', review: 'Yoxlama' });
    expect(az.mobile.tasks.detail.accept).toBe('Qəbul et');
    expect(az.mobile.tasks.detail.start).toBe('Başla');
    expect(az.mobile.tasks.detail.complete).toBe('Tamamla');
    expect(az.mobile.tasks.online).toBe('İnternet bağlantısı tələb olunur');
    expect(az.mobile.tasks.home.open.replace('{{count}}', '2')).toBe('Açıq: 2');
    expect(az.mobile.tasks.create.teamOption.replace('{{name}}', 'Texniki xidmət').replace('{{count}}', '3')).toBe('Texniki xidmət (3 nəfər)');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.mobile.tabs.tasks` is undefined and `az.mobile.tasks` does not exist.

- [ ] **Step 3: Add the strings**

In `packages/i18n/src/az/mobile.ts`, replace the `tabs` line with:

```ts
  tabs: { home: 'Əsas', tasks: 'Tapşırıqlar', profile: 'Profil' },
```

Replace the `kinds` line inside `sync` with:

```ts
    kinds: {
      claim: 'Başlama',
      media: 'Fayl qeydiyyatı',
      answers: 'Cavablar',
      complete: 'Tamamlama',
      upload: 'Fayl yükləmə',
      task: { accept: 'Tapşırığın qəbulu', start: 'Tapşırığa başlama', media: 'Tapşırıq faylının qeydiyyatı', submit: 'Tapşırığın cavabı' },
    },
```

Add after the `logout` block (before the closing `} as const;`):

```ts
  tasks: {
    title: 'Tapşırıqlar',
    sections: { team: 'Komanda üçün', mine: 'Mənim', inReview: 'Yoxlamada', done: 'Tamamlanıb', review: 'Yoxlama' },
    empty: 'Burada heç nə yoxdur.',
    due: 'Son tarix: {{time}}',
    noDue: 'Son tarix yoxdur',
    team: 'Komanda: {{name}}',
    syncPending: 'Göndərilməyib',
    syncFailed: 'Göndərilmədi',
    online: 'İnternet bağlantısı tələb olunur',
    home: { title: 'Tapşırıqlar', open: 'Açıq: {{count}}', overdue: 'Gecikmiş: {{count}}' },
    detail: {
      instructions: 'Təlimat',
      noInstructions: 'Təlimat yazılmayıb.',
      problem: 'Problem',
      accept: 'Qəbul et',
      start: 'Başla',
      response: 'Cavab',
      responsePlaceholder: 'Nə etdiyinizi yazın',
      complete: 'Tamamla',
      submitted: 'Cavab göndərildi.',
      readOnly: 'Bu cavab göndərilə bilmədi və artıq dəyişdirilə bilməz.',
      rejected: 'Geri qaytarıldı: {{comment}}',
      cancelled: 'Ləğv edilib: {{reason}}',
      mediaOffline: 'Fayllar internet olanda görünəcək.',
      mediaFailed: 'Fayllar açıla bilmədi.',
      notFound: 'Tapşırıq bu telefonda yoxdur.',
    },
    create: {
      open: 'Yeni tapşırıq',
      title: 'Yeni tapşırıq',
      name: 'Ad',
      instructions: 'Təlimat',
      priority: 'Prioritet',
      assignee: 'İcraçı',
      search: 'Əməkdaş və ya komanda axtar',
      teams: 'Komandalar',
      people: 'Əməkdaşlar',
      teamOption: '{{name}} ({{count}} nəfər)',
      site: 'Obyekt',
      noSite: 'Obyekt yoxdur',
      due: 'Son tarix (İİİİ-AA-GG SS:DD)',
      review: 'Yoxlama tələb olunur',
      evidence: 'Sübut',
      photos: 'Təlimat şəkilləri (ən çox 5)',
      save: 'Yarat',
      created: 'Tapşırıq yaradıldı.',
      titleRequired: 'Ad yazın.',
      assigneeRequired: 'İcraçı seçin.',
    },
    review: {
      title: 'Yoxlama',
      approve: 'Təsdiqlə',
      reject: 'Geri qaytar',
      comment: 'Şərh',
      approved: 'Tapşırıq təsdiqləndi.',
      rejected: 'Tapşırıq geri qaytarıldı.',
      submission: 'Cavab',
      empty: 'Yoxlama gözləyən tapşırıq yoxdur.',
      notReviewable: 'Bu tapşırıq artıq yoxlama gözləmir.',
    },
  },
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS, including the existing `mobile execution translations` (the five original `sync.kinds` keys are unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/az/mobile.ts packages/i18n/src/i18n.test.ts
git commit -m "feat(i18n): add phone strings for the tasks tab, task screens and task sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Local database version 3: entity and owner columns, task tables

**Files:**
- Modify: `apps/mobile/src/offline/db.ts`, `outbox.ts`, `local-model.ts`, `execution-store.ts`, `refusals.ts`, `sync-pull.ts`, `sync-engine.ts`, `media-queue.ts`, `user-scope.ts`, `apps/mobile/src/features/sync/sync-screen.tsx`
- Create: `apps/mobile/src/offline/migration-v3.test.ts`
- Test (updated for the new columns): `apps/mobile/src/offline/db.test.ts`, `outbox.test.ts`, `sync-engine.test.ts`, `sync-pull.test.ts`, `user-scope.test.ts`, `media-queue.test.ts`, `apps/mobile/src/features/execution/execution-screen.test.tsx`

**Interfaces:**
- Consumes: `TaskMediaRole` from `@taskop/contracts` (Part 1 Task 1).
- Produces:
  - `MIGRATIONS[2]` (version 3). Tables `outbox (seq, entity_type, entity_id, kind, ref_id, rev, payload, status, attempts, error_code, error_key, created_at)`, `media (id, owner_type, owner_id, item_id, role, kind, …)`, `media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at)`, `tasks (id, data, local_status, rev, sync_note, received_at, updated_at)`, `task_drafts (task_id, submission_id, text, media_ids, submitted_at, updated_at)`.
  - `ENTITY_TYPES = ['execution', 'task']`, `type EntityType` (outbox.ts).
  - `OutboxCommand` and `AppendInput` carry `entityType: EntityType; entityId: string` instead of `executionId`. `QueueEntry.title` and `MediaQueueEntry.title` (the checklist or task name) replace `checklistName`.
  - `LocalMedia` carries `ownerType: EntityType; ownerId: string; role: TaskMediaRole | null` instead of `executionId`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/offline/migration-v3.test.ts`:

```ts
import { createDb, type Db, migrate, MIGRATIONS, setMeta } from './db';
import { appendCommand, listCommands, nextCommand } from './outbox';
import { DEVICE, ME, OCC, T, VERSION } from './testing/fixtures';
import { createHarness } from './testing/harness';
import { nodeDriver } from './testing/node-db';

const EXEC = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';
const MEDIUM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e61';
const FILE = 'file:///doc/media/before-v3.jpg';

/** A version 2 database (sub-project 4) holding a started execution whose claim, media registration and answers are still queued. */
async function version2WithQueuedWork(): Promise<Db> {
  const db = createDb(nodeDriver());
  await migrate(db, MIGRATIONS.slice(0, 2));
  await setMeta(db, 'userId', ME);
  await db.run(
    `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, answers, rev, updated_at)
     VALUES (?, ?, ?, 'active', 'pending', ?, '{}', 1, ?)`,
    [EXEC, OCC, VERSION, T.open, T.open],
  );
  await db.run(
    `INSERT INTO media (id, execution_id, item_id, kind, source, mime, bytes, captured_at, local_uri) VALUES (?, ?, NULL, 'photo', 'camera', 'image/jpeg', 10, ?, ?)`,
    [MEDIUM, EXEC, T.open, FILE],
  );
  await db.run(`INSERT INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES ('r1', ?, 'i1', 'errors.MEDIA_TOO_LARGE', ?)`, [EXEC, T.open]);
  const queue = (kind: string, refId: string | null, rev: number | null, payload: unknown) =>
    db.run('INSERT INTO outbox (execution_id, kind, ref_id, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [EXEC, kind, refId, rev, JSON.stringify(payload), T.open]);
  await queue('claim', null, null, { id: EXEC, occurrenceId: OCC, startedAt: T.open, device: DEVICE });
  await queue('media', MEDIUM, null, { id: MEDIUM, itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, width: null, height: null, durationMs: null, capturedAt: T.open });
  await queue('answers', null, 1, { rev: 1, answers: {} });
  // An acknowledged command: its number (4) is used up although its row is gone.
  await queue('complete', null, 1, { rev: 1, answers: {}, completedAt: T.open });
  await db.run('DELETE FROM outbox WHERE seq = 4');
  return db;
}

describe('local database version 3', () => {
  it('moves queued execution commands, media and refusals to entity and owner columns, keeping ids and order', async () => {
    const db = await version2WithQueuedWork();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await db.all('SELECT seq, entity_type, entity_id, kind, ref_id, rev, status FROM outbox ORDER BY seq')).toEqual([
      { seq: 1, entity_type: 'execution', entity_id: EXEC, kind: 'claim', ref_id: null, rev: null, status: 'pending' },
      { seq: 2, entity_type: 'execution', entity_id: EXEC, kind: 'media', ref_id: MEDIUM, rev: null, status: 'pending' },
      { seq: 3, entity_type: 'execution', entity_id: EXEC, kind: 'answers', ref_id: null, rev: 1, status: 'pending' },
    ]);
    expect(await db.first('SELECT id, owner_type, owner_id, item_id, role, local_uri FROM media')).toEqual({
      id: MEDIUM, owner_type: 'execution', owner_id: EXEC, item_id: null, role: null, local_uri: FILE,
    });
    expect(await db.first('SELECT media_id, owner_type, owner_id, item_id FROM media_refusals')).toEqual({ media_id: 'r1', owner_type: 'execution', owner_id: EXEC, item_id: 'i1' });
    expect(await db.first('SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_drafts) AS drafts')).toEqual({ tasks: 0, drafts: 0 });
  });

  it('numbers new commands above every number used before the upgrade', async () => {
    const db = await version2WithQueuedWork();
    await migrate(db);
    // A newer answers revision replaces the queued one (seq 3) and must not reuse the acknowledged number 4.
    await appendCommand(db, { entityType: 'execution', entityId: EXEC, kind: 'answers', rev: 2, payload: { rev: 2, answers: {} }, createdAt: T.open });
    expect((await listCommands(db)).map((c) => c.seq)).toEqual([1, 2, 5]);
    expect(await nextCommand(db)).toMatchObject({ seq: 1, entityType: 'execution', entityId: EXEC, kind: 'claim' });
  });

  it('still syncs the execution work queued before the upgrade', async () => {
    const db = await version2WithQueuedWork();
    await migrate(db);
    const h = await createHarness({ db });
    h.transport.files.add(FILE);
    await h.engine.run('manual');
    expect(h.api.calls.map((c) => c.method)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(await db.first('SELECT count(*) AS n FROM outbox')).toEqual({ n: 0 });
    expect(await db.first('SELECT uploaded_at FROM media')).toEqual({ uploaded_at: T.open });
  });

  it('leaves a version 2 database untouched when the app is killed during the upgrade, and upgrades on the next start', async () => {
    const base = nodeDriver();
    const v2 = createDb(base);
    await migrate(v2, MIGRATIONS.slice(0, 2));
    await v2.run(`INSERT INTO outbox (execution_id, kind, payload, created_at) VALUES ('e1', 'claim', '{}', ?)`, [T.open]);
    let killed = false;
    const killing = createDb({
      ...base,
      exec: async (sql) => {
        await base.exec(sql);
        // Every statement of the upgrade ran, but the app dies before COMMIT.
        if (!killed && sql.includes('outbox_v3')) {
          killed = true;
          throw new Error('simulated crash');
        }
      },
    });
    await expect(migrate(killing)).rejects.toThrow('simulated crash');
    expect(await killing.first('PRAGMA user_version')).toEqual({ user_version: 2 });
    expect(await killing.all('SELECT execution_id, kind FROM outbox')).toEqual([{ execution_id: 'e1', kind: 'claim' }]);
    expect(await migrate(killing)).toBe(MIGRATIONS.length);
    expect(await killing.all('SELECT entity_type, entity_id, kind FROM outbox')).toEqual([{ entity_type: 'execution', entity_id: 'e1', kind: 'claim' }]);
  });
});
```

In `apps/mobile/src/offline/db.test.ts`:
- the expected table list becomes `['checklist_versions', 'executions', 'media', 'media_refusals', 'meta', 'occurrences', 'outbox', 'task_drafts', 'tasks']`;
- in `upgrades a version 1 database in place, keeping its executions`, `expect(await migrate(db)).toBe(2);` becomes `expect(await migrate(db)).toBe(MIGRATIONS.length);`.

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/migration-v3.test.ts src/offline/db.test.ts`
Expected: FAIL. `migrate` stops at version 2, so `no such column: entity_type` and the table list lacks `task_drafts` and `tasks`; `appendCommand` has no `entityType`.

- [ ] **Step 3: Add the migration**

In `apps/mobile/src/offline/db.ts`, append a third entry to `MIGRATIONS` (after the v2 entry, before the closing `];`):

```ts
  // v3 (sub-project 5): commands and media belong to an execution or a task. SQLite cannot repurpose a NOT NULL column,
  // so outbox, media and media_refusals are rebuilt; every row keeps its id, and the outbox its order and numbering.
  `
  CREATE TABLE outbox_v3 (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('execution', 'task')),
    entity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT,
    rev INTEGER,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_key TEXT,
    created_at TEXT NOT NULL
  );
  INSERT INTO outbox_v3 (seq, entity_type, entity_id, kind, ref_id, rev, payload, status, attempts, error_code, error_key, created_at)
    SELECT seq, 'execution', execution_id, kind, ref_id, rev, payload, status, attempts, error_code, error_key, created_at FROM outbox ORDER BY seq;
  DELETE FROM sqlite_sequence WHERE name = 'outbox_v3';
  INSERT INTO sqlite_sequence (name, seq) SELECT 'outbox_v3', seq FROM sqlite_sequence WHERE name = 'outbox';
  DROP TABLE outbox;
  ALTER TABLE outbox_v3 RENAME TO outbox;
  CREATE INDEX outbox_entity ON outbox (entity_type, entity_id, kind);

  CREATE TABLE media_v3 (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('execution', 'task')),
    owner_id TEXT NOT NULL,
    item_id TEXT,
    role TEXT,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    captured_at TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    registered_at TEXT,
    uploaded_at TEXT,
    failed_code TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    file_deleted_at TEXT
  );
  INSERT INTO media_v3 (id, owner_type, owner_id, item_id, role, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri,
      registered_at, uploaded_at, failed_code, attempts, file_deleted_at)
    SELECT id, 'execution', execution_id, item_id, NULL, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri,
      registered_at, uploaded_at, failed_code, attempts, file_deleted_at FROM media;
  DROP TABLE media;
  ALTER TABLE media_v3 RENAME TO media;
  CREATE INDEX media_owner ON media (owner_type, owner_id);

  CREATE TABLE media_refusals_v3 (
    media_id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('execution', 'task')),
    owner_id TEXT NOT NULL,
    item_id TEXT,
    error_key TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  INSERT INTO media_refusals_v3 (media_id, owner_type, owner_id, item_id, error_key, created_at)
    SELECT media_id, 'execution', execution_id, item_id, error_key, created_at FROM media_refusals;
  DROP TABLE media_refusals;
  ALTER TABLE media_refusals_v3 RENAME TO media_refusals;
  CREATE INDEX media_refusals_owner ON media_refusals (owner_type, owner_id, item_id);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    local_status TEXT NOT NULL,
    rev INTEGER NOT NULL,
    sync_note TEXT,
    received_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE task_drafts (
    task_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    media_ids TEXT NOT NULL DEFAULT '[]',
    submitted_at TEXT,
    updated_at TEXT NOT NULL
  );
  `,
```

- [ ] **Step 4: Move the outbox to entities**

Replace `apps/mobile/src/offline/outbox.ts` with:

```ts
import type { Db } from './db';

export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

/** What a command or a medium belongs to (local database version 3). */
export const ENTITY_TYPES = ['execution', 'task'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

interface OutboxRow {
  seq: number;
  entity_type: EntityType;
  entity_id: string;
  kind: CommandKind;
  ref_id: string | null;
  rev: number | null;
  payload: string;
  status: 'pending' | 'failed';
  attempts: number;
  error_code: string | null;
  error_key: string | null;
  created_at: string;
}

export interface OutboxCommand {
  seq: number;
  entityType: EntityType;
  /** The execution or task the command belongs to. */
  entityId: string;
  kind: CommandKind;
  /** The medium ID of a media registration; the submission ID of a task submission. */
  refId: string | null;
  rev: number | null;
  /** The command body. Execution commands get `deviceTime` (= `createdAt`) and `clientOffsetMs` stamped when sent. */
  payload: Record<string, unknown>;
  status: 'pending' | 'failed';
  attempts: number;
  errorCode: string | null;
  errorKey: string | null;
  /** The device time of the worker's action. A newer answers revision carries its own action time. */
  createdAt: string;
}

const toCommand = (r: OutboxRow): OutboxCommand => ({
  seq: r.seq,
  entityType: r.entity_type,
  entityId: r.entity_id,
  kind: r.kind,
  refId: r.ref_id,
  rev: r.rev,
  payload: JSON.parse(r.payload) as Record<string, unknown>,
  status: r.status,
  attempts: r.attempts,
  errorCode: r.error_code,
  errorKey: r.error_key,
  createdAt: r.created_at,
});

export interface AppendInput {
  entityType: EntityType;
  entityId: string;
  kind: CommandKind;
  refId?: string | null;
  rev?: number | null;
  payload: Record<string, unknown>;
  /** When the worker acted (device time), not when the command is sent. */
  createdAt: string;
}

/** Called inside the action's transaction. Only the newest answers revision is ever sent (SP4 spec §7.2). */
export async function appendCommand(tx: Db, c: AppendInput): Promise<void> {
  if (c.kind === 'answers') await tx.run(`DELETE FROM outbox WHERE entity_type = ? AND entity_id = ? AND kind = 'answers'`, [c.entityType, c.entityId]);
  await tx.run('INSERT INTO outbox (entity_type, entity_id, kind, ref_id, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    c.entityType,
    c.entityId,
    c.kind,
    c.refId ?? null,
    c.rev ?? null,
    JSON.stringify(c.payload),
    c.createdAt,
  ]);
}

/** The oldest pending command. Commands of an execution whose claim failed wait: without the claim they could only fail. */
export async function nextCommand(db: Db): Promise<OutboxCommand | null> {
  const row = await db.first<OutboxRow>(
    `SELECT * FROM outbox o
     WHERE o.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM outbox c WHERE c.entity_type = o.entity_type AND c.entity_id = o.entity_id AND c.kind = 'claim' AND c.status = 'failed')
     ORDER BY o.seq LIMIT 1`,
  );
  return row ? toCommand(row) : null;
}

export const ackCommand = (db: Db, seq: number) => db.run('DELETE FROM outbox WHERE seq = ?', [seq]);

export const failCommand = (db: Db, seq: number, code: string, messageKey: string) =>
  db.run(`UPDATE outbox SET status = 'failed', attempts = attempts + 1, error_code = ?, error_key = ? WHERE seq = ?`, [code, messageKey, seq]);

export const noteAttempt = (db: Db, seq: number) => db.run('UPDATE outbox SET attempts = attempts + 1 WHERE seq = ?', [seq]);

export const retryFailedCommands = (db: Db) =>
  db.run(`UPDATE outbox SET status = 'pending', error_code = NULL, error_key = NULL WHERE status = 'failed'`);

export interface OutboxCounts {
  pending: number;
  failed: number;
}

export async function outboxCounts(db: Db): Promise<OutboxCounts> {
  const rows = await db.all<{ status: 'pending' | 'failed'; n: number }>('SELECT status, count(*) AS n FROM outbox GROUP BY status');
  return { pending: rows.find((r) => r.status === 'pending')?.n ?? 0, failed: rows.find((r) => r.status === 'failed')?.n ?? 0 };
}

export interface QueueEntry extends OutboxCommand {
  /** The checklist or task the command belongs to, for the sync queue; null once it is gone from the phone. */
  title: string | null;
}

export async function listCommands(db: Db): Promise<QueueEntry[]> {
  const rows = await db.all<OutboxRow & { title: string | null }>(
    `SELECT o.*, coalesce(oc.checklist_name, json_extract(t.data, '$.title')) AS title FROM outbox o
     LEFT JOIN executions e ON o.entity_type = 'execution' AND e.id = o.entity_id
     LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
     LEFT JOIN tasks t ON o.entity_type = 'task' AND t.id = o.entity_id
     ORDER BY o.seq`,
  );
  return rows.map((r) => ({ ...toCommand(r), title: r.title }));
}
```

- [ ] **Step 5: Give local media an owner and a role**

In `apps/mobile/src/offline/local-model.ts`:
- Add `TaskMediaRole` to the `@taskop/contracts` type import, and add `import type { EntityType } from './outbox';`.
- In `MediaRow`, replace `execution_id: string;` with:

```ts
  owner_type: string;
  owner_id: string;
  role: string | null;
```

- In `LocalMedia`, replace `executionId: string;` with:

```ts
  ownerType: EntityType;
  /** The execution or task the medium belongs to. */
  ownerId: string;
  /** A task medium's role (`instruction` | `response`); null for execution media. */
  role: TaskMediaRole | null;
```

- In `toMedia`, replace `executionId: r.execution_id,` with:

```ts
  ownerType: r.owner_type as EntityType,
  ownerId: r.owner_id,
  role: r.role as TaskMediaRole | null,
```

- [ ] **Step 6: Point every execution query at the new columns**

Apply these exact replacements (each left-hand text occurs once in its file unless marked "every"):

`apps/mobile/src/offline/execution-store.ts`

| Replace | With |
|---|---|
| `await appendCommand(tx, { executionId, kind: 'answers',` | `await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'answers',` |
| `await appendCommand(tx, { executionId, kind: 'claim',` | `await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'claim',` |
| `'SELECT id FROM media WHERE execution_id = ? AND id IN (SELECT value FROM json_each(?))'` | `` `SELECT id FROM media WHERE owner_type = 'execution' AND owner_id = ? AND id IN (SELECT value FROM json_each(?))` `` |
| `'DELETE FROM media_refusals WHERE execution_id = ? AND item_id = ?'` | `` `DELETE FROM media_refusals WHERE owner_type = 'execution' AND owner_id = ? AND item_id = ?` `` |
| `await appendCommand(tx, { executionId, kind: 'media',` | `await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'media',` |
| `'SELECT * FROM media WHERE id = ? AND execution_id = ?'` | `` `SELECT * FROM media WHERE id = ? AND owner_type = 'execution' AND owner_id = ?` `` |
| `await appendCommand(tx, { executionId, kind: 'complete',` | `await appendCommand(tx, { entityType: 'execution', entityId: executionId, kind: 'complete',` |
| `(await db.all<{ execution_id: string }>('SELECT DISTINCT execution_id FROM outbox')).map((r) => r.execution_id)` | ``(await db.all<{ entity_id: string }>(`SELECT DISTINCT entity_id FROM outbox WHERE entity_type = 'execution'`)).map((r) => r.entity_id)`` |
| `'SELECT * FROM media WHERE execution_id = ? ORDER BY captured_at, id'` | `` `SELECT * FROM media WHERE owner_type = 'execution' AND owner_id = ? ORDER BY captured_at, id` `` |
| `'SELECT media_id, item_id, error_key FROM media_refusals WHERE execution_id = ? ORDER BY created_at, media_id'` | `` `SELECT media_id, item_id, error_key FROM media_refusals WHERE owner_type = 'execution' AND owner_id = ? ORDER BY created_at, media_id` `` |

In `attachMedia`, the two-line media insert

```ts
        `INSERT INTO media (id, execution_id, item_id, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
```

becomes (the parameter array is unchanged):

```ts
        `INSERT INTO media (id, owner_type, owner_id, item_id, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
         VALUES (?, 'execution', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
```

`apps/mobile/src/offline/refusals.ts`

| Replace | With |
|---|---|
| `` `SELECT seq, payload FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')` `` | `` `SELECT seq, payload FROM outbox WHERE entity_type = 'execution' AND entity_id = ? AND kind IN ('answers', 'complete')` `` |
| `const medium = await tx.first<{ local_uri: string; execution_id: string; item_id: string \| null; file_deleted_at: string \| null }>(` | `const medium = await tx.first<{ local_uri: string; owner_type: string; owner_id: string; item_id: string \| null; file_deleted_at: string \| null }>(` |
| `'SELECT local_uri, execution_id, item_id, file_deleted_at FROM media WHERE id = ?'` | `'SELECT local_uri, owner_type, owner_id, item_id, file_deleted_at FROM media WHERE id = ?'` |
| `const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [medium.execution_id]);` | `if (medium.owner_type !== 'execution') return file;` on one line, then `const row = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [medium.owner_id]);` |
| `'INSERT OR REPLACE INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES (?, ?, ?, ?, ?)'` | `` `INSERT OR REPLACE INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES (?, 'execution', ?, ?, ?, ?)` `` |
| `await appendCommand(tx, { executionId: e.id, kind: 'answers',` | `await appendCommand(tx, { entityType: 'execution', entityId: e.id, kind: 'answers',` |
| `await tx.run('DELETE FROM outbox WHERE execution_id = ?', [executionId]);` | ``await tx.run(`DELETE FROM outbox WHERE entity_type = 'execution' AND entity_id = ?`, [executionId]);`` |
| `'SELECT local_uri, file_deleted_at FROM media WHERE execution_id = ?'` | `` `SELECT local_uri, file_deleted_at FROM media WHERE owner_type = 'execution' AND owner_id = ?` `` |
| `await tx.run('DELETE FROM media WHERE execution_id = ?', [executionId]);` | ``await tx.run(`DELETE FROM media WHERE owner_type = 'execution' AND owner_id = ?`, [executionId]);`` |
| `` `DELETE FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')` `` | `` `DELETE FROM outbox WHERE entity_type = 'execution' AND entity_id = ? AND kind IN ('answers', 'complete')` `` |
| every `cmd.executionId` | `cmd.entityId` |
| `const row = await tx.first<{ execution_id: string; kind: OutboxCommand['kind']; ref_id: string \| null; error_key: string \| null }>(` | `const row = await tx.first<{ entity_id: string; kind: OutboxCommand['kind']; ref_id: string \| null; error_key: string \| null }>(` |
| `` `SELECT execution_id, kind, ref_id, error_key FROM outbox WHERE seq = ? AND status = 'failed'` `` | `` `SELECT entity_id, kind, ref_id, error_key FROM outbox WHERE seq = ? AND status = 'failed'` `` |
| every `row.execution_id` | `row.entity_id` |
| `const cmd = { seq, executionId: row.entity_id } as OutboxCommand;` (after the previous replacement) | `const cmd = { seq, entityType: 'execution', entityId: row.entity_id } as OutboxCommand;` |

`apps/mobile/src/offline/sync-pull.ts`

| Replace | With |
|---|---|
| `OR EXISTS (SELECT 1 FROM outbox x WHERE x.execution_id = e.id)` | `OR EXISTS (SELECT 1 FROM outbox x WHERE x.entity_type = 'execution' AND x.entity_id = e.id)` |
| `OR EXISTS (SELECT 1 FROM media m WHERE m.execution_id = e.id AND` | `OR EXISTS (SELECT 1 FROM media m WHERE m.owner_type = 'execution' AND m.owner_id = e.id AND` |
| `` `DELETE FROM media WHERE execution_id IN (`` | `` `DELETE FROM media WHERE owner_type = 'execution' AND owner_id IN (`` |
| `` `DELETE FROM media_refusals WHERE execution_id IN (`` | `` `DELETE FROM media_refusals WHERE owner_type = 'execution' AND owner_id IN (`` |
| `'SELECT count(*) AS n FROM outbox WHERE execution_id = ?'` | `` `SELECT count(*) AS n FROM outbox WHERE entity_type = 'execution' AND entity_id = ?` `` |

`apps/mobile/src/offline/sync-engine.ts`

| Replace | With |
|---|---|
| `AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.execution_id = executions.id)` | `AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.entity_type = 'execution' AND outbox.entity_id = executions.id)` |
| `'UPDATE media SET execution_id = ? WHERE execution_id = ?'` | `` `UPDATE media SET owner_id = ? WHERE owner_type = 'execution' AND owner_id = ?` `` |
| `'UPDATE outbox SET execution_id = ? WHERE execution_id = ?'` | `` `UPDATE outbox SET entity_id = ? WHERE entity_type = 'execution' AND entity_id = ?` `` |
| `'UPDATE media_refusals SET execution_id = ? WHERE execution_id = ?'` | `` `UPDATE media_refusals SET owner_id = ? WHERE owner_type = 'execution' AND owner_id = ?` `` |
| `` `SELECT seq, rev, payload FROM outbox WHERE execution_id = ? AND kind IN ('answers', 'complete')` `` | `` `SELECT seq, rev, payload FROM outbox WHERE entity_type = 'execution' AND entity_id = ? AND kind IN ('answers', 'complete')` `` |
| `await appendCommand(tx, { executionId: e.id, kind: 'answers',` | `await appendCommand(tx, { entityType: 'execution', entityId: e.id, kind: 'answers',` |
| every `cmd.executionId` | `cmd.entityId` |

(`ClaimRejection.executionId` and `r.claim.executionId` are claim fields and stay.)

`apps/mobile/src/offline/media-queue.ts`
- `ticket = await api.executions.registerMedia(m.executionId, {` becomes `ticket = await api.executions.registerMedia(m.ownerId, {`.
- In `cleanup`, `` `SELECT m.id, m.local_uri FROM media m JOIN executions e ON e.id = m.execution_id `` becomes `` `SELECT m.id, m.local_uri FROM media m JOIN executions e ON m.owner_type = 'execution' AND e.id = m.owner_id ``.
- In `MediaQueueEntry`, replace `checklistName: string | null;` with `/** The checklist or task the file belongs to. */ title: string | null;`.
- Replace the body of `list()` with:

```ts
    async list() {
      const found = await db.all<{ id: string; kind: LocalMedia['kind']; title: string | null; failed_code: string | null; attempts: number }>(
        `SELECT m.id, m.kind, coalesce(oc.checklist_name, json_extract(t.data, '$.title')) AS title, m.failed_code, m.attempts FROM media m
         LEFT JOIN executions e ON m.owner_type = 'execution' AND e.id = m.owner_id
         LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
         LEFT JOIN tasks t ON m.owner_type = 'task' AND t.id = m.owner_id
         WHERE m.registered_at IS NOT NULL AND m.uploaded_at IS NULL AND m.file_deleted_at IS NULL
         ORDER BY CASE m.kind WHEN 'photo' THEN 0 ELSE 1 END, m.captured_at, m.id`,
      );
      return found.map((r) => ({ id: r.id, kind: r.kind, title: r.title, failedCode: r.failed_code, attempts: r.attempts }));
    },
```

`apps/mobile/src/offline/user-scope.ts`: the table list in `clearLocalData` becomes

```ts
    for (const table of ['outbox', 'media', 'media_refusals', 'task_drafts', 'tasks', 'executions', 'occurrences', 'checklist_versions', 'meta']) await tx.run(`DELETE FROM ${table}`);
```

`apps/mobile/src/features/sync/sync-screen.tsx`: `name(c.checklistName)` becomes `name(c.title)` and `name(m.checklistName)` becomes `name(m.title)`.

- [ ] **Step 7: Update the existing tests to the new columns**

| File | Replace | With |
|---|---|---|
| `src/offline/outbox.test.ts` | `appendCommand(db, { executionId, kind, payload: { kind }, createdAt: AT, ...extra });` | `appendCommand(db, { entityType: 'execution', entityId: executionId, kind, payload: { kind }, createdAt: AT, ...extra });` |
| `src/offline/outbox.test.ts` | every `executionId: 'e` inside `toMatchObject(` | `entityId: 'e` |
| `src/offline/outbox.test.ts` | `c.executionId === 'e1'` and `[c.executionId, c.kind, c.rev, c.status]` | `c.entityId === 'e1'` and `[c.entityId, c.kind, c.rev, c.status]` |
| `src/offline/outbox.test.ts` | both `appendCommand(db, { executionId: 'e1', kind: 'answers',` | `appendCommand(db, { entityType: 'execution', entityId: 'e1', kind: 'answers',` |
| `src/offline/sync-engine.test.ts` | `{ executionId: first, kind: 'claim',` and `{ executionId: first, kind: 'answers',` | `{ entityId: first, kind: 'claim',` and `{ entityId: first, kind: 'answers',` |
| `src/offline/sync-engine.test.ts` | `toMatchObject([{ executionId: OTHER_EXECUTION, kind: 'answers', rev: 3 }])` | `toMatchObject([{ entityId: OTHER_EXECUTION, kind: 'answers', rev: 3 }])` |
| `src/offline/sync-pull.test.ts` | `appendCommand(db, { executionId: x.id,` and `appendCommand(db, { executionId: 'x',` | `appendCommand(db, { entityType: 'execution', entityId: x.id,` and `appendCommand(db, { entityType: 'execution', entityId: 'x',` |
| `src/offline/sync-pull.test.ts` | `INSERT INTO media (id, execution_id, kind,` | `INSERT INTO media (id, owner_type, owner_id, kind,` |
| `src/offline/sync-pull.test.ts` | `VALUES ('m', 'x', 'photo',` | `VALUES ('m', 'execution', 'x', 'photo',` |
| `src/offline/sync-pull.test.ts` | `INSERT INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES ('r', 'x',` | `INSERT INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES ('r', 'execution', 'x',` |
| `src/offline/user-scope.test.ts` | `INSERT INTO media (id, execution_id, kind,` | `INSERT INTO media (id, owner_type, owner_id, kind,` |
| `src/offline/user-scope.test.ts` | `VALUES ('m', 'e', 'photo',` | `VALUES ('m', 'execution', 'e', 'photo',` |
| `src/offline/user-scope.test.ts` | `INSERT INTO outbox (execution_id, kind, payload, created_at) VALUES ('e', 'claim',` | `INSERT INTO outbox (entity_type, entity_id, kind, payload, created_at) VALUES ('execution', 'e', 'claim',` |
| `src/offline/media-queue.test.ts` | `checklistName: 'Açılış yoxlaması'` | `title: 'Açılış yoxlaması'` |
| `src/features/execution/execution-screen.test.tsx` | `INSERT INTO media_refusals (media_id, execution_id, item_id, error_key, created_at) VALUES ('m', ?,` | `INSERT INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES ('m', 'execution', ?,` |
| `src/features/execution/execution-screen.test.tsx` | both `'UPDATE outbox SET execution_id = ? WHERE execution_id = ?'` | `` `UPDATE outbox SET entity_id = ? WHERE entity_type = 'execution' AND entity_id = ?` `` |

- [ ] **Step 8: Run the whole mobile suite and typecheck**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. Every SP4 suite passes unchanged in behaviour; `grep -rn "execution_id" apps/mobile/src` shows only `claim_execution_id`, the two `INSERT … (execution_id, …)` lines in `migration-v3.test.ts`, and the `SELECT execution_id` assertion there.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/offline apps/mobile/src/features/sync/sync-screen.tsx apps/mobile/src/features/execution/execution-screen.test.tsx
git commit -m "feat(mobile): local database v3 with entity and owner columns and task tables" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Task rows and the pull: `tasks`, `removedTaskIds`, `knownTaskIds`

**Files:**
- Create: `apps/mobile/src/offline/task-records.ts`
- Modify: `apps/mobile/src/offline/local-model.ts`, `sync-pull.ts`, `sync-engine.ts`, `testing/fixtures.ts`, `testing/fake-api.ts`
- Test: `apps/mobile/src/offline/sync-pull.test.ts`, `apps/mobile/src/offline/sync-engine.test.ts`

**Interfaces:**
- Consumes: `SyncTask`, `TaskStatus`, `TASK_LIMITS`, `SyncResponse.tasks` / `removedTaskIds` (Part 1 Task 2); `sync.pull(knownVersionIds, knownTaskIds)` (Part 1 Task 4); Part 1 Task 2's `syncResponse` fixture with `tasks: []` and `removedTaskIds: []`.
- Produces:
  - `local-model.ts`: `TaskRow`, `LocalTask { id; server: SyncTask; status: TaskStatus; rev; syncNote: string | null; receivedAt; updatedAt }`, `toTask`, `DraftRow`, `TaskDraft { taskId; submissionId; text; mediaIds: string[]; submittedAt: string | null; updatedAt }`, `toDraft`.
  - `task-records.ts`: `STATUS_KINDS_SQL`, `mergeTask(tx, task: SyncTask, now: number, ignoreSeq = -1): Promise<void>`, `forgetTask(tx, taskId): Promise<{ title: string | null; files: string[] }>`, `removeTasks(tx, ids): Promise<string[]>`, `knownTaskIds(db): Promise<string[]>`.
  - `applyPull` and `mergePull` return `Promise<string[]>`: the local files of removed tasks, deleted by the caller after the commit.
  - Fixtures `TASK`, `TASK2`, `TASK3`, `TASK4`, `TASK5`, `TEAM`, `ME_REF`, `syncTask(over)`. Fake API `pull(knownVersionIds, knownTaskIds)`, recorded as `body: { knownVersionIds, knownTaskIds }`.

- [ ] **Step 1: Add the fixtures**

In `apps/mobile/src/offline/testing/fixtures.ts`, add `type SyncTask` to the `@taskop/contracts` import and append:

```ts
export const TASK = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e70';
export const TASK2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e71';
export const TASK3 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e72';
export const TASK4 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e75';
export const TASK5 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e76';
export const TEAM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e80';
export const ME_REF = { id: ME, fullName: 'Aysel Əliyeva' };

/** A task assigned to me directly (spec §7): photo required, no review, due tomorrow. */
export const syncTask = (over: Partial<SyncTask> = {}): SyncTask => ({
  id: TASK,
  title: 'Soyuducunun qapısını təmir et',
  priority: 'normal',
  status: 'new',
  site: { id: SITE, name: 'Bakı filialı 1' },
  assignee: ME_REF,
  team: null,
  assigneeInactive: false,
  createdBy: { id: OTHER, fullName: 'Murad Həsənov' },
  requiresReview: false,
  source: 'adhoc',
  problemId: null,
  dueAt: '2026-11-03T14:00:00.000Z',
  overdueAt: null,
  rev: 1,
  createdAt: T.starts,
  updatedAt: T.starts,
  instructions: 'Qapının rezinini dəyişin.',
  evidence: { photo: 'required', video: 'optional', liveOnly: false },
  acceptedAt: null,
  startedAt: null,
  submittedAt: null,
  completedAt: null,
  cancelledAt: null,
  cancelReason: null,
  media: [],
  submissions: [],
  problem: null,
  ...over,
});
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/mobile/src/offline/sync-pull.test.ts` (extend the fixtures import with `syncTask`, `TASK`, `TASK2`, `TEAM`, and import `knownTaskIds` from `./task-records` and `TASK_LIMITS` from `@taskop/contracts`):

```ts
describe('tasks in /me/sync', () => {
  const taskRows = (db: Awaited<ReturnType<typeof openTestDb>>) =>
    db.all<{ id: string; local_status: string; rev: number; title: string }>(`SELECT id, local_status, rev, json_extract(data, '$.title') AS title FROM tasks ORDER BY id`);
  /** A status command waiting in the outbox, as the task store (Task 6) queues it. */
  const queueStatus = (db: Awaited<ReturnType<typeof openTestDb>>, taskId: string, kind = 'task.start') =>
    db.run(`INSERT INTO outbox (entity_type, entity_id, kind, payload, created_at) VALUES ('task', ?, ?, '{}', ?)`, [taskId, kind, T.open]);

  it('stores the tasks it is given and reports them as known', async () => {
    const db = await openTestDb();
    const team = syncTask({ id: TASK2, title: 'Rəfləri yığ', assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    await applyPull(db, syncResponse({ tasks: [syncTask(), team] }), 0, NOW);
    expect(await taskRows(db)).toEqual([
      { id: TASK, local_status: 'new', rev: 1, title: 'Soyuducunun qapısını təmir et' },
      { id: TASK2, local_status: 'new', rev: 1, title: 'Rəfləri yığ' },
    ]);
    expect(JSON.parse((await db.first<{ data: string }>('SELECT data FROM tasks WHERE id = ?', [TASK]))!.data)).toEqual(syncTask());
    expect((await knownTaskIds(db)).sort()).toEqual([TASK, TASK2]);
  });

  it('reports at most the 100 most recently updated tasks as known', async () => {
    const db = await openTestDb();
    for (let i = 0; i < 101; i++) {
      const id = `task-${String(i).padStart(3, '0')}`;
      const updatedAt = new Date(Date.parse(T.open) + i * 60_000).toISOString();
      await db.run(`INSERT INTO tasks (id, data, local_status, rev, received_at, updated_at) VALUES (?, '{}', 'new', 1, ?, ?)`, [id, T.open, updatedAt]);
    }
    const known = await knownTaskIds(db);
    expect(known).toHaveLength(TASK_LIMITS.knownTaskIds);
    expect(known).not.toContain('task-000');
    expect(known[0]).toBe('task-100');
  });

  it('a pull never overrides the status of a queued accept, start or submission, nor touches the draft', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ tasks: [syncTask()] }), 0, NOW);
    await db.run(`UPDATE tasks SET local_status = 'in_progress'`);
    await db.run(`INSERT INTO task_drafts (task_id, submission_id, text, media_ids, updated_at) VALUES (?, 's1', 'Rezin dəyişildi', '[]', ?)`, [TASK, T.open]);
    await queueStatus(db, TASK);
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 2, title: 'Qapını təmir et' })] }), 0, NOW);
    expect(await taskRows(db)).toEqual([{ id: TASK, local_status: 'in_progress', rev: 2, title: 'Qapını təmir et' }]);
    expect(await db.first('SELECT text FROM task_drafts')).toEqual({ text: 'Rezin dəyişildi' });

    // A queued media registration does not hold the status: only accept, start and submit do.
    await db.run('DELETE FROM outbox');
    await db.run(`INSERT INTO outbox (entity_type, entity_id, kind, ref_id, payload, created_at) VALUES ('task', ?, 'task.media', 'm', '{}', ?)`, [TASK, T.open]);
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 3, status: 'cancelled', cancelReason: 'Lazım deyil' })] }), 0, NOW);
    expect((await taskRows(db))[0]).toMatchObject({ local_status: 'cancelled', rev: 3 });
    expect(await db.first('SELECT text FROM task_drafts')).toEqual({ text: 'Rezin dəyişildi' });
  });

  it('ignores a server copy older than the one it holds', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 3, status: 'accepted' })] }), 0, NOW);
    await applyPull(db, syncResponse({ tasks: [syncTask({ rev: 2, status: 'new', title: 'Köhnə' })] }), 0, NOW);
    expect(await taskRows(db)).toEqual([{ id: TASK, local_status: 'accepted', rev: 3, title: 'Soyuducunun qapısını təmir et' }]);
  });

  it('drops tasks in removedTaskIds with their draft and files, unless work for them is still queued or uploading', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ tasks: [syncTask(), syncTask({ id: TASK2 })] }), 0, NOW);
    for (const id of [TASK, TASK2]) {
      await db.run(
        `INSERT INTO media (id, owner_type, owner_id, role, kind, source, mime, bytes, captured_at, local_uri, registered_at, uploaded_at)
         VALUES (?, 'task', ?, 'response', 'photo', 'camera', 'image/jpeg', 1, ?, ?, ?, ?)`,
        [`m-${id}`, id, T.open, `file:///doc/media/${id}.jpg`, T.open, T.open],
      );
      await db.run('INSERT INTO task_drafts (task_id, submission_id, updated_at) VALUES (?, ?, ?)', [id, `s-${id}`, T.open]);
      await db.run(`INSERT INTO media_refusals (media_id, owner_type, owner_id, error_key, created_at) VALUES (?, 'task', ?, 'errors.MEDIA_TOO_LARGE', ?)`, [`r-${id}`, id, T.open]);
    }
    await queueStatus(db, TASK2, 'task.submit');
    expect(await applyPull(db, syncResponse({ tasks: [], removedTaskIds: [TASK, TASK2] }), 0, NOW)).toEqual([`file:///doc/media/${TASK}.jpg`]);
    expect(await db.all('SELECT id FROM tasks')).toEqual([{ id: TASK2 }]);
    expect(await db.all('SELECT task_id FROM task_drafts')).toEqual([{ task_id: TASK2 }]);
    expect(await db.all('SELECT owner_id FROM media')).toEqual([{ owner_id: TASK2 }]);
    expect(await db.all('SELECT owner_id FROM media_refusals')).toEqual([{ owner_id: TASK2 }]);

    // The submission went through, but its photo is still uploading: the task waits for the upload.
    await db.run('DELETE FROM outbox');
    await db.run('UPDATE media SET uploaded_at = NULL');
    expect(await applyPull(db, syncResponse({ tasks: [], removedTaskIds: [TASK2] }), 0, NOW)).toEqual([]);
    await db.run('UPDATE media SET uploaded_at = ?', [T.open]);
    expect(await applyPull(db, syncResponse({ tasks: [], removedTaskIds: [TASK2] }), 0, NOW)).toEqual([`file:///doc/media/${TASK2}.jpg`]);
    expect(await db.all('SELECT id FROM tasks')).toEqual([]);
  });
});
```

Append to `apps/mobile/src/offline/sync-engine.test.ts` (extend the fixtures import with `syncTask`, `TASK`, `TASK2`):

```ts
describe('pulling tasks', () => {
  it('sends the ids of the tasks the phone holds, applies the new copies and deletes the removed ones', async () => {
    const h = await createHarness();
    await h.seed(syncResponse({ checklistVersions: [versionOf(h.c.content)], tasks: [syncTask(), syncTask({ id: TASK2 })] }));
    h.api.sync = syncResponse({ tasks: [syncTask({ rev: 2, status: 'cancelled' })], removedTaskIds: [TASK2] });
    await h.engine.run('manual');
    const pull = h.api.calls.find((c) => c.method === 'pull')!;
    expect((pull.body as { knownTaskIds: string[] }).knownTaskIds.sort()).toEqual([TASK, TASK2].sort());
    expect(await h.db.all('SELECT id, local_status FROM tasks')).toEqual([{ id: TASK, local_status: 'cancelled' }]);
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/sync-pull.test.ts src/offline/sync-engine.test.ts`
Expected: FAIL. `./task-records` does not exist; the pull stores no tasks and sends no `knownTaskIds`.

- [ ] **Step 4: Add the task row models**

Append to `apps/mobile/src/offline/local-model.ts` (add `SyncTask` and `TaskStatus` to the `@taskop/contracts` type import):

```ts
export interface TaskRow {
  id: string;
  data: string;
  local_status: string;
  rev: number;
  sync_note: string | null;
  received_at: string;
  updated_at: string;
}

export interface LocalTask {
  id: string;
  /** The server's copy as last received (/me/sync or a command's answer). */
  server: SyncTask;
  /** What the phone shows: the server's status, or the outcome of accept/start/submit commands not yet answered. */
  status: TaskStatus;
  /** The `rev` of `server`. */
  rev: number;
  /** The i18n key of why the server refused this task's work for good ("Server qəbul etmədi: …"); null when none. */
  syncNote: string | null;
  receivedAt: string;
  updatedAt: string;
}

export const toTask = (r: TaskRow): LocalTask => ({
  id: r.id,
  server: JSON.parse(r.data) as SyncTask,
  status: r.local_status as TaskStatus,
  rev: r.rev,
  syncNote: r.sync_note,
  receivedAt: r.received_at,
  updatedAt: r.updated_at,
});

export interface DraftRow {
  task_id: string;
  submission_id: string;
  text: string;
  media_ids: string;
  submitted_at: string | null;
  updated_at: string;
}

/** The response being written for a task (spec §7.1), autosaved. */
export interface TaskDraft {
  taskId: string;
  /** The client UUIDv7 the submission is sent with (idempotent on the server). */
  submissionId: string;
  text: string;
  mediaIds: string[];
  /** Set by Tamamla: the draft is then read-only until the server answers. */
  submittedAt: string | null;
  updatedAt: string;
}

export const toDraft = (r: DraftRow): TaskDraft => ({
  taskId: r.task_id,
  submissionId: r.submission_id,
  text: r.text,
  mediaIds: JSON.parse(r.media_ids) as string[],
  submittedAt: r.submitted_at,
  updatedAt: r.updated_at,
});
```

- [ ] **Step 5: Add the task records**

Create `apps/mobile/src/offline/task-records.ts`:

```ts
import { type SyncTask, TASK_LIMITS } from '@taskop/contracts';
import type { Db } from './db';
import { iso } from './local-model';

/** Commands that move a task's status. Until the server has answered them, the phone's status wins over a pull (spec §7.1). */
export const STATUS_KINDS_SQL = `('task.accept', 'task.start', 'task.submit')`;

/**
 * Stores the server's copy of a task (from /me/sync or a command's answer). A copy older than the one held is ignored.
 * The local status follows the server's unless an accept, start or submission is still queued (other than `ignoreSeq`:
 * the command whose answer this is). The draft is never touched here.
 */
export async function mergeTask(tx: Db, task: SyncTask, now: number, ignoreSeq = -1): Promise<void> {
  const queued =
    (
      await tx.first<{ n: number }>(
        `SELECT count(*) AS n FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind IN ${STATUS_KINDS_SQL} AND seq <> ?`,
        [task.id, ignoreSeq],
      )
    )?.n ?? 0;
  await tx.run(
    `INSERT INTO tasks (id, data, local_status, rev, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data, rev = excluded.rev, received_at = excluded.received_at, updated_at = excluded.updated_at,
       local_status = CASE WHEN ? > 0 THEN tasks.local_status ELSE excluded.local_status END
     WHERE excluded.rev >= tasks.rev`,
    [task.id, JSON.stringify(task), task.status, task.rev, iso(now), iso(now), queued],
  );
}

/** Deletes a task with everything the phone holds for it. Returns its title and the local files to delete once the transaction commits. */
export async function forgetTask(tx: Db, taskId: string): Promise<{ title: string | null; files: string[] }> {
  const row = await tx.first<{ data: string }>('SELECT data FROM tasks WHERE id = ?', [taskId]);
  const media = await tx.all<{ local_uri: string; file_deleted_at: string | null }>(
    `SELECT local_uri, file_deleted_at FROM media WHERE owner_type = 'task' AND owner_id = ?`,
    [taskId],
  );
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'task' AND entity_id = ?`, [taskId]);
  await tx.run(`DELETE FROM media WHERE owner_type = 'task' AND owner_id = ?`, [taskId]);
  await tx.run(`DELETE FROM media_refusals WHERE owner_type = 'task' AND owner_id = ?`, [taskId]);
  await tx.run('DELETE FROM task_drafts WHERE task_id = ?', [taskId]);
  await tx.run('DELETE FROM tasks WHERE id = ?', [taskId]);
  return {
    title: row ? (JSON.parse(row.data) as SyncTask).title : null,
    files: media.filter((m) => m.file_deleted_at === null).map((m) => m.local_uri),
  };
}

/**
 * Spec §7.1: tasks that left the user's set (reassigned away, taken by a teammate, closed over 7 days ago) go, unless a
 * command for them is still queued or one of their files is still uploading: those resolve first, and a later pull
 * removes the task. Returns the local files to delete once the transaction commits.
 */
export async function removeTasks(tx: Db, ids: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const id of ids) {
    const busy = await tx.first<{ one: number }>(
      `SELECT 1 AS one WHERE EXISTS (SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_id = ?)
          OR EXISTS (SELECT 1 FROM media WHERE owner_type = 'task' AND owner_id = ?
                       AND registered_at IS NOT NULL AND uploaded_at IS NULL AND failed_code IS NULL)`,
      [id, id],
    );
    if (!busy) files.push(...(await forgetTask(tx, id)).files);
  }
  return files;
}

/**
 * The ids of the TASK_LIMITS.knownTaskIds (100) most recently updated tasks the phone holds, newest first: /me/sync answers
 * which of them left the set. The server truncates a longer list, so the cap is applied here; tasks beyond the 100 newest are not
 * reported until they are among them.
 */
export async function knownTaskIds(db: Db): Promise<string[]> {
  return (await db.all<{ id: string }>('SELECT id FROM tasks ORDER BY updated_at DESC, id LIMIT ?', [TASK_LIMITS.knownTaskIds])).map((r) => r.id);
}
```

- [ ] **Step 6: Apply tasks in the pull**

In `apps/mobile/src/offline/sync-pull.ts`:
- Add `import { mergeTask, removeTasks } from './task-records';`.
- Replace `applyPull` and the signature and doc comment of `mergePull` with:

```ts
/** Spec §6.1, applied in one transaction. Returns the local files of removed tasks, to delete once it commits. */
export async function applyPull(db: Db, res: SyncResponse, offsetMs: number, now: number): Promise<string[]> {
  return db.transaction((tx) => mergePull(tx, res, offsetMs, now));
}

/** `applyPull` inside the caller's transaction. */
export async function mergePull(tx: Db, res: SyncResponse, offsetMs: number, now: number): Promise<string[]> {
```

- Replace the last line of `mergePull`, `for (const x of res.executions) await mergeExecution(tx, x, now);`, and the stray ` }` after it with:

```ts
  for (const x of res.executions) await mergeExecution(tx, x, now);
  for (const task of res.tasks) await mergeTask(tx, task, now);
  return removeTasks(tx, res.removedTaskIds);
}
```

In `apps/mobile/src/offline/sync-engine.ts`:
- Add `import { knownTaskIds } from './task-records';`.
- Replace the body of `pull()` with:

```ts
  async function pull(): Promise<Outcome> {
    const known = await knownVersionIds(db);
    const taskIds = await knownTaskIds(db);
    const sentAt = clock.now();
    let res: SyncResponse;
    try {
      res = await api.sync.pull(known, taskIds);
    } catch (e) {
      return classifyError(e).kind === 'auth' ? 'auth' : 'retry';
    }
    const receivedAt = clock.now();
    const offsetMs = clampOffset(measureOffset(res.serverTime, sentAt, receivedAt));
    const files = await ownedTransaction(db, userId, (tx) => mergePull(tx, res, offsetMs, receivedAt));
    if (files === NOT_OWNER) return 'ok';
    files.forEach(removeFile);
    feed.emit();
    return 'ok';
  }
```

In `apps/mobile/src/offline/testing/fake-api.ts`:
- `pull(knownVersionIds: string[]): Promise<SyncResponse>;` in `ApiHandlers` becomes `pull(knownVersionIds: string[], knownTaskIds: string[]): Promise<SyncResponse>;`.
- The `sync.pull` entry of `api` becomes:

```ts
      sync: {
        pull: async (known = [], taskIds = []) => {
          calls.push({ method: 'pull', id: null, body: { knownVersionIds: known, knownTaskIds: taskIds } });
          return (handlers.pull ?? fake.defaults.pull)(known, taskIds);
        },
      },
```

- [ ] **Step 7: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS, the SP4 pull and engine tests included.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/offline/task-records.ts apps/mobile/src/offline/local-model.ts apps/mobile/src/offline/sync-pull.ts apps/mobile/src/offline/sync-pull.test.ts apps/mobile/src/offline/sync-engine.ts apps/mobile/src/offline/sync-engine.test.ts apps/mobile/src/offline/testing/fixtures.ts apps/mobile/src/offline/testing/fake-api.ts
git commit -m "feat(mobile): store tasks from /me/sync and drop the ones that left the user" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Task commands in the outbox and the sync engine

**Files:**
- Modify: `apps/mobile/src/offline/outbox.ts`, `clock.ts`, `sync-api.ts`, `sync-engine.ts`, `refusals.ts`, `task-records.ts`, `testing/fake-api.ts`
- Test: `apps/mobile/src/offline/sync-engine.test.ts`, `apps/mobile/src/offline/clock.test.ts`

**Interfaces:**
- Consumes: `TasksApi`, `TaskActionCommand`, `SubmissionInput`, `TaskMediaRegisterInput`, `syncTaskSchema`, `TaskDetail` (Part 1 Tasks 1, 2, 4); `mergeTask`, `STATUS_KINDS_SQL` (Task 3).
- Produces:
  - `COMMAND_KINDS` gains `task.accept`, `task.start`, `task.media`, `task.submit`; `nextCommand` holds back an entity's later commands after a failed `claim`, `task.accept` or `task.start`.
  - `serverTime(deviceIso: string, offsetMs: number): string` (clock.ts).
  - `SyncApi.tasks: Pick<TasksApi['tasks'], 'accept' | 'start' | 'submit' | 'registerMedia'>`, `SyncApi.taskMedia: Pick<TasksApi['taskMedia'], 'confirmUploaded'>`.
  - `revertTask(tx, taskId, note, now): Promise<void>` (task-records.ts).
  - Engine: sends the four task commands with server-time bodies; an accepted status command stores the returned task (`mergeTask`) and, for a submission, deletes its draft. `discardFailedCommand` handles the task kinds.
  - Fake API methods `taskAccept`, `taskStart`, `taskSubmit`, `taskRegisterMedia`, `taskConfirmUploaded`, whose defaults act like the server on `fake.sync.tasks`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/src/offline/clock.test.ts` (import `serverTime` from `./clock`):

```ts
describe('serverTime', () => {
  it('moves a device instant onto the server clock (offset = device − server)', () => {
    expect(serverTime('2026-11-02T04:10:00.000Z', 120_000)).toBe('2026-11-02T04:08:00.000Z');
    expect(serverTime('2026-11-02T04:10:00.000Z', -60_000)).toBe('2026-11-02T04:11:00.000Z');
    expect(serverTime('2026-11-02T04:10:00.000Z', 0)).toBe('2026-11-02T04:10:00.000Z');
  });
});
```

Append to `apps/mobile/src/offline/sync-engine.test.ts` (add `appendCommand`, `type CommandKind` to the `./outbox` import):

```ts
describe('task commands', () => {
  const M1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e73';
  const SUB = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e74';
  const queueTask = (h: Harness, kind: CommandKind, payload: Record<string, unknown>, refId: string | null = null) =>
    appendCommand(h.db, { entityType: 'task', entityId: TASK, kind, refId, payload, createdAt: T.open });

  it('sends a task’s start, media registration and submission in outbox order, on the server’s clock, and keeps the server’s answer', async () => {
    const h = await createHarness();
    h.api.sync = syncResponse({ serverTime: '2026-11-02T04:08:00.000Z', tasks: [syncTask()] });
    await h.engine.run('start'); // measures +2 min and stores the task
    h.api.calls.length = 0;
    await h.db.run(`UPDATE tasks SET local_status = 'completed'`);
    // Already uploaded, so this test stays about the outbox (Task 5 covers the upload).
    await h.db.run(
      `INSERT INTO media (id, owner_type, owner_id, role, kind, source, mime, bytes, captured_at, local_uri, uploaded_at)
       VALUES (?, 'task', ?, 'response', 'photo', 'camera', 'image/jpeg', 10, ?, 'file:///doc/media/t.jpg', ?)`,
      [M1, TASK, T.open, T.open],
    );
    await h.db.run('INSERT INTO task_drafts (task_id, submission_id, text, media_ids, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      TASK, SUB, 'Hazırdır', JSON.stringify([M1]), T.open, T.open,
    ]);
    await queueTask(h, 'task.start', { at: T.open });
    await queueTask(h, 'task.media', { id: M1, role: 'response', kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, width: null, height: null, durationMs: null, capturedAt: T.open }, M1);
    await queueTask(h, 'task.submit', { id: SUB, text: 'Hazırdır', mediaIds: [M1], submittedAt: T.open }, SUB);
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['taskStart', 'taskRegisterMedia', 'taskSubmit', 'pull']);
    expect(bodyOf(h, 'taskStart')).toEqual({ at: '2026-11-02T04:08:00.000Z' });
    expect(bodyOf(h, 'taskRegisterMedia')).toMatchObject({ id: M1, role: 'response', capturedAt: '2026-11-02T04:08:00.000Z' });
    expect(bodyOf(h, 'taskSubmit')).toEqual({ id: SUB, text: 'Hazırdır', mediaIds: [M1], submittedAt: '2026-11-02T04:08:00.000Z' });
    expect(await h.db.first('SELECT local_status, rev FROM tasks')).toEqual({ local_status: 'completed', rev: 3 });
    expect(await h.db.first('SELECT count(*) AS n FROM task_drafts')).toEqual({ n: 0 });
    expect(await h.db.first('SELECT registered_at FROM media')).toEqual({ registered_at: T.open });
  });

  it('holds back a task’s later commands while its start is parked, and "Sil" returns the task to the server’s status', async () => {
    const h = await createHarness();
    await h.seed(syncResponse({ checklistVersions: [versionOf(h.c.content)], tasks: [syncTask()] }));
    h.api.sync = syncResponse({ tasks: [syncTask()] });
    await h.db.run(`UPDATE tasks SET local_status = 'completed'`);
    await h.db.run('INSERT INTO task_drafts (task_id, submission_id, text, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?)', [TASK, SUB, 'Hazırdır', T.open, T.open]);
    await queueTask(h, 'task.start', { at: T.open });
    await queueTask(h, 'task.submit', { id: SUB, text: 'Hazırdır', mediaIds: [], submittedAt: T.open }, SUB);
    h.api.on('taskStart', async () => {
      throw new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN');
    });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['taskStart', 'pull']);
    expect((await listCommands(h.db)).map((c) => [c.kind, c.status])).toEqual([['task.start', 'failed'], ['task.submit', 'pending']]);
    expect(await h.db.first('SELECT local_status FROM tasks')).toEqual({ local_status: 'completed' });

    await h.engine.discardCommand((await listCommands(h.db))[0]!.seq);
    expect(await listCommands(h.db)).toEqual([]);
    expect(await h.db.first('SELECT local_status, sync_note FROM tasks')).toEqual({ local_status: 'new', sync_note: 'errors.FORBIDDEN' });
    expect(await h.db.first('SELECT text, submitted_at FROM task_drafts')).toEqual({ text: 'Hazırdır', submitted_at: null });
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/sync-engine.test.ts src/offline/clock.test.ts`
Expected: FAIL. `serverTime is not a function`; the engine has no case for the task kinds, so it calls nothing (`methods(h)` is `['pull']`) and acknowledges the commands unsent. (Jest runs through Babel, so the `task.start` kind's type error shows only in `typecheck`.)

- [ ] **Step 3: Add the command kinds, the hold-back and the server clock**

In `apps/mobile/src/offline/outbox.ts`:
- `COMMAND_KINDS` becomes:

```ts
export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete', 'task.accept', 'task.start', 'task.media', 'task.submit'] as const;
```

- Replace `nextCommand` with:

```ts
/**
 * The oldest pending command, so each execution's and each task's commands go in order (a medium's registration before
 * the submission that lists it). A failed claim, task accept or task start holds back the later commands of its entity:
 * without it they could only fail.
 */
export async function nextCommand(db: Db): Promise<OutboxCommand | null> {
  const row = await db.first<OutboxRow>(
    `SELECT * FROM outbox o
     WHERE o.status = 'pending'
       AND NOT EXISTS (SELECT 1 FROM outbox c WHERE c.entity_type = o.entity_type AND c.entity_id = o.entity_id
                         AND c.kind IN ('claim', 'task.accept', 'task.start') AND c.status = 'failed' AND c.seq < o.seq)
     ORDER BY o.seq LIMIT 1`,
  );
  return row ? toCommand(row) : null;
}
```

Append to `apps/mobile/src/offline/clock.ts`:

```ts
/** A device instant moved onto the server's clock with the offset measured at the last /me/sync (device − server). */
export const serverTime = (deviceIso: string, offsetMs: number): string => new Date(Date.parse(deviceIso) - offsetMs).toISOString();
```

Replace `apps/mobile/src/offline/sync-api.ts`'s import and interface with:

```ts
import { ApiError, type ExecutionsApi, type TasksApi } from '@taskop/api-client';

/** The slice of the API client the offline layer uses. `api` from '@/lib/session' satisfies it. */
export interface SyncApi {
  sync: Pick<ExecutionsApi['sync'], 'pull'>;
  executions: Pick<ExecutionsApi['executions'], 'claim' | 'saveAnswers' | 'complete' | 'registerMedia'>;
  media: Pick<ExecutionsApi['media'], 'confirmUploaded'>;
  tasks: Pick<TasksApi['tasks'], 'accept' | 'start' | 'submit' | 'registerMedia'>;
  taskMedia: Pick<TasksApi['taskMedia'], 'confirmUploaded'>;
}
```

Append to `apps/mobile/src/offline/task-records.ts`:

```ts
/**
 * The phone's view of a task goes back to the server's copy: queued accept, start and submission commands go, a submitted
 * draft becomes unsubmitted (kept; editable only while the task is in progress), and the note says why.
 */
export async function revertTask(tx: Db, taskId: string, note: string, now: number): Promise<void> {
  await tx.run(`DELETE FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind IN ${STATUS_KINDS_SQL}`, [taskId]);
  await tx.run('UPDATE task_drafts SET submitted_at = NULL, updated_at = ? WHERE task_id = ?', [iso(now), taskId]);
  await tx.run(`UPDATE tasks SET local_status = json_extract(data, '$.status'), sync_note = ?, updated_at = ? WHERE id = ?`, [note, iso(now), taskId]);
}
```

- [ ] **Step 4: Send the task commands and keep their answers**

In `apps/mobile/src/offline/sync-engine.ts`:
- Add to the `@taskop/contracts` import: `type SubmissionInput`, `syncTaskSchema`, `type TaskActionCommand`, `type TaskMediaRegisterInput`.
- Change the clock import to `import { clampOffset, type Clock, measureOffset, readOffset, serverTime } from './clock';` and the task-records import to `import { knownTaskIds, mergeTask } from './task-records';`.
- Replace `send` with:

```ts
  /**
   * Execution commands carry the worker's action time as `deviceTime` plus the latest offset (the API refuses answers stamped
   * at or after closes_at). Task commands carry no offset (Part 1 decision 1): their times move onto the server's clock here.
   */
  async function send(cmd: OutboxCommand): Promise<unknown> {
    const offset = clampOffset(await readOffset(db));
    const body = { ...cmd.payload, deviceTime: cmd.createdAt, clientOffsetMs: offset };
    switch (cmd.kind) {
      case 'claim':
        return api.executions.claim(body as ClaimCommand);
      case 'media':
        return api.executions.registerMedia(cmd.entityId, body as RegisterMediaCommand);
      case 'answers':
        return api.executions.saveAnswers(cmd.entityId, body as SaveAnswersCommand);
      case 'complete':
        return api.executions.complete(cmd.entityId, body as CompleteCommand);
      case 'task.accept':
        return api.tasks.accept(cmd.entityId, { at: serverTime((cmd.payload as TaskActionCommand).at, offset) });
      case 'task.start':
        return api.tasks.start(cmd.entityId, { at: serverTime((cmd.payload as TaskActionCommand).at, offset) });
      case 'task.media': {
        const b = cmd.payload as TaskMediaRegisterInput;
        return api.tasks.registerMedia(cmd.entityId, { ...b, capturedAt: serverTime(b.capturedAt, offset) });
      }
      case 'task.submit': {
        const b = cmd.payload as SubmissionInput;
        return api.tasks.submit(cmd.entityId, { ...b, submittedAt: serverTime(b.submittedAt, offset) });
      }
    }
  }
```

- In `applyResult`, change `case 'media': {` to two labels, `case 'media':` then `case 'task.media': {` (the body is unchanged), and add before the closing `}` of the `switch`:

```ts
      case 'task.accept':
      case 'task.start':
      case 'task.submit': {
        // The task may have left the phone while the command was in flight.
        if (!(await tx.first('SELECT 1 AS one FROM tasks WHERE id = ?', [cmd.entityId]))) return null;
        if (cmd.kind === 'task.submit') await tx.run('DELETE FROM task_drafts WHERE task_id = ? AND submission_id = ?', [cmd.entityId, cmd.refId]);
        await mergeTask(tx, syncTaskSchema.parse(result), now, cmd.seq);
        return null;
      }
```

In `apps/mobile/src/offline/refusals.ts`:
- Add `import { revertTask } from './task-records';`.
- In `discardFailedCommand`, change `case 'media': {` to `case 'media':` followed by `case 'task.media': {` (body unchanged), and add before the closing `}` of the `switch`:

```ts
    case 'task.accept':
    case 'task.start':
    case 'task.submit':
      // The failed command goes with every queued status change of its task; the draft stays, unsubmitted.
      await revertTask(tx, row.entity_id, note, now);
      return [];
```

- [ ] **Step 5: Teach the fake API the task endpoints**

Replace `apps/mobile/src/offline/testing/fake-api.ts` with:

```ts
import type {
  ClaimCommand,
  ClaimResult,
  CompleteCommand,
  CompleteResult,
  MediaConfirmResult,
  MediaUploadTicket,
  RegisterMediaCommand,
  SaveAnswersCommand,
  SaveAnswersResult,
  SubmissionInput,
  SyncResponse,
  SyncTask,
  TaskActionCommand,
  TaskDetail,
  TaskMediaRegisterInput,
} from '@taskop/contracts';
import type { SyncApi } from '../sync-api';
import { ME, ME_REF, syncResponse, syncTask, VERSION } from './fixtures';

export interface ApiHandlers {
  pull(knownVersionIds: string[], knownTaskIds: string[]): Promise<SyncResponse>;
  claim(body: ClaimCommand): Promise<ClaimResult>;
  saveAnswers(id: string, body: SaveAnswersCommand): Promise<SaveAnswersResult>;
  complete(id: string, body: CompleteCommand): Promise<CompleteResult>;
  registerMedia(executionId: string, body: RegisterMediaCommand): Promise<MediaUploadTicket>;
  confirmUploaded(id: string): Promise<MediaConfirmResult>;
  taskAccept(taskId: string, body: TaskActionCommand): Promise<TaskDetail>;
  taskStart(taskId: string, body: TaskActionCommand): Promise<TaskDetail>;
  taskSubmit(taskId: string, body: SubmissionInput): Promise<TaskDetail>;
  taskRegisterMedia(taskId: string, body: TaskMediaRegisterInput): Promise<MediaUploadTicket>;
  taskConfirmUploaded(id: string): Promise<MediaConfirmResult>;
}
export type ApiMethod = keyof ApiHandlers;
export interface ApiCall {
  method: ApiMethod;
  /** The execution or task ID (commands, registerMedia), or the media ID (confirmUploaded). */
  id: string | null;
  body: unknown;
}

export interface FakeApi {
  api: SyncApi;
  calls: ApiCall[];
  /** What a healthy server answers; custom handlers may delegate to these. */
  defaults: ApiHandlers;
  /** The /me/sync response `defaults.pull` returns. The task defaults update its `tasks` like the server would. */
  sync: SyncResponse;
  on<K extends ApiMethod>(method: K, handler: ApiHandlers[K]): void;
  reset(method: ApiMethod): void;
}

const progress = { answered: 0, total: 0, requiredMissing: 0 };
const UPLOADED_AT = '2026-11-02T04:30:00.000Z';

const ticketFor = (b: { id: string; mime: string; bytes: number }): MediaUploadTicket => ({
  mediaId: b.id,
  status: 'pending',
  uploadUrl: `http://files.test/taskop-media/${b.id}`,
  headers: { 'Content-Type': b.mime, 'Content-Length': String(b.bytes) },
  expiresAt: '2026-11-02T05:00:00.000Z',
});

export function createFakeApi(): FakeApi {
  const calls: ApiCall[] = [];
  const handlers: Partial<ApiHandlers> = {};
  /** Applies a worker command to the server's copy of a task (in `fake.sync.tasks` when listed there) and answers it. */
  const serverTask = (id: string, patch: (t: SyncTask) => Partial<SyncTask>): TaskDetail => {
    const base = fake.sync.tasks.find((t) => t.id === id) ?? syncTask({ id });
    const next: SyncTask = { ...base, ...patch(base), rev: base.rev + 1 };
    fake.sync = { ...fake.sync, tasks: fake.sync.tasks.map((t) => (t.id === id ? next : t)) };
    return { ...next, history: [], canManage: false, canReview: false };
  };
  const call = <K extends ApiMethod>(method: K, id: string | null, body: unknown): ApiHandlers[K] => {
    calls.push({ method, id, body });
    return (handlers[method] ?? fake.defaults[method]) as ApiHandlers[K];
  };
  const fake: FakeApi = {
    calls,
    sync: syncResponse({ occurrences: [] }),
    defaults: {
      pull: async () => fake.sync,
      claim: async (b) => ({
        executionId: b.id,
        state: 'active',
        reason: null,
        claim: { executionId: b.id, executorUserId: ME, executorName: 'Aysel Əliyeva' },
        checklistVersionId: VERSION,
        startedAt: b.startedAt,
        clockSuspect: false,
      }),
      saveAnswers: async (id, b) => ({ executionId: id, rev: b.rev, stale: false, state: 'active', progress }),
      complete: async (id, b) => ({ executionId: id, state: 'completed', completedAt: b.completedAt, late: false, progress, score: null }),
      registerMedia: async (_executionId, b) => ticketFor(b),
      confirmUploaded: async (id) => ({ mediaId: id, status: 'uploaded', uploadedAt: UPLOADED_AT }),
      taskAccept: async (id, b) => serverTask(id, (t) => ({ status: 'accepted', assignee: t.assignee ?? ME_REF, acceptedAt: b.at })),
      taskStart: async (id, b) =>
        serverTask(id, (t) => ({ status: 'in_progress', assignee: t.assignee ?? ME_REF, acceptedAt: t.acceptedAt ?? b.at, startedAt: b.at })),
      taskSubmit: async (id, b) =>
        serverTask(id, (t) => ({
          status: t.requiresReview ? 'awaiting_review' : 'completed',
          submittedAt: b.submittedAt,
          completedAt: t.requiresReview ? null : b.submittedAt,
          submissions: [
            ...t.submissions,
            {
              id: b.id, submittedBy: ME_REF, text: b.text ?? '', mediaIds: b.mediaIds ?? [], submittedAt: b.submittedAt, receivedAt: b.submittedAt,
              reviewDecision: null, reviewComment: null, reviewedBy: null, reviewedAt: null,
            },
          ],
        })),
      taskRegisterMedia: async (_taskId, b) => ticketFor(b),
      taskConfirmUploaded: async (id) => ({ mediaId: id, status: 'uploaded', uploadedAt: UPLOADED_AT }),
    },
    api: {
      sync: {
        pull: async (known = [], taskIds = []) => call('pull', null, { knownVersionIds: known, knownTaskIds: taskIds })(known, taskIds),
      },
      executions: {
        claim: async (b) => call('claim', null, b)(b),
        saveAnswers: async (id, b) => call('saveAnswers', id, b)(id, b),
        complete: async (id, b) => call('complete', id, b)(id, b),
        registerMedia: async (executionId, b) => call('registerMedia', executionId, b)(executionId, b),
      },
      media: {
        confirmUploaded: async (id) => call('confirmUploaded', id, null)(id),
      },
      tasks: {
        accept: async (id, b) => call('taskAccept', id, b)(id, b),
        start: async (id, b) => call('taskStart', id, b)(id, b),
        submit: async (id, b) => call('taskSubmit', id, b)(id, b),
        registerMedia: async (id, b) => call('taskRegisterMedia', id, b)(id, b),
      },
      taskMedia: {
        confirmUploaded: async (id) => call('taskConfirmUploaded', id, null)(id),
      },
    },
    on: (method, handler) => {
      Object.assign(handlers, { [method]: handler });
    },
    reset: (method) => {
      delete handlers[method];
    },
  };
  return fake;
}
```

(`call` records the call before the handler is chosen, as before, so a handler that throws still shows in `calls`.)

- [ ] **Step 6: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. Server rev 1 → 2 (start) → 3 (submission); the media registration does not change it.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/offline/outbox.ts apps/mobile/src/offline/clock.ts apps/mobile/src/offline/clock.test.ts apps/mobile/src/offline/sync-api.ts apps/mobile/src/offline/sync-engine.ts apps/mobile/src/offline/sync-engine.test.ts apps/mobile/src/offline/refusals.ts apps/mobile/src/offline/task-records.ts apps/mobile/src/offline/testing/fake-api.ts
git commit -m "feat(mobile): send task accept, start, media and submission commands in outbox order" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Media queue: task files go to the task endpoints

**Files:**
- Modify: `apps/mobile/src/offline/media-queue.ts`, `apps/mobile/src/offline/task-records.ts`
- Test: `apps/mobile/src/offline/media-queue.test.ts`

**Interfaces:**
- Consumes: `SyncApi.tasks.registerMedia`, `SyncApi.taskMedia.confirmUploaded`, `serverTime` (Task 4); `LocalMedia.ownerType/ownerId/role` (Task 2).
- Produces:
  - `taskMediaBody(m, role: TaskMediaRole): TaskMediaRegisterInput` (task-records.ts): the one builder for the outbox payload and the queue's re-registration.
  - The queue registers and confirms by owner: `api.tasks.registerMedia(ownerId, body)` + `api.taskMedia.confirmUploaded(id)` for tasks, the SP4 endpoints for executions.
  - `cleanup()` also deletes task files 7 days after their upload.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/src/offline/media-queue.test.ts` (import `setMeta` from `./db`, add `TASK` to the fixtures import):

```ts
describe('task media', () => {
  const M1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e73';
  async function taskMedium(h: Harness, role: 'response' | 'instruction' = 'response') {
    const p = capturedPhoto(h.transport);
    await h.db.run(
      `INSERT INTO media (id, owner_type, owner_id, role, kind, source, mime, bytes, width, height, captured_at, local_uri, registered_at)
       VALUES (?, 'task', ?, ?, 'photo', 'camera', 'image/jpeg', ?, 1600, 1200, ?, ?, ?)`,
      [M1, TASK, role, p.bytes, T.open, p.localUri, T.open],
    );
    return p;
  }

  it('uploads a task medium through the task endpoints, with its capture time on the server’s clock', async () => {
    const h = await createHarness();
    await setMeta(h.db, 'clockOffsetMs', '120000');
    const p = await taskMedium(h);
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.api.calls.map((c) => [c.method, c.id])).toEqual([['taskRegisterMedia', TASK], ['taskConfirmUploaded', M1]]);
    expect(h.api.calls[0]!.body).toEqual({
      id: M1, role: 'response', kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: p.bytes, width: 1600, height: 1200, durationMs: null,
      capturedAt: '2026-11-02T04:08:00.000Z',
    });
    expect(h.transport.uploads.map((u) => u.uri)).toEqual([p.localUri]);
    expect((await rows(h))[0]).toMatchObject({ uploaded_at: T.open });
  });

  it('registers an instruction photo again with its role', async () => {
    const h = await createHarness();
    await taskMedium(h, 'instruction');
    await h.mediaQueue.drain();
    expect(h.api.calls[0]!.body).toMatchObject({ id: M1, role: 'instruction' });
  });

  it('deletes a task medium’s local file 7 days after its upload', async () => {
    const h = await createHarness();
    const p = await taskMedium(h);
    await h.mediaQueue.drain();
    h.clock.advance(LOCAL_FILE_KEEP_DAYS * 86_400_000 - 1);
    expect(await h.mediaQueue.cleanup()).toBe(0);
    h.clock.advance(1);
    expect(await h.mediaQueue.cleanup()).toBe(1);
    expect(h.transport.removed).toEqual([p.localUri]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/media-queue.test.ts`
Expected: FAIL. The queue calls `registerMedia` (the execution endpoint) for the task medium, and `cleanup()` returns 0.

- [ ] **Step 3: Route by owner**

Append to `apps/mobile/src/offline/task-records.ts` (extend the contracts import with `type TaskMediaRegisterInput`, `type TaskMediaRole`, and add `type LocalMedia` to the `./local-model` import):

```ts
/** The registration body of a task medium (POST /tasks/:id/media) with the device's capture time; the sender moves it onto the server's clock. */
export function taskMediaBody(
  m: Pick<LocalMedia, 'id' | 'kind' | 'source' | 'mime' | 'bytes' | 'width' | 'height' | 'durationMs' | 'capturedAt'>,
  role: TaskMediaRole,
): TaskMediaRegisterInput {
  return {
    id: m.id, role, kind: m.kind, source: m.source, mime: m.mime, bytes: m.bytes,
    width: m.width, height: m.height, durationMs: m.durationMs, capturedAt: m.capturedAt,
  };
}
```

In `apps/mobile/src/offline/media-queue.ts`:
- Change the clock import to `import { clampOffset, type Clock, readOffset, serverTime } from './clock';` and add `import { taskMediaBody } from './task-records';`.
- In `uploadOne`, replace the registration `try` block with:

```ts
    try {
      const offset = clampOffset(await readOffset(db));
      // Registering a known ID again only returns a fresh presigned URL (SP4 decision 7; tasks: Part 1 decision 9).
      ticket =
        m.ownerType === 'task'
          ? await api.tasks.registerMedia(m.ownerId, { ...taskMediaBody(m, m.role ?? 'response'), capturedAt: serverTime(m.capturedAt, offset) })
          : await api.executions.registerMedia(m.ownerId, { ...mediaRegisterBody(m), deviceTime: iso(clock.now()), clientOffsetMs: offset });
    } catch (e) {
```

- Replace `await api.media.confirmUploaded(m.id);` with `await (m.ownerType === 'task' ? api.taskMedia.confirmUploaded(m.id) : api.media.confirmUploaded(m.id));`.
- Replace the `cleanup` doc comment in `MediaQueue` with `/** Deletes local files uploaded more than 7 days ago: an execution's once it finished syncing, a task's counted from the upload. Returns how many. */` and its query with:

```ts
        const cutoff = iso(now - LOCAL_FILE_KEEP_DAYS * DAY_MS);
        const due = await tx.all<{ id: string; local_uri: string }>(
          `SELECT m.id, m.local_uri FROM media m
           LEFT JOIN executions e ON m.owner_type = 'execution' AND e.id = m.owner_id
           WHERE m.uploaded_at IS NOT NULL AND m.file_deleted_at IS NULL
             AND ((m.owner_type = 'execution' AND e.finished_synced_at IS NOT NULL AND e.finished_synced_at <= ?)
               OR (m.owner_type = 'task' AND m.uploaded_at <= ?))`,
          [cutoff, cutoff],
        );
```

- [ ] **Step 4: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS, every SP4 media-queue test included.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/offline/media-queue.ts apps/mobile/src/offline/media-queue.test.ts apps/mobile/src/offline/task-records.ts
git commit -m "feat(mobile): upload task media through the task endpoints and clean their files up" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Task store: accept, start, response media, draft and Tamamla in one transaction each

**Files:**
- Create: `apps/mobile/src/offline/task-store.ts`
- Modify: `apps/mobile/src/offline/services.ts`, `testing/harness.ts`
- Test: `apps/mobile/src/offline/task-store.test.ts`, `apps/mobile/src/features/sync/sync.test.tsx`

**Interfaces:**
- Consumes: `taskTransition`, `taskEvidenceMet`, `isFinalTaskStatus`, `TASK_LIMITS`, `TaskEvidenceResult` (Part 1 Task 1); `StoreDeps`, `WriteKind`, `CapturedMedia`, `MediaRefusal`, `LiveOnlyError`, `MediaLimitError` (execution-store.ts); `taskMediaBody` (Task 5).
- Produces (`task-store.ts`):
  - `class TaskStateError extends Error { status: TaskStatus; action: TaskAction | 'edit' }`
  - `interface TaskView extends LocalTask { draft: TaskDraft | null; unsynced: boolean; failedKey: string | null }`
  - `isTeamOffer(t: LocalTask): boolean`, `isTaskOverdue(t: LocalTask, now: number): boolean`, `canEditDraft(t: TaskView): boolean`, `RESPONSE_LIMITS: Record<MediaKind, number>`
  - `createTaskStore(deps)` → `TaskStore` with `tasks(): Promise<TaskView[]>`, `task(id): Promise<TaskView | null>`, `media(taskId): Promise<LocalMedia[]>` (response media), `refusals(taskId): Promise<MediaRefusal[]>`, `accept(id)`, `start(id)`, `attachMedia(id, m: CapturedMedia): Promise<string>`, `removeMedia(id, mediaId)`, `saveText(id, text)`, `submit(id): Promise<TaskEvidenceResult>`, `queueInstructionMedia(taskId, photos: readonly CapturedMedia[])`.
  - `OfflineServices` gains `tasks: TaskStore`, `newId: () => string`, `files: FileRemover`. `Harness` gains `tasks: TaskStore`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/offline/task-store.test.ts`:

```ts
import { type SyncTask, TASK_LIMITS } from '@taskop/contracts';
import { LiveOnlyError, MediaLimitError } from './execution-store';
import { canEditDraft, isTeamOffer, TaskStateError } from './task-store';
import { capturedPhoto, capturedVideo } from './testing/fake-transport';
import { syncResponse, syncTask, T, TASK, TASK2, TEAM, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';
import { failingDriver, nodeDriver, openTestDb } from './testing/node-db';

async function withTask(over: Partial<SyncTask> = {}, h?: Harness): Promise<Harness> {
  const harness = h ?? (await createHarness());
  await harness.seed(syncResponse({ checklistVersions: [versionOf(harness.c.content)], tasks: [syncTask(over)] }));
  harness.api.sync = syncResponse({ tasks: [syncTask(over)] });
  return harness;
}
const commands = (h: Harness) =>
  h.db.all<{ kind: string; ref_id: string | null; payload: string }>(`SELECT kind, ref_id, payload FROM outbox WHERE entity_type = 'task' ORDER BY seq`);
const view = async (h: Harness, id = TASK) => (await h.tasks.task(id))!;

describe('task store', () => {
  it('accepting a team task writes its status and its command in one transaction, and syncs at once', async () => {
    const h = await withTask({ assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    expect(isTeamOffer(await view(h))).toBe(true);
    await h.tasks.accept(TASK);
    expect((await view(h)).status).toBe('accepted');
    expect(isTeamOffer(await view(h))).toBe(false);
    expect((await commands(h)).map((c) => [c.kind, JSON.parse(c.payload)])).toEqual([['task.accept', { at: T.open }]]);
    expect(h.writes).toEqual(['claim']);
  });

  it('start on a new task accepts and starts it with one command', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    expect((await view(h)).status).toBe('in_progress');
    expect((await commands(h)).map((c) => c.kind)).toEqual(['task.start']);
  });

  it('refuses what the status table refuses and writes nothing', async () => {
    const h = await withTask({ status: 'cancelled' });
    for (const action of [() => h.tasks.accept(TASK), () => h.tasks.start(TASK), () => h.tasks.saveText(TASK, 'x'), () => h.tasks.submit(TASK)]) {
      await expect(action()).rejects.toBeInstanceOf(TaskStateError);
    }
    await expect(h.tasks.attachMedia(TASK, capturedPhoto(h.transport))).rejects.toBeInstanceOf(TaskStateError);
    expect(await commands(h)).toEqual([]);
    expect(await h.db.first('SELECT count(*) AS n FROM task_drafts')).toEqual({ n: 0 });
  });

  it('queues a response medium’s registration before the submission that lists it', async () => {
    const h = await withTask({ status: 'in_progress' });
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.saveText(TASK, 'Rezin dəyişildi');
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    const queued = await commands(h);
    const draft = (await view(h)).draft!;
    expect(queued.map((c) => [c.kind, c.ref_id])).toEqual([['task.media', id], ['task.submit', draft.submissionId]]);
    expect(JSON.parse(queued[0]!.payload)).toEqual({
      id, role: 'response', kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 250_000, width: 1600, height: 1200, durationMs: null, capturedAt: T.open,
    });
    expect(JSON.parse(queued[1]!.payload)).toEqual({ id: draft.submissionId, text: 'Rezin dəyişildi', mediaIds: [id], submittedAt: T.open });
    expect((await view(h)).status).toBe('completed');
    expect(canEditDraft(await view(h))).toBe(false);
  });

  it('keeps Tamamla closed until the required evidence is attached, and goes to review when the task asks for it', async () => {
    const h = await withTask({ status: 'in_progress', requiresReview: true, evidence: { photo: 'required', video: 'required', liveOnly: false } });
    expect(await h.tasks.submit(TASK)).toEqual({ ok: false, missing: ['photo', 'video'] });
    expect(await commands(h)).toEqual([]);
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    expect(await h.tasks.submit(TASK)).toEqual({ ok: false, missing: ['video'] });
    await h.tasks.attachMedia(TASK, capturedVideo(h.transport));
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    expect((await view(h)).status).toBe('awaiting_review');
  });

  it('refuses gallery media on a live-only task, a kind the task does not take, and more than the limit', async () => {
    const h = await withTask({ status: 'in_progress', evidence: { photo: 'optional', video: 'none', liveOnly: true } });
    await expect(h.tasks.attachMedia(TASK, capturedPhoto(h.transport, { source: 'gallery' }))).rejects.toBeInstanceOf(LiveOnlyError);
    await expect(h.tasks.attachMedia(TASK, capturedVideo(h.transport))).rejects.toBeInstanceOf(MediaLimitError);
    for (let i = 0; i < TASK_LIMITS.responsePhotos; i++) await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await expect(h.tasks.attachMedia(TASK, capturedPhoto(h.transport))).rejects.toBeInstanceOf(MediaLimitError);
    expect((await view(h)).draft!.mediaIds).toHaveLength(TASK_LIMITS.responsePhotos);
  });

  it('forgets a medium never registered when it is removed, and autosaves the text under one submission id', async () => {
    const h = await withTask({ status: 'in_progress' });
    const photo = capturedPhoto(h.transport);
    const id = await h.tasks.attachMedia(TASK, photo);
    await h.tasks.removeMedia(TASK, id);
    expect(await commands(h)).toEqual([]);
    expect(await h.db.first('SELECT count(*) AS n FROM media')).toEqual({ n: 0 });
    expect(h.transport.removed).toEqual([photo.localUri]);
    await h.tasks.saveText(TASK, 'Bir');
    const first = (await view(h)).draft!;
    await h.tasks.saveText(TASK, 'İki');
    expect((await view(h)).draft).toMatchObject({ text: 'İki', mediaIds: [], submissionId: first.submissionId, submittedAt: null });
  });

  it('rolls the start back when the app is killed between the status write and the outbox append', async () => {
    const driver = failingDriver(nodeDriver(), /INSERT INTO outbox/);
    const h = await withTask({}, await createHarness({ db: await openTestDb(driver) }));
    driver.armed = true;
    await expect(h.tasks.start(TASK)).rejects.toThrow('simulated crash');
    driver.armed = false;
    expect((await view(h)).status).toBe('new');
    expect(await commands(h)).toEqual([]);
  });

  it('queues the instruction photos of a task created online, at most five', async () => {
    const h = await createHarness();
    await h.tasks.queueInstructionMedia(TASK2, [capturedPhoto(h.transport), capturedPhoto(h.transport)]);
    expect((await commands(h)).map((c) => [c.kind, JSON.parse(c.payload).role])).toEqual([['task.media', 'instruction'], ['task.media', 'instruction']]);
    expect(await h.db.all('SELECT owner_id, role FROM media')).toEqual([{ owner_id: TASK2, role: 'instruction' }, { owner_id: TASK2, role: 'instruction' }]);
    const six = Array.from({ length: TASK_LIMITS.instructionMedia + 1 }, () => capturedPhoto(h.transport));
    await expect(h.tasks.queueInstructionMedia(TASK2, six)).rejects.toBeInstanceOf(MediaLimitError);
    expect(h.writes).toEqual(['claim']);
  });

  it('offline start, photo and Tamamla reach the server in order once online', async () => {
    const h = await withTask();
    h.net.online = false;
    await h.tasks.start(TASK);
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    await h.engine.run('manual');
    expect(h.api.calls).toEqual([]);
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'taskRegisterMedia', 'taskSubmit', 'pull', 'taskRegisterMedia', 'taskConfirmUploaded']);
    expect(await h.tasks.task(TASK)).toMatchObject({ status: 'completed', draft: null, unsynced: false, failedKey: null });
    expect(await h.db.first('SELECT uploaded_at FROM media WHERE id = ?', [id])).toEqual({ uploaded_at: T.open });
  });
});
```

Append to `apps/mobile/src/features/sync/sync.test.tsx` (extend the fixtures import with `syncResponse`, `syncTask`, `TASK`, `versionOf`):

```ts
describe('sync queue with tasks', () => {
  it('names a task command after its kind and its task', async () => {
    const t = await createTestServices();
    await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask()] }));
    await t.services.tasks.start(TASK);
    await renderWithServices(t.services, <SyncScreen />);
    expect(await screen.findByText('Tapşırığa başlama · Soyuducunun qapısını təmir et')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/task-store.test.ts src/features/sync/sync.test.tsx`
Expected: FAIL. `./task-store` does not exist; `h.tasks` and `services.tasks` are undefined.

- [ ] **Step 3: Write the store**

Create `apps/mobile/src/offline/task-store.ts`:

```ts
import {
  isFinalTaskStatus,
  type MediaKind,
  TASK_LIMITS,
  type TaskAction,
  taskEvidenceMet,
  type TaskEvidenceResult,
  type TaskMediaRole,
  type TaskStatus,
  taskTransition,
} from '@taskop/contracts';
import type { Db } from './db';
import { type CapturedMedia, LiveOnlyError, MediaLimitError, type MediaRefusal, type StoreDeps, type WriteKind } from './execution-store';
import { type DraftRow, iso, type LocalMedia, type LocalTask, type MediaRow, type TaskDraft, type TaskRow, toDraft, toMedia, toTask } from './local-model';
import { appendCommand } from './outbox';
import { taskMediaBody } from './task-records';

/** What the server would refuse with TASK_STATE_INVALID; `edit` covers the draft (text and response media). */
export class TaskStateError extends Error {
  constructor(
    readonly status: TaskStatus,
    readonly action: TaskAction | 'edit',
  ) {
    super(`Task is ${status}: ${action} is not allowed`);
    this.name = 'TaskStateError';
  }
}

export interface TaskView extends LocalTask {
  draft: TaskDraft | null;
  /** Commands of the task are still on the phone (waiting or failed). */
  unsynced: boolean;
  /** The i18n key of a command of the task the server refused and that waits for "Yenidən cəhd et" or "Sil". */
  failedKey: string | null;
}

/** A team task on offer: nobody has accepted it, on the server or on this phone. */
export const isTeamOffer = (t: LocalTask): boolean => t.server.assignee === null && t.server.team !== null && t.status === 'new';

/** "Gecikib" (FR-14.09): flagged by the server's sweep (kept after completion), or past due by the phone's clock while open. */
export const isTaskOverdue = (t: LocalTask, now: number): boolean =>
  t.server.overdueAt !== null || (!isFinalTaskStatus(t.status) && t.server.dueAt !== null && Date.parse(t.server.dueAt) <= now);

/** The response changes only while the task is in progress and not yet submitted (decision 5). */
export const canEditDraft = (t: TaskView): boolean => t.status === 'in_progress' && (t.draft?.submittedAt ?? null) === null;

export const RESPONSE_LIMITS: Readonly<Record<MediaKind, number>> = { photo: TASK_LIMITS.responsePhotos, video: TASK_LIMITS.responseVideos };

export function createTaskStore(deps: Pick<StoreDeps, 'db' | 'clock' | 'newId' | 'files' | 'feed' | 'onWrite'>) {
  const { db, clock, newId, files, feed, onWrite } = deps;

  const changed = (kind: WriteKind) => {
    feed.emit();
    onWrite(kind);
  };

  async function load(tx: Db, taskId: string): Promise<LocalTask> {
    const row = await tx.first<TaskRow>('SELECT * FROM tasks WHERE id = ?', [taskId]);
    if (!row) throw new Error(`Unknown task ${taskId}`);
    return toTask(row);
  }

  /** The task's draft, created with its submission id on first use. */
  async function draftOf(tx: Db, taskId: string, now: number): Promise<TaskDraft> {
    const row = await tx.first<DraftRow>('SELECT * FROM task_drafts WHERE task_id = ?', [taskId]);
    if (row) return toDraft(row);
    const draft: TaskDraft = { taskId, submissionId: newId(), text: '', mediaIds: [], submittedAt: null, updatedAt: iso(now) };
    await tx.run('INSERT INTO task_drafts (task_id, submission_id, text, media_ids, updated_at) VALUES (?, ?, ?, ?, ?)', [
      taskId, draft.submissionId, draft.text, '[]', draft.updatedAt,
    ]);
    return draft;
  }

  /** The task and its draft when the response may change; TaskStateError otherwise. */
  async function editable(tx: Db, taskId: string, now: number): Promise<{ task: LocalTask; draft: TaskDraft }> {
    const task = await load(tx, taskId);
    if (task.status !== 'in_progress') throw new TaskStateError(task.status, 'edit');
    const draft = await draftOf(tx, taskId, now);
    if (draft.submittedAt !== null) throw new TaskStateError(task.status, 'edit');
    return { task, draft };
  }

  const saveDraft = (tx: Db, d: TaskDraft, now: number) =>
    tx.run('UPDATE task_drafts SET text = ?, media_ids = ?, updated_at = ? WHERE task_id = ?', [d.text, JSON.stringify(d.mediaIds), iso(now), d.taskId]);

  const kindsOf = (tx: Db, ids: readonly string[]) =>
    tx.all<{ kind: MediaKind }>('SELECT kind FROM media WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)]);

  /** One medium of the task and its registration command (spec §7.1: queued before the submission that lists it). */
  async function addMedium(tx: Db, taskId: string, m: CapturedMedia, role: TaskMediaRole, now: number): Promise<string> {
    const mediaId = newId();
    await tx.run(
      `INSERT INTO media (id, owner_type, owner_id, item_id, role, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
       VALUES (?, 'task', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [mediaId, taskId, role, m.kind, m.source, m.mime, m.bytes, m.width, m.height, m.durationMs, m.capturedAt, m.localUri],
    );
    await appendCommand(tx, { entityType: 'task', entityId: taskId, kind: 'task.media', refId: mediaId, payload: { ...taskMediaBody({ ...m, id: mediaId }, role) }, createdAt: iso(now) });
    return mediaId;
  }

  /** Accept or start: the new local status and its command in one transaction. `start` on a new task also accepts it (spec §3). */
  async function act(taskId: string, action: 'accept' | 'start'): Promise<void> {
    const now = clock.now();
    await db.transaction(async (tx) => {
      const task = await load(tx, taskId);
      const next = taskTransition(task.status, action, { requiresReview: task.server.requiresReview });
      if (!next) throw new TaskStateError(task.status, action);
      await tx.run('UPDATE tasks SET local_status = ?, sync_note = NULL, updated_at = ? WHERE id = ?', [next, iso(now), taskId]);
      await appendCommand(tx, {
        entityType: 'task', entityId: taskId, kind: action === 'accept' ? 'task.accept' : 'task.start', payload: { at: iso(now) }, createdAt: iso(now),
      });
    });
    // The first accept to reach the server owns a team task (spec §1): sync at once, like a checklist claim (decision 15).
    changed('claim');
  }

  async function attachMedia(taskId: string, m: CapturedMedia): Promise<string> {
    const now = clock.now();
    const mediaId = await db.transaction(async (tx) => {
      const { task, draft } = await editable(tx, taskId, now);
      const { evidence } = task.server;
      if (evidence[m.kind] === 'none') throw new MediaLimitError();
      if (evidence.liveOnly && m.source === 'gallery') throw new LiveOnlyError();
      const kinds = await kindsOf(tx, draft.mediaIds);
      if (kinds.filter((k) => k.kind === m.kind).length >= RESPONSE_LIMITS[m.kind]) throw new MediaLimitError();
      // A new medium replaces the note about one the server refused.
      await tx.run(`DELETE FROM media_refusals WHERE owner_type = 'task' AND owner_id = ?`, [taskId]);
      const id = await addMedium(tx, taskId, m, 'response', now);
      await saveDraft(tx, { ...draft, mediaIds: [...draft.mediaIds, id] }, now);
      return id;
    });
    changed('change');
    return mediaId;
  }

  async function removeMedia(taskId: string, mediaId: string): Promise<void> {
    const now = clock.now();
    const discarded = await db.transaction(async (tx) => {
      const { draft } = await editable(tx, taskId, now);
      const row = await tx.first<MediaRow>(`SELECT * FROM media WHERE id = ? AND owner_type = 'task' AND owner_id = ?`, [mediaId, taskId]);
      await saveDraft(tx, { ...draft, mediaIds: draft.mediaIds.filter((x) => x !== mediaId) }, now);
      if (!row || row.registered_at !== null) return null;
      // Never registered on the server: forget it entirely.
      await tx.run(`DELETE FROM outbox WHERE kind = 'task.media' AND ref_id = ?`, [mediaId]);
      await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
      return row.local_uri;
    });
    if (discarded) files.remove(discarded);
    changed('change');
  }

  /** Autosave (CommitInput): the draft only, no command; the text goes with Tamamla. */
  async function saveText(taskId: string, text: string): Promise<void> {
    if (text.length > TASK_LIMITS.submissionTextMax) throw new RangeError(`A response holds at most ${TASK_LIMITS.submissionTextMax} characters`);
    const now = clock.now();
    await db.transaction(async (tx) => {
      const { draft } = await editable(tx, taskId, now);
      await saveDraft(tx, { ...draft, text }, now);
    });
    feed.emit();
  }

  /** Tamamla: checks the status table and the evidence rules, then submits the draft with its submission id. */
  async function submit(taskId: string): Promise<TaskEvidenceResult> {
    const now = clock.now();
    const out = await db.transaction(async (tx): Promise<TaskEvidenceResult> => {
      const task = await load(tx, taskId);
      const next = taskTransition(task.status, 'submit', { requiresReview: task.server.requiresReview });
      if (!next) throw new TaskStateError(task.status, 'submit');
      const draft = await draftOf(tx, taskId, now);
      if (draft.submittedAt !== null) throw new TaskStateError(task.status, 'submit');
      const evidence = taskEvidenceMet(task.server.evidence, await kindsOf(tx, draft.mediaIds));
      if (!evidence.ok) return evidence;
      const submittedAt = iso(now);
      await tx.run('UPDATE task_drafts SET submitted_at = ?, updated_at = ? WHERE task_id = ?', [submittedAt, submittedAt, taskId]);
      await tx.run('UPDATE tasks SET local_status = ?, sync_note = NULL, updated_at = ? WHERE id = ?', [next, submittedAt, taskId]);
      await appendCommand(tx, {
        entityType: 'task', entityId: taskId, kind: 'task.submit', refId: draft.submissionId,
        payload: { id: draft.submissionId, text: draft.text, mediaIds: draft.mediaIds, submittedAt }, createdAt: submittedAt,
      });
      return { ok: true };
    });
    if (out.ok) changed('change');
    return out;
  }

  /** After an online create (decision 9): the instruction photos register and upload through the outbox and the media queue. */
  async function queueInstructionMedia(taskId: string, photos: readonly CapturedMedia[]): Promise<void> {
    if (photos.length > TASK_LIMITS.instructionMedia) throw new MediaLimitError();
    const now = clock.now();
    await db.transaction(async (tx) => {
      for (const m of photos) await addMedium(tx, taskId, m, 'instruction', now);
    });
    changed('claim');
  }

  async function views(rows: TaskRow[]): Promise<TaskView[]> {
    const drafts = new Map((await db.all<DraftRow>('SELECT * FROM task_drafts')).map((r) => [r.task_id, toDraft(r)]));
    const queued = await db.all<{ entity_id: string; failed_key: string | null }>(
      `SELECT entity_id, max(CASE WHEN status = 'failed' THEN coalesce(error_key, 'errors.INTERNAL') END) AS failed_key
       FROM outbox WHERE entity_type = 'task' GROUP BY entity_id`,
    );
    const byTask = new Map(queued.map((q) => [q.entity_id, q.failed_key]));
    return rows.map((r) => {
      const task = toTask(r);
      return { ...task, draft: drafts.get(task.id) ?? null, unsynced: byTask.has(task.id), failedKey: byTask.get(task.id) ?? null };
    });
  }

  return {
    tasks: async (): Promise<TaskView[]> => views(await db.all<TaskRow>('SELECT * FROM tasks ORDER BY id')),
    async task(id: string): Promise<TaskView | null> {
      return (await views(await db.all<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id])))[0] ?? null;
    },
    /** The response media the phone holds for the task (attached here), by capture time. */
    async media(taskId: string): Promise<LocalMedia[]> {
      const rows = await db.all<MediaRow>(`SELECT * FROM media WHERE owner_type = 'task' AND owner_id = ? AND role = 'response' ORDER BY captured_at, id`, [taskId]);
      return rows.map(toMedia);
    },
    async refusals(taskId: string): Promise<MediaRefusal[]> {
      const rows = await db.all<{ media_id: string; item_id: string | null; error_key: string }>(
        `SELECT media_id, item_id, error_key FROM media_refusals WHERE owner_type = 'task' AND owner_id = ? ORDER BY created_at, media_id`,
        [taskId],
      );
      return rows.map((r) => ({ mediaId: r.media_id, itemId: r.item_id, errorKey: r.error_key }));
    },
    accept: (taskId: string) => act(taskId, 'accept'),
    start: (taskId: string) => act(taskId, 'start'),
    attachMedia,
    removeMedia,
    saveText,
    submit,
    queueInstructionMedia,
  };
}

export type TaskStore = ReturnType<typeof createTaskStore>;
```

- [ ] **Step 4: Wire the store into the services and the harness**

In `apps/mobile/src/offline/services.ts`:
- Add `type WriteKind` to the `./execution-store` import, `import { createTaskStore, type TaskStore } from './task-store';` and `type FileRemover` to the `./user-scope` import.
- Add to `OfflineServices` after `readonly store: ExecutionStore;`:

```ts
  readonly tasks: TaskStore;
  /** Client UUIDv7s (a task created online, spec §6.2). */
  readonly newId: () => string;
  /** Deletes local files (photos taken for a task that was never created). */
  readonly files: FileRemover;
```

- Replace the `createExecutionStore({ … })` call with:

```ts
  // An online start or accept syncs at once (spec §1, decision 15); other changes wait 2 s for more edits.
  const onWrite = (kind: WriteKind) => (kind === 'claim' ? void engine.run('claim') : triggers?.requestSoon());
  const store = createExecutionStore({ db, clock, newId: deps.newId, device: deps.device, files: transport, feed, onWrite });
  const tasks = createTaskStore({ db, clock, newId: deps.newId, files: transport, feed, onWrite });
```

- In the returned object add `tasks,`, `newId: deps.newId,` and `files: transport,` after `store,`.

In `apps/mobile/src/offline/testing/harness.ts`:
- Add `import { createTaskStore, type TaskStore } from '../task-store';`, add `tasks: TaskStore;` to `Harness` after `store: ExecutionStore;`.
- After the `createExecutionStore(…)` line add:

```ts
  const tasks = createTaskStore({ db, clock, newId: testIds(clock), files: transport, feed, onWrite: (kind) => writes.push(kind) });
```

- Return `tasks` with the other fields: `return { db, clock, feed, transport, store, tasks, api, mediaQueue, engine, net, rejections, writes, c, seed };`.

- [ ] **Step 5: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline src/features/sync && pnpm --filter @taskop/mobile typecheck`
Expected: PASS. In the offline flow the photo is registered before the submission, then uploaded after the pull; the server copy (`completed`) replaces the draft.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/task-store.ts apps/mobile/src/offline/task-store.test.ts apps/mobile/src/offline/services.ts apps/mobile/src/offline/testing/harness.ts apps/mobile/src/features/sync/sync.test.tsx
git commit -m "feat(mobile): task store with accept, start, response media, autosaved draft and Tamamla" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Task refusals: taken, reassigned away, state changed, evidence and media

**Files:**
- Modify: `apps/mobile/src/offline/refusals.ts`, `task-records.ts`, `sync-engine.ts`, `services.ts`, `offline-provider.tsx`, `native/create-native-services.ts`, `testing/harness.ts`, `testing/test-services.ts`
- Test: `apps/mobile/src/offline/task-refusals.test.ts`, `apps/mobile/src/offline/sync-engine.test.ts` (one engine built directly gains the new callback)

**Interfaces:**
- Consumes: `forgetTask`, `revertTask` (Tasks 3–4); `classifyError` (`Failure.code`, `messageKey`).
- Produces:
  - `task-records.ts`: `interface TaskRemoved { taskId: string; title: string | null }`, `dropTaskMedium(tx, taskId, mediaId, now, errorKey: string | null): Promise<void>`.
  - `refusals.ts`: `resolveExecutionRefusal(tx, cmd, code, messageKey, now): Promise<string[]>` (SP4's permanent path, moved out of the engine), `resolveTaskRefusal(tx, cmd, code, messageKey, now): Promise<{ files: string[]; removed: TaskRemoved | null }>`; `dropMedium` handles task media.
  - `SyncEngineDeps.onTaskRemoved: (r: TaskRemoved) => void`; `ServiceDeps.onTaskRemoved`; `openNativeServices(userId, timeZone, hooks: { onClaimRejected; onTaskRemoved })`; `Harness.removedTasks`, `TestServices.removedTasks`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/offline/task-refusals.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import type { SyncTask } from '@taskop/contracts';
import { listCommands } from './outbox';
import { canEditDraft } from './task-store';
import { capturedPhoto } from './testing/fake-transport';
import { syncResponse, syncTask, T, TASK, TEAM, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

async function withTask(over: Partial<SyncTask> = {}): Promise<Harness> {
  const h = await createHarness();
  await h.seed(syncResponse({ checklistVersions: [versionOf(h.c.content)], tasks: [syncTask(over)] }));
  h.api.sync = syncResponse({ tasks: [syncTask(over)] });
  h.net.online = false; // the worker acts offline; each test goes online itself
  return h;
}
const refuse = (status: number, code: string) => async (): Promise<never> => {
  throw new ApiError(status, code as ApiError['code'], `errors.${code}`);
};
const counts = (h: Harness) =>
  h.db.first(`SELECT (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM task_drafts) AS drafts, (SELECT count(*) FROM media) AS media, (SELECT count(*) FROM outbox) AS outbox`);

describe('task refusals', () => {
  it('a teammate’s earlier accept removes the team task and tells the worker', async () => {
    const h = await withTask({ assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } });
    await h.tasks.accept(TASK);
    h.api.on('taskAccept', refuse(409, 'TASK_ALREADY_TAKEN'));
    h.api.sync = syncResponse({ tasks: [], removedTaskIds: [] }); // the server no longer lists it for this worker
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.removedTasks).toEqual([{ taskId: TASK, title: 'Soyuducunun qapısını təmir et' }]);
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('a task reassigned away while offline is removed with its queued media and files, and the notice is shown', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    await h.tasks.attachMedia(TASK, photo);
    await h.tasks.saveText(TASK, 'Hazırdır');
    expect(await h.tasks.submit(TASK)).toEqual({ ok: true });
    h.api.on('taskStart', refuse(404, 'NOT_FOUND'));
    h.api.sync = syncResponse({ tasks: [], removedTaskIds: [] });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method)).toEqual(['taskStart', 'pull']);
    expect(await counts(h)).toEqual({ tasks: 0, drafts: 0, media: 0, outbox: 0 });
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect(h.removedTasks).toEqual([{ taskId: TASK, title: 'Soyuducunun qapısını təmir et' }]);
  });

  it('TASK_STATE_INVALID refreshes the task and keeps the draft, read-only, with the note', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.saveText(TASK, 'Rezin dəyişildi');
    await h.tasks.submit(TASK);
    h.api.on('taskSubmit', async () => {
      // The manager cancelled the task while the phone was offline.
      h.api.sync = syncResponse({ tasks: [syncTask({ status: 'cancelled', rev: 9, cancelReason: 'Lazım deyil' })] });
      throw new ApiError(409, 'TASK_STATE_INVALID', 'errors.TASK_STATE_INVALID');
    });
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.map((c) => c.method).slice(0, 4)).toEqual(['taskStart', 'taskRegisterMedia', 'taskSubmit', 'pull']);
    const task = (await h.tasks.task(TASK))!;
    expect(task).toMatchObject({ status: 'cancelled', syncNote: 'errors.TASK_STATE_INVALID', unsynced: false });
    expect(task.draft).toMatchObject({ text: 'Rezin dəyişildi', submittedAt: null });
    expect(task.draft!.mediaIds).toHaveLength(1);
    expect(canEditDraft(task)).toBe(false);
    expect(h.engine.status()).toMatchObject({ failed: 0 });
  });

  it('EVIDENCE_REQUIRED reopens the draft for another photo instead of parking the submission', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.tasks.submit(TASK);
    h.api.on('taskSubmit', refuse(422, 'EVIDENCE_REQUIRED'));
    h.net.online = true;
    await h.engine.run('reconnect');
    const task = (await h.tasks.task(TASK))!;
    expect(task).toMatchObject({ status: 'in_progress', syncNote: 'errors.EVIDENCE_REQUIRED', unsynced: false });
    expect(canEditDraft(task)).toBe(true);
    expect(await listCommands(h.db)).toEqual([]);
  });

  it('a photo the server refuses for good leaves the draft and the queued submission, with a note on the task', async () => {
    const h = await withTask({ evidence: { photo: 'optional', video: 'optional', liveOnly: false } });
    await h.tasks.start(TASK);
    const photo = capturedPhoto(h.transport);
    const id = await h.tasks.attachMedia(TASK, photo);
    await h.tasks.submit(TASK);
    h.api.on('taskRegisterMedia', refuse(422, 'MEDIA_TOO_LARGE'));
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(h.api.calls.find((c) => c.method === 'taskSubmit')!.body).toMatchObject({ mediaIds: [] });
    expect(await h.tasks.refusals(TASK)).toEqual([{ mediaId: id, itemId: null, errorKey: 'errors.MEDIA_TOO_LARGE' }]);
    expect(h.transport.removed).toEqual([photo.localUri]);
    expect((await h.tasks.task(TASK))!.status).toBe('completed');
  });

  it('"Sil" on a task photo that failed to upload drops it from the draft with a note', async () => {
    const h = await withTask();
    await h.tasks.start(TASK);
    const id = await h.tasks.attachMedia(TASK, capturedPhoto(h.transport));
    await h.db.run(`DELETE FROM outbox WHERE kind = 'task.media'`);
    await h.db.run(`UPDATE media SET registered_at = ?, failed_code = 'UPLOAD_FAILED', attempts = 5`, [T.open]);
    await h.mediaQueue.discard(id);
    expect((await h.tasks.task(TASK))!.draft!.mediaIds).toEqual([]);
    expect(await h.tasks.refusals(TASK)).toEqual([{ mediaId: id, itemId: null, errorKey: 'mobile.sync.mediaErrors.UPLOAD_FAILED' }]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/task-refusals.test.ts`
Expected: FAIL. `h.removedTasks` is undefined; refused task commands are parked as failed (`failed: 1`) and the refused photo stays in the draft.

- [ ] **Step 3: Drop task media and resolve task refusals**

Append to `apps/mobile/src/offline/task-records.ts` (add `type DraftRow` to the `./local-model` import):

```ts
/** What the engine reports when a task left the phone because the server refused its work for good (spec §7.1). */
export interface TaskRemoved {
  taskId: string;
  title: string | null;
}

/**
 * A task medium the server refused for good, or the worker discarded after it failed: it leaves the draft and any queued
 * submission (so the submission does not fail on an unknown medium), and with `errorKey` the task notes why. The caller
 * has already deleted the medium's row and its registration.
 */
export async function dropTaskMedium(tx: Db, taskId: string, mediaId: string, now: number, errorKey: string | null): Promise<void> {
  const draft = await tx.first<DraftRow>('SELECT * FROM task_drafts WHERE task_id = ?', [taskId]);
  if (draft) {
    const mediaIds = (JSON.parse(draft.media_ids) as string[]).filter((x) => x !== mediaId);
    await tx.run('UPDATE task_drafts SET media_ids = ?, updated_at = ? WHERE task_id = ?', [JSON.stringify(mediaIds), iso(now), taskId]);
  }
  const queued = await tx.all<{ seq: number; payload: string }>(`SELECT seq, payload FROM outbox WHERE entity_type = 'task' AND entity_id = ? AND kind = 'task.submit'`, [taskId]);
  for (const q of queued) {
    const payload = JSON.parse(q.payload) as { mediaIds?: string[] };
    await tx.run('UPDATE outbox SET payload = ? WHERE seq = ?', [JSON.stringify({ ...payload, mediaIds: (payload.mediaIds ?? []).filter((x) => x !== mediaId) }), q.seq]);
  }
  if (errorKey) {
    await tx.run(`INSERT OR REPLACE INTO media_refusals (media_id, owner_type, owner_id, item_id, error_key, created_at) VALUES (?, 'task', ?, NULL, ?, ?)`, [
      mediaId, taskId, errorKey, iso(now),
    ]);
  }
}
```

In `apps/mobile/src/offline/refusals.ts`:
- Replace the task-records import with `import { dropTaskMedium, forgetTask, revertTask, type TaskRemoved } from './task-records';` and add `ackCommand, failCommand` to the `./outbox` import (`import { ackCommand, appendCommand, failCommand, type OutboxCommand } from './outbox';`).
- In `dropMedium`, replace `` await tx.run(`DELETE FROM outbox WHERE kind = 'media' AND ref_id = ?`, [mediaId]); `` with `` await tx.run(`DELETE FROM outbox WHERE kind IN ('media', 'task.media') AND ref_id = ?`, [mediaId]); `` and replace `if (medium.owner_type !== 'execution') return file;` with:

```ts
  if (medium.owner_type === 'task') {
    await dropTaskMedium(tx, medium.owner_id, mediaId, now, errorKey);
    return file;
  }
```

- Append:

```ts
/** SP4's permanent-refusal path for an execution command: resolved when no retry can fix it, otherwise parked as failed. Returns files to delete. */
export async function resolveExecutionRefusal(tx: Db, cmd: OutboxCommand, code: string, messageKey: string, now: number): Promise<string[]> {
  if (cmd.kind === 'media') {
    await ackCommand(tx, cmd.seq);
    const uri = cmd.refId ? await dropMedium(tx, cmd.refId, now, messageKey) : null;
    return uri ? [uri] : [];
  }
  if (cmd.kind === 'complete' && code === 'REQUIREMENTS_UNMET' && (await reopenRefusedCompletion(tx, cmd, now))) return [];
  const resolved = await resolveTerminalRefusal(tx, cmd, code, messageKey, now);
  if (resolved) return resolved;
  await failCommand(tx, cmd.seq, code, messageKey);
  return [];
}

/** Refusals of a status command that the task shows instead of a red row (decision 7). */
const SHOWN_ON_TASK: ReadonlySet<string> = new Set(['TASK_STATE_INVALID', 'EVIDENCE_REQUIRED', 'EVIDENCE_LIVE_ONLY', 'VALIDATION_FAILED', 'MEDIA_LIMIT_REACHED']);

/**
 * Spec §7.1 and Part 1 "Refusals": a task a teammate took, or one the worker can no longer read (404, reassigned away),
 * goes with everything the phone holds for it; a refused medium is dropped from the draft and the queued submission; a
 * state change or an evidence refusal reverts the task to the server's copy, keeping the draft, with the note. Anything
 * else is parked as failed. Returns the files to delete and the removed task to tell the worker about.
 */
export async function resolveTaskRefusal(
  tx: Db,
  cmd: OutboxCommand,
  code: string,
  messageKey: string,
  now: number,
): Promise<{ files: string[]; removed: TaskRemoved | null }> {
  if (code === 'TASK_ALREADY_TAKEN' || code === 'NOT_FOUND') {
    const gone = await forgetTask(tx, cmd.entityId);
    return { files: gone.files, removed: { taskId: cmd.entityId, title: gone.title } };
  }
  if (cmd.kind === 'task.media') {
    await ackCommand(tx, cmd.seq);
    const uri = cmd.refId ? await dropMedium(tx, cmd.refId, now, messageKey) : null;
    return { files: uri ? [uri] : [], removed: null };
  }
  if (SHOWN_ON_TASK.has(code)) await revertTask(tx, cmd.entityId, messageKey, now);
  else await failCommand(tx, cmd.seq, code, messageKey);
  return { files: [], removed: null };
}
```

- [ ] **Step 4: Report removed tasks from the engine to the worker**

In `apps/mobile/src/offline/sync-engine.ts`:
- The refusals import becomes `import { discardFailedCommand, requeueRevision, resolveExecutionRefusal, resolveTaskRefusal } from './refusals';` (`dropMedium`, `reopenRefusedCompletion` and `resolveTerminalRefusal` are now used only inside `refusals.ts`), drop `failCommand` from the `./outbox` import (no longer used here), and add `type TaskRemoved` to the `./task-records` import.
- Add to `SyncEngineDeps` after `onClaimRejected`:

```ts
  /** A task left the phone because a teammate took it or it was reassigned away ("Bu tapşırığı artıq başqası qəbul edib"). */
  onTaskRemoved: (r: TaskRemoved) => void;
```

- Add `onTaskRemoved` to the destructuring at the top of `createSyncEngine`.
- In `push`, replace the whole `if (f.kind === 'permanent') { … }` block with:

```ts
        if (f.kind === 'permanent') {
          const now = clock.now();
          const outcome = await ownedTransaction(db, userId, async (tx): Promise<{ files: string[]; removed: TaskRemoved | null }> =>
            cmd.entityType === 'task'
              ? resolveTaskRefusal(tx, cmd, f.code, f.messageKey, now)
              : { files: await resolveExecutionRefusal(tx, cmd, f.code, f.messageKey, now), removed: null },
          );
          if (outcome === NOT_OWNER) return 'ok';
          outcome.files.forEach(removeFile);
          feed.emit();
          if (outcome.removed) onTaskRemoved(outcome.removed);
          continue;
        }
```

In `apps/mobile/src/offline/sync-engine.test.ts`, the engine built directly in `an error before the push (the local lock) backs off like a network failure` gets `onTaskRemoved: () => undefined,` after `onClaimRejected: () => undefined,`.

In `apps/mobile/src/offline/services.ts`:
- Add `import type { TaskRemoved } from './task-records';`, add `onTaskRemoved: (r: TaskRemoved) => void;` to `ServiceDeps` after `onClaimRejected`, and pass `onTaskRemoved: deps.onTaskRemoved,` to `createSyncEngine` after `onClaimRejected`.

In `apps/mobile/src/offline/testing/harness.ts`:
- Import `type TaskRemoved` from `../task-records`, add `removedTasks: TaskRemoved[];` to `Harness`, create `const removedTasks: TaskRemoved[] = [];` next to `rejections`, pass `onTaskRemoved: (r) => removedTasks.push(r),` to `createSyncEngine`, and return `removedTasks`.

In `apps/mobile/src/offline/testing/test-services.ts`:
- Import `type TaskRemoved` from `../task-records`, add `removedTasks: TaskRemoved[];` to `TestServices`, create `const removedTasks: TaskRemoved[] = [];`, pass `onTaskRemoved: (r) => removedTasks.push(r)` in the `createOfflineServices` deps, and return `removedTasks`.

In `apps/mobile/src/offline/native/create-native-services.ts`:
- Import `type TaskRemoved` from `../task-records`; the `hooks` parameter becomes `hooks: { onClaimRejected: (r: ClaimRejection) => void; onTaskRemoved: (r: TaskRemoved) => void }`, and `onTaskRemoved: hooks.onTaskRemoved,` is passed after `onClaimRejected`.

In `apps/mobile/src/offline/offline-provider.tsx`, the `openNativeServices` call becomes:

```ts
    const session = openNativeServices(userId, timeZone, {
      onClaimRejected: (r) => Alert.alert(claimRejectionText(i18n.getFixedT(null, 'translation'), r.reason, r.byName)),
      // Spec §7.1: the task is gone from the phone; its title says which one.
      onTaskRemoved: (r) => Alert.alert(i18n.t('tasks.alreadyTaken'), r.title ?? undefined),
    });
```

- [ ] **Step 5: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck`
Expected: PASS: every SP4 refusal test still passes through `resolveExecutionRefusal`, and the six task refusal tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/refusals.ts apps/mobile/src/offline/task-records.ts apps/mobile/src/offline/sync-engine.ts apps/mobile/src/offline/sync-engine.test.ts apps/mobile/src/offline/services.ts apps/mobile/src/offline/offline-provider.tsx apps/mobile/src/offline/native/create-native-services.ts apps/mobile/src/offline/testing/harness.ts apps/mobile/src/offline/testing/test-services.ts apps/mobile/src/offline/task-refusals.test.ts
git commit -m "feat(mobile): resolve task refusals: taken or reassigned tasks go, state changes keep the draft" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Tapşırıqlar tab: sections, rows and the Home card

**Files:**
- Create: `apps/mobile/src/features/tasks/group-tasks.ts`, `group-tasks.test.ts`, `task-row.tsx`, `tasks-screen.tsx`, `tasks-screen.test.tsx`, `apps/mobile/app/(app)/tasks.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`, `apps/mobile/src/features/home/home-screen.tsx`
- Test: `apps/mobile/src/features/home/home-screen.test.tsx`

**Interfaces:**
- Consumes: `TaskView`, `isTeamOffer`, `isTaskOverdue` (Task 6); `services.tasks.tasks()`; `useLiveQuery`, `useNow`; `formatDateTime` (`@taskop/i18n`); `az.tasks.statuses.*`, `az.tasks.flags.overdue`, `az.mobile.tasks.*`.
- Produces:
  - `TASK_GROUP_KEYS = ['team', 'mine', 'inReview', 'done']`, `type TaskGroups = Record<TaskGroupKey, TaskView[]>`, `groupTasks(tasks, now): TaskGroups`, `taskCounts(groups, now): { open: number; overdue: number }`.
  - `Badge({ text, tone? })` and `TaskRow({ task, now, timeZone, onPress })` (testID `task-<id>`).
  - `TasksScreen` (section headers have testID `section-<key>`), route `/tasks`, the Tapşırıqlar tab between Home and Profile, and the Home card (testID `home-tasks`).

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/features/tasks/group-tasks.test.ts`:

```ts
import type { SyncTask, TaskStatus } from '@taskop/contracts';
import type { TaskView } from '@/offline/task-store';
import { syncTask, T, TASK, TASK2, TASK3, TASK4, TASK5, TEAM } from '@/offline/testing/fixtures';
import { groupTasks, taskCounts } from './group-tasks';

const NOW = Date.parse(T.open);
const team = { id: TEAM, name: 'Texniki xidmət' };
const view = (over: Partial<SyncTask>, status?: TaskStatus): TaskView => {
  const server = syncTask(over);
  return {
    id: server.id, server, status: status ?? server.status, rev: server.rev, syncNote: null, receivedAt: T.open, updatedAt: T.open,
    draft: null, unsynced: false, failedKey: null,
  };
};
const ids = (xs: TaskView[]) => xs.map((x) => x.id);

describe('groupTasks', () => {
  it('puts team offers, my open tasks (overdue first, then by due date) and counts the Home card', () => {
    const g = groupTasks(
      [
        view({ id: TASK, dueAt: '2026-11-04T10:00:00.000Z' }),
        view({ id: TASK2, dueAt: null }),
        view({ id: TASK3, dueAt: '2026-11-03T10:00:00.000Z' }),
        view({ id: TASK4, dueAt: T.before }), // past due by the phone's clock, before the sweep flagged it
        view({ id: TASK5, assignee: null, team }),
      ],
      NOW,
    );
    expect(ids(g.team)).toEqual([TASK5]);
    expect(ids(g.mine)).toEqual([TASK4, TASK3, TASK, TASK2]);
    expect(g.inReview).toEqual([]);
    expect(g.done).toEqual([]);
    expect(taskCounts(g, NOW)).toEqual({ open: 4, overdue: 1 });
  });

  it('moves a team task accepted on this phone to Mənim, and sorts tasks in review and closed ones', () => {
    const g = groupTasks(
      [
        view({ id: TASK, assignee: null, team }, 'accepted'),
        view({ id: TASK2, status: 'awaiting_review' }),
        view({ id: TASK3, status: 'completed', updatedAt: '2026-11-01T10:00:00.000Z', overdueAt: '2026-10-31T10:00:00.000Z' }),
        view({ id: TASK4, status: 'cancelled', updatedAt: '2026-11-02T03:00:00.000Z' }),
        view({ id: TASK5 }, 'awaiting_review'), // submitted on this phone, not yet synced
      ],
      NOW,
    );
    expect(ids(g.team)).toEqual([]);
    expect(ids(g.mine)).toEqual([TASK]);
    expect(ids(g.inReview)).toEqual([TASK2, TASK5]);
    expect(ids(g.done)).toEqual([TASK4, TASK3]);
    expect(taskCounts(g, NOW)).toEqual({ open: 1, overdue: 0 });
  });
});
```

Create `apps/mobile/src/features/tasks/tasks-screen.test.tsx`:

```tsx
import { fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { syncResponse, syncTask, T, TASK, TASK2, TASK3, TASK4, TASK5, TEAM, versionOf } from '@/offline/testing/fixtures';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TasksScreen } from './tasks-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

beforeEach(() => mockPush.mockClear());

async function world() {
  const t = await createTestServices();
  await t.seed(
    syncResponse({
      checklistVersions: [versionOf(t.c.content)],
      tasks: [
        syncTask({ id: TASK, title: 'Qapını təmir et' }),
        syncTask({ id: TASK2, title: 'Rəfi bərkit', dueAt: T.before }),
        syncTask({ id: TASK3, title: 'Lampanı dəyiş', assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } }),
        syncTask({ id: TASK4, title: 'Kassanı yoxla', status: 'awaiting_review' }),
        syncTask({ id: TASK5, title: 'Anbarı təmizlə', status: 'completed', completedAt: T.open }),
      ],
    }),
  );
  return t;
}

describe('Tapşırıqlar', () => {
  it('lists my tasks in the spec sections with due dates, status, overdue and sync badges', async () => {
    const t = await world();
    await t.services.tasks.start(TASK);
    await renderWithServices(t.services, <TasksScreen />);
    const headers = { team: 'Komanda üçün', mine: 'Mənim', inReview: 'Yoxlamada', done: 'Tamamlanıb' };
    for (const [key, title] of Object.entries(headers)) expect((await screen.findByTestId(`section-${key}`)).props.children).toBe(title);
    expect(screen.getAllByTestId(/^task-/).map((e) => e.props.testID)).toEqual([`task-${TASK3}`, `task-${TASK2}`, `task-${TASK}`, `task-${TASK4}`, `task-${TASK5}`]);
    expect(within(screen.getByTestId(`task-${TASK3}`)).getByText('Komanda: Texniki xidmət')).toBeTruthy();
    expect(within(screen.getByTestId(`task-${TASK2}`)).getByText('Gecikib')).toBeTruthy();
    const started = within(screen.getByTestId(`task-${TASK}`));
    expect(started.getByText('İcradadır')).toBeTruthy();
    expect(started.getByText('Göndərilməyib')).toBeTruthy();
    expect(started.getByText(/^Son tarix: /)).toBeTruthy();
    expect(within(screen.getByTestId(`task-${TASK5}`)).getByText('Tamamlanıb')).toBeTruthy();
  });

  it('opens a task by its id', async () => {
    const t = await world();
    await renderWithServices(t.services, <TasksScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Rəfi bərkit' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK2 } });
  });
});
```

Append to `apps/mobile/src/features/home/home-screen.test.tsx` (extend the fixtures import with `syncTask`, `T`, `TASK`, `TASK2`, `TASK3`, `TEAM`):

```tsx
describe('Home task card', () => {
  it('counts my open and overdue tasks, not my team’s offers, and opens the tasks tab', async () => {
    const t = await createTestServices();
    await t.seed(
      syncResponse({
        checklistVersions: [versionOf(t.c.content)],
        tasks: [
          syncTask({ dueAt: T.before }),
          syncTask({ id: TASK2, dueAt: null }),
          syncTask({ id: TASK3, assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } }),
        ],
      }),
    );
    await renderWithServices(t.services, <HomeScreen />);
    const card = await screen.findByTestId('home-tasks');
    expect(await within(card).findByText('Açıq: 2')).toBeTruthy();
    expect(within(card).getByText('Gecikmiş: 1')).toBeTruthy();
    await fireEvent.press(card);
    expect(mockPush).toHaveBeenCalledWith('/tasks');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks src/features/home`
Expected: FAIL. `./group-tasks` and `./tasks-screen` do not exist; Home has no `home-tasks` card.

- [ ] **Step 3: Group the tasks**

Create `apps/mobile/src/features/tasks/group-tasks.ts`:

```ts
import { isFinalTaskStatus } from '@taskop/contracts';
import { isTaskOverdue, isTeamOffer, type TaskView } from '@/offline/task-store';

export const TASK_GROUP_KEYS = ['team', 'mine', 'inReview', 'done'] as const;
export type TaskGroupKey = (typeof TASK_GROUP_KEYS)[number];
export type TaskGroups = Record<TaskGroupKey, TaskView[]>;

const dueMs = (t: TaskView): number => (t.server.dueAt ? Date.parse(t.server.dueAt) : Number.POSITIVE_INFINITY);
/** By due date (none last), then by creation. Two tasks without a due date compare as NaN, which falls through. */
const byDue = (a: TaskView, b: TaskView): number => dueMs(a) - dueMs(b) || a.server.createdAt.localeCompare(b.server.createdAt);

/**
 * Spec §7.2: Komanda üçün (unaccepted team tasks), Mənim (overdue first, then by due date), Yoxlamada (awaiting review),
 * Tamamlanıb (completed or cancelled; /me/sync keeps them 7 days), newest first.
 */
export function groupTasks(tasks: readonly TaskView[], now: number): TaskGroups {
  const groups: TaskGroups = { team: [], mine: [], inReview: [], done: [] };
  for (const t of tasks) {
    if (isTeamOffer(t)) groups.team.push(t);
    else if (isFinalTaskStatus(t.status)) groups.done.push(t);
    else if (t.status === 'awaiting_review') groups.inReview.push(t);
    else groups.mine.push(t);
  }
  groups.team.sort(byDue);
  groups.mine.sort((a, b) => Number(isTaskOverdue(b, now)) - Number(isTaskOverdue(a, now)) || byDue(a, b));
  groups.inReview.sort(byDue);
  groups.done.sort((a, b) => b.server.updatedAt.localeCompare(a.server.updatedAt));
  return groups;
}

/** The Home card (decision 14): my open tasks (Mənim) and how many of them are overdue. */
export function taskCounts(groups: TaskGroups, now: number): { open: number; overdue: number } {
  return { open: groups.mine.length, overdue: groups.mine.filter((t) => isTaskOverdue(t, now)).length };
}
```

- [ ] **Step 4: Write the row and the tab**

Create `apps/mobile/src/features/tasks/task-row.tsx`:

```tsx
import { formatDateTime } from '@taskop/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { isTaskOverdue, isTeamOffer, type TaskView } from '@/offline/task-store';

const TONES = { neutral: colors.muted, warning: colors.warning, danger: colors.danger, success: colors.success } as const;

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: keyof typeof TONES }) {
  return (
    <View style={[styles.badge, { borderColor: TONES[tone] }]}>
      <Text style={[styles.badgeText, { color: TONES[tone] }]}>{text}</Text>
    </View>
  );
}

/** Spec §7.2: title, site, due date, status, overdue and sync badges. */
export function TaskRow({ task, now, timeZone, onPress }: { task: TaskView; now: number; timeZone: string; onPress: () => void }) {
  const { t } = useTranslation();
  const s = task.server;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={s.title} testID={`task-${task.id}`} onPress={onPress} style={styles.card}>
      <Text style={styles.title}>{s.title}</Text>
      {s.site ? <Text style={styles.muted}>{s.site.name}</Text> : null}
      {isTeamOffer(task) && s.team ? <Text style={styles.muted}>{t('mobile.tasks.team', { name: s.team.name })}</Text> : null}
      <Text style={styles.muted}>{s.dueAt ? t('mobile.tasks.due', { time: formatDateTime(s.dueAt, { locale: 'az', timeZone }) }) : t('mobile.tasks.noDue')}</Text>
      <View style={styles.badges}>
        <Badge text={t(`tasks.statuses.${task.status}`)} tone={task.status === 'completed' ? 'success' : 'neutral'} />
        {isTaskOverdue(task, now) ? <Badge text={t('tasks.flags.overdue')} tone="danger" /> : null}
        {task.failedKey ? (
          <Badge text={t('mobile.tasks.syncFailed')} tone="danger" />
        ) : task.unsynced ? (
          <Badge text={t('mobile.tasks.syncPending')} tone="warning" />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
```

Create `apps/mobile/src/features/tasks/tasks-screen.tsx`:

```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useLiveQuery, useNow } from '@/offline/hooks';
import { groupTasks, TASK_GROUP_KEYS } from './group-tasks';
import { TaskRow } from './task-row';

/** Spec §7.2: the Tapşırıqlar tab. */
export function TasksScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const now = useNow();
  const list = useLiveQuery((s) => s.tasks.tasks(), []);
  const groups = list ? groupTasks(list, now) : null;
  const open = (id: string) => router.push({ pathname: '/task/[id]', params: { id } });
  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.heading}>{t('mobile.tasks.title')}</Text>
        <SyncIndicator />
      </View>
      {groups ? (
        TASK_GROUP_KEYS.map((key) => (
          <View key={key} style={styles.group}>
            <Text testID={`section-${key}`} style={styles.section}>
              {t(`mobile.tasks.sections.${key}`)}
            </Text>
            {groups[key].length === 0 ? (
              <Text style={styles.muted}>{t('mobile.tasks.empty')}</Text>
            ) : (
              groups[key].map((task) => <TaskRow key={task.id} task={task} now={now} timeZone={services.timeZone} onPress={() => open(task.id)} />)
            )}
          </View>
        ))
      ) : (
        <ActivityIndicator color={colors.primary} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
});
```

Create `apps/mobile/app/(app)/tasks.tsx`:

```tsx
import { TasksScreen } from '@/features/tasks/tasks-screen';

export default TasksScreen;
```

In `apps/mobile/app/(app)/_layout.tsx`, add the tab between the `index` and `profile` screens:

```tsx
        <Tabs.Screen name="tasks" options={{ title: t('mobile.tabs.tasks'), tabBarIcon: ({ color, size }) => <Ionicons name="clipboard-outline" color={color} size={size} /> }} />
```

- [ ] **Step 5: Add the Home card**

In `apps/mobile/src/features/home/home-screen.tsx`:
- Add `Pressable` to the `react-native` import and `import { groupTasks, taskCounts } from '@/features/tasks/group-tasks';`.
- After the `const problems = useLiveQuery(…)` line add:

```tsx
  const tasks = useLiveQuery((x) => x.tasks.tasks(), []);
  const taskStats = tasks ? taskCounts(groupTasks(tasks, now), now) : null;
```

- After the closing `</View>` of the tiles grid (`styles.grid`) add:

```tsx
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('mobile.tasks.home.title')}
        testID="home-tasks"
        onPress={() => router.push('/tasks')}
        style={styles.tasks}
      >
        <Text style={styles.section}>{t('mobile.tasks.home.title')}</Text>
        <View style={styles.taskCounts}>
          <Text style={styles.tileLabel}>{t('mobile.tasks.home.open', { count: taskStats?.open ?? 0 })}</Text>
          <Text style={[styles.tileLabel, { color: colors.danger }]}>{t('mobile.tasks.home.overdue', { count: taskStats?.overdue ?? 0 })}</Text>
        </View>
      </Pressable>
```

- Add to `styles`:

```ts
  tasks: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  taskCounts: { flexDirection: 'row', gap: spacing.md },
```

- [ ] **Step 6: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS, the existing Home tests included.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/features/tasks apps/mobile/app/'(app)'/tasks.tsx apps/mobile/app/'(app)'/_layout.tsx apps/mobile/src/features/home/home-screen.tsx apps/mobile/src/features/home/home-screen.test.tsx
git commit -m "feat(mobile): Tapşırıqlar tab with spec sections and a Home task card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Task screen: instructions, problem, Qəbul et / Başla, response, evidence and Tamamla

**Files:**
- Create: `apps/mobile/src/features/tasks/screen-header.tsx`, `remote-media.tsx`, `task-screen.tsx`, `task-screen.test.tsx`, `apps/mobile/app/(app)/task/[id].tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `services.tasks.{task, media, refusals, accept, start, attachMedia, removeMedia, saveText, submit}`, `canEditDraft`, `isTaskOverdue`, `RESPONSE_LIMITS`, `TaskStateError` (Task 6); `services.mediaQueue.discard`, `services.engine.refresh`; SP4's `CaptureModal`, `pickFromGallery`, `VideoPreview`, `CaptureError`, `EvidenceRow`, `CommitInput`, `notAcceptedText`, `fileNotAcceptedText`, `mediaErrorKey`; `api.taskMedia.url`, `api.tasks.problemMediaUrl` (Part 1 Task 4); `ProblemDto.media`, `TaskMediaDto.status`, `MediaStatus` (Part 1).
- Produces:
  - `ScreenHeader({ title })` (back button and title).
  - `type RemoteMedia = { id: string; kind: MediaKind; status: MediaStatus }`; `RemoteMediaStrip({ items: RemoteMedia[]; load: (id: string) => Promise<MediaUrl> })` (thumbnails with testID `remote-<id>`; `pending` items are drawn with testID `pending-<id>` and never loaded; offline text `mobile.tasks.detail.mediaOffline`).
  - `TaskScreen({ taskId })`, route `/task/[id]` (hidden tab screen).

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/features/tasks/task-screen.test.tsx`:

```tsx
import type { ProblemDto, SyncTask } from '@taskop/contracts';
import { fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { CHECKLIST, ME_REF, OCC, OTHER, SITE, syncResponse, syncTask, T, TASK, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { TaskScreen } from './task-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
const mockUrl = jest.fn();
const mockProblemUrl = jest.fn();
jest.mock('@/lib/session', () => ({
  api: {
    taskMedia: { url: (...a: unknown[]) => mockUrl(...a) },
    tasks: { problemMediaUrl: (...a: unknown[]) => mockProblemUrl(...a) },
  },
}));

const PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e90';
const PROBLEM_PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e91';
const PROBLEM_VIDEO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e95';

async function opened(over: Partial<SyncTask> = {}, o: { online?: boolean } = {}): Promise<TestServices> {
  const t = await createTestServices({ online: o.online });
  await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask(over)] }));
  await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
  await screen.findByText(over.title ?? 'Soyuducunun qapısını təmir et');
  return t;
}
const gallery = () => (jest.requireMock('@/features/execution/capture') as { pickFromGallery: jest.Mock }).pickFromGallery;

beforeEach(() => jest.clearAllMocks());

describe('TaskScreen', () => {
  it('offers Qəbul et and Başla on a new task; Başla accepts and starts it', async () => {
    const t = await opened();
    expect(screen.getByText('Qapının rezinini dəyişin.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Qəbul et' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Başla' }));
    await eventually(async () => expect((await t.services.tasks.task(TASK))!.status).toBe('in_progress'));
    expect(await screen.findByLabelText('Cavab')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Qəbul et' })).toBeNull();
  });

  it('keeps Tamamla disabled with the reason until the required photo is attached, then completes', async () => {
    const t = await opened({ status: 'in_progress' });
    expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Ən azı bir foto əlavə edin.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Cavab'), 'Rezin dəyişildi');
    await fireEvent(screen.getByLabelText('Cavab'), 'blur');
    gallery().mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Foto: Qalereya' }));
    await eventually(async () => expect(screen.queryByText('Ən azı bir foto əlavə edin.')).toBeNull());
    await eventually(async () => expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    expect(await screen.findByText('Cavab göndərildi.')).toBeTruthy();
    const task = (await t.services.tasks.task(TASK))!;
    expect(task.status).toBe('completed');
    expect(task.draft).toMatchObject({ text: 'Rezin dəyişildi', mediaIds: [expect.any(String)] });
  });

  it('offers only the camera on a live-only task and no chip for a kind it does not take', async () => {
    await opened({ status: 'in_progress', evidence: { photo: 'required', video: 'none', liveOnly: true } });
    expect(screen.getByRole('button', { name: 'Foto: Kamera' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Foto: Qalereya' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Video:/ })).toBeNull();
  });

  it('shows the reviewer’s comment after a rejection, and the problem the task fixes with its photo when online', async () => {
    mockProblemUrl.mockResolvedValue({ url: `http://files.test/taskop-media/${PROBLEM_PHOTO}?X-Amz-Signature=x`, expiresAt: T.due });
    const problem: ProblemDto = {
      id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e92', executionId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e50', occurrenceId: OCC, localDate: '2026-11-02',
      siteId: SITE, siteName: 'Bakı filialı 1', checklistId: CHECKLIST, checklistName: 'Açılış yoxlaması', itemId: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e93',
      itemLabel: 'Soyuducuda problem varmı?', source: 'manual', severity: 'critical', note: 'Qapı bağlanmır', mediaIds: [PROBLEM_PHOTO, PROBLEM_VIDEO],
      media: [
        { id: PROBLEM_PHOTO, kind: 'photo', status: 'uploaded' },
        { id: PROBLEM_VIDEO, kind: 'video', status: 'pending' },
      ],
      executorName: 'Aysel Əliyeva', createdAt: T.open, resolution: 'open', taskId: TASK, executionState: 'completed',
    };
    await opened(
      {
        status: 'in_progress', source: 'problem', problemId: problem.id, problem,
        submissions: [
          {
            id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e94', submittedBy: ME_REF, text: 'Hazırdır', mediaIds: [],
            submittedAt: T.open, receivedAt: T.open, reviewDecision: 'rejected', reviewComment: 'Foto bulanıqdır', reviewedBy: null, reviewedAt: T.open,
          },
        ],
      },
      { online: true },
    );
    expect(screen.getByText('Geri qaytarıldı: Foto bulanıqdır')).toBeTruthy();
    expect(screen.getByText('Açılış yoxlaması · Bakı filialı 1')).toBeTruthy();
    expect(screen.getByText('Qapı bağlanmır')).toBeTruthy();
    // The kind comes from ProblemDto.media, not from the URL; the pending video is drawn but never signed.
    expect(await screen.findByTestId(`remote-${PROBLEM_PHOTO}`)).toBeTruthy();
    expect(screen.getByTestId(`pending-${PROBLEM_VIDEO}`)).toBeTruthy();
    expect(screen.getByLabelText('Video hələ yüklənməyib')).toBeTruthy();
    expect(mockProblemUrl.mock.calls).toEqual([[TASK, PROBLEM_PHOTO]]);
  });

  it('shows instruction photos only when online', async () => {
    const instruction = {
      id: PHOTO, role: 'instruction' as const, submissionId: null, kind: 'photo' as const, source: 'camera' as const, mime: 'image/jpeg', bytes: 10,
      width: 1600, height: 1200, durationMs: null, capturedAt: T.open, capturedBy: { id: OTHER, fullName: 'Murad Həsənov' }, status: 'uploaded' as const, uploadedAt: T.open,
    };
    await opened({ media: [instruction] });
    expect(screen.getByText('Fayllar internet olanda görünəcək.')).toBeTruthy();
    expect(mockUrl).not.toHaveBeenCalled();
  });

  it('keeps a draft the server refused read-only with the note, and lets the worker discard a photo that failed to upload', async () => {
    const t = await createTestServices();
    await t.seed(syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask({ status: 'in_progress' })] }));
    const id = await t.services.tasks.attachMedia(TASK, capturedPhoto(t.transport));
    await t.services.tasks.saveText(TASK, 'Rezin dəyişildi');
    await t.db.run(`DELETE FROM outbox`);
    await t.db.run(`UPDATE media SET registered_at = ?, failed_code = 'UPLOAD_FAILED', attempts = 5`, [T.open]);
    await t.db.run(`UPDATE tasks SET local_status = 'cancelled', sync_note = 'errors.TASK_STATE_INVALID'`);
    await renderWithServices(t.services, <TaskScreen taskId={TASK} />);
    expect(await screen.findByText('Server qəbul etmədi: Tapşırığın vəziyyəti dəyişib; bu əməliyyat artıq mümkün deyil.')).toBeTruthy();
    expect(screen.getByText('Bu cavab göndərilə bilmədi və artıq dəyişdirilə bilməz.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tamamla' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sil: Foto' }));
    await eventually(async () => expect((await t.services.tasks.task(TASK))!.draft!.mediaIds).not.toContain(id));
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks/task-screen.test.tsx`
Expected: FAIL: `./task-screen` does not exist.

- [ ] **Step 3: Write the header and the remote media strip**

Create `apps/mobile/src/features/tasks/screen-header.tsx`:

```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';

export function ScreenHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, flexShrink: 1 },
});
```

Create `apps/mobile/src/features/tasks/remote-media.tsx`:

```tsx
import type { MediaKind, MediaStatus, MediaUrl } from '@taskop/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { VideoPreview } from '@/features/execution/capture';
import { colors, spacing } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';

/** A medium the server holds, as `TaskMediaDto` and `ProblemDto.media` describe it (decision 12). */
export interface RemoteMedia {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
}

/**
 * Media the server holds (instructions, a problem's photos, a submission's files): presigned GET URLs, fetched while
 * online, for uploaded media only. A pending medium (not uploaded yet, or purged) is drawn as such and never signed.
 * A tap plays a video.
 */
export function RemoteMediaStrip({ items, load }: { items: RemoteMedia[]; load: (id: string) => Promise<MediaUrl> }) {
  const { t } = useTranslation();
  const { online } = useSyncStatus();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const uploaded = items.filter((i) => i.status === 'uploaded');
  const key = uploaded.map((i) => i.id).join(',');
  useEffect(() => {
    if (!online || uploaded.length === 0) return;
    let alive = true;
    Promise.all(uploaded.map(async (i) => [i.id, (await load(i.id)).url] as const)).then(
      (pairs) => {
        if (alive) setUrls(Object.fromEntries(pairs));
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
    // `key` stands for the uploaded items; `load` is a new closure on every render. The repo's ESLint has no react-hooks plugin.
  }, [online, key]);
  if (items.length === 0) return null;
  if (failed) return <Text style={styles.muted}>{t('mobile.tasks.detail.mediaFailed')}</Text>;
  if (!online && uploaded.length > 0 && Object.keys(urls).length === 0) return <Text style={styles.muted}>{t('mobile.tasks.detail.mediaOffline')}</Text>;
  return (
    <View style={styles.strip}>
      {items.map((item, n) => {
        const kind = t(`executions.mediaKinds.${item.kind}`);
        if (item.status === 'pending') {
          return (
            <View key={item.id} testID={`pending-${item.id}`} accessibilityLabel={t('executions.media.pendingLabel', { kind })} style={styles.thumb}>
              <Text style={styles.pending}>{t('executions.media.pending')}</Text>
            </View>
          );
        }
        const url = urls[item.id];
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${kind} ${n + 1}`}
            onPress={() => {
              if (url && item.kind === 'video') setPlaying(url);
            }}
            style={styles.thumb}
          >
            {!url ? (
              <ActivityIndicator color={colors.primary} />
            ) : item.kind === 'photo' ? (
              <Image testID={`remote-${item.id}`} source={{ uri: url }} style={styles.image} />
            ) : (
              <Text testID={`remote-${item.id}`} style={styles.play}>
                ▶
              </Text>
            )}
          </Pressable>
        );
      })}
      {playing ? <VideoPreview uri={playing} onClose={() => setPlaying(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: 72, height: 72 },
  play: { fontSize: 24, color: colors.text },
  pending: { fontSize: 12, color: colors.muted, textAlign: 'center', padding: spacing.xs },
  muted: { color: colors.muted },
});
```

- [ ] **Step 4: Write the task screen and its route**

Create `apps/mobile/src/features/tasks/task-screen.tsx`:

```tsx
import { MEDIA_KINDS, type MediaKind, type MediaSource, TASK_LIMITS, taskEvidenceMet } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CommitInput } from '@/components/commit-input';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { CaptureModal, pickFromGallery, VideoPreview } from '@/features/execution/capture';
import { CaptureError } from '@/features/execution/media-capture';
import { EvidenceRow } from '@/features/execution/parts';
import { fileNotAcceptedText, notAcceptedText } from '@/features/sync/refusal-text';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { LiveOnlyError, MediaLimitError } from '@/offline/execution-store';
import { useLiveQuery, useNow } from '@/offline/hooks';
import { mediaErrorKey } from '@/offline/media-queue';
import { canEditDraft, isTaskOverdue, RESPONSE_LIMITS, TaskStateError } from '@/offline/task-store';
import { RemoteMediaStrip } from './remote-media';
import { ScreenHeader } from './screen-header';
import { Badge } from './task-row';

/** Spec §7.2 task detail: instructions, the problem it fixes, Qəbul et / Başla, the response, evidence chips and Tamamla. */
export function TaskScreen({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { tasks, mediaQueue, engine, timeZone } = useOffline();
  const now = useNow();
  const data = useLiveQuery(
    async (s) => {
      const task = await s.tasks.task(taskId);
      return task ? { task, media: await s.tasks.media(taskId), refusals: await s.tasks.refusals(taskId) } : null;
    },
    [taskId],
  );
  const [camera, setCamera] = useState<MediaKind | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const report = (e: unknown) => {
    if (e instanceof MediaLimitError || e instanceof LiveOnlyError) Alert.alert(t('mobile.evidence.limitReached'));
    else if (e instanceof CaptureError) Alert.alert(t(`mobile.evidence.${e.problem}`));
    else if (e instanceof TaskStateError) Alert.alert(t('errors.TASK_STATE_INVALID'));
    else Alert.alert(t('mobile.evidence.failed'));
  };
  const run = (job: () => Promise<unknown>) => {
    setBusy(true);
    void job()
      .catch(report)
      .finally(() => setBusy(false));
  };

  if (data === undefined) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }
  if (data === null) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.title')} />
        <Text style={styles.muted}>{t('mobile.tasks.detail.notFound')}</Text>
      </Screen>
    );
  }

  const { task, media, refusals } = data;
  const s = task.server;
  const editable = canEditDraft(task);
  const draftIds = task.draft?.mediaIds ?? [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const evidence = taskEvidenceMet(s.evidence, draftIds.flatMap((id) => mediaById.get(id) ?? []));
  const failed = media.filter((m) => m.failedCode !== null && m.uploadedAt === null);
  const last = s.submissions.at(-1) ?? null;
  const rejection = task.status === 'in_progress' && last?.reviewDecision === 'rejected' ? (last.reviewComment ?? '') : null;
  const notes = [task.syncNote, task.failedKey].filter((k): k is string => k !== null).map((k) => notAcceptedText(t, k));

  const startCapture = (kind: MediaKind, source: MediaSource) => {
    if (source === 'camera') {
      setCamera(kind);
      return;
    }
    run(async () => {
      const picked = await pickFromGallery(kind);
      if (picked) await tasks.attachMedia(taskId, picked);
    });
  };
  const confirmRemove = (mediaId: string) =>
    Alert.alert(t('mobile.evidence.removeTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.evidence.remove'), style: 'destructive', onPress: () => run(() => tasks.removeMedia(taskId, mediaId)) },
    ]);
  const complete = () =>
    run(async () => {
      const r = await tasks.submit(taskId);
      if (!r.ok) Alert.alert(r.missing.map((k) => t(`tasks.issues.${k}Required`)).join('\n'));
    });

  return (
    <Screen>
      <ScreenHeader title={s.title} />
      <View style={styles.badges}>
        <Badge text={t(`tasks.statuses.${task.status}`)} />
        {isTaskOverdue(task, now) ? <Badge text={t('tasks.flags.overdue')} tone="danger" /> : null}
        {s.priority === 'high' ? <Badge text={t('tasks.priorities.high')} tone="warning" /> : null}
      </View>
      {notes.map((n) => (
        <Text key={n} style={styles.warning}>
          {n}
        </Text>
      ))}
      {rejection !== null ? <Text style={styles.warning}>{t('mobile.tasks.detail.rejected', { comment: rejection })}</Text> : null}
      {task.status === 'cancelled' && s.cancelReason ? <Text style={styles.warning}>{t('mobile.tasks.detail.cancelled', { reason: s.cancelReason })}</Text> : null}
      {s.site ? <Text style={styles.muted}>{s.site.name}</Text> : null}
      {s.team ? <Text style={styles.muted}>{t('mobile.tasks.team', { name: s.team.name })}</Text> : null}
      <Text style={styles.muted}>{s.dueAt ? t('mobile.tasks.due', { time: formatDateTime(s.dueAt, { locale: 'az', timeZone }) }) : t('mobile.tasks.noDue')}</Text>

      <Text style={styles.label}>{t('mobile.tasks.detail.instructions')}</Text>
      <Text style={styles.text}>{s.instructions || t('mobile.tasks.detail.noInstructions')}</Text>
      <RemoteMediaStrip
        items={s.media.filter((m) => m.role === 'instruction').map((m) => ({ id: m.id, kind: m.kind, status: m.status }))}
        load={(id) => api.taskMedia.url(id)}
      />

      {s.problem ? (
        <View testID="task-problem" style={styles.card}>
          <Text style={styles.label}>{t('mobile.tasks.detail.problem')}</Text>
          <Text style={styles.muted}>{`${s.problem.checklistName} · ${s.problem.siteName}`}</Text>
          {s.problem.itemLabel ? <Text style={styles.text}>{s.problem.itemLabel}</Text> : null}
          <View style={styles.badges}>
            <Badge text={t(`executions.severities.${s.problem.severity}`)} tone={s.problem.severity === 'critical' ? 'danger' : 'warning'} />
          </View>
          {s.problem.note ? <Text style={styles.text}>{s.problem.note}</Text> : null}
          <RemoteMediaStrip items={s.problem.media} load={(id) => api.tasks.problemMediaUrl(taskId, id)} />
        </View>
      ) : null}

      {task.status === 'new' || task.status === 'accepted' ? (
        <View style={styles.actions}>
          {task.status === 'new' ? (
            <PrimaryButton variant="outline" title={t('mobile.tasks.detail.accept')} onPress={() => run(() => tasks.accept(taskId))} disabled={busy} />
          ) : null}
          <PrimaryButton title={t('mobile.tasks.detail.start')} onPress={() => run(() => tasks.start(taskId))} disabled={busy} />
        </View>
      ) : null}

      {task.status === 'in_progress' || task.draft ? (
        <View style={styles.response}>
          <Text style={styles.label}>{t('mobile.tasks.detail.response')}</Text>
          <CommitInput
            accessibilityLabel={t('mobile.tasks.detail.response')}
            placeholder={t('mobile.tasks.detail.responsePlaceholder')}
            value={task.draft?.text ?? ''}
            editable={editable}
            multiline
            maxLength={TASK_LIMITS.submissionTextMax}
            onCommit={(text) => run(() => tasks.saveText(taskId, text))}
          />
          {MEDIA_KINDS.filter((kind) => s.evidence[kind] !== 'none').map((kind) => (
            <EvidenceRow
              key={kind}
              kind={kind}
              ids={draftIds.filter((id) => mediaById.get(id)?.kind === kind)}
              limit={RESPONSE_LIMITS[kind]}
              liveOnly={s.evidence.liveOnly}
              readOnly={!editable}
              media={mediaById}
              onCapture={startCapture}
              onRemove={confirmRemove}
              onOpenVideo={setVideo}
            />
          ))}
          {refusals.map((r) => (
            <Text key={r.mediaId} style={styles.error}>
              {fileNotAcceptedText(t, r.errorKey)}
            </Text>
          ))}
          {failed.map((m) => (
            <View key={m.id} style={styles.failed}>
              <Text style={styles.error}>{t(mediaErrorKey(m.failedCode ?? 'UPLOAD_FAILED'))}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('mobile.sync.discard')}: ${t(`executions.mediaKinds.${m.kind}`)}`}
                onPress={() =>
                  run(async () => {
                    await mediaQueue.discard(m.id);
                    await engine.refresh();
                  })
                }
                style={styles.discard}
              >
                <Text style={styles.discardText}>{t('mobile.sync.discard')}</Text>
              </Pressable>
            </View>
          ))}
          {editable ? (
            <>
              {evidence.ok
                ? null
                : evidence.missing.map((k) => (
                    <Text key={k} style={styles.error}>
                      {t(`tasks.issues.${k}Required`)}
                    </Text>
                  ))}
              <PrimaryButton title={t('mobile.tasks.detail.complete')} onPress={complete} disabled={busy || !evidence.ok} />
            </>
          ) : task.draft?.submittedAt ? (
            <Text style={styles.muted}>{t('mobile.tasks.detail.submitted')}</Text>
          ) : task.draft ? (
            <Text style={styles.warning}>{t('mobile.tasks.detail.readOnly')}</Text>
          ) : null}
        </View>
      ) : (task.status === 'awaiting_review' || task.status === 'completed') && last ? (
        <View style={styles.response}>
          <Text style={styles.label}>{t('mobile.tasks.detail.response')}</Text>
          <Text style={styles.muted}>{t('mobile.tasks.detail.submitted')}</Text>
          {last.text ? <Text style={styles.text}>{last.text}</Text> : null}
        </View>
      ) : null}

      {camera ? (
        <CaptureModal
          kind={camera}
          onClose={() => setCamera(null)}
          onCaptured={(m) => {
            setCamera(null);
            run(() => tasks.attachMedia(taskId, m));
          }}
        />
      ) : null}
      {video ? <VideoPreview uri={video} onClose={() => setVideo(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  text: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  warning: { color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  error: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end' },
  response: { gap: spacing.sm },
  failed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  discard: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  discardText: { color: colors.danger, fontWeight: '600' },
});
```

Create `apps/mobile/app/(app)/task/[id].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { TaskScreen } from '@/features/tasks/task-screen';

export default function TaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new key per task, so a capture in progress never lands on another task.
  return <TaskScreen key={id} taskId={id} />;
}
```

In `apps/mobile/app/(app)/_layout.tsx`, add after `<Tabs.Screen name="execution/[id]/finish" options={HIDDEN} />`:

```tsx
        <Tabs.Screen name="task/[id]" options={HIDDEN} />
```

- [ ] **Step 5: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. In the rejection test the problem photo loads through `tasks.problemMediaUrl(TASK, PROBLEM_PHOTO)` and the pending problem video is drawn without a request; offline the instruction photo shows the waiting text and no request is made.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/tasks apps/mobile/app/'(app)'/task apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat(mobile): task screen with instructions, problem, accept/start, response, evidence and Tamamla" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Create task on the phone (`tasks.manage`, online only)

**Files:**
- Create: `apps/mobile/src/features/tasks/create-task-screen.tsx`, `create-task-screen.test.tsx`, `apps/mobile/app/(app)/task/new.tsx`
- Modify: `apps/mobile/src/features/tasks/tasks-screen.tsx`, `tasks-screen.test.tsx`, `apps/mobile/app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `api.tasks.create(body: CreateTaskInput)`, `api.tasks.assignees({ q })` → `TaskAssigneeOptions` (`users`, `teams` and the site choices `sites`, decision 17); `DEFAULT_TASK_EVIDENCE`, `EVIDENCE_LEVELS`, `TASK_PRIORITIES`, `TASK_LIMITS`, `TaskAssignee`; `services.newId`, `services.files`, `services.tasks.queueInstructionMedia` (Task 6); `useSession().me.permissions`; `useSyncStatus().online`; SP4's `toAnswerDatetime`, `CaptureModal`, `pickFromGallery`, `Choice`, `Chip`, `Field`, `FormError`, `mobileErrorText`.
- Produces: `CreateTaskScreen`, route `/task/new` (hidden), and the "Yeni tapşırıq" button on the Tasks tab for `tasks.manage` holders.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/features/tasks/create-task-screen.test.tsx`:

```tsx
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { OTHER, SITE, syncTask, TEAM } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { CreateTaskScreen } from './create-task-screen';

const mockBack = jest.fn();
const mockCreate = jest.fn();
const mockAssignees = jest.fn();
jest.mock('expo-router', () => ({ router: { back: (...a: unknown[]) => mockBack(...a), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
jest.mock('@/lib/session', () => ({
  // tasks.manage without sites.view: the site choices still come, from GET /tasks/assignees (decision 17).
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: ['tasks.manage'] } }),
  api: {
    tasks: { create: (...a: unknown[]) => mockCreate(...a), assignees: (...a: unknown[]) => mockAssignees(...a) },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockAssignees.mockResolvedValue({
    users: [{ id: OTHER, fullName: 'Murad Həsənov', jobTitle: null, kind: 'worker' }],
    teams: [{ id: TEAM, name: 'Texniki xidmət', memberCount: 3 }],
    sites: [{ id: SITE, name: 'Bakı filialı 1' }],
  });
  mockCreate.mockImplementation(async (body: { id: string }) => ({ ...syncTask({ id: body.id }), history: [], canManage: true, canReview: true }));
});

describe('CreateTaskScreen', () => {
  it('offline it says a connection is needed and sends nothing', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <CreateTaskScreen />);
    expect(await screen.findByText('İnternet bağlantısı tələb olunur')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yarat' })).toBeNull();
    expect(mockAssignees).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates a team task with a site, due date, review and photo evidence, then queues its instruction photo', async () => {
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ad'), '  Soyuducunu təmir et ');
    await fireEvent.changeText(screen.getByLabelText('Təlimat'), 'Rezini dəyişin');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Texniki xidmət (3 nəfər)' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Bakı filialı 1' }));
    await fireEvent.changeText(screen.getByLabelText('Son tarix (İİİİ-AA-GG SS:DD)'), '2026-11-03 18:00');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Yoxlama tələb olunur' }));
    await fireEvent.press(within(screen.getByTestId('evidence-photo')).getByRole('radio', { name: 'Mütləq' }));
    const { pickFromGallery } = jest.requireMock('@/features/execution/capture') as { pickFromGallery: jest.Mock };
    pickFromGallery.mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Foto: Qalereya' }));
    expect(await screen.findByTestId('instruction-0')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    await eventually(async () => expect(mockBack).toHaveBeenCalled());
    const body = mockCreate.mock.calls[0]![0] as { id: string };
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      title: 'Soyuducunu təmir et',
      instructions: 'Rezini dəyişin',
      priority: 'normal',
      siteId: SITE,
      dueAt: new Date('2026-11-03T18:00').toISOString(),
      evidence: { photo: 'required', video: 'optional', liveOnly: false },
      requiresReview: true,
      assignee: { teamId: TEAM },
    });
    expect(await t.db.all('SELECT owner_id, role FROM media')).toEqual([{ owner_id: body.id, role: 'instruction' }]);
    expect(Alert.alert).toHaveBeenCalledWith('Tapşırıq yaradıldı.');
  });

  it('asks for a title and an assignee before sending', async () => {
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await screen.findByRole('radio', { name: 'Murad Həsənov' });
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Ad yazın.')).toBeTruthy();
    expect(screen.getByText('İcraçı seçin.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("retries a failed create with the same client id and shows the server's field error", async () => {
    const { ApiError } = jest.requireActual<typeof import('@taskop/api-client')>('@taskop/api-client');
    mockCreate
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'errors.NETWORK'))
      .mockRejectedValueOnce(new ApiError(422, 'TASK_ASSIGNEE_INVALID', 'errors.TASK_ASSIGNEE_INVALID', { assignee: 'errors.TASK_ASSIGNEE_INVALID' }));
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <CreateTaskScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ad'), 'Qapı');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Murad Həsənov' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Serverlə əlaqə qurulmadı. İnternet bağlantınızı yoxlayın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Seçilmiş əməkdaş və ya komanda bu tapşırıq üçün uyğun deyil.')).toBeTruthy();
    expect(mockCreate.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual([expect.any(String), (mockCreate.mock.calls[0]![0] as { id: string }).id]);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
```

In `apps/mobile/src/features/tasks/tasks-screen.test.tsx`:
- After the `expo-router` mock add:

```tsx
let mockPermissions: string[] = [];
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: mockPermissions } }),
}));
```

- Replace `beforeEach(() => mockPush.mockClear());` with:

```tsx
beforeEach(() => {
  mockPush.mockClear();
  mockPermissions = [];
});
```

- Append inside `describe('Tapşırıqlar', …)`:

```tsx
  it('offers "Yeni tapşırıq" to tasks.manage holders only', async () => {
    const t = await world();
    const view = await renderWithServices(t.services, <TasksScreen />);
    await screen.findByTestId('section-mine');
    expect(screen.queryByRole('button', { name: 'Yeni tapşırıq' })).toBeNull();
    await view.unmount();
    mockPermissions = ['tasks.manage'];
    await renderWithServices(t.services, <TasksScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Yeni tapşırıq' }));
    expect(mockPush).toHaveBeenCalledWith('/task/new');
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks`
Expected: FAIL: `./create-task-screen` does not exist; the Tasks tab has no "Yeni tapşırıq" button.

- [ ] **Step 3: Write the screen**

Create `apps/mobile/src/features/tasks/create-task-screen.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import {
  DEFAULT_TASK_EVIDENCE,
  EVIDENCE_LEVELS,
  type EvidenceLevel,
  MEDIA_KINDS,
  type MediaKind,
  TASK_LIMITS,
  TASK_PRIORITIES,
  type TaskAssignee,
  type TaskAssigneeOptions,
  type TaskEvidence,
  type TaskPriority,
} from '@taskop/contracts';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '@/components/field';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { CaptureModal, pickFromGallery } from '@/features/execution/capture';
import { toAnswerDatetime } from '@/features/execution/datetime-format';
import { CaptureError } from '@/features/execution/media-capture';
import { Chip, Choice } from '@/features/execution/parts';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import type { CapturedMedia } from '@/offline/execution-store';
import { useSyncStatus } from '@/offline/hooks';
import { ScreenHeader } from './screen-header';

const ASSIGNEE_SEARCH_DELAY_MS = 300;

const withLevel = (e: TaskEvidence, kind: MediaKind, level: EvidenceLevel): TaskEvidence => (kind === 'photo' ? { ...e, photo: level } : { ...e, video: level });

/** Spec §7.2: a tasks.manage holder creates a task on the phone. Creating needs a connection (spec §1). */
export function CreateTaskScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const { online } = useSyncStatus();
  // One client id per screen: a retry after a lost connection repeats the same idempotent POST (decision 10).
  const [id] = useState(() => services.newId());
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<TaskAssigneeOptions | null>(null);
  const [assignee, setAssignee] = useState<{ value: TaskAssignee; key: string } | null>(null);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [requiresReview, setRequiresReview] = useState(false);
  const [evidence, setEvidence] = useState<TaskEvidence>(DEFAULT_TASK_EVIDENCE);
  const [photos, setPhotos] = useState<CapturedMedia[]>([]);
  const [camera, setCamera] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const created = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    if (!online) return;
    let alive = true;
    const timer = setTimeout(() => {
      const term = q.trim();
      api.tasks.assignees(term ? { q: term } : {}).then(
        (o) => {
          if (alive) setOptions(o);
        },
        (e: unknown) => {
          if (alive) setError(mobileErrorText(t, e));
        },
      );
    }, ASSIGNEE_SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [online, q, t]);

  const removeFile = (uri: string) => {
    try {
      services.files.remove(uri);
    } catch {
      // Already gone.
    }
  };
  // Photos taken for a task that was never created are deleted when the screen closes (decision 10).
  useEffect(
    () => () => {
      if (!created.current) photosRef.current.forEach((p) => removeFile(p.localUri));
    },
    // Runs once on unmount; `removeFile` only reads `services`.
    [services],
  );

  if (!online) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.create.title')} />
        <Text style={styles.muted}>{t('mobile.tasks.online')}</Text>
      </Screen>
    );
  }

  const fieldError = (key: string) => (fields[key] ? t(fields[key]) : null);
  const pick = (value: TaskAssignee, key: string) => {
    setAssignee({ value, key });
    setFields(({ assignee: _cleared, ...rest }) => rest);
  };
  const pickPhoto = async () => {
    try {
      const picked = await pickFromGallery('photo');
      if (picked) setPhotos((xs) => [...xs, picked]);
    } catch (e) {
      Alert.alert(e instanceof CaptureError ? t(`mobile.evidence.${e.problem}`) : t('mobile.evidence.failed'));
    }
  };
  const removePhoto = (p: CapturedMedia) => {
    setPhotos((xs) => xs.filter((x) => x !== p));
    removeFile(p.localUri);
  };

  const save = async () => {
    setError(null);
    const dueAt = due.trim() ? toAnswerDatetime('datetime', due) : null;
    const invalid: Record<string, string> = {};
    if (!title.trim()) invalid.title = 'mobile.tasks.create.titleRequired';
    if (!assignee) invalid.assignee = 'mobile.tasks.create.assigneeRequired';
    if (due.trim() && !dueAt) invalid.dueAt = 'mobile.execution.invalidDate';
    setFields(invalid);
    if (!assignee || Object.keys(invalid).length > 0) return;
    setBusy(true);
    try {
      await api.tasks.create({ id, title: title.trim(), instructions: instructions.trim(), priority, siteId, dueAt, evidence, requiresReview, assignee: assignee.value });
      created.current = true;
      if (photos.length > 0) await services.tasks.queueInstructionMedia(id, photos);
      Alert.alert(t('mobile.tasks.create.created'));
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const full = photos.length >= TASK_LIMITS.instructionMedia;
  return (
    <Screen>
      <ScreenHeader title={t('mobile.tasks.create.title')} />
      <Field label={t('mobile.tasks.create.name')} value={title} onChangeText={setTitle} error={fieldError('title')} />
      <Text style={styles.label}>{t('mobile.tasks.create.instructions')}</Text>
      <TextInput
        accessibilityLabel={t('mobile.tasks.create.instructions')}
        value={instructions}
        onChangeText={setInstructions}
        multiline
        maxLength={TASK_LIMITS.instructionsMax}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={styles.label}>{t('mobile.tasks.create.priority')}</Text>
      <View style={styles.row}>
        {TASK_PRIORITIES.map((p) => (
          <Choice key={p} role="radio" label={t(`tasks.priorities.${p}`)} selected={priority === p} onPress={() => setPriority(p)} />
        ))}
      </View>

      <Text style={styles.label}>{t('mobile.tasks.create.assignee')}</Text>
      <Field label={t('mobile.tasks.create.search')} value={q} onChangeText={setQ} autoCapitalize="none" />
      <FormError message={fieldError('assignee')} />
      {options && options.teams.length > 0 ? <Text style={styles.muted}>{t('mobile.tasks.create.teams')}</Text> : null}
      <View style={styles.row}>
        {options?.teams.map((team) => (
          <Choice
            key={team.id}
            role="radio"
            label={t('mobile.tasks.create.teamOption', { name: team.name, count: team.memberCount })}
            selected={assignee?.key === `t:${team.id}`}
            onPress={() => pick({ teamId: team.id }, `t:${team.id}`)}
          />
        ))}
      </View>
      {options && options.users.length > 0 ? <Text style={styles.muted}>{t('mobile.tasks.create.people')}</Text> : null}
      <View style={styles.row}>
        {options?.users.map((u) => (
          <Choice
            key={u.id}
            role="radio"
            label={u.jobTitle ? `${u.fullName} · ${u.jobTitle}` : u.fullName}
            selected={assignee?.key === `u:${u.id}`}
            onPress={() => pick({ userId: u.id }, `u:${u.id}`)}
          />
        ))}
      </View>

      {/* Active sites writable in the caller's scope, unaffected by the search (decision 17). */}
      {options && options.sites.length > 0 ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.create.site')}</Text>
          <View style={styles.row}>
            <Choice role="radio" label={t('mobile.tasks.create.noSite')} selected={siteId === null} onPress={() => setSiteId(null)} />
            {options.sites.map((site) => (
              <Choice key={site.id} role="radio" label={site.name} selected={siteId === site.id} onPress={() => setSiteId(site.id)} />
            ))}
          </View>
          <FormError message={fieldError('siteId')} />
        </>
      ) : null}

      <Field label={t('mobile.tasks.create.due')} value={due} onChangeText={setDue} error={fieldError('dueAt')} autoCapitalize="none" />
      <Choice role="checkbox" label={t('mobile.tasks.create.review')} selected={requiresReview} onPress={() => setRequiresReview((v) => !v)} />

      <Text style={styles.label}>{t('mobile.tasks.create.evidence')}</Text>
      {MEDIA_KINDS.map((kind) => (
        <View key={kind} testID={`evidence-${kind}`} style={styles.evidence}>
          <Text style={styles.muted}>{t(`executions.mediaKinds.${kind}`)}</Text>
          <View style={styles.row}>
            {EVIDENCE_LEVELS.map((level) => (
              <Choice
                key={level}
                role="radio"
                label={t(`tasks.evidenceLevels.${level}`)}
                selected={evidence[kind] === level}
                onPress={() => setEvidence((e) => withLevel(e, kind, level))}
              />
            ))}
          </View>
        </View>
      ))}
      <Choice role="checkbox" label={t('mobile.evidence.liveOnly')} selected={evidence.liveOnly} onPress={() => setEvidence((e) => ({ ...e, liveOnly: !e.liveOnly }))} />

      <Text style={styles.label}>{t('mobile.tasks.create.photos')}</Text>
      <View style={styles.row}>
        {photos.map((p, n) => (
          <Pressable
            key={p.localUri}
            testID={`instruction-${n}`}
            accessibilityRole="button"
            accessibilityLabel={`${t('executions.mediaKinds.photo')} ${n + 1}`}
            onLongPress={() => removePhoto(p)}
            style={styles.thumb}
          >
            <Image source={{ uri: p.localUri }} style={styles.thumb} />
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Chip label={`${t('executions.mediaKinds.photo')}: ${t('mobile.evidence.camera')}`} disabled={full} onPress={() => setCamera(true)} />
        <Chip label={`${t('executions.mediaKinds.photo')}: ${t('mobile.evidence.gallery')}`} disabled={full} onPress={() => void pickPhoto()} />
      </View>

      <FormError message={error} />
      <PrimaryButton title={t('mobile.tasks.create.save')} onPress={() => void save()} disabled={busy} />
      {camera ? (
        <CaptureModal
          kind="photo"
          onClose={() => setCamera(false)}
          onCaptured={(m) => {
            setCamera(false);
            setPhotos((xs) => [...xs, m]);
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  evidence: { gap: spacing.xs },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
  thumb: { width: 64, height: 64, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
});
```

Create `apps/mobile/app/(app)/task/new.tsx`:

```tsx
import { CreateTaskScreen } from '@/features/tasks/create-task-screen';

export default CreateTaskScreen;
```

In `apps/mobile/app/(app)/_layout.tsx`, add after `<Tabs.Screen name="task/[id]" options={HIDDEN} />`:

```tsx
        <Tabs.Screen name="task/new" options={HIDDEN} />
```

- [ ] **Step 4: Offer the button on the Tasks tab**

In `apps/mobile/src/features/tasks/tasks-screen.tsx`:
- Add `import { PrimaryButton } from '@/components/primary-button';` and `import { useSession } from '@/lib/session';`.
- After `const now = useNow();` add:

```tsx
  const session = useSession();
  const canManage = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
```

- Replace `<SyncIndicator />` inside `styles.top` with:

```tsx
        <View style={styles.tools}>
          {canManage ? <PrimaryButton title={`+ ${t('mobile.tasks.create.open')}`} accessibilityLabel={t('mobile.tasks.create.open')} onPress={() => router.push('/task/new')} /> : null}
          <SyncIndicator />
        </View>
```

- Add `tools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },` to `styles`.

- [ ] **Step 5: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. Offline nothing is requested; the retry sends the same id; after a create the instruction photo is a `task.media` command with role `instruction`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/features/tasks apps/mobile/app/'(app)'/task/new.tsx apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat(mobile): create tasks on the phone for tasks.manage holders, online only" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Yoxlama: tasks awaiting my review, Approve and Reject (online only)

**Files:**
- Create: `apps/mobile/src/features/tasks/review-section.tsx`, `review-screen.tsx`, `review-screen.test.tsx`, `apps/mobile/app/(app)/review/[id].tsx`
- Modify: `apps/mobile/src/features/tasks/tasks-screen.tsx`, `tasks-screen.test.tsx`, `apps/mobile/app/(app)/_layout.tsx`

**Interfaces:**
- Consumes: `api.tasks.list({ awaitingMyReview: 'true' })` → `Page<TaskSummary>`, `api.tasks.get(id)` → `TaskDetail` (`canReview`, `submissions`, `media`), `api.tasks.review(id, ReviewTaskInput)`, `api.taskMedia.url`; `TASK_LIMITS.commentMax`; `az.tasks.issues.commentRequired`; `useFocusEffect` (expo-router); `RemoteMediaStrip`, `ScreenHeader` (Task 9).
- Produces: `ReviewSection` (rows with testID `review-<id>`), `ReviewScreen({ taskId })`, route `/review/[id]` (hidden).

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/features/tasks/review-screen.test.tsx`:

```tsx
import type { TaskDetail } from '@taskop/contracts';
import { fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { ME_REF, syncTask, T, TASK } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ReviewScreen } from './review-screen';

const mockBack = jest.fn();
const mockGet = jest.fn();
const mockReview = jest.fn();
const mockUrl = jest.fn();
jest.mock('expo-router', () => ({ router: { back: (...a: unknown[]) => mockBack(...a), push: jest.fn() } }));
jest.mock('@/features/execution/capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));
jest.mock('@/lib/session', () => ({
  api: {
    tasks: { get: (...a: unknown[]) => mockGet(...a), review: (...a: unknown[]) => mockReview(...a) },
    taskMedia: { url: (...a: unknown[]) => mockUrl(...a) },
  },
}));

const SUB = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e95';
const PHOTO = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e96';
const awaiting = (over: Partial<TaskDetail> = {}): TaskDetail => ({
  ...syncTask({
    status: 'awaiting_review',
    requiresReview: true,
    media: [
      {
        id: PHOTO, role: 'response', submissionId: SUB, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 10, width: 1600, height: 1200,
        durationMs: null, capturedAt: T.open, capturedBy: ME_REF, status: 'uploaded', uploadedAt: T.open,
      },
    ],
    submissions: [
      {
        id: SUB, submittedBy: ME_REF, text: 'Rezin dəyişildi', mediaIds: [PHOTO], submittedAt: T.open, receivedAt: T.open,
        reviewDecision: null, reviewComment: null, reviewedBy: null, reviewedAt: null,
      },
    ],
  }),
  history: [],
  canManage: true,
  canReview: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockUrl.mockResolvedValue({ url: `http://files.test/taskop-media/${PHOTO}.jpg?X-Amz-Signature=x`, expiresAt: T.due });
});

async function opened() {
  const t = await createTestServices({ online: true });
  await renderWithServices(t.services, <ReviewScreen taskId={TASK} />);
  return t;
}

describe('ReviewScreen', () => {
  it('shows the latest submission with its photo and approves it', async () => {
    mockGet.mockResolvedValue(awaiting());
    mockReview.mockResolvedValue(awaiting({ status: 'completed', canReview: false }));
    await opened();
    expect(await screen.findByText('Rezin dəyişildi')).toBeTruthy();
    expect(await screen.findByTestId(`remote-${PHOTO}`)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Təsdiqlə' }));
    await eventually(async () => expect(mockBack).toHaveBeenCalled());
    expect(mockReview).toHaveBeenCalledWith(TASK, { decision: 'approve' });
    expect(Alert.alert).toHaveBeenCalledWith('Tapşırıq təsdiqləndi.');
  });

  it('needs a comment to send the task back', async () => {
    mockGet.mockResolvedValue(awaiting());
    mockReview.mockResolvedValue(awaiting({ status: 'in_progress', canReview: false }));
    await opened();
    await fireEvent.press(await screen.findByRole('button', { name: 'Geri qaytar' }));
    expect(await screen.findByText('Geri qaytarmaq üçün şərh yazın.')).toBeTruthy();
    expect(mockReview).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Şərh'), '  Foto bulanıqdır ');
    await fireEvent.press(screen.getByRole('button', { name: 'Geri qaytar' }));
    await eventually(async () => expect(mockReview).toHaveBeenCalledWith(TASK, { decision: 'reject', comment: 'Foto bulanıqdır' }));
  });

  it('says when the task no longer awaits review', async () => {
    mockGet.mockResolvedValue(awaiting({ status: 'completed', canReview: false }));
    await opened();
    expect(await screen.findByText('Bu tapşırıq artıq yoxlama gözləmir.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Təsdiqlə' })).toBeNull();
  });

  it('offline it says a connection is needed and loads nothing', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <ReviewScreen taskId={TASK} />);
    expect(await screen.findByText('İnternet bağlantısı tələb olunur')).toBeTruthy();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
```

In `apps/mobile/src/features/tasks/tasks-screen.test.tsx`:
- Replace the `expo-router` mock with:

```tsx
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  // The tab is focused while rendered in a test.
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
```

- Replace the `@/lib/session` mock with:

```tsx
const mockList = jest.fn();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: mockPermissions } }),
  api: { tasks: { list: (...a: unknown[]) => mockList(...a) } },
}));
```

- In `beforeEach`, add `mockList.mockReset();` and `mockList.mockResolvedValue({ items: [], nextCursor: null });`, and extend the fixtures import with `ME_REF` and `OTHER`.
- Append inside `describe('Tapşırıqlar', …)`:

```tsx
  it('lists the tasks awaiting my review for tasks.manage holders, online, and opens one', async () => {
    mockPermissions = ['tasks.manage'];
    mockList.mockResolvedValue({
      items: [
        {
          id: TASK4, title: 'Kassanı yoxla', priority: 'normal', status: 'awaiting_review', site: null, assignee: { id: OTHER, fullName: 'Murad Həsənov' },
          team: null, assigneeInactive: false, createdBy: ME_REF, requiresReview: true, source: 'adhoc',
          problemId: null, dueAt: null, overdueAt: null, rev: 3, createdAt: T.starts, updatedAt: T.open,
        },
      ],
      nextCursor: null,
    });
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <TasksScreen />);
    expect((await screen.findByTestId('section-review')).props.children).toBe('Yoxlama');
    const row = await screen.findByTestId(`review-${TASK4}`);
    expect(within(row).getByText('Murad Həsənov')).toBeTruthy();
    expect(mockList).toHaveBeenCalledWith({ awaitingMyReview: 'true' });
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/review/[id]', params: { id: TASK4 } });
  });

  it('shows no Yoxlama to workers, and asks managers for a connection while offline', async () => {
    const t = await world();
    const view = await renderWithServices(t.services, <TasksScreen />);
    await screen.findByTestId('section-mine');
    expect(screen.queryByTestId('section-review')).toBeNull();
    await view.unmount();
    mockPermissions = ['tasks.manage'];
    await renderWithServices(t.services, <TasksScreen />);
    expect(await screen.findByText('İnternet bağlantısı tələb olunur')).toBeTruthy();
    expect(mockList).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks`
Expected: FAIL: `./review-screen` does not exist; the Tasks tab has no `section-review`.

- [ ] **Step 3: Write the section and the screen**

Create `apps/mobile/src/features/tasks/review-section.tsx`:

```tsx
import type { TaskSummary } from '@taskop/contracts';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';

/** Spec §7.2 "Yoxlama": tasks awaiting the caller's review, fetched whenever the tab gains focus while online (decision 13). */
export function ReviewSection() {
  const { t } = useTranslation();
  const { online } = useSyncStatus();
  const [items, setItems] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!online) return undefined;
      let alive = true;
      setError(null);
      api.tasks.list({ awaitingMyReview: 'true' }).then(
        (page) => {
          if (alive) setItems(page.items);
        },
        (e: unknown) => {
          if (alive) setError(mobileErrorText(t, e));
        },
      );
      return () => {
        alive = false;
      };
    }, [online, t]),
  );
  return (
    <View style={styles.group}>
      <Text testID="section-review" style={styles.section}>
        {t('mobile.tasks.sections.review')}
      </Text>
      {!online ? (
        <Text style={styles.muted}>{t('mobile.tasks.online')}</Text>
      ) : error ? (
        <FormError message={error} />
      ) : items === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : items.length === 0 ? (
        <Text style={styles.muted}>{t('mobile.tasks.review.empty')}</Text>
      ) : (
        items.map((item) => (
          <Pressable
            key={item.id}
            testID={`review-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => router.push({ pathname: '/review/[id]', params: { id: item.id } })}
            style={styles.card}
          >
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.muted}>{item.assignee?.fullName ?? item.team?.name ?? ''}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  card: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
});
```

Create `apps/mobile/src/features/tasks/review-screen.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { TASK_LIMITS, type TaskDetail } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';
import { RemoteMediaStrip } from './remote-media';
import { ScreenHeader } from './screen-header';

/** Spec §7.2: approve, or send back with a comment (required to reject), a task awaiting the caller's review. Online only. */
export function ReviewScreen({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { timeZone } = useOffline();
  const { online } = useSyncStatus();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comment, setComment] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    api.tasks.get(taskId).then(
      (d) => {
        if (alive) setTask(d);
      },
      (e: unknown) => {
        if (alive) setError(mobileErrorText(t, e));
      },
    );
    return () => {
      alive = false;
    };
  }, [online, taskId, t]);

  const decide = async (decision: 'approve' | 'reject') => {
    setError(null);
    if (decision === 'reject' && !comment.trim()) {
      setFields({ comment: 'tasks.issues.commentRequired' });
      return;
    }
    setFields({});
    setBusy(true);
    try {
      await api.tasks.review(taskId, decision === 'approve' ? { decision } : { decision, comment: comment.trim() });
      Alert.alert(t(decision === 'approve' ? 'mobile.tasks.review.approved' : 'mobile.tasks.review.rejected'));
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setError(mobileErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (!online) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.review.title')} />
        <Text style={styles.muted}>{t('mobile.tasks.online')}</Text>
      </Screen>
    );
  }
  if (!task) {
    return (
      <Screen>
        <ScreenHeader title={t('mobile.tasks.review.title')} />
        {error ? <FormError message={error} /> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }

  const submission = task.submissions.at(-1) ?? null;
  const media = submission ? task.media.filter((m) => m.submissionId === submission.id) : [];
  const reviewable = task.canReview && task.status === 'awaiting_review';
  return (
    <Screen>
      <ScreenHeader title={task.title} />
      <Text style={styles.muted}>{task.assignee?.fullName ?? task.team?.name ?? ''}</Text>
      {task.instructions ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.detail.instructions')}</Text>
          <Text style={styles.text}>{task.instructions}</Text>
        </>
      ) : null}
      {submission ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.review.submission')}</Text>
          <Text style={styles.muted}>{formatDateTime(submission.submittedAt, { locale: 'az', timeZone })}</Text>
          {submission.text ? <Text style={styles.text}>{submission.text}</Text> : null}
          <RemoteMediaStrip items={media.map((m) => ({ id: m.id, kind: m.kind, status: m.status }))} load={(id) => api.taskMedia.url(id)} />
        </>
      ) : null}
      {reviewable ? (
        <>
          <Text style={styles.label}>{t('mobile.tasks.review.comment')}</Text>
          <TextInput
            accessibilityLabel={t('mobile.tasks.review.comment')}
            value={comment}
            onChangeText={(c) => {
              setComment(c);
              setFields({});
            }}
            multiline
            maxLength={TASK_LIMITS.commentMax}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <FormError message={fields.comment ? t(fields.comment) : null} />
          <FormError message={error} />
          <PrimaryButton title={t('mobile.tasks.review.approve')} onPress={() => void decide('approve')} disabled={busy} />
          <PrimaryButton variant="outline" title={t('mobile.tasks.review.reject')} onPress={() => void decide('reject')} disabled={busy} />
        </>
      ) : (
        <Text style={styles.muted}>{t('mobile.tasks.review.notReviewable')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  text: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
});
```

Create `apps/mobile/app/(app)/review/[id].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { ReviewScreen } from '@/features/tasks/review-screen';

export default function ReviewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ReviewScreen key={id} taskId={id} />;
}
```

In `apps/mobile/app/(app)/_layout.tsx`, add after `<Tabs.Screen name="task/new" options={HIDDEN} />`:

```tsx
        <Tabs.Screen name="review/[id]" options={HIDDEN} />
```

In `apps/mobile/src/features/tasks/tasks-screen.tsx`, add `import { ReviewSection } from './review-section';` and, right after the closing `</View>` of `styles.top`, add:

```tsx
      {canManage ? <ReviewSection /> : null}
```

- [ ] **Step 4: Run the tests and check they pass**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/features/tasks && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/tasks apps/mobile/app/'(app)'/review apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat(mobile): Yoxlama section and review screen with approve and reject for tasks.manage holders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Full verification and the manual device checklist

**Files:**
- None created. Findings go into the pull request description. A real defect found here becomes a fix in the task that owns the file, with its own test and commit.

**Interfaces:**
- Consumes: everything above, and a running API with Part 1 Tasks 1–18 merged (and its seed: the team "Texniki xidmət" and two demo tasks, Part 1 Task 19).
- Produces: a verified development build on two real phones.

- [ ] **Step 1: Run every automated check**

```bash
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
pnpm --filter @taskop/i18n test
pnpm --filter @taskop/mobile test
pnpm --filter @taskop/mobile typecheck
pnpm --filter @taskop/mobile lint
pnpm --filter @taskop/mobile exec expo config --type prebuild > /dev/null
```

Expected: all suites pass, none skipped, and Jest reports no open handles. `grep -rn "execution_id" apps/mobile/src` lists only `claim_execution_id` and `migration-v3.test.ts`.

- [ ] **Step 2: Start the stack for phones on the LAN**

```bash
docker compose up -d
ipconfig getifaddr en0                     # e.g. 192.168.1.20
# apps/api/.env:    S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333
# apps/mobile/.env: EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
pnpm db:setup && pnpm db:seed
pnpm --filter @taskop/api dev
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
pnpm --filter @taskop/mobile android -- --device
```

Expected: both phones install the development build; a seeded worker sees the Tapşırıqlar tab with the demo tasks, and the Home card counts them.

- [ ] **Step 3: Run the manual device checklist (spec §9)**

Tick each item in the PR description, with the phone model and OS version:

1. **Upgrade with unsynced checklist work.** Install the previous build (before Task 2), start a checklist, answer two items and take a photo in airplane mode. Install this build over it and open it, still offline. Expected: the execution and its photo are intact. Turn airplane mode off. Expected: the indicator turns green and the web "İcra" tab shows the answers and the photo.
2. **Offline accept, start and complete with photos.** In airplane mode, open a task assigned to you: "Başla", write a response, take two photos (one from the gallery), "Tamamla". Expected while offline: the row shows "Göndərilməyib", the indicator is amber, the task sits under Tamamlanıb or Yoxlamada locally. Turn airplane mode off and foreground the app. Expected: green within 30 s; the web task drawer shows the submission, both photos and device vs received times; the history has accept and start rows.
3. **Kill mid-upload.** Record a 50 s video response on a slow connection (Network Link Conditioner "3G"), press "Tamamla", kill the app while amber, reopen. Expected: the upload resumes and the video plays on the web.
4. **Two phones racing a team task.** Assign a task to "Texniki xidmət" with both workers in it. Put both phones in airplane mode; both press "Qəbul et". Bring phone A online, then phone B. Expected on B: the alert "Bu tapşırığı artıq başqası qəbul edib" with the task's title, the task gone from the list, no red row in the sync queue. Expected on the web: A is the assignee.
5. **Reassigned away while offline.** Phone A starts a task and takes a photo offline; on the web, reassign the task to B. Bring A online. Expected on A: the same alert, the task and its photo gone. Expected on B: the task under Mənim with status Yeni.
6. **Cancelled while offline.** Start a task offline, write a response, attach a photo, "Tamamla"; cancel it on the web; go online. Expected: the task shows "Ləğv edilib", the note "Server qəbul etmədi: Tapşırığın vəziyyəti dəyişib…", and the response read-only.
7. **Live-only and evidence rules.** A task with photo "Mütləq" and "Yalnız kamera": only "Foto: Kamera" is offered; "Tamamla" is disabled with "Ən azı bir foto əlavə edin." until a photo is attached.
8. **Manager creates a task on the phone.** Log in as `manager@demo.taskop.az`. "+ Yeni tapşırıq": title, instructions, "Texniki xidmət", a site, a due date, review on, photo "Mütləq", one instruction photo, "Yarat". Expected: the task appears on the web; a team member's phone shows it under Komanda üçün with the instruction photo (online). In airplane mode the Create screen says "İnternet bağlantısı tələb olunur".
9. **Reviewing on the phone.** After a worker submits a review task, the manager's Tasks tab shows it under Yoxlama. "Geri qaytar" without a comment shows "Geri qaytarmaq üçün şərh yazın."; with a comment the worker's phone shows "Geri qaytarıldı: …" and the task back in Mənim (İcradadır); after the worker submits again, "Təsdiqlə" moves it to Tamamlanıb on the worker's phone.
10. **Logout with unsynced task work.** Offline, start a task and take a photo, then log out. Expected: the unsynced warning counts the task's commands; after "Sil və çıx", logging in as another worker shows none of it.

- [ ] **Step 4: Record and finish**

Add the checklist results to the PR description. For each failed item, open a fix in the owning task's files, with a regression test where Jest can express it, and commit it as `fix(mobile): …`. Do not commit device-only notes into the repo.

---

## Self-review

**Spec §7 and Part 1 decisions coverage**

| Spec / decision | Where |
|---|---|
| §7.1 outbox rebuilt with `entity_type`/`entity_id`, rows copied with ids and order | Task 2 (migration, `sqlite_sequence`, kill-mid-upgrade test) |
| §7.1 media rebuilt with `owner_type`/`owner_id`; queue routes by owner | Task 2 (columns), Task 5 (routing, cleanup) |
| §7.1 `tasks` (server JSON, `local_status`, `rev`, sync state) and `task_drafts` (autosaved) | Task 2 (tables), Task 3 (`mergeTask`), Task 6 (drafts, `CommitInput` autosave) |
| §7.1 `COMMAND_KINDS` + four task kinds, per-entity order, media before submit | Task 4 (kinds, hold-back, send), Task 6 (`queues a response medium's registration before the submission that lists it`) |
| §7.1 `task-store.ts`: transitions, evidence, one transaction, SP4 capture, live-only camera | Task 6; Task 9 (capture reuse) |
| §7.1 pull: upsert tasks, delete removed, keep those with unsynced work | Task 3; Part 1 decision 2 (`knownTaskIds`) |
| §7.1 refusals: taken, state invalid, evidence and media; Part 1 "404 = taken" | Task 7 |
| §7.2 tabs, Home card, list sections and row badges | Task 8 |
| §7.2 task detail (instructions + media, problem card, Qəbul et / Başla, response, chips, Tamamla reasons, reviewer comment) | Task 9 |
| §7.2 manager Create (online, picker, site, due, review, evidence, instruction photos) | Task 10 |
| §7.2 manager Yoxlama with Approve / Reject (comment required) | Task 11 |
| §9 mobile tests and manual checklist | Tasks 2–11 (Jest), Task 12 |

**Placeholder scan.** No "TBD", "TODO", "add validation" or "similar to Task N". Every edit to an existing file names the exact text it replaces.

**Names used from Part 1 "Interfaces for Parts 2 and 3".** `TASK_STATUSES`/`TaskStatus`, `isFinalTaskStatus`, `TASK_PRIORITIES`/`TaskPriority`, `TaskAction`, `EVIDENCE_LEVELS`/`EvidenceLevel`, `TaskEvidence`, `DEFAULT_TASK_EVIDENCE`, `TaskMediaRole`, `TASK_LIMITS` (`instructionsMax`, `submissionTextMax`, `commentMax`, `instructionMedia`, `responsePhotos`, `responseVideos`, `knownTaskIds`), `taskTransition`, `taskEvidenceMet`/`TaskEvidenceResult`, `TaskAssignee`, `CreateTaskInput`, `ReviewTaskInput`, `TaskActionCommand`, `SubmissionInput`, `TaskMediaRegisterInput`, `TaskSummary`, `TaskDetail`, `TaskMediaDto`, `SyncTask`/`syncTaskSchema`, `TaskAssigneeOptions`, `SyncResponse.tasks`/`removedTaskIds`, `ProblemDto` (+ `resolution`, `taskId`, `executionState`, `media: ProblemMediaRef[]`), `TaskAssigneeOptions.sites`, `TaskMediaDto.status` (pending includes purged); `az.tasks.{statuses, priorities, evidenceLevels, flags.overdue, issues.*, alreadyTaken}`, `az.errors.TASK_*`; `TasksApi`, `tasks.{list, get, create, review, accept, start, submit, registerMedia, assignees, problemMediaUrl}`, `taskMedia.{confirmUploaded, url}`, `sync.pull(knownVersionIds, knownTaskIds)`. Existing repo names: `MediaUrl`, `MediaUploadTicket`, `MediaStatus`, `Me.permissions`. The task-time correction (`device time − clockOffsetMs`) is Part 1's documented contract (*Server behaviour* → "Device times are sent on the server's clock").
