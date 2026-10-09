# Taskop Mobile Execution — Part 2: Mobile App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a worker see their occurrences on the phone, start one, answer every SP2 item type with follow-ups, photo/video evidence and manual problem flags, and complete it, online or offline. The work survives an app kill and syncs automatically when the connection returns.

**Architecture:**
- **Offline layer (`apps/mobile/src/offline/`)** is plain TypeScript behind small interfaces, so Jest can test it without native modules:
  - `db.ts` is a `Db` interface over a `SqlDriver`. On the phone the driver is `expo-sqlite` with SQLCipher; in Jest it is Node 24's built-in `node:sqlite`.
  - All statements and transactions on the one connection run through a JS queue. That queue is what makes "SQLite write + outbox append" atomic (spec §7.2).
  - `execution-store.ts` does every worker action as one transaction: it writes the execution or media row and appends an outbox command.
  - `sync-engine.ts` sends the outbox oldest first, pulls `/me/sync`, and then lets `media-queue.ts` upload files one at a time.
  - `sync-triggers.ts` wires the run to app start, reconnect, foreground, a 30 s interval and a 2 s delay after local writes.
- **Native adapters (`src/offline/native/`)** are thin and only typechecked: SQLCipher open with a SecureStore key, `expo-file-system` uploads, `expo-network` and `AppState` ports. The manual device checklist (Task 16) covers them.
- **Screens** read the store through `useOffline()` and `useLiveQuery()`. A change feed re-runs queries after every local write or sync. The screens are: My checklists (the home tab), Execution, Finish, and the Sync queue, plus a sync indicator in the headers.

**Tech Stack:** Expo SDK 57 (React Native 0.86, React 19.2.3, TypeScript 6 in `apps/mobile`), Expo Router, **expo-sqlite (SQLCipher), expo-camera, expo-image-picker, expo-image-manipulator, expo-file-system, expo-network, expo-video, expo-crypto** (new), expo-secure-store, i18next, Jest 29 (`jest-expo`) + React Native Testing Library 14, `node:sqlite` (Node 24 built-in, tests only).

**Spec:** `docs/superpowers/specs/2026-10-09-mobile-execution-design.md`. This plan covers §7, the mobile parts of §9 (`EXPO_PUBLIC_API_URL` on the LAN) and §10 (mobile Jest suites and the manual device checklist).

**This plan is Part 2 of 3.** It consumes `docs/superpowers/plans/2026-10-09-mobile-execution-1-api.md` → **Interfaces for Parts 2 and 3**.

**Depends on: Part 1 Tasks 1–5 must be merged into the feature branch first.** Those tasks provide the contracts (`progress`, `deriveProblems`, `MEDIA_LIMITS`, command and result schemas, `SyncResponse`), the `az.executions` and `az.errors.*` strings, and `createExecutionsApi`. Every task here runs against fakes, so Part 1 Tasks 6–17 (the real API) are needed only for Task 16's device run.

## Global Constraints

- All Foundation Part 3 (mobile) constraints still apply:
  - Expo-managed packages are installed with `pnpm --filter @taskop/mobile exec expo install <pkg>` so versions match SDK 57.
  - All text comes from `@taskop/i18n`, with phone strings under `az.mobile`.
  - Touch targets are at least 44 pt.
  - A network failure never logs the user out.
- `apps/mobile/AGENTS.md`: Expo changes every SDK, so check APIs against `https://docs.expo.dev/versions/v57.0.0/` before writing native code. Never hand-edit `ios/` or `android/`; configure native behaviour in `app.json`.
- **The shared packages ship `dist/`.** Before running any mobile test or typecheck, build them: `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build`. Commands below say "(after building the shared packages)" where this matters.
- **Native modules are never imported by code that Jest loads.** Only these import `expo-sqlite`, `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-network`, `expo-video`, `expo-crypto` or `@/lib/session`:
  - `src/offline/native/*`
  - `src/offline/offline-provider.tsx`
  - `src/features/execution/capture.tsx`
  - Tests that render a screen importing `./capture` mock it with `jest.mock('./capture', …)`.
- **Database:**
  - One SQLCipher database, `taskop.db`. Its key is 32 random bytes from `expo-crypto`, hex-encoded and kept in SecureStore under `taskop.dbKey` with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (FR-10.10).
  - The key is applied with `PRAGMA key = "x'<64 hex>'"` before any other statement.
  - Migrations are forward-only and tracked with `PRAGMA user_version`.
- **Atomicity:** every worker action (start, answer, attach media, flag a problem, complete) runs in **one** `db.transaction(…)` that writes its rows and appends its outbox command. Inside a transaction callback only the `tx` handle is used. Calling the outer `db` from inside one would deadlock the queue.
- **Time:**
  - `startedAt`, `completedAt` and `capturedAt` are device times taken when the action happens.
  - `deviceTime` and `clientOffsetMs` are stamped when the command is **sent**. `clientOffsetMs` is device minus server, measured at the last successful `/me/sync`, rounded and clamped to ±2,000,000,000.
  - All instants stored locally are `Date.prototype.toISOString()` strings, so SQLite compares them as text.
- **Sync:**
  - Triggers: app start, reconnect, return to foreground, every **30 s** while online and in the foreground, and **2 s** after a local write.
  - A claim (start) asks for an immediate run.
  - The outbox is sent oldest first. Network errors, `5xx`, `408` and `429` stop the run, with backoff **5 s, 10 s, 20 s … capped at 5 min**. Any other `4xx` marks that command `failed` and the run moves on.
  - `401` stops the run without failing anything: the session layer decides about login.
  - Answers commands are collapsed: a new revision deletes older pending or failed answers commands of the same execution, in the same transaction.
- **Media:**
  - Photos are resized to a long edge of **1600 px** and saved as JPEG with quality **0.7**, at most 5 MB. Videos are recorded at `videoQuality="720p"` with `maxDuration: 60` and are at most 60 MB. All of these come from `MEDIA_LIMITS`; never repeat the literals.
  - Live-only items (`evidence.liveOnly`) offer the camera only.
  - Registration goes through the outbox **before** the answers that reference it (Part 1 decision 1).
  - The queue uploads one file at a time, photos before videos. It deletes a local file only after `uploaded` **and** 7 days after its execution finished syncing.
- **Data scope:** local data belongs to the user in `meta.userId`. Starting the offline services for any other user clears every table and every media file **before** the sync engine starts.
- No background sync. Nothing runs while the app is suspended.
- Checklist content with `schemaVersion > 1` is never parsed. The phone shows "Tətbiqi yeniləyin".
- Commits use explicit paths (`git add <paths>`, never `-A`). Messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Spec decisions this plan makes (ambiguities resolved)

1. **Home tiles count today, not this month.** The phone only holds the sync window (1 day back, 3 ahead, finished executions for 24 h), so month totals cannot be computed offline. The tiles become "Mənim tapşırıqlarım" (open + in progress), "Gecikən", "Tamamlanan (bu gün)" and "Problemlər (bu gün)". Monthly figures belong to SP7 dashboards.
2. **Command timing is stamped at send time.** `deviceTime`/`clientOffsetMs` describe the moment of sending, which is what the server's `CLOCK_INVALID` check (device time vs receipt) is about. The action times (`startedAt`, `completedAt`, `capturedAt`) are captured when the worker acts.
3. **A rejected claim makes the execution read-only on the phone.** The commands already queued are still sent, because the server stores them and nothing is lost (spec §6.2). The worker sees the alert and a banner.
4. **A failed claim holds back the later commands of the same execution.** Without the claim they could only fail with `404`. "Yenidən cəhd et" resets every failed command to pending and runs again.
5. **`401` is not a parked `4xx`.** The API client already tried to refresh. If the refresh failed on the network, the error is `NETWORK` and the run backs off. If it was rejected, the user is sent to login and the command stays pending.
6. **A completion never supersedes answers commands.** Only a newer answers revision does. If completion were refused (`REQUIREMENTS_UNMET` stores nothing, Part 1 decision 12), the server would otherwise never receive the answers. Completion uses `rev = max(rev, 1)`, because `completeCommandSchema` needs `rev ≥ 1`.
7. **The media queue asks for a fresh upload URL on every attempt** (register replay, Part 1 decision 1). Network errors do not count as attempts. A bad upload status or `MEDIA_NOT_FOUND_IN_STORAGE` counts. After 5 attempts the file is marked failed and shown red until "Yenidən cəhd et".
8. **"Finished syncing"** means the execution is no longer `active` and none of its commands is left in the outbox (`executions.finished_synced_at`). The 7-day file retention counts from then.
9. **Gallery photos are re-encoded as JPEG** with the same resize, so every photo the phone sends is `image/jpeg`. Gallery videos with a short edge above 720 px, longer than 60 s or over 60 MB are refused on the phone, since the server would refuse them anyway.
10. **`expo-crypto` is added** (not in spec §7.1). It supplies the random bytes for the SQLCipher key and for client UUIDv7s. Hermes has no `crypto.getRandomValues`.
11. **Transactions are serialised in JS on one connection.** `withExclusiveTransactionAsync` opens a second connection, which would not carry the SQLCipher key. `withTransactionAsync` lets other queries interleave. The queue in `createDb` gives one-at-a-time semantics, and Jest tests it.
12. **Logout also clears local data when nothing is unsynced**, because data is scoped to the signed-in user.
13. **Media attached to a manual problem** is registered with `itemId: null` (spec §5.2). On a live-only item the phone still offers only the camera for it.
14. **The interval and the 2 s local-write triggers respect the backoff.** Start, reconnect, foreground, claim and the retry button run at once.
15. **The local lock at `closes_at` writes no command.** The server's sweep makes the execution `partial` (spec §6.5). The phone marks it `partial` itself and keeps it locked even if the device clock is later moved back.
16. **Date/time items use a text field with an "İndi" button.** This avoids a picker dependency. Values are validated against the same formats as `answerIssues`: `YYYY-MM-DD`, `HH:MM`, and an ISO instant for `datetime`.

## Review Focus

These are the five failure modes most likely to bite users that no spec test names. Each line gives the task and test that pin it.

1. **App killed between the SQLite write and the outbox append.** The answer must not be saved without its command, or it would never reach the server. Pinned in Task 6 (`rolls the answer back when the outbox append fails (app killed between the two writes)`).
2. **Answers edited while a sync run is in flight.** Revision 1 is on the wire when the worker types revision 2. Revision 2 must be sent next in the same run, and the late success of revision 1 must not delete it or lower `synced_rev`. Pinned in Task 8 (`answers edited while their previous revision is in flight are sent next, in the same run`).
3. **Token refresh failing mid-outbox.** A rejected refresh (`401`) must leave the command pending, not mark it red, and must not retry in a loop. A refresh lost to the network must back off like any network error. Pinned in Task 8 (`an expired session stops the run without failing or retrying the command` and `a NETWORK failure stops the run and keeps the command pending`).
4. **Device clock moved backwards.** A clock set back must not reopen a locked execution, and must not produce `completedAt < startedAt`. Pinned in Task 6 (`locks at closes_at and stays locked when the clock is moved back` and `never completes before it started when the clock moved backwards`).
5. **Signing in as another user with unsynced data.** The previous user's executions, outbox and media files must be gone before the engine runs, and nothing of theirs may be sent with the new token. Pinned in Task 9 (`signing in as another user clears the previous user's unsynced data and never sends it`).

---

## File Structure

```
README.md                                       + phone development build, LAN IP, S3_PUBLIC_ENDPOINT
packages/i18n/src/az/mobile.ts                  + checklists, execution, evidence, problem, finish, sync, logout, offline
packages/i18n/src/i18n.test.ts                  + mobile execution strings
apps/mobile/
  package.json                                  + 8 Expo modules; ios/android scripts → expo run:*
  app.json                                      + expo-sqlite (useSQLCipher), expo-camera, expo-image-picker, expo-video plugins
  .env.example                                  LAN IP note
  app/(app)/_layout.tsx                         OfflineProvider around the tabs, hidden routes
  app/(app)/sync.tsx                            sync queue route
  app/(app)/execution/[id]/index.tsx            execution route (param itemId = jump target)
  app/(app)/execution/[id]/finish.tsx           finish route
  src/app-config.test.ts                        plugin and dependency guard
  src/components/commit-input.tsx               debounced text input that commits on blur
  src/components/primary-button.tsx             + accessibilityLabel
  src/lib/time.ts (+ test)                      formatTime, localDate in the tenant time zone
  src/offline/
    db.ts (+ test)                              Db, createDb (queue + transactions), migrations, meta
    ids.ts (+ test)                             uuidv7
    clock.ts (+ test)                           Clock, measureOffset, clampOffset, readOffset, isClockSkewed
    local-model.ts (+ test)                     row types and mappers, iso/normIso
    content.ts (+ test)                         loadContent (schemaVersion gate), findItem
    change-feed.ts                              emit/subscribe
    outbox.ts (+ test)                          append (answers collapse), next, ack, fail, retry, counts, list
    sync-pull.ts (+ test)                       applyPull, knownVersionIds
    user-scope.ts (+ test)                      ensureUser, clearLocalData
    execution-store.ts (+ test)                 start, patchAnswer, attachMedia, removeMedia, setProblem, complete, lock
    sync-api.ts (+ test)                        SyncApi, classifyError
    media-queue.ts (+ test)                     drain, cleanup, counts, list, retryFailed
    sync-engine.ts (+ test)                     run, backoff, status, retryFailed
    sync-triggers.ts (+ test)                   start/reconnect/foreground/30 s/2 s
    services.ts (+ test)                        createOfflineServices
    context.tsx, hooks.ts                       useOffline, useLiveQuery, useSyncStatus, useNow
    offline-provider.tsx                        native services for the signed-in user
    native/open-database.ts, media-files.ts, ports.ts, device.ts, create-native-services.ts
    testing/node-db.ts, fixtures.ts, fake-transport.ts, harness.ts, fake-api.ts, test-services.ts, render.tsx
  src/features/
    sync/claim-rejection.ts (+ test), sync-indicator.tsx, sync-screen.tsx, sync.test.tsx
    checklists/group-occurrences.ts (+ test), occurrence-card.tsx
    home/home-screen.tsx (+ test)               My checklists
    execution/media-capture.ts (+ test), capture.tsx, datetime-format.ts (+ test), parts.tsx,
              item-field.tsx, problem-sheet.tsx, use-execution.ts, execution-screen.tsx (+ test),
              finish-screen.tsx (+ test)
    profile/profile-screen.tsx (+ test)         logout warning
```

---

### Task 1: Native modules, config plugins and phone development docs

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/.env.example`, `README.md`
- Test: `apps/mobile/src/app-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Direct dependencies `expo-sqlite`, `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-network`, `expo-video` and `expo-crypto`, at SDK 57 versions.
  - Plugins `["expo-sqlite", { "useSQLCipher": true }]`, `["expo-camera", {…}]`, `["expo-image-picker", {…}]` and `"expo-video"`.
  - Scripts `ios` → `expo run:ios`, `android` → `expo run:android`.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/app-config.test.ts`:

```ts
import appJson from '../app.json';
import pkg from '../package.json';

type Plugin = string | [string, Record<string, unknown>];
const plugins = appJson.expo.plugins as Plugin[];
const options = (name: string) => plugins.find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === name)?.[1];

describe('native configuration', () => {
  it('encrypts the local database with SQLCipher', () => {
    expect(options('expo-sqlite')).toEqual({ useSQLCipher: true });
  });

  it('asks for camera, microphone and photo access in Azerbaijani', () => {
    expect(options('expo-camera')).toMatchObject({
      recordAudioAndroid: true,
      cameraPermission: expect.stringContaining('kamera'),
      microphonePermission: expect.stringContaining('mikrofon'),
    });
    expect(options('expo-image-picker')).toMatchObject({ photosPermission: expect.stringContaining('qalereya') });
    expect(plugins).toContain('expo-video');
  });

  it('depends on every Expo module the offline layer uses and builds development builds', () => {
    const deps = Object.keys(pkg.dependencies);
    for (const m of ['expo-sqlite', 'expo-camera', 'expo-image-picker', 'expo-image-manipulator', 'expo-file-system', 'expo-network', 'expo-video', 'expo-crypto']) {
      expect(deps).toContain(m);
    }
    expect(pkg.scripts.ios).toBe('expo run:ios');
    expect(pkg.scripts.android).toBe('expo run:android');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/app-config.test.ts`
Expected: FAIL. `options('expo-sqlite')` is `undefined` and `expo-sqlite` is missing from `dependencies`.

- [ ] **Step 3: Install the modules**

From the repo root:

```bash
pnpm --filter @taskop/mobile exec expo install expo-sqlite expo-camera expo-image-picker expo-image-manipulator expo-file-system expo-network expo-video expo-crypto
```

`expo install` may add bare plugin entries to `app.json`. Step 4 replaces the `plugins` array completely.

Check the API facts this plan relies on against the installed versions. Record any difference in the task's commit message and adapt only the matching file in `src/offline/native/` or `capture.tsx`:
- `expo-sqlite`:
  - `openDatabaseAsync(name)`, `execAsync`, `runAsync(sql, params[])` → `{ changes }`, `getAllAsync<T>(sql, params[])`, `getFirstAsync`, `closeAsync`, `deleteDatabaseAsync(name)`
  - the plugin option `useSQLCipher` (https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- `expo-file-system` (the new default API; `expo-file-system/legacy` is not used):
  - `File`, `Directory`, `Paths.document`
  - `file.size`, `file.exists`, `file.moveSync(dest)`, `file.delete()`
  - `file.upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers })` → `{ status }`
  - All of these are verified in `expo-file-system@57.0.7`'s `build/*.d.ts`.
- `expo-image-manipulator`: the context API `ImageManipulator.manipulate(uri).resize({ width | height }).renderAsync()` → `ImageRef.saveAsync({ format: SaveFormat.JPEG, compress })` → `{ uri, width, height }`. `manipulateAsync` is deprecated in SDK 57.
- `expo-camera`:
  - `CameraView` props `mode="picture" | "video"`, `videoQuality="720p"`, `facing="back"`
  - `takePictureAsync()` → `{ uri, width, height }`; `recordAsync({ maxDuration, maxFileSize })` → `{ uri } | undefined`; `stopRecording()`
  - `useCameraPermissions`, `useMicrophonePermissions`
  - The docs note that some 16:9 qualities are Android-only, so Task 16 checks the iOS recording resolution.
- `expo-image-picker`: `launchImageLibraryAsync({ mediaTypes: ['images'] | ['videos'], quality, videoMaxDuration, allowsMultipleSelection })` → `{ canceled, assets: [{ uri, width, height, mimeType, fileSize, duration (ms) }] }`.
- `expo-network`: `getNetworkStateAsync()` and `addNetworkStateListener(listener)` → `{ remove() }`, with `isConnected` and `isInternetReachable`.
- `expo-video`: `useVideoPlayer(source, setup)` and `<VideoView player nativeControls contentFit />`.
- `expo-crypto`: `getRandomBytes(byteCount): Uint8Array`.

- [ ] **Step 4: Configure plugins and scripts**

In `apps/mobile/app.json`, replace `"plugins"` with:

```json
    "plugins": [
      "expo-router",
      "expo-secure-store",
      "expo-status-bar",
      ["expo-sqlite", { "useSQLCipher": true }],
      [
        "expo-camera",
        {
          "cameraPermission": "Taskop yoxlamalar zamanı foto və video çəkmək üçün kameradan istifadə edir.",
          "microphonePermission": "Taskop video sübutlarda səsi yazmaq üçün mikrofondan istifadə edir.",
          "recordAudioAndroid": true
        }
      ],
      [
        "expo-image-picker",
        { "photosPermission": "Taskop sübut kimi qalereyadan foto və video seçmək üçün icazə istəyir." }
      ],
      "expo-video"
    ],
```

In `apps/mobile/package.json`, change two scripts. SQLCipher and the camera need a development build, and Expo Go cannot run them:

```json
    "android": "expo run:android",
    "ios": "expo run:ios",
```

Replace `apps/mobile/.env.example` with:

```bash
# The API the app talks to. On a physical phone use your Mac's LAN IP (`ipconfig getifaddr en0`), e.g.
# EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
# Photo and video uploads go straight from the phone to S3_PUBLIC_ENDPOINT (apps/api/.env),
# which must then be the same LAN IP on port 8333, e.g. http://192.168.1.20:8333.
EXPO_PUBLIC_API_URL=http://localhost:3000
```

In `README.md`, replace the `## Mobile (Expo)` section's last paragraph (the one starting `` `EXPO_PUBLIC_API_URL` points the app``) with:

````markdown
`EXPO_PUBLIC_API_URL` points the app at the API (default `http://localhost:3000`).

### Running on a phone (development build)
Checklist execution uses native modules that Expo Go does not ship (SQLCipher, camera), so run a development build:
```bash
ipconfig getifaddr en0                     # your Mac's LAN IP, e.g. 192.168.1.20
# apps/mobile/.env:  EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
# apps/api/.env:     S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333   (presigned upload URLs point here)
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
pnpm --filter @taskop/mobile android -- --device
```
The phone and the Mac must be on the same Wi-Fi, and the macOS firewall must accept incoming connections for Node (port 3000) and Docker (port 8333). The iOS simulator can keep `localhost`.
````

- [ ] **Step 5: Run the test, typecheck and resolve the config**

Run: `pnpm --filter @taskop/mobile test -- src/app-config.test.ts && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile exec expo config --type prebuild > /dev/null`
Expected: PASS (3 tests). Typecheck is clean, and `expo config` exits 0. Exit 0 proves every plugin resolves with its options.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json apps/mobile/.env.example apps/mobile/src/app-config.test.ts README.md pnpm-lock.yaml
git commit -m "chore(mobile): add SQLCipher, camera, picker, file system, network and video modules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Phone strings for checklists, execution, evidence, problems, finish, sync and logout

**Files:**
- Modify: `packages/i18n/src/az/mobile.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `MISSING_KINDS` (Part 1 Task 1).
- Produces new `az.mobile` keys, used by Tasks 9–15:
  - `home.*`: values changed for the today-only tiles (decision 1)
  - `offline.{preparing, failed}`
  - `checklists.{sections.*, window, overdue, claimedBy, start, continue, view, opensAt, emptySection, startBlocked.*}`
  - `execution.*`, `evidence.*`, `problem.*`, `finish.{…, missingKinds.*}`
  - `sync.{…, kinds.*, states.*, mediaErrors.*}`, `logout.*`
- It reuses the existing keys `executions.alreadyClaimedBy`, `executions.claimRejections.*`, `executions.states.*`, `executions.severities.*`, `executions.mediaKinds.*`, `executions.flags.late`, `checklists.builder.fixedOptions.*`, `scheduling.statuses.*`, `common.*` and `errors.*`.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`, and add `MISSING_KINDS` to its `@taskop/contracts` import:

```ts
describe('mobile execution translations', () => {
  it('labels every missing kind, outbox command, start block and sync state', () => {
    for (const k of MISSING_KINDS) expect(az.mobile.finish.missingKinds[k], k).toBeTypeOf('string');
    for (const k of ['claim', 'media', 'answers', 'complete', 'upload'] as const) expect(az.mobile.sync.kinds[k], k).toBeTypeOf('string');
    for (const k of ['notYetOpen', 'closed', 'claimedByOther', 'finished', 'needsUpdate', 'notDownloaded'] as const) {
      expect(az.mobile.checklists.startBlocked[k], k).toBeTypeOf('string');
    }
    for (const k of ['synced', 'pending', 'offline', 'failed'] as const) expect(az.mobile.sync[k], k).toBeTypeOf('string');
    for (const k of ['FILE_MISSING', 'UPLOAD_FAILED'] as const) expect(az.mobile.sync.mediaErrors[k], k).toBeTypeOf('string');
    for (const k of ['tooLong', 'tooLarge', 'resolution'] as const) expect(az.mobile.evidence[k], k).toBeTypeOf('string');
  });

  it('uses the spec wording', () => {
    expect(az.mobile.checklists.sections).toEqual({ now: 'İndi', inProgress: 'Davam edən', upcoming: 'Gələcək', done: 'Bitmiş' });
    expect(az.mobile.checklists.claimedBy.replace('{{name}}', 'Murad')).toBe('Murad icra edir');
    expect(az.mobile.sync.pending.replace('{{count}}', '3')).toBe('3 gözləyir');
    expect(az.mobile.sync.retry).toBe('Yenidən cəhd et');
    expect(az.mobile.execution.flagProblem).toBe('Problem qeyd et');
    expect(az.mobile.execution.needsUpdate).toBe('Tətbiqi yeniləyin');
    expect(az.mobile.finish.complete).toBe('Tamamla');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL. `az.mobile.finish` is undefined.

- [ ] **Step 3: Implement**

Replace `packages/i18n/src/az/mobile.ts` with the following. `login`, `profile` and `changeSecret` are unchanged. `home` keeps its keys, but `subtitle`, `completed` and `issues` get new values:

```ts
export default {
  tabs: { home: 'Əsas', profile: 'Profil' },
  login: {
    title: 'Daxil ol',
    worker: 'İşçi',
    staff: 'Rəhbər',
    orgCode: 'Təşkilat kodu',
    username: 'İstifadəçi adı',
    secret: 'PIN və ya şifrə',
    email: 'E-poçt',
    password: 'Şifrə',
    submit: 'Daxil ol',
    hint: 'Giriş məlumatlarını rəhbərinizdən alın.',
  },
  home: {
    greeting: 'Salam, {{name}}!',
    subtitle: 'Bugünkü yoxlamalarınız',
    myTasks: 'Mənim tapşırıqlarım',
    overdue: 'Gecikən',
    completed: 'Tamamlanan (bu gün)',
    issues: 'Problemlər (bu gün)',
    recent: 'Son tapşırıqlar',
    empty: 'Hələ tapşırıq yoxdur.',
    offline: 'Oflayn rejim — internet bərpa olunanda məlumatlar yenilənəcək.',
  },
  profile: {
    title: 'Profil',
    role: 'Rol',
    organization: 'Təşkilat',
    login: 'Giriş',
    changeSecret: 'PIN/şifrəni dəyiş',
    logout: 'Çıxış',
  },
  changeSecret: {
    title: 'PIN/şifrəni dəyiş',
    current: 'Cari PIN/şifrə',
    next: 'Yeni PIN/şifrə',
    submit: 'Dəyiş',
    done: 'Dəyişdirildi.',
  },
  offline: {
    preparing: 'Məlumatlar hazırlanır…',
    failed: 'Telefondakı məlumat bazası açıla bilmədi. Tətbiqi bağlayıb yenidən açın.',
  },
  checklists: {
    sections: { now: 'İndi', inProgress: 'Davam edən', upcoming: 'Gələcək', done: 'Bitmiş' },
    window: '{{from}}–{{to}}',
    overdue: 'Gecikir',
    claimedBy: '{{name}} icra edir',
    start: 'Başla',
    continue: 'Davam et',
    view: 'Bax',
    opensAt: '{{time}}-da açılır',
    emptySection: 'Burada heç nə yoxdur.',
    startBlocked: {
      notYetOpen: 'İcra vaxtı hələ başlamayıb.',
      closed: 'İcra vaxtı bitib.',
      claimedByOther: 'Bu checklist başqa əməkdaş tərəfindən icra olunur.',
      finished: 'Bu checklist artıq bitib.',
      needsUpdate: 'Tətbiqi yeniləyin',
      notDownloaded: 'Checklist hələ telefona yüklənməyib. İnternetə qoşulun.',
    },
  },
  execution: {
    section: 'Bölmə {{n}}/{{total}}',
    progress: '{{answered}}/{{total}} cavablandı',
    previous: 'Əvvəlki bölmə',
    next: 'Növbəti bölmə',
    finish: 'Bitir',
    note: 'Qeyd',
    notePlaceholder: 'Nə gördüyünüzü qısa yazın',
    now: 'İndi',
    numberRange: '{{min}}–{{max}} arası',
    invalidNumber: 'Rəqəm düzgün deyil və ya icazə verilən aralıqdan kənardır.',
    invalidDate: 'Format düzgün deyil.',
    datePlaceholder: { date: 'İİİİ-AA-GG', time: 'SS:DD', datetime: 'İİİİ-AA-GG SS:DD' },
    locked: 'İcra vaxtı bitib — cavablar yarımçıq kimi saxlanıldı.',
    completedBanner: 'Tamamlanıb. Cavablar artıq dəyişdirilə bilməz.',
    needsUpdate: 'Tətbiqi yeniləyin',
    needsUpdateHint: 'Bu checklist tətbiqin daha yeni versiyasını tələb edir.',
    notFound: 'İcra tapılmadı.',
    flagProblem: 'Problem qeyd et',
    problemFlagged: 'Problem qeyd olunub',
  },
  evidence: {
    camera: 'Kamera',
    gallery: 'Qalereya',
    liveOnly: 'Yalnız kamera',
    count: '{{count}}/{{limit}}',
    take: 'Çək',
    record: 'Yazmağa başla',
    stop: 'Dayandır',
    grant: 'İcazə ver',
    cameraPermission: 'Sübut çəkmək üçün kameraya (videoda həm də mikrofona) icazə verin.',
    remove: 'Sil',
    removeTitle: 'Fayl silinsin?',
    uploaded: 'Yükləndi',
    limitReached: 'Bu sual üçün fayl limiti dolub və ya bu mənbəyə icazə yoxdur.',
    failed: 'Fayl hazırlana bilmədi. Yenidən cəhd edin.',
    tooLong: 'Video 60 saniyədən uzun ola bilməz.',
    tooLarge: 'Fayl çox böyükdür.',
    resolution: 'Video 720p-dən yüksək ola bilməz. Kamera ilə çəkin.',
  },
  problem: {
    title: 'Problem qeyd et',
    severity: 'Ciddilik',
    note: 'Təsvir',
    media: 'Foto və video (ən çox 5)',
    save: 'Yadda saxla',
    remove: 'Problemi sil',
    noteRequired: 'Təsvir yazın.',
  },
  finish: {
    title: 'Bitir',
    missingTitle: 'Tamamlamaq üçün qalanlar',
    none: 'Bütün tələblər yerinə yetirilib.',
    score: 'Bal',
    noScore: 'Bal hesablanmır',
    problems: 'Problemlər: {{count}}',
    complete: 'Tamamla',
    completed: 'Checklist tamamlandı.',
    missingKinds: {
      answer: 'Cavab verilməyib',
      photo: 'Foto lazımdır',
      video: 'Video lazımdır',
      note: 'Qeyd lazımdır',
      mediaCount: 'Kifayət qədər fayl yoxdur',
    },
  },
  sync: {
    title: 'Sinxronizasiya',
    synced: 'Sinxronlaşdırılıb',
    pending: '{{count}} gözləyir',
    offline: 'Oflayn',
    failed: '{{count}} xəta',
    lastSynced: 'Son sinxronizasiya: {{time}}',
    never: 'Hələ sinxronlaşdırılmayıb',
    empty: 'Göndəriləcək heç nə yoxdur.',
    retry: 'Yenidən cəhd et',
    signInAgain: 'Sessiya bitib. Göndərmək üçün yenidən daxil olun.',
    clockSkew: 'Telefonun saatı serverdən {{minutes}} dəqiqə fərqlənir. Telefonun saatını yoxlayın.',
    kinds: { claim: 'Başlama', media: 'Fayl qeydiyyatı', answers: 'Cavablar', complete: 'Tamamlama', upload: 'Fayl yükləmə' },
    states: { pending: 'Gözləyir', failed: 'Xəta' },
    mediaErrors: { FILE_MISSING: 'Fayl telefonda tapılmadı.', UPLOAD_FAILED: 'Fayl bir neçə cəhddən sonra yüklənmədi.' },
  },
  logout: {
    unsyncedTitle: 'Göndərilməmiş məlumat var',
    unsyncedBody: '{{count}} dəyişiklik hələ serverə göndərilməyib. Çıxsanız, onlar bu telefondan silinəcək.',
    continue: 'Yenə də çıx',
    confirmTitle: 'Əminsiniz?',
    confirmBody: 'Göndərilməmiş cavablar, foto və videolar həmişəlik silinəcək.',
    confirm: 'Sil və çıx',
  },
} as const;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/mobile test -- src/features`
Expected: PASS. The existing mobile login and change-secret tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/az/mobile.ts packages/i18n/src/i18n.test.ts
git commit -m "feat(i18n): add phone strings for checklist execution, evidence, problems and sync" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Local database: one queued connection, transactions and forward-only migrations

**Files:**
- Create: `apps/mobile/src/offline/db.ts`, `apps/mobile/src/offline/testing/node-db.ts`
- Test: `apps/mobile/src/offline/db.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SqlValue = string | number | null`
  - `interface SqlDriver { exec(sql): Promise<void>; run(sql, params: SqlValue[]): Promise<number /* changes */>; all<T>(sql, params: SqlValue[]): Promise<T[]>; close(): Promise<void> }`
  - `interface Db`:
    - `exec(sql)`, `run(sql, params?)` → `Promise<number>`, `all<T>(sql, params?)`, `first<T>(sql, params?)` → `Promise<T | null>`
    - `transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>`
    - `close()`
  - `createDb(driver: SqlDriver): Db`. Every call and every transaction runs alone, in call order. A transaction is `BEGIN IMMEDIATE … COMMIT`, or `ROLLBACK` when the callback throws.
  - `MIGRATIONS: readonly string[]`, `migrate(db, migrations = MIGRATIONS): Promise<number>`
    - Each step runs in its own transaction and bumps `PRAGMA user_version`.
    - A database newer than the app throws `Error('Local database version N is newer than this app (M)')`.
  - `type MetaKey = 'userId' | 'clockOffsetMs' | 'lastSyncedAt'`, `getMeta(db, key)`, `setMeta(db, key, value)`
  - Testing:
    - `nodeDriver(path = ':memory:'): SqlDriver` over `node:sqlite`, loaded with `process.getBuiltinModule` so Jest's resolver is never involved
    - `openTestDb(driver?)` returns a migrated `Db`
    - `failingDriver(base, pattern)` returns `SqlDriver & { armed: boolean }`

Schema v1 (all instants are ISO strings, all IDs UUID strings):

| Table | Columns |
|---|---|
| `meta` | `key` PK, `value` |
| `occurrences` | `id` PK, `checklist_id`, `checklist_name`, `site_id`, `site_name`, `shift_name?`, `local_date`, `starts_at`, `due_at`, `closes_at`, `status`, `checklist_version_id`, `claim_execution_id?`, `claim_user_id?`, `claim_name?` |
| `checklist_versions` | `id` PK, `checklist_id`, `number`, `schema_version`, `content` (raw JSON text), `received_at` |
| `executions` | `id` PK, `occurrence_id`, `checklist_version_id`, `state` (`active·completed·partial·rejected`), `claim` (`pending·accepted·rejected`), `rejected_reason?`, `rejected_by?`, `started_at`, `completed_at?`, `locked_at?`, `answers` (JSON, default `'{}'`), `rev` (default 0), `synced_rev` (default 0), `finished_synced_at?`, `updated_at` |
| `media` | `id` PK, `execution_id`, `item_id?`, `kind`, `source`, `mime`, `bytes`, `width?`, `height?`, `duration_ms?`, `captured_at`, `local_uri`, `registered_at?`, `uploaded_at?`, `failed_code?`, `attempts` (default 0), `file_deleted_at?` |
| `outbox` | `seq` INTEGER PK AUTOINCREMENT, `execution_id`, `kind` (`claim·media·answers·complete`), `ref_id?`, `rev?`, `payload` (JSON), `status` (`pending·failed`, default `pending`), `attempts` (default 0), `error_code?`, `error_key?`, `created_at` |

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/offline/db.test.ts`:

```ts
import { createDb, getMeta, migrate, MIGRATIONS, setMeta, type SqlDriver } from './db';
import { nodeDriver } from './testing/node-db';

const tables = async (db: ReturnType<typeof createDb>) =>
  (await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).map((r) => r.name);

describe('local database', () => {
  it('creates every table on a fresh database and records the schema version', async () => {
    const db = createDb(nodeDriver());
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await tables(db)).toEqual(['checklist_versions', 'executions', 'media', 'meta', 'occurrences', 'outbox']);
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: MIGRATIONS.length });
  });

  it('does nothing when already migrated and keeps the data', async () => {
    const db = createDb(nodeDriver());
    await migrate(db);
    await setMeta(db, 'userId', 'u1');
    await migrate(db);
    expect(await getMeta(db, 'userId')).toBe('u1');
  });

  it('runs each migration in its own transaction and stops at the first failing one', async () => {
    const db = createDb(nodeDriver());
    const steps = ['CREATE TABLE a (x INTEGER)', 'CREATE TABLE b (y INTEGER); INSERT INTO nope VALUES (1)'];
    await expect(migrate(db, steps)).rejects.toThrow(/no such table: nope/);
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 1 });
    expect(await tables(db)).toEqual(['a']);
  });

  it('refuses a database written by a newer app version', async () => {
    const db = createDb(nodeDriver());
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow('Local database version 99 is newer than this app');
  });

  it('rolls a transaction back when its callback throws', async () => {
    const db = createDb(nodeDriver());
    await migrate(db);
    await expect(
      db.transaction(async (tx) => {
        await setMeta(tx, 'userId', 'u1');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await getMeta(db, 'userId')).toBeNull();
  });

  it('runs statements and transactions one at a time, in call order', async () => {
    const base = nodeDriver();
    const log: string[] = [];
    const slow: SqlDriver = {
      ...base,
      run: async (sql, params) => {
        log.push(`start ${String(params[0])}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const n = await base.run(sql, params);
        log.push(`end ${String(params[0])}`);
        return n;
      },
    };
    const db = createDb(slow);
    await migrate(db);
    const insert = `INSERT INTO meta (key, value) VALUES (?, 'x')`;
    const tx = db.transaction(async (t) => {
      await t.run(insert, ['a']);
      await t.run(insert, ['b']);
    });
    const outside = db.run(insert, ['c']);
    await Promise.all([tx, outside]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run (after building the shared packages): `pnpm --filter @taskop/mobile test -- src/offline/db.test.ts`
Expected: FAIL: `Cannot find module './db'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/offline/db.ts`:

```ts
export type SqlValue = string | number | null;

/** The primitives a SQLite engine provides: expo-sqlite on the phone, node:sqlite in Jest. */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  /** Returns the number of changed rows. */
  run(sql: string, params: SqlValue[]): Promise<number>;
  all<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<number>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** All-or-nothing. Inside `fn` use only `tx`: the outer handle would wait for this transaction to end. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * One connection, one queue: every statement and every transaction runs alone, in call order.
 * expo-sqlite's withTransactionAsync lets other queries interleave, and withExclusiveTransactionAsync opens a
 * second connection that would not carry the SQLCipher key, so atomicity comes from this queue instead.
 */
export function createDb(driver: SqlDriver): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job, job);
    tail = result.catch(() => undefined);
    return result;
  };
  const inTransaction: Db = {
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => driver.run(sql, params),
    all: <T>(sql: string, params: SqlValue[] = []) => driver.all<T>(sql, params),
    first: async <T>(sql: string, params: SqlValue[] = []) => (await driver.all<T>(sql, params))[0] ?? null,
    transaction: () => Promise.reject(new Error('Nested transactions are not supported')),
    close: () => Promise.reject(new Error('Cannot close the database inside a transaction')),
  };
  return {
    exec: (sql) => enqueue(() => driver.exec(sql)),
    run: (sql, params = []) => enqueue(() => driver.run(sql, params)),
    all: <T>(sql: string, params: SqlValue[] = []) => enqueue(() => driver.all<T>(sql, params)),
    first: <T>(sql: string, params: SqlValue[] = []) => enqueue(async () => (await driver.all<T>(sql, params))[0] ?? null),
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      enqueue(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(inTransaction);
          await driver.exec('COMMIT');
          return result;
        } catch (e) {
          await driver.exec('ROLLBACK').catch(() => undefined);
          throw e;
        }
      }),
    close: () => enqueue(() => driver.close()),
  };
}

/** Forward-only. Never edit a shipped entry: append a new one. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE occurrences (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL,
    checklist_name TEXT NOT NULL,
    site_id TEXT NOT NULL,
    site_name TEXT NOT NULL,
    shift_name TEXT,
    local_date TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    closes_at TEXT NOT NULL,
    status TEXT NOT NULL,
    checklist_version_id TEXT NOT NULL,
    claim_execution_id TEXT,
    claim_user_id TEXT,
    claim_name TEXT
  );
  CREATE TABLE checklist_versions (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    content TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE TABLE executions (
    id TEXT PRIMARY KEY,
    occurrence_id TEXT NOT NULL,
    checklist_version_id TEXT NOT NULL,
    state TEXT NOT NULL,
    claim TEXT NOT NULL,
    rejected_reason TEXT,
    rejected_by TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    locked_at TEXT,
    answers TEXT NOT NULL DEFAULT '{}',
    rev INTEGER NOT NULL DEFAULT 0,
    synced_rev INTEGER NOT NULL DEFAULT 0,
    finished_synced_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX executions_occurrence ON executions (occurrence_id);
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    item_id TEXT,
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
  CREATE INDEX media_execution ON media (execution_id);
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL,
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
  CREATE INDEX outbox_execution ON outbox (execution_id, kind);
  `,
];

export async function migrate(db: Db, migrations: readonly string[] = MIGRATIONS): Promise<number> {
  const from = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (from > migrations.length) throw new Error(`Local database version ${from} is newer than this app (${migrations.length})`);
  for (let version = from; version < migrations.length; version++) {
    await db.transaction(async (tx) => {
      await tx.exec(migrations[version]!);
      await tx.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
  return migrations.length;
}

export type MetaKey = 'userId' | 'clockOffsetMs' | 'lastSyncedAt';

export async function getMeta(db: Db, key: MetaKey): Promise<string | null> {
  return (await db.first<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))?.value ?? null;
}

export async function setMeta(db: Db, key: MetaKey, value: string): Promise<void> {
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}
```

`apps/mobile/src/offline/testing/node-db.ts`:

```ts
import { createDb, type Db, migrate, type SqlDriver, type SqlValue } from '../db';

type NodeSqlite = typeof import('node:sqlite');

/**
 * Node 24's built-in SQLite, loaded through process.getBuiltinModule so Jest's module resolver never sees it.
 * Test-only: nothing in the app imports this file.
 */
export function nodeDriver(path = ':memory:'): SqlDriver {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as NodeSqlite;
  const db = new DatabaseSync(path);
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params) => Number(db.prepare(sql).run(...params).changes),
    all: async <T>(sql: string, params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
    close: async () => {
      db.close();
    },
  };
}

export async function openTestDb(driver: SqlDriver = nodeDriver()): Promise<Db> {
  const db = createDb(driver);
  await migrate(db);
  return db;
}

/** A driver that throws "simulated crash" on statements matching `pattern` once `armed` is set: an app kill mid-action. */
export function failingDriver(base: SqlDriver, pattern: RegExp): SqlDriver & { armed: boolean } {
  const driver = {
    ...base,
    armed: false,
    run: async (sql: string, params: SqlValue[]) => {
      if (driver.armed && pattern.test(sql)) throw new Error('simulated crash');
      return base.run(sql, params);
    },
  };
  return driver;
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline/db.test.ts && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (6 tests). Node may print an `ExperimentalWarning` for SQLite, which is harmless.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/offline/db.ts apps/mobile/src/offline/db.test.ts apps/mobile/src/offline/testing/node-db.ts
git commit -m "feat(mobile): add the local SQLite layer with queued transactions and migrations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client IDs, clock offset, local row models and the content gate

**Files:**
- Create: `apps/mobile/src/offline/ids.ts`, `clock.ts`, `local-model.ts`, `content.ts` (all in `apps/mobile/src/offline/`)
- Test: `apps/mobile/src/offline/ids.test.ts`, `clock.test.ts`, `local-model.test.ts`, `content.test.ts`

**Interfaces:**
- Consumes: `Db`, `getMeta` (Task 3); `EXECUTION_LIMITS`, `parseDraftContent`, `walkItems`, `idSchema` and the types `Answers`, `ChecklistContent`, `Item`, `ClaimRef`, `ClaimRejectionReason`, `ExecutionState`, `MediaKind`, `MediaSource`, `OccurrenceStatus` from `@taskop/contracts`.
- Produces:
  - `uuidv7(now: number, random: (byteCount: number) => Uint8Array): string`
  - `interface Clock { now(): number }`, `systemClock`
  - `measureOffset(serverTime, sentAt, receivedAt): number`: device minus server, at the midpoint of the request
  - `clampOffset(ms): number` (±2e9, integer), `readOffset(db): Promise<number>`, `isClockSkewed(ms): boolean` (`> EXECUTION_LIMITS.clockSkewMs`)
  - `iso(ms)`, `normIso(s)`
  - `OccurrenceRow` / `LocalOccurrence` / `toOccurrence`
  - `ClaimStatus = 'pending' | 'accepted' | 'rejected'`, `ExecutionRow` / `LocalExecution` / `toExecution`
  - `MediaRow` / `LocalMedia` / `toMedia`
  - `SUPPORTED_SCHEMA_VERSION = 1`
  - `type ContentLoad = { kind: 'ok'; content } | { kind: 'needsUpdate' } | { kind: 'missing' }`
  - `loadContent(schemaVersion, raw): ContentLoad`, `findItem(content, itemId): Item | undefined`

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/offline/ids.test.ts`:

```ts
import { idSchema } from '@taskop/contracts';
import { uuidv7 } from './ids';

const filled = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);
const AT = Date.parse('2026-11-02T04:10:00.000Z');

describe('uuidv7', () => {
  it('is a version 7, RFC 4122 variant UUID with the millisecond time in the first 48 bits', () => {
    const id = uuidv7(AT, filled(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(AT);
    expect(idSchema.safeParse(id).success).toBe(true);
  });

  it('sorts by creation time and differs with the random part', () => {
    expect(uuidv7(AT, filled(0)) < uuidv7(AT + 1, filled(0))).toBe(true);
    expect(uuidv7(AT, filled(1))).not.toBe(uuidv7(AT, filled(2)));
  });
});
```

`apps/mobile/src/offline/clock.test.ts`:

```ts
import { clampOffset, isClockSkewed, measureOffset, readOffset } from './clock';
import { setMeta } from './db';
import { openTestDb } from './testing/node-db';

describe('clock offset', () => {
  it('is device minus server at the midpoint of the request', () => {
    const sent = Date.parse('2026-11-02T04:10:00.000Z');
    // The server stamped 04:08:00.200; the request took 400 ms on a phone that runs 2 min fast.
    expect(measureOffset('2026-11-02T04:08:00.200Z', sent, sent + 400)).toBe(120_000);
  });

  it('is clamped to the range commands accept and read back from meta', async () => {
    expect(clampOffset(3_000_000_000.4)).toBe(2_000_000_000);
    expect(clampOffset(-12.6)).toBe(-13);
    const db = await openTestDb();
    expect(await readOffset(db)).toBe(0);
    await setMeta(db, 'clockOffsetMs', '-4500');
    expect(await readOffset(db)).toBe(-4500);
  });

  it('flags more than 5 minutes of skew', () => {
    expect(isClockSkewed(300_000)).toBe(false);
    expect(isClockSkewed(-300_001)).toBe(true);
  });
});
```

`apps/mobile/src/offline/local-model.test.ts`:

```ts
import { iso, normIso, toExecution, toOccurrence } from './local-model';

describe('local rows', () => {
  it('normalises server instants so SQLite can compare them as text', () => {
    expect(normIso('2026-11-02T04:10:00Z')).toBe('2026-11-02T04:10:00.000Z');
    expect(iso(Date.parse('2026-11-02T04:10:00.5Z'))).toBe('2026-11-02T04:10:00.500Z');
  });

  it('maps occurrence and execution rows', () => {
    const occ = toOccurrence({
      id: 'o', checklist_id: 'c', checklist_name: 'Açılış', site_id: 's', site_name: 'Filial', shift_name: null, local_date: '2026-11-02',
      starts_at: 'a', due_at: 'b', closes_at: 'c', status: 'started', checklist_version_id: 'v',
      claim_execution_id: 'e', claim_user_id: 'u', claim_name: 'Murad',
    });
    expect(occ.claim).toEqual({ executionId: 'e', executorUserId: 'u', executorName: 'Murad' });
    const e = toExecution({
      id: 'e', occurrence_id: 'o', checklist_version_id: 'v', state: 'active', claim: 'pending', rejected_reason: null, rejected_by: null,
      started_at: 's', completed_at: null, locked_at: null, answers: '{"i":{"number":5}}', rev: 2, synced_rev: 1, finished_synced_at: null, updated_at: 'u',
    });
    expect(e).toMatchObject({ occurrenceId: 'o', answers: { i: { number: 5 } }, rev: 2, syncedRev: 1, claim: 'pending' });
  });
});
```

`apps/mobile/src/offline/content.test.ts`:

```ts
import { blankContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';
import { findItem, loadContent } from './content';

describe('checklist content gate', () => {
  it('parses content this app understands', () => {
    const r = loadContent(1, JSON.stringify(blankContent()));
    expect(r.kind).toBe('ok');
  });

  it('refuses a newer schemaVersion without parsing it, and treats unreadable content the same way', () => {
    expect(loadContent(2, '{"schemaVersion":2,"anything":true}')).toEqual({ kind: 'needsUpdate' });
    expect(loadContent(1, '{not json')).toEqual({ kind: 'needsUpdate' });
    expect(loadContent(1, '{"schemaVersion":1}')).toEqual({ kind: 'needsUpdate' });
  });

  it('finds follow-up items nested in rules', () => {
    const q = newItem('yes_no') as YesNoItem;
    const rule = newRule(q);
    const follow = newItem('text');
    rule.then.followUps.push(follow);
    q.rules.push(rule);
    const content = { ...blankContent(), sections: [{ ...newSection('A'), items: [q] }] };
    expect(findItem(content, follow.id)).toBe(follow);
    expect(findItem(content, 'nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/ids.test.ts src/offline/clock.test.ts src/offline/local-model.test.ts src/offline/content.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Implement**

`apps/mobile/src/offline/ids.ts`:

```ts
/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 10, 74 random bits.
 * Executions and media are created offline, so the phone generates their IDs (spec §1).
 * `random` is expo-crypto's getRandomBytes on the phone; tests pass their own.
 */
export function uuidv7(now: number, random: (byteCount: number) => Uint8Array): string {
  const b = new Uint8Array(16);
  let t = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  const r = random(10);
  b[6] = 0x70 | (r[0]! & 0x0f);
  b[7] = r[1]!;
  b[8] = 0x80 | (r[2]! & 0x3f);
  for (let i = 3; i < 10; i++) b[i + 6] = r[i]!;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

`apps/mobile/src/offline/clock.ts`:

```ts
import { EXECUTION_LIMITS } from '@taskop/contracts';
import { type Db, getMeta } from './db';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Device clock minus server clock (spec §6.6), taking the request's midpoint as the moment the server stamped. */
export function measureOffset(serverTime: string, sentAt: number, receivedAt: number): number {
  return Math.round((sentAt + receivedAt) / 2 - Date.parse(serverTime));
}

const OFFSET_LIMIT = 2_000_000_000;

/** Commands accept an integer within ±2e9 (Part 1 `commandTiming`). */
export const clampOffset = (ms: number): number => Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(ms)));

/** The offset measured at the last successful /me/sync, or 0 before the first one. */
export async function readOffset(db: Db): Promise<number> {
  const value = Number(await getMeta(db, 'clockOffsetMs'));
  return Number.isFinite(value) ? value : 0;
}

export const isClockSkewed = (offsetMs: number): boolean => Math.abs(offsetMs) > EXECUTION_LIMITS.clockSkewMs;
```

`apps/mobile/src/offline/local-model.ts`:

```ts
import type { Answers, ClaimRef, ClaimRejectionReason, ExecutionState, MediaKind, MediaSource, OccurrenceStatus } from '@taskop/contracts';

export const iso = (ms: number): string => new Date(ms).toISOString();
/** Server instants in the same 24-character form as `iso`, so SQLite text comparison orders them correctly. */
export const normIso = (s: string): string => iso(Date.parse(s));

export interface OccurrenceRow {
  id: string;
  checklist_id: string;
  checklist_name: string;
  site_id: string;
  site_name: string;
  shift_name: string | null;
  local_date: string;
  starts_at: string;
  due_at: string;
  closes_at: string;
  status: string;
  checklist_version_id: string;
  claim_execution_id: string | null;
  claim_user_id: string | null;
  claim_name: string | null;
}

export interface LocalOccurrence {
  id: string;
  checklistId: string;
  checklistName: string;
  siteId: string;
  siteName: string;
  shiftName: string | null;
  localDate: string;
  startsAt: string;
  dueAt: string;
  closesAt: string;
  status: OccurrenceStatus;
  checklistVersionId: string;
  claim: ClaimRef | null;
}

export const toOccurrence = (r: OccurrenceRow): LocalOccurrence => ({
  id: r.id,
  checklistId: r.checklist_id,
  checklistName: r.checklist_name,
  siteId: r.site_id,
  siteName: r.site_name,
  shiftName: r.shift_name,
  localDate: r.local_date,
  startsAt: r.starts_at,
  dueAt: r.due_at,
  closesAt: r.closes_at,
  status: r.status as OccurrenceStatus,
  checklistVersionId: r.checklist_version_id,
  claim:
    r.claim_execution_id && r.claim_user_id
      ? { executionId: r.claim_execution_id, executorUserId: r.claim_user_id, executorName: r.claim_name ?? '' }
      : null,
});

/** Whether the server has answered this execution's claim. */
export type ClaimStatus = 'pending' | 'accepted' | 'rejected';

export interface ExecutionRow {
  id: string;
  occurrence_id: string;
  checklist_version_id: string;
  state: string;
  claim: string;
  rejected_reason: string | null;
  rejected_by: string | null;
  started_at: string;
  completed_at: string | null;
  locked_at: string | null;
  answers: string;
  rev: number;
  synced_rev: number;
  finished_synced_at: string | null;
  updated_at: string;
}

export interface LocalExecution {
  id: string;
  occurrenceId: string;
  checklistVersionId: string;
  state: ExecutionState;
  claim: ClaimStatus;
  rejectedReason: ClaimRejectionReason | null;
  /** The name of the worker whose claim won, when ours was rejected. */
  rejectedBy: string | null;
  startedAt: string;
  completedAt: string | null;
  lockedAt: string | null;
  answers: Answers;
  rev: number;
  syncedRev: number;
  finishedSyncedAt: string | null;
}

export const toExecution = (r: ExecutionRow): LocalExecution => ({
  id: r.id,
  occurrenceId: r.occurrence_id,
  checklistVersionId: r.checklist_version_id,
  state: r.state as ExecutionState,
  claim: r.claim as ClaimStatus,
  rejectedReason: r.rejected_reason as ClaimRejectionReason | null,
  rejectedBy: r.rejected_by,
  startedAt: r.started_at,
  completedAt: r.completed_at,
  lockedAt: r.locked_at,
  answers: JSON.parse(r.answers) as Answers,
  rev: r.rev,
  syncedRev: r.synced_rev,
  finishedSyncedAt: r.finished_synced_at,
});

export interface MediaRow {
  id: string;
  execution_id: string;
  item_id: string | null;
  kind: string;
  source: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  captured_at: string;
  local_uri: string;
  registered_at: string | null;
  uploaded_at: string | null;
  failed_code: string | null;
  attempts: number;
  file_deleted_at: string | null;
}

export interface LocalMedia {
  id: string;
  executionId: string;
  itemId: string | null;
  kind: MediaKind;
  source: MediaSource;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedAt: string;
  localUri: string;
  registeredAt: string | null;
  uploadedAt: string | null;
  failedCode: string | null;
  attempts: number;
  fileDeletedAt: string | null;
}

export const toMedia = (r: MediaRow): LocalMedia => ({
  id: r.id,
  executionId: r.execution_id,
  itemId: r.item_id,
  kind: r.kind as MediaKind,
  source: r.source as MediaSource,
  mime: r.mime,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  durationMs: r.duration_ms,
  capturedAt: r.captured_at,
  localUri: r.local_uri,
  registeredAt: r.registered_at,
  uploadedAt: r.uploaded_at,
  failedCode: r.failed_code,
  attempts: r.attempts,
  fileDeletedAt: r.file_deleted_at,
});
```

`apps/mobile/src/offline/content.ts`:

```ts
import { type ChecklistContent, type Item, parseDraftContent, walkItems } from '@taskop/contracts';

/** The highest checklist content schemaVersion this app understands (SP2 §3.2). */
export const SUPPORTED_SCHEMA_VERSION = 1;

export type ContentLoad = { kind: 'ok'; content: ChecklistContent } | { kind: 'needsUpdate' } | { kind: 'missing' };

/** Newer or unreadable content is never guessed at: the worker is told to update the app ("Tətbiqi yeniləyin"). */
export function loadContent(schemaVersion: number, raw: string): ContentLoad {
  if (schemaVersion > SUPPORTED_SCHEMA_VERSION) return { kind: 'needsUpdate' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'needsUpdate' };
  }
  const parsed = parseDraftContent(json);
  return parsed.success ? { kind: 'ok', content: parsed.content } : { kind: 'needsUpdate' };
}

export function findItem(content: ChecklistContent, itemId: string): Item | undefined {
  const items = new Map<string, Item>();
  walkItems(content, (item) => items.set(item.id, item));
  return items.get(itemId);
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (db 6, ids 2, clock 3, local-model 2, content 3).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/offline/ids.ts apps/mobile/src/offline/ids.test.ts apps/mobile/src/offline/clock.ts apps/mobile/src/offline/clock.test.ts apps/mobile/src/offline/local-model.ts apps/mobile/src/offline/local-model.test.ts apps/mobile/src/offline/content.ts apps/mobile/src/offline/content.test.ts
git commit -m "feat(mobile): add UUIDv7 ids, clock offset, local row models and the schemaVersion gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Outbox, pull application and user scope

**Files:**
- Create: `apps/mobile/src/offline/change-feed.ts`, `outbox.ts`, `sync-pull.ts`, `user-scope.ts`, `testing/fixtures.ts`
- Test: `apps/mobile/src/offline/outbox.test.ts`, `sync-pull.test.ts`, `user-scope.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4; `SyncResponse`, `MyExecution` from `@taskop/contracts`.
- Produces:
  - `interface ChangeFeed { emit(): void; subscribe(listener): () => void }`, `createChangeFeed()`
  - Outbox basics: `COMMAND_KINDS = ['claim', 'media', 'answers', 'complete']`, `type CommandKind`, `interface OutboxCommand { seq, executionId, kind, refId, rev, payload, status, attempts, errorCode, errorKey, createdAt }`
  - Outbox writes:
    - `appendCommand(tx, { executionId, kind, refId?, rev?, payload, createdAt })`. For `answers`, it first deletes the execution's other answers commands, pending or failed.
    - `ackCommand(db, seq)`, `failCommand(db, seq, code, messageKey)`, `noteAttempt(db, seq)`, `retryFailedCommands(db)`
  - Outbox reads:
    - `nextCommand(db): Promise<OutboxCommand | null>` returns the oldest pending command, skipping executions whose claim failed
    - `outboxCounts(db): Promise<{ pending; failed }>`
    - `listCommands(db): Promise<QueueEntry[]>` (`OutboxCommand & { checklistName: string | null }`)
  - `applyPull(db, res: SyncResponse, offsetMs: number, now: number)`:
    - in one transaction: meta, versions, occurrence upserts and removals, execution merge
  - `knownVersionIds(db): Promise<string[]>`: the 200 most recently received
  - `interface FileRemover { remove(uri: string): void }`, `clearLocalData(db, files)`, `ensureUser(db, userId, files): Promise<'same' | 'switched' | 'fresh'>`
  - Test fixtures:
    - IDs: `ME`, `OTHER`, `OTHER_EXECUTION`, `OCC`…`OCC5`, `VERSION`, `VERSION2`, `CHECKLIST`, `SITE`
    - Times and ports: `T`, `DEVICE`, `testIds(clock)`, `manualClock(iso)` / `ManualClock`
    - Builders: `checklist()` / `Checklist`, `versionOf(content, id?, schemaVersion?)`, `occurrence(over?)`, `syncResponse(over?)`, `myExecution(over?)`

- [ ] **Step 1: Write the test fixtures**

`apps/mobile/src/offline/testing/fixtures.ts`:

```ts
import {
  blankContent,
  type ChecklistContent,
  type DeviceInfo,
  type MyExecution,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type PhotoItem,
  type SyncChecklistVersion,
  type SyncOccurrence,
  type SyncResponse,
  type YesNoItem,
} from '@taskop/contracts';
import type { Clock } from '../clock';
import { uuidv7 } from '../ids';

export const ME = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
export const OTHER = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02';
export const OTHER_EXECUTION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e03';
export const OCC = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e10';
export const OCC2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e11';
export const OCC3 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e12';
export const OCC4 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e13';
export const OCC5 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e14';
export const VERSION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e20';
export const VERSION2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e21';
export const CHECKLIST = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e30';
export const SITE = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e40';

/** Monday 2 Nov 2026 in Baku (UTC+4): window 08:00–11:00, due 10:00. */
export const T = {
  before: '2026-11-02T03:50:00.000Z',
  starts: '2026-11-02T04:00:00.000Z',
  open: '2026-11-02T04:10:00.000Z',
  due: '2026-11-02T06:00:00.000Z',
  closes: '2026-11-02T07:00:00.000Z',
} as const;

export const DEVICE: DeviceInfo = { platform: 'ios', osVersion: '26.0', appVersion: '0.1.0' };

export interface ManualClock extends Clock {
  set(isoTime: string): void;
  advance(ms: number): void;
}

export function manualClock(start: string): ManualClock {
  let t = Date.parse(start);
  return {
    now: () => t,
    set: (s) => {
      t = Date.parse(s);
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Distinct, time-ordered UUIDv7s for tests. */
export function testIds(clock: Clock): () => string {
  let n = 0;
  return () => uuidv7(clock.now() + n++, (k) => globalThis.crypto.getRandomValues(new Uint8Array(k)));
}

/**
 * Section "Zal": problem (yes → critical + photo + follow-up comment; photo evidence optional), temp (outside 2–8 → normal + note).
 * Section "Vitrin": photo (1–2, live-only), note (optional text).
 */
export function checklist() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Soyuducuda problem varmı?';
  problem.evidence = { photo: 'optional', video: 'none', liveOnly: false };
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true };
  const comment = newItem('comment');
  comment.label = 'Problemi təsvir edin';
  onYes.then.followUps.push(comment);
  problem.rules.push(onYes);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  temp.unit = '°C';
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  out.then.requireNote = true;
  temp.rules.push(out);
  const photo = newItem('photo') as PhotoItem;
  photo.label = 'Vitrinin şəkli';
  photo.minCount = 1;
  photo.maxCount = 2;
  photo.evidence = { photo: 'none', video: 'none', liveOnly: true };
  const note = newItem('text');
  note.label = 'Əlavə qeyd';
  note.required = false;
  const content: ChecklistContent = {
    ...blankContent(),
    sections: [
      { ...newSection('Zal'), items: [problem, temp] },
      { ...newSection('Vitrin'), items: [photo, note] },
    ],
  };
  return { content, problem, yes, no, comment, temp, photo, note };
}
export type Checklist = ReturnType<typeof checklist>;

export const versionOf = (content: unknown, id = VERSION, schemaVersion = 1): SyncChecklistVersion => ({
  id,
  checklistId: CHECKLIST,
  number: 1,
  schemaVersion,
  content,
});

export const occurrence = (over: Partial<SyncOccurrence> = {}): SyncOccurrence => ({
  id: OCC,
  checklistId: CHECKLIST,
  checklistName: 'Açılış yoxlaması',
  siteId: SITE,
  siteName: 'Bakı filialı 1',
  shiftName: 'Səhər',
  localDate: '2026-11-02',
  startsAt: T.starts,
  dueAt: T.due,
  closesAt: T.closes,
  status: 'pending',
  checklistVersionId: VERSION,
  claim: null,
  ...over,
});

export const syncResponse = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  serverTime: T.open,
  occurrences: [occurrence()],
  checklistVersions: [],
  executions: [],
  ...over,
});

export const myExecution = (over: Partial<MyExecution> = {}): MyExecution => ({
  id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e50',
  occurrenceId: OCC,
  checklistVersionId: VERSION,
  state: 'active',
  rejectedReason: null,
  startedAt: T.open,
  completedAt: null,
  answers: {},
  answersRev: 0,
  progress: { answered: 0, total: 4, requiredMissing: 3 },
  late: false,
  clockSuspect: false,
  mediaPending: 0,
  ...over,
});
```

- [ ] **Step 2: Write the failing tests**

`apps/mobile/src/offline/outbox.test.ts`:

```ts
import type { Db } from './db';
import { ackCommand, appendCommand, type CommandKind, failCommand, listCommands, nextCommand, outboxCounts, retryFailedCommands } from './outbox';
import { openTestDb } from './testing/node-db';

const AT = '2026-11-02T04:10:00.000Z';
const add = (db: Db, executionId: string, kind: CommandKind, extra: { refId?: string; rev?: number } = {}) =>
  appendCommand(db, { executionId, kind, payload: { kind }, createdAt: AT, ...extra });

describe('outbox', () => {
  it('hands out the oldest pending command first and forgets acknowledged ones', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'claim');
    await add(db, 'e1', 'media', { refId: 'm1' });
    const first = await nextCommand(db);
    expect(first).toMatchObject({ executionId: 'e1', kind: 'claim', payload: { kind: 'claim' }, status: 'pending' });
    await ackCommand(db, first!.seq);
    expect(await nextCommand(db)).toMatchObject({ kind: 'media', refId: 'm1' });
  });

  it('keeps only the newest answers revision of an execution, whether the older one was pending or failed', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'claim');
    await add(db, 'e1', 'answers', { rev: 1 });
    await add(db, 'e2', 'answers', { rev: 1 });
    const failed = (await listCommands(db)).find((c) => c.executionId === 'e1' && c.kind === 'answers')!;
    await failCommand(db, failed.seq, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED');
    await add(db, 'e1', 'answers', { rev: 2 });
    expect((await listCommands(db)).map((c) => [c.executionId, c.kind, c.rev, c.status])).toEqual([
      ['e1', 'claim', null, 'pending'],
      ['e2', 'answers', 1, 'pending'],
      ['e1', 'answers', 2, 'pending'],
    ]);
  });

  it('parks a failed command and holds back the rest of an execution whose claim failed', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'claim');
    await add(db, 'e1', 'answers', { rev: 1 });
    await add(db, 'e2', 'claim');
    const claim = (await nextCommand(db))!;
    await failCommand(db, claim.seq, 'CLOCK_INVALID', 'errors.CLOCK_INVALID');
    expect(await nextCommand(db)).toMatchObject({ executionId: 'e2', kind: 'claim' });
    expect(await outboxCounts(db)).toEqual({ pending: 2, failed: 1 });
    expect((await listCommands(db))[0]).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'CLOCK_INVALID', errorKey: 'errors.CLOCK_INVALID' });
    await retryFailedCommands(db);
    expect(await nextCommand(db)).toMatchObject({ executionId: 'e1', kind: 'claim', status: 'pending', errorCode: null });
  });
});
```

`apps/mobile/src/offline/sync-pull.test.ts`:

```ts
import { getMeta } from './db';
import { appendCommand } from './outbox';
import { applyPull, knownVersionIds } from './sync-pull';
import { checklist, myExecution, OCC, OCC2, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION, versionOf } from './testing/fixtures';
import { openTestDb } from './testing/node-db';

const NOW = Date.parse(T.open);

describe('applying /me/sync', () => {
  it('stores occurrences, new checklist versions, the clock offset and the sync time', async () => {
    const db = await openTestDb();
    const c = checklist();
    await applyPull(db, syncResponse({ occurrences: [occurrence({ startsAt: '2026-11-02T04:00:00Z' })], checklistVersions: [versionOf(c.content)] }), 120_000, NOW);
    expect(await db.first('SELECT id, starts_at, status, checklist_version_id FROM occurrences')).toEqual({
      id: OCC, starts_at: '2026-11-02T04:00:00.000Z', status: 'pending', checklist_version_id: VERSION,
    });
    expect(await getMeta(db, 'clockOffsetMs')).toBe('120000');
    expect(await getMeta(db, 'lastSyncedAt')).toBe(T.open);
    expect(await knownVersionIds(db)).toEqual([VERSION]);
    const stored = await db.first<{ content: string; schema_version: number }>('SELECT content, schema_version FROM checklist_versions');
    expect(JSON.parse(stored!.content)).toEqual(c.content);
  });

  it('updates claims and drops vanished occurrences unless the phone has an execution for them', async () => {
    const db = await openTestDb();
    await applyPull(db, syncResponse({ occurrences: [occurrence(), occurrence({ id: OCC2 })] }), 0, NOW);
    await db.run(`INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES ('x', ?, ?, 'active', 'pending', ?, ?)`, [OCC2, VERSION, T.open, T.open]);
    const claim = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
    await applyPull(db, syncResponse({ occurrences: [occurrence({ status: 'started', claim })] }), 0, NOW);
    expect(await db.all('SELECT id, status, claim_user_id, claim_name FROM occurrences ORDER BY id')).toEqual([
      { id: OCC, status: 'started', claim_user_id: OTHER, claim_name: 'Murad Həsənov' },
      { id: OCC2, status: 'pending', claim_user_id: null, claim_name: null },
    ]);
    await db.run('DELETE FROM executions');
    await applyPull(db, syncResponse({ occurrences: [] }), 0, NOW);
    expect(await db.all('SELECT id FROM occurrences')).toEqual([]);
  });

  it('adds my executions from the server so a reinstalled phone can resume them', async () => {
    const db = await openTestDb();
    const answers = { [VERSION]: { number: 5 } };
    await applyPull(db, syncResponse({ executions: [myExecution({ answers, answersRev: 2 }), myExecution({ id: OTHER_EXECUTION, occurrenceId: OCC2, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED' })] }), 0, NOW);
    expect(await db.all('SELECT state, claim, rejected_reason, rev, synced_rev, answers FROM executions ORDER BY id')).toEqual([
      { state: 'rejected', claim: 'rejected', rejected_reason: 'ALREADY_CLAIMED', rev: 0, synced_rev: 0, answers: '{}' },
      { state: 'active', claim: 'accepted', rejected_reason: null, rev: 2, synced_rev: 2, answers: JSON.stringify(answers) },
    ]);
  });

  it('takes newer server answers only when nothing is queued locally, and keeps a local lock', async () => {
    const db = await openTestDb();
    const x = myExecution({ answersRev: 2, answers: { a: { number: 1 } } });
    await applyPull(db, syncResponse({ executions: [x] }), 0, NOW);
    await db.run(`UPDATE executions SET answers = '{"a":{"number":3}}', rev = 3`);
    await appendCommand(db, { executionId: x.id, kind: 'answers', rev: 3, payload: {}, createdAt: T.open });
    await applyPull(db, syncResponse({ executions: [{ ...x, answersRev: 5, answers: { a: { number: 9 } } }] }), 0, NOW);
    expect(await db.first('SELECT rev, answers FROM executions')).toEqual({ rev: 3, answers: '{"a":{"number":3}}' });

    await db.run('DELETE FROM outbox');
    await db.run(`UPDATE executions SET state = 'partial', locked_at = ?`, [T.closes]);
    await applyPull(db, syncResponse({ executions: [{ ...x, answersRev: 5, answers: { a: { number: 9 } } }] }), 0, NOW);
    expect(await db.first('SELECT state, rev, synced_rev, answers FROM executions')).toEqual({ state: 'partial', rev: 5, synced_rev: 5, answers: '{"a":{"number":9}}' });
  });
});
```

`apps/mobile/src/offline/user-scope.test.ts`:

```ts
import { getMeta, setMeta } from './db';
import { ME, OTHER, T } from './testing/fixtures';
import { openTestDb } from './testing/node-db';
import { ensureUser } from './user-scope';

const counts = async (db: Awaited<ReturnType<typeof openTestDb>>) => {
  const out: Record<string, number> = {};
  for (const t of ['occurrences', 'checklist_versions', 'executions', 'media', 'outbox']) {
    out[t] = (await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))!.n;
  }
  return out;
};

async function fill(db: Awaited<ReturnType<typeof openTestDb>>) {
  await db.run(`INSERT INTO occurrences (id, checklist_id, checklist_name, site_id, site_name, local_date, starts_at, due_at, closes_at, status, checklist_version_id) VALUES ('o', 'c', 'n', 's', 'sn', '2026-11-02', ?, ?, ?, 'pending', 'v')`, [T.starts, T.due, T.closes]);
  await db.run(`INSERT INTO checklist_versions (id, checklist_id, number, schema_version, content, received_at) VALUES ('v', 'c', 1, 1, '{}', ?)`, [T.open]);
  await db.run(`INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES ('e', 'o', 'v', 'active', 'pending', ?, ?)`, [T.open, T.open]);
  await db.run(`INSERT INTO media (id, execution_id, kind, source, mime, bytes, captured_at, local_uri) VALUES ('m', 'e', 'photo', 'camera', 'image/jpeg', 10, ?, 'file:///doc/media/m.jpg')`, [T.open]);
  await db.run(`INSERT INTO outbox (execution_id, kind, payload, created_at) VALUES ('e', 'claim', '{}', ?)`, [T.open]);
}

describe('user scope', () => {
  it('remembers the first user and keeps their data on the next start', async () => {
    const db = await openTestDb();
    expect(await ensureUser(db, ME, { remove: jest.fn() })).toBe('fresh');
    await fill(db);
    expect(await ensureUser(db, ME, { remove: jest.fn() })).toBe('same');
    expect(await counts(db)).toEqual({ occurrences: 1, checklist_versions: 1, executions: 1, media: 1, outbox: 1 });
  });

  it('clears every table and every media file when another user signs in', async () => {
    const db = await openTestDb();
    await ensureUser(db, ME, { remove: jest.fn() });
    await fill(db);
    await setMeta(db, 'clockOffsetMs', '1000');
    const remove = jest.fn();
    expect(await ensureUser(db, OTHER, { remove })).toBe('switched');
    expect(await counts(db)).toEqual({ occurrences: 0, checklist_versions: 0, executions: 0, media: 0, outbox: 0 });
    expect(remove).toHaveBeenCalledWith('file:///doc/media/m.jpg');
    expect(await getMeta(db, 'userId')).toBe(OTHER);
    expect(await getMeta(db, 'clockOffsetMs')).toBeNull();
  });

  it('clears leftovers that belong to no recorded user', async () => {
    const db = await openTestDb();
    await fill(db);
    expect(await ensureUser(db, ME, { remove: jest.fn() })).toBe('fresh');
    expect((await counts(db)).executions).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/outbox.test.ts src/offline/sync-pull.test.ts src/offline/user-scope.test.ts`
Expected: FAIL: the modules do not exist.

- [ ] **Step 4: Implement**

`apps/mobile/src/offline/change-feed.ts`:

```ts
/** "Local data changed": store writes and sync results emit; live queries and the sync status re-read. */
export interface ChangeFeed {
  emit(): void;
  subscribe(listener: () => void): () => void;
}

export function createChangeFeed(): ChangeFeed {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((l) => l()),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
```

`apps/mobile/src/offline/outbox.ts`:

```ts
import type { Db } from './db';

export const COMMAND_KINDS = ['claim', 'media', 'answers', 'complete'] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

interface OutboxRow {
  seq: number;
  execution_id: string;
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
  executionId: string;
  kind: CommandKind;
  /** The medium ID for `media` commands. */
  refId: string | null;
  rev: number | null;
  /** The command body without `deviceTime` and `clientOffsetMs`, which are stamped when it is sent. */
  payload: Record<string, unknown>;
  status: 'pending' | 'failed';
  attempts: number;
  errorCode: string | null;
  errorKey: string | null;
  createdAt: string;
}

const toCommand = (r: OutboxRow): OutboxCommand => ({
  seq: r.seq,
  executionId: r.execution_id,
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
  executionId: string;
  kind: CommandKind;
  refId?: string | null;
  rev?: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Called inside the action's transaction. Only the newest answers revision is ever sent (spec §7.2). */
export async function appendCommand(tx: Db, c: AppendInput): Promise<void> {
  if (c.kind === 'answers') await tx.run(`DELETE FROM outbox WHERE execution_id = ? AND kind = 'answers'`, [c.executionId]);
  await tx.run('INSERT INTO outbox (execution_id, kind, ref_id, rev, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    c.executionId,
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
       AND NOT EXISTS (SELECT 1 FROM outbox c WHERE c.execution_id = o.execution_id AND c.kind = 'claim' AND c.status = 'failed')
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
  checklistName: string | null;
}

export async function listCommands(db: Db): Promise<QueueEntry[]> {
  const rows = await db.all<OutboxRow & { checklist_name: string | null }>(
    `SELECT o.*, oc.checklist_name FROM outbox o
     LEFT JOIN executions e ON e.id = o.execution_id
     LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
     ORDER BY o.seq`,
  );
  return rows.map((r) => ({ ...toCommand(r), checklistName: r.checklist_name }));
}
```

`apps/mobile/src/offline/sync-pull.ts`:

```ts
import type { MyExecution, SyncResponse } from '@taskop/contracts';
import { type Db, setMeta } from './db';
import { type ExecutionRow, iso, normIso } from './local-model';

/** Spec §6.1, applied in one transaction. Occurrences missing from the response were cancelled or reassigned (Part 1 #14). */
export async function applyPull(db: Db, res: SyncResponse, offsetMs: number, now: number): Promise<void> {
  await db.transaction(async (tx) => {
    await setMeta(tx, 'clockOffsetMs', String(offsetMs));
    await setMeta(tx, 'lastSyncedAt', iso(now));
    for (const v of res.checklistVersions) {
      // Versions never change once published, so a known ID is kept as it is.
      await tx.run(
        'INSERT INTO checklist_versions (id, checklist_id, number, schema_version, content, received_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        [v.id, v.checklistId, v.number, v.schemaVersion, JSON.stringify(v.content), iso(now)],
      );
    }
    for (const o of res.occurrences) {
      await tx.run(
        `INSERT INTO occurrences (id, checklist_id, checklist_name, site_id, site_name, shift_name, local_date, starts_at, due_at, closes_at, status,
           checklist_version_id, claim_execution_id, claim_user_id, claim_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           checklist_name = excluded.checklist_name, site_name = excluded.site_name, shift_name = excluded.shift_name,
           local_date = excluded.local_date, starts_at = excluded.starts_at, due_at = excluded.due_at, closes_at = excluded.closes_at,
           status = excluded.status, checklist_version_id = excluded.checklist_version_id,
           claim_execution_id = excluded.claim_execution_id, claim_user_id = excluded.claim_user_id, claim_name = excluded.claim_name`,
        [
          o.id, o.checklistId, o.checklistName, o.siteId, o.siteName, o.shiftName, o.localDate,
          normIso(o.startsAt), normIso(o.dueAt), normIso(o.closesAt), o.status, o.checklistVersionId,
          o.claim?.executionId ?? null, o.claim?.executorUserId ?? null, o.claim?.executorName ?? null,
        ],
      );
    }
    await tx.run(
      `DELETE FROM occurrences
       WHERE id NOT IN (SELECT value FROM json_each(?))
         AND id NOT IN (SELECT occurrence_id FROM executions)`,
      [JSON.stringify(res.occurrences.map((o) => o.id))],
    );
    for (const x of res.executions) await mergeExecution(tx, x, now);
  });
}

async function mergeExecution(tx: Db, x: MyExecution, now: number): Promise<void> {
  const claim = x.state === 'rejected' ? 'rejected' : 'accepted';
  const local = await tx.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [x.id]);
  if (!local) {
    await tx.run(
      `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, rejected_reason, started_at, completed_at, answers, rev, synced_rev, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [x.id, x.occurrenceId, x.checklistVersionId, x.state, claim, x.rejectedReason, normIso(x.startedAt), x.completedAt ? normIso(x.completedAt) : null,
        JSON.stringify(x.answers), x.answersRev, x.answersRev, iso(now)],
    );
    return;
  }
  const queued = (await tx.first<{ n: number }>('SELECT count(*) AS n FROM outbox WHERE execution_id = ?', [x.id]))?.n ?? 0;
  if (queued > 0) return; // Local changes not sent yet win; the next pull sees their result.
  // The local lock at closes_at is sticky even before the server's sweep has run (decision 15).
  const state = local.state === 'partial' && x.state === 'active' ? 'partial' : x.state;
  const takeAnswers = x.answersRev > local.rev;
  await tx.run(
    `UPDATE executions SET state = ?, claim = ?, rejected_reason = ?, completed_at = ?, answers = ?, rev = ?, synced_rev = max(synced_rev, ?), updated_at = ?
     WHERE id = ?`,
    [state, claim, x.rejectedReason, x.completedAt ? normIso(x.completedAt) : local.completed_at,
      takeAnswers ? JSON.stringify(x.answers) : local.answers, takeAnswers ? x.answersRev : local.rev, x.answersRev, iso(now), x.id],
  );
}

/** The versions the phone already holds, so /me/sync sends only new content (≤ 200, Part 1 `syncQuerySchema`). */
export async function knownVersionIds(db: Db): Promise<string[]> {
  return (await db.all<{ id: string }>('SELECT id FROM checklist_versions ORDER BY received_at DESC, id LIMIT 200')).map((r) => r.id);
}
```

`apps/mobile/src/offline/user-scope.ts`:

```ts
import { type Db, getMeta, setMeta } from './db';

export interface FileRemover {
  remove(uri: string): void;
}

/** Deletes every local row and media file (logout, or a different user signing in). */
export async function clearLocalData(db: Db, files: FileRemover): Promise<void> {
  const media = await db.all<{ local_uri: string }>('SELECT local_uri FROM media WHERE file_deleted_at IS NULL');
  await db.transaction(async (tx) => {
    for (const table of ['outbox', 'media', 'executions', 'occurrences', 'checklist_versions', 'meta']) await tx.run(`DELETE FROM ${table}`);
  });
  for (const m of media) {
    try {
      files.remove(m.local_uri);
    } catch {
      // Already gone: nothing to protect.
    }
  }
}

/** Runs before the sync engine starts: data of any other user must never be sent with this user's token (spec §7.2). */
export async function ensureUser(db: Db, userId: string, files: FileRemover): Promise<'same' | 'switched' | 'fresh'> {
  const current = await getMeta(db, 'userId');
  if (current === userId) return 'same';
  await clearLocalData(db, files);
  await setMeta(db, 'userId', userId);
  return current === null ? 'fresh' : 'switched';
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (outbox 3, sync-pull 4, user-scope 3, plus the earlier offline tests).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/change-feed.ts apps/mobile/src/offline/outbox.ts apps/mobile/src/offline/outbox.test.ts apps/mobile/src/offline/sync-pull.ts apps/mobile/src/offline/sync-pull.test.ts apps/mobile/src/offline/user-scope.ts apps/mobile/src/offline/user-scope.test.ts apps/mobile/src/offline/testing/fixtures.ts
git commit -m "feat(mobile): add the command outbox, /me/sync application and per-user data scope" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Execution store: every action writes SQLite and the outbox in one transaction

**Files:**
- Create: `apps/mobile/src/offline/execution-store.ts`, `apps/mobile/src/offline/testing/fake-transport.ts`, `apps/mobile/src/offline/testing/harness.ts`
- Test: `apps/mobile/src/offline/execution-store.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 3–5
  - From `@taskop/contracts`: `requirements`, `deriveProblems`, `mediaLimitFor`, `MEDIA_LIMITS`, `EXECUTION_LIMITS`, and the types `Answer`, `Answers`, `ManualProblem`, `DeviceInfo`, `MediaKind`, `MediaSource`, `Missing`
- Produces:
  - Start rules: `type StartBlock = 'notYetOpen' | 'closed' | 'claimedByOther' | 'finished' | 'needsUpdate' | 'notDownloaded'`, `startBlock(o: LocalOccurrence, userId, now: number, content: ContentLoad['kind']): StartBlock | null`
  - Errors: `ExecutionLockedError` (`.state`), `StartRefusedError` (`.reason: StartBlock`), `MediaLimitError`, `LiveOnlyError`
  - Types:
    - `WriteKind = 'claim' | 'change'`
    - `StoreDeps { db; clock; newId; device; files: FileRemover; feed; onWrite(kind) }`
    - `CapturedMedia { kind; source; mime; bytes; width; height; durationMs; localUri; capturedAt }`
    - `MediaTarget = { itemId; field: 'evidence' } | { itemId; field: 'problem' }`
    - `OccurrenceView = LocalOccurrence & { execution: LocalExecution | null }`
  - `createExecutionStore(deps)` / `type ExecutionStore`, with these methods:
    - Reads:
      - `occurrences(): Promise<OccurrenceView[]>`, `occurrence(id)`, `execution(id)`
      - `media(executionId): Promise<LocalMedia[]>`, `content(versionId): Promise<ContentLoad>`
      - `unsyncedCount()`, `problemCount(executionIds)`
    - Actions:
      - `start(occurrenceId, userId): Promise<string>`: one claim command, then `onWrite('claim')`
      - `patchAnswer(executionId, itemId, patch: Partial<Answer>)`
      - `attachMedia(executionId, media: CapturedMedia, target: MediaTarget): Promise<string>`
      - `removeMedia(executionId, mediaId)`, `setProblem(executionId, itemId, problem: ManualProblem | null)`
      - `complete(executionId): Promise<{ ok: true } | { ok: false; missing: Missing[] }>`, `lockExpired(): Promise<number>`
      - Every change other than start calls `onWrite('change')`.
  - Testing: `createFakeTransport()` / `FakeTransport` (`files`, `uploads`, `removed`, `respond(fn)`, `exists`, `remove`, `upload`), `capturedPhoto(t, over?)`, `capturedVideo(t, over?)`, `createHarness({ at?, db? })` / `Harness`

- [ ] **Step 1: Write the test helpers**

`apps/mobile/src/offline/testing/fake-transport.ts`:

```ts
import type { CapturedMedia } from '../execution-store';
import { T } from './fixtures';

/** In-memory stand-in for the phone's media files and the presigned PUT. */
export interface FakeTransport {
  files: Set<string>;
  uploads: { uri: string; url: string; headers: Record<string, string> }[];
  removed: string[];
  respond(fn: (uri: string) => number | Promise<number>): void;
  exists(uri: string): boolean;
  remove(uri: string): void;
  upload(uri: string, url: string, headers: Record<string, string>): Promise<number>;
}

export function createFakeTransport(): FakeTransport {
  let respond: (uri: string) => number | Promise<number> = () => 200;
  const t: FakeTransport = {
    files: new Set(),
    uploads: [],
    removed: [],
    respond: (fn) => {
      respond = fn;
    },
    exists: (uri) => t.files.has(uri),
    remove: (uri) => {
      t.removed.push(uri);
      t.files.delete(uri);
    },
    upload: async (uri, url, headers) => {
      t.uploads.push({ uri, url, headers });
      return respond(uri);
    },
  };
  return t;
}

let counter = 0;

export function capturedPhoto(t: FakeTransport, over: Partial<CapturedMedia> = {}): CapturedMedia {
  const localUri = `file:///doc/media/p${++counter}.jpg`;
  t.files.add(localUri);
  return { kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 250_000, width: 1600, height: 1200, durationMs: null, capturedAt: T.open, ...over, localUri };
}

export function capturedVideo(t: FakeTransport, over: Partial<CapturedMedia> = {}): CapturedMedia {
  const localUri = `file:///doc/media/v${++counter}.mp4`;
  t.files.add(localUri);
  return { kind: 'video', source: 'camera', mime: 'video/mp4', bytes: 8_000_000, width: 1280, height: 720, durationMs: 12_000, capturedAt: T.open, ...over, localUri };
}
```

`apps/mobile/src/offline/testing/harness.ts`:

```ts
import type { SyncResponse } from '@taskop/contracts';
import { type ChangeFeed, createChangeFeed } from '../change-feed';
import type { Db } from '../db';
import { createExecutionStore, type ExecutionStore, type WriteKind } from '../execution-store';
import { applyPull } from '../sync-pull';
import { ensureUser } from '../user-scope';
import { createFakeTransport, type FakeTransport } from './fake-transport';
import { type Checklist, checklist, DEVICE, ME, manualClock, type ManualClock, syncResponse, T, testIds, versionOf } from './fixtures';
import { openTestDb } from './node-db';

export interface Harness {
  db: Db;
  clock: ManualClock;
  feed: ChangeFeed;
  transport: FakeTransport;
  store: ExecutionStore;
  /** Every onWrite call, in order. */
  writes: WriteKind[];
  c: Checklist;
  /** Applies a /me/sync response; the default is one open occurrence (OCC) and its version. */
  seed(res?: SyncResponse): Promise<void>;
}

export async function createHarness(o: { at?: string; db?: Db } = {}): Promise<Harness> {
  const db = o.db ?? (await openTestDb());
  const clock = manualClock(o.at ?? T.open);
  const feed = createChangeFeed();
  const transport = createFakeTransport();
  await ensureUser(db, ME, transport);
  const writes: WriteKind[] = [];
  const store = createExecutionStore({ db, clock, newId: testIds(clock), device: DEVICE, files: transport, feed, onWrite: (kind) => writes.push(kind) });
  const c = checklist();
  const seed = async (res: SyncResponse = syncResponse({ checklistVersions: [versionOf(c.content)] })) => {
    await applyPull(db, res, 0, clock.now());
    feed.emit();
  };
  await seed();
  return { db, clock, feed, transport, store, writes, c, seed };
}
```

- [ ] **Step 2: Write the failing test**

`apps/mobile/src/offline/execution-store.test.ts`:

```ts
import { requirements } from '@taskop/contracts';
import type { ContentLoad } from './content';
import { ExecutionLockedError, LiveOnlyError, MediaLimitError, type StartBlock, startBlock } from './execution-store';
import type { LocalOccurrence } from './local-model';
import { capturedPhoto, capturedVideo } from './testing/fake-transport';
import { DEVICE, ME, OCC, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION, VERSION2, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';
import { failingDriver, nodeDriver, openTestDb } from './testing/node-db';

const outbox = (h: Harness) => h.db.all<{ kind: string; rev: number | null; ref_id: string | null; payload: string }>('SELECT kind, rev, ref_id, payload FROM outbox ORDER BY seq');
const kinds = async (h: Harness) => (await outbox(h)).map((c) => c.kind);
const payload = async (h: Harness, kind: string) => JSON.parse((await outbox(h)).filter((c) => c.kind === kind).at(-1)!.payload);

async function started(o: { at?: string } = {}) {
  const h = await createHarness(o);
  const id = await h.store.start(OCC, ME);
  return { h, id };
}

async function answerEverything(h: Harness, id: string) {
  await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
  await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
  await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
}

describe('startBlock', () => {
  const base: LocalOccurrence = {
    id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
    startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'pending', checklistVersionId: VERSION, claim: null,
  };
  const claimedBy = (userId: string) => ({ ...base, claim: { executionId: OTHER_EXECUTION, executorUserId: userId, executorName: 'Murad' } });
  it.each<[string, LocalOccurrence, string, ContentLoad['kind'], StartBlock | null]>([
    ['open and mine', base, T.open, 'ok', null],
    ['before the window', base, T.before, 'ok', 'notYetOpen'],
    ['at closes_at', base, T.closes, 'ok', 'closed'],
    ['claimed by someone else', claimedBy(OTHER), T.open, 'ok', 'claimedByOther'],
    ['claimed by me on another phone', claimedBy(ME), T.open, 'ok', null],
    ['already completed', { ...base, status: 'completed' }, T.open, 'ok', 'finished'],
    ['content not downloaded yet', base, T.open, 'missing', 'notDownloaded'],
    ['content newer than the app', base, T.open, 'needsUpdate', 'needsUpdate'],
  ])('%s', (_name, o, now, content, expected) => {
    expect(startBlock(o, ME, Date.parse(now), content)).toBe(expected);
  });
});

describe('starting', () => {
  it('writes the execution and its claim command in one go and asks for an immediate sync', async () => {
    const { h, id } = await started();
    expect(await h.store.execution(id)).toMatchObject({ occurrenceId: OCC, state: 'active', claim: 'pending', startedAt: T.open, rev: 0, answers: {} });
    expect(await kinds(h)).toEqual(['claim']);
    expect(await payload(h, 'claim')).toEqual({ id, occurrenceId: OCC, startedAt: T.open, device: DEVICE });
    expect(h.writes).toEqual(['claim']);
    expect((await h.store.occurrences())[0]).toMatchObject({ id: OCC, execution: { id } });
  });

  it('resumes instead of claiming twice on a double tap', async () => {
    const { h, id } = await started();
    expect(await h.store.start(OCC, ME)).toBe(id);
    expect(await kinds(h)).toEqual(['claim']);
  });

  it('refuses before the window opens and for a checklist version newer than the app understands', async () => {
    const h = await createHarness({ at: T.before });
    await expect(h.store.start(OCC, ME)).rejects.toMatchObject({ reason: 'notYetOpen' });
    h.clock.set(T.open);
    await h.seed(syncResponse({ occurrences: [occurrence({ checklistVersionId: VERSION2 })], checklistVersions: [versionOf({ schemaVersion: 2 }, VERSION2, 2)] }));
    await expect(h.store.start(OCC, ME)).rejects.toMatchObject({ reason: 'needsUpdate' });
    expect(await h.store.content(VERSION2)).toEqual({ kind: 'needsUpdate' });
    expect(await kinds(h)).toEqual([]);
  });
});

describe('answering', () => {
  it('appends one answers command per change and keeps only the latest revision queued', async () => {
    const { h, id } = await started();
    await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 4 });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    const answers = { [h.c.problem.id]: { optionIds: [h.c.no.id] }, [h.c.temp.id]: { number: 5 } };
    expect(await h.store.execution(id)).toMatchObject({ rev: 3, answers });
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['claim', null], ['answers', 3]]);
    expect(await payload(h, 'answers')).toEqual({ rev: 3, answers });
    expect(h.writes).toEqual(['claim', 'change', 'change', 'change']);
    expect(await h.store.unsyncedCount()).toBe(2);
  });

  it('drops cleared fields and empty answers', async () => {
    const { h, id } = await started();
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5, note: 'x' });
    await h.store.patchAnswer(id, h.c.temp.id, { number: undefined, note: '' });
    expect((await h.store.execution(id))!.answers).toEqual({});
  });
});

describe('media', () => {
  it('queues the registration before the answers command that references the medium', async () => {
    const { h, id } = await started();
    const photo = capturedPhoto(h.transport);
    const mediaId = await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
    expect((await outbox(h)).map((c) => [c.kind, c.ref_id])).toEqual([['claim', null], ['media', mediaId], ['answers', null]]);
    expect(await payload(h, 'media')).toEqual({
      id: mediaId, itemId: h.c.photo.id, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 250_000, width: 1600, height: 1200, durationMs: null, capturedAt: T.open,
    });
    expect((await payload(h, 'answers')).answers).toEqual({ [h.c.photo.id]: { photos: [mediaId] } });
    expect(await h.store.media(id)).toMatchObject([{ id: mediaId, localUri: photo.localUri, registeredAt: null, uploadedAt: null }]);
  });

  it('refuses gallery media on a live-only item and media beyond what the item allows', async () => {
    const { h, id } = await started();
    const evidence = { itemId: h.c.photo.id, field: 'evidence' } as const;
    await expect(h.store.attachMedia(id, capturedPhoto(h.transport, { source: 'gallery' }), evidence)).rejects.toBeInstanceOf(LiveOnlyError);
    await h.store.attachMedia(id, capturedPhoto(h.transport), evidence);
    await h.store.attachMedia(id, capturedPhoto(h.transport), evidence);
    await expect(h.store.attachMedia(id, capturedPhoto(h.transport), evidence)).rejects.toBeInstanceOf(MediaLimitError);
    await expect(h.store.attachMedia(id, capturedVideo(h.transport), { itemId: h.c.note.id, field: 'evidence' })).rejects.toBeInstanceOf(MediaLimitError);
    expect(await h.store.media(id)).toHaveLength(2);
  });

  it('keeps problem media out of the answers until the problem is saved', async () => {
    const { h, id } = await started();
    const mediaId = await h.store.attachMedia(id, capturedVideo(h.transport), { itemId: h.c.temp.id, field: 'problem' });
    expect(await kinds(h)).toEqual(['claim', 'media']);
    expect((await payload(h, 'media')).itemId).toBeNull();
    await h.store.setProblem(id, h.c.temp.id, { severity: 'critical', note: '  Termometr sınıb ', mediaIds: [mediaId] });
    expect((await h.store.execution(id))!.answers).toEqual({ [h.c.temp.id]: { problem: { severity: 'critical', note: 'Termometr sınıb', mediaIds: [mediaId] } } });
    await expect(h.store.setProblem(id, h.c.temp.id, { severity: 'normal', note: '   ', mediaIds: [] })).rejects.toBeInstanceOf(RangeError);
    await h.store.setProblem(id, h.c.temp.id, null);
    expect((await h.store.execution(id))!.answers).toEqual({});
  });

  it('forgets a medium completely when it is removed before registration', async () => {
    const { h, id } = await started();
    const photo = capturedPhoto(h.transport);
    const mediaId = await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
    await h.store.removeMedia(id, mediaId);
    expect((await outbox(h)).map((c) => [c.kind, c.rev])).toEqual([['claim', null], ['answers', 2]]);
    expect((await payload(h, 'answers')).answers).toEqual({});
    expect(await h.store.media(id)).toEqual([]);
    expect(h.transport.removed).toEqual([photo.localUri]);
  });
});

describe('completing', () => {
  it('lists what is missing, then completes with the full answers once everything is there', async () => {
    const { h, id } = await started();
    expect(await h.store.complete(id)).toEqual({ ok: false, missing: requirements(h.c.content, {}) });
    await answerEverything(h, id);
    h.clock.set('2026-11-02T05:00:00.000Z');
    expect(await h.store.complete(id)).toEqual({ ok: true });
    const e = (await h.store.execution(id))!;
    expect(e).toMatchObject({ state: 'completed', completedAt: '2026-11-02T05:00:00.000Z', rev: 3 });
    expect(await kinds(h)).toEqual(['claim', 'media', 'answers', 'complete']);
    expect(await payload(h, 'complete')).toEqual({ rev: 3, answers: e.answers, completedAt: '2026-11-02T05:00:00.000Z' });
    await expect(h.store.patchAnswer(id, h.c.note.id, { text: 'gec' })).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await h.store.problemCount([id])).toBe(0);
  });
});

describe('the device clock', () => {
  it('locks at closes_at and stays locked when the clock is moved back', async () => {
    const { h, id } = await started();
    h.clock.set(T.closes);
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 5 })).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await h.store.execution(id)).toMatchObject({ state: 'partial', lockedAt: T.closes, rev: 0 });
    h.clock.set(T.open);
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 5 })).rejects.toMatchObject({ state: 'partial' });
    await expect(h.store.complete(id)).rejects.toBeInstanceOf(ExecutionLockedError);
    expect(await kinds(h)).toEqual(['claim']);
  });

  it('locks every open execution past closes_at in one sweep', async () => {
    const { h, id } = await started();
    h.clock.set('2026-11-02T07:00:01.000Z');
    expect(await h.store.lockExpired()).toBe(1);
    expect(await h.store.execution(id)).toMatchObject({ state: 'partial' });
    expect(await h.store.lockExpired()).toBe(0);
  });

  it('never completes before it started when the clock moved backwards', async () => {
    const { h, id } = await started();
    await answerEverything(h, id);
    h.clock.set('2026-11-02T04:05:00.000Z');
    expect(await h.store.complete(id)).toEqual({ ok: true });
    expect((await h.store.execution(id))!.completedAt).toBe(T.open);
  });
});

describe('atomic actions', () => {
  it('rolls the answer back when the outbox append fails (app killed between the two writes)', async () => {
    const driver = failingDriver(nodeDriver(), /INSERT INTO outbox/);
    const h = await createHarness({ db: await openTestDb(driver) });
    const id = await h.store.start(OCC, ME);
    driver.armed = true;
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 5 })).rejects.toThrow('simulated crash');
    await expect(h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' })).rejects.toThrow('simulated crash');
    driver.armed = false;
    expect(await h.store.execution(id)).toMatchObject({ rev: 0, answers: {} });
    expect(await h.store.media(id)).toEqual([]);
    expect(await kinds(h)).toEqual(['claim']);
  });
});
```

- [ ] **Step 3: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/offline/execution-store.test.ts`
Expected: FAIL: `Cannot find module './execution-store'`.

- [ ] **Step 4: Implement**

`apps/mobile/src/offline/execution-store.ts`:

```ts
import {
  type Answer,
  type Answers,
  deriveProblems,
  type DeviceInfo,
  EXECUTION_LIMITS,
  type ManualProblem,
  MEDIA_LIMITS,
  type MediaKind,
  mediaLimitFor,
  type MediaSource,
  type Missing,
  requirements,
} from '@taskop/contracts';
import type { ChangeFeed } from './change-feed';
import type { Clock } from './clock';
import { type ContentLoad, findItem, loadContent } from './content';
import type { Db } from './db';
import {
  type ExecutionRow,
  iso,
  type LocalExecution,
  type LocalMedia,
  type LocalOccurrence,
  type MediaRow,
  type OccurrenceRow,
  toExecution,
  toMedia,
  toOccurrence,
} from './local-model';
import { appendCommand } from './outbox';
import type { FileRemover } from './user-scope';

export type StartBlock = 'notYetOpen' | 'closed' | 'claimedByOther' | 'finished' | 'needsUpdate' | 'notDownloaded';

const FINISHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'cancelled', 'audit_pending', 'audited']);

/**
 * Spec §7.4: start is offered when the window is open by device time, nobody else is known to hold the claim,
 * and the content is usable. Every occurrence on the phone came from /me/sync, which lists only the caller's
 * occurrences, so "I am an assignee" holds. The shift check runs on the server.
 */
export function startBlock(o: LocalOccurrence, userId: string, now: number, content: ContentLoad['kind']): StartBlock | null {
  if (FINISHED_STATUSES.has(o.status)) return 'finished';
  if (o.claim && o.claim.executorUserId !== userId) return 'claimedByOther';
  if (now < Date.parse(o.startsAt)) return 'notYetOpen';
  if (now >= Date.parse(o.closesAt)) return 'closed';
  if (content === 'missing') return 'notDownloaded';
  if (content === 'needsUpdate') return 'needsUpdate';
  return null;
}

export class ExecutionLockedError extends Error {
  constructor(readonly state: string) {
    super(`Execution is ${state}`);
    this.name = 'ExecutionLockedError';
  }
}

export class StartRefusedError extends Error {
  constructor(readonly reason: StartBlock) {
    super(`Cannot start: ${reason}`);
    this.name = 'StartRefusedError';
  }
}

export class MediaLimitError extends Error {
  constructor() {
    super('This item cannot take more media of this kind');
    this.name = 'MediaLimitError';
  }
}

export class LiveOnlyError extends Error {
  constructor() {
    super('This item accepts camera media only');
    this.name = 'LiveOnlyError';
  }
}

/** `claim` asks for an immediate sync (online starts claim at once); `change` waits 2 s for more edits. */
export type WriteKind = 'claim' | 'change';

export interface StoreDeps {
  db: Db;
  clock: Clock;
  newId: () => string;
  device: DeviceInfo;
  files: FileRemover;
  feed: ChangeFeed;
  onWrite: (kind: WriteKind) => void;
}

/** A photo or video already resized/recorded within MEDIA_LIMITS and stored under the app's documents. */
export interface CapturedMedia {
  kind: MediaKind;
  source: MediaSource;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  localUri: string;
  capturedAt: string;
}

/** Where a new medium goes: the item's photos/videos, or a manual problem being drafted (added by setProblem). */
export type MediaTarget = { itemId: string; field: 'evidence' } | { itemId: string; field: 'problem' };

export interface OccurrenceView extends LocalOccurrence {
  execution: LocalExecution | null;
}

type Guard = { locked: true; state: string } | { locked: false; e: LocalExecution };

function compactAnswer(a: Answer): Answer | undefined {
  const out: Answer = {};
  if (a.optionIds?.length) out.optionIds = a.optionIds;
  if (typeof a.number === 'number' && Number.isFinite(a.number)) out.number = a.number;
  if (a.text) out.text = a.text;
  if (a.datetime) out.datetime = a.datetime;
  if (a.photos?.length) out.photos = a.photos;
  if (a.videos?.length) out.videos = a.videos;
  if (a.note) out.note = a.note;
  if (a.problem) out.problem = a.problem;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Answers as the API expects them: no empty fields, no empty answers. */
function compact(answers: Answers): Answers {
  const out: Answers = {};
  for (const [itemId, a] of Object.entries(answers)) {
    const c = a ? compactAnswer(a) : undefined;
    if (c) out[itemId] = c;
  }
  return out;
}

export function createExecutionStore(deps: StoreDeps) {
  const { db, clock, newId, device, files, feed, onWrite } = deps;
  const contents = new Map<string, ContentLoad>();

  const changed = (kind: WriteKind) => {
    feed.emit();
    onWrite(kind);
  };

  /** Pass `tx` when called inside a transaction. */
  async function content(versionId: string, q: Db = db): Promise<ContentLoad> {
    const cached = contents.get(versionId);
    if (cached) return cached;
    const row = await q.first<{ schema_version: number; content: string }>('SELECT schema_version, content FROM checklist_versions WHERE id = ?', [versionId]);
    if (!row) return { kind: 'missing' };
    const loaded = loadContent(row.schema_version, row.content);
    contents.set(versionId, loaded);
    return loaded;
  }

  async function usableContent(tx: Db, versionId: string) {
    const loaded = await content(versionId, tx);
    if (loaded.kind !== 'ok') throw new Error(`Checklist version ${versionId} cannot be used on this phone (${loaded.kind})`);
    return loaded.content;
  }

  /** Spec §7.4: past closes_at an open execution locks as partial. Persisted, so a clock moved back does not reopen it. */
  async function guard(tx: Db, executionId: string, now: number): Promise<Guard> {
    const row = await tx.first<ExecutionRow & { closes_at: string }>(
      'SELECT e.*, o.closes_at FROM executions e JOIN occurrences o ON o.id = e.occurrence_id WHERE e.id = ?',
      [executionId],
    );
    if (!row) throw new Error(`Unknown execution ${executionId}`);
    if (row.state !== 'active') return { locked: true, state: row.state };
    if (now >= Date.parse(row.closes_at)) {
      await tx.run(`UPDATE executions SET state = 'partial', locked_at = ?, updated_at = ? WHERE id = ?`, [iso(now), iso(now), executionId]);
      return { locked: true, state: 'partial' };
    }
    return { locked: false, e: toExecution(row) };
  }

  /**
   * One transaction: guard, then `edit` (which may write media rows and commands), then the new answers revision
   * and its outbox command. `edit` returns null when the answers do not change.
   */
  async function change(executionId: string, edit: (tx: Db, e: LocalExecution, now: number) => Promise<Answers | null>): Promise<void> {
    const now = clock.now();
    const result = await db.transaction(async (tx): Promise<Guard> => {
      const g = await guard(tx, executionId, now);
      if (g.locked) return g;
      const next = await edit(tx, g.e, now);
      if (next !== null) {
        const answers = compact(next);
        const rev = g.e.rev + 1;
        await tx.run('UPDATE executions SET answers = ?, rev = ?, updated_at = ? WHERE id = ?', [JSON.stringify(answers), rev, iso(now), executionId]);
        await appendCommand(tx, { executionId, kind: 'answers', rev, payload: { rev, answers }, createdAt: iso(now) });
      }
      return g;
    });
    changed('change');
    if (result.locked) throw new ExecutionLockedError(result.state);
  }

  async function start(occurrenceId: string, userId: string): Promise<string> {
    const now = clock.now();
    const id = await db.transaction(async (tx) => {
      const mine = await tx.first<{ id: string; state: string }>(
        'SELECT id, state FROM executions WHERE occurrence_id = ? ORDER BY started_at DESC LIMIT 1',
        [occurrenceId],
      );
      if (mine?.state === 'active') return mine.id; // a double tap resumes instead of claiming twice
      if (mine) throw new StartRefusedError(mine.state === 'rejected' ? 'claimedByOther' : 'finished');
      const row = await tx.first<OccurrenceRow>('SELECT * FROM occurrences WHERE id = ?', [occurrenceId]);
      if (!row) throw new Error(`Unknown occurrence ${occurrenceId}`);
      const occ = toOccurrence(row);
      const block = startBlock(occ, userId, now, (await content(occ.checklistVersionId, tx)).kind);
      if (block) throw new StartRefusedError(block);
      const executionId = newId();
      const startedAt = iso(now);
      await tx.run(
        `INSERT INTO executions (id, occurrence_id, checklist_version_id, state, claim, started_at, updated_at) VALUES (?, ?, ?, 'active', 'pending', ?, ?)`,
        [executionId, occurrenceId, occ.checklistVersionId, startedAt, startedAt],
      );
      await appendCommand(tx, { executionId, kind: 'claim', createdAt: startedAt, payload: { id: executionId, occurrenceId, startedAt, device } });
      return executionId;
    });
    changed('claim');
    return id;
  }

  function patchAnswer(executionId: string, itemId: string, patch: Partial<Answer>): Promise<void> {
    return change(executionId, async (_tx, e) => ({ ...e.answers, [itemId]: { ...e.answers[itemId], ...patch } }));
  }

  async function setProblem(executionId: string, itemId: string, problem: ManualProblem | null): Promise<void> {
    let value: ManualProblem | undefined;
    if (problem) {
      const note = problem.note.trim();
      if (!note || note.length > EXECUTION_LIMITS.problemNote || problem.mediaIds.length > MEDIA_LIMITS.problemMaxMedia) {
        throw new RangeError('A manual problem needs a note of 1–2000 characters and at most 5 media');
      }
      value = { severity: problem.severity, note, mediaIds: [...problem.mediaIds] };
    }
    await change(executionId, async (_tx, e) => ({ ...e.answers, [itemId]: { ...e.answers[itemId], problem: value } }));
  }

  async function attachMedia(executionId: string, m: CapturedMedia, target: MediaTarget): Promise<string> {
    const mediaId = newId();
    await change(executionId, async (tx, e, now) => {
      const item = findItem(await usableContent(tx, e.checklistVersionId), target.itemId);
      if (!item) throw new Error(`Unknown item ${target.itemId}`);
      if (item.evidence.liveOnly && m.source === 'gallery') throw new LiveOnlyError();
      const current = (m.kind === 'photo' ? e.answers[target.itemId]?.photos : e.answers[target.itemId]?.videos) ?? [];
      if (target.field === 'evidence' && current.length >= mediaLimitFor(item, m.kind)) throw new MediaLimitError();
      const itemId = target.field === 'evidence' ? target.itemId : null;
      await tx.run(
        `INSERT INTO media (id, execution_id, item_id, kind, source, mime, bytes, width, height, duration_ms, captured_at, local_uri)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mediaId, executionId, itemId, m.kind, m.source, m.mime, m.bytes, m.width, m.height, m.durationMs, m.capturedAt, m.localUri],
      );
      // Registration is queued before any answers that reference the medium (Part 1 decision 1).
      await appendCommand(tx, {
        executionId,
        kind: 'media',
        refId: mediaId,
        createdAt: iso(now),
        payload: {
          id: mediaId, itemId, kind: m.kind, source: m.source, mime: m.mime, bytes: m.bytes,
          width: m.width, height: m.height, durationMs: m.durationMs, capturedAt: m.capturedAt,
        },
      });
      if (target.field === 'problem') return null;
      const next: Answer = { ...e.answers[target.itemId] };
      if (m.kind === 'photo') next.photos = [...current, mediaId];
      else next.videos = [...current, mediaId];
      return { ...e.answers, [target.itemId]: next };
    });
    return mediaId;
  }

  async function removeMedia(executionId: string, mediaId: string): Promise<void> {
    const discarded: string[] = [];
    await change(executionId, async (tx, e) => {
      const row = await tx.first<MediaRow>('SELECT * FROM media WHERE id = ? AND execution_id = ?', [mediaId, executionId]);
      if (row && row.registered_at === null) {
        // Never registered on the server: forget it entirely.
        await tx.run(`DELETE FROM outbox WHERE kind = 'media' AND ref_id = ?`, [mediaId]);
        await tx.run('DELETE FROM media WHERE id = ?', [mediaId]);
        discarded.push(row.local_uri);
      }
      const answers: Answers = {};
      for (const [itemId, a] of Object.entries(e.answers)) {
        if (!a) continue;
        answers[itemId] = {
          ...a,
          photos: a.photos?.filter((x) => x !== mediaId),
          videos: a.videos?.filter((x) => x !== mediaId),
          problem: a.problem && { ...a.problem, mediaIds: a.problem.mediaIds.filter((x) => x !== mediaId) },
        };
      }
      return answers;
    });
    for (const uri of discarded) files.remove(uri);
  }

  async function complete(executionId: string): Promise<{ ok: true } | { ok: false; missing: Missing[] }> {
    const now = clock.now();
    type Outcome = { kind: 'locked'; state: string } | { kind: 'missing'; missing: Missing[] } | { kind: 'done' };
    const out = await db.transaction(async (tx): Promise<Outcome> => {
      const g = await guard(tx, executionId, now);
      if (g.locked) return { kind: 'locked', state: g.state };
      const missing = requirements(await usableContent(tx, g.e.checklistVersionId), g.e.answers);
      if (missing.length) return { kind: 'missing', missing };
      // A clock moved backwards must not put the completion before the start.
      const completedAt = iso(Math.max(now, Date.parse(g.e.startedAt)));
      // completeCommandSchema needs rev ≥ 1; the server ignores a revision it already has (Part 1 decision 2).
      const rev = Math.max(g.e.rev, 1);
      await tx.run(`UPDATE executions SET state = 'completed', completed_at = ?, rev = ?, updated_at = ? WHERE id = ?`, [completedAt, rev, iso(now), executionId]);
      await appendCommand(tx, { executionId, kind: 'complete', rev, payload: { rev, answers: g.e.answers, completedAt }, createdAt: iso(now) });
      return { kind: 'done' };
    });
    changed('change');
    if (out.kind === 'locked') throw new ExecutionLockedError(out.state);
    return out.kind === 'missing' ? { ok: false, missing: out.missing } : { ok: true };
  }

  /** Runs before each sync and on screen ticks: open executions past closes_at become partial locally. */
  async function lockExpired(): Promise<number> {
    const now = iso(clock.now());
    const n = await db.run(
      `UPDATE executions SET state = 'partial', locked_at = ?, updated_at = ?
       WHERE state = 'active' AND occurrence_id IN (SELECT id FROM occurrences WHERE closes_at <= ?)`,
      [now, now, now],
    );
    if (n > 0) feed.emit();
    return n;
  }

  return {
    content: (versionId: string) => content(versionId),
    async occurrences(): Promise<OccurrenceView[]> {
      const rows = await db.all<OccurrenceRow>('SELECT * FROM occurrences ORDER BY starts_at, checklist_name');
      const executions = await db.all<ExecutionRow>('SELECT * FROM executions ORDER BY started_at');
      const byOccurrence = new Map(executions.map((r) => [r.occurrence_id, toExecution(r)])); // the newest wins
      return rows.map((r) => ({ ...toOccurrence(r), execution: byOccurrence.get(r.id) ?? null }));
    },
    async occurrence(id: string): Promise<LocalOccurrence | null> {
      const row = await db.first<OccurrenceRow>('SELECT * FROM occurrences WHERE id = ?', [id]);
      return row ? toOccurrence(row) : null;
    },
    async execution(id: string): Promise<LocalExecution | null> {
      const row = await db.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [id]);
      return row ? toExecution(row) : null;
    },
    async media(executionId: string): Promise<LocalMedia[]> {
      return (await db.all<MediaRow>('SELECT * FROM media WHERE execution_id = ? ORDER BY captured_at, id', [executionId])).map(toMedia);
    },
    /** Commands not yet accepted plus registered files not yet uploaded (the logout warning, spec §7.4). */
    async unsyncedCount(): Promise<number> {
      const row = await db.first<{ n: number }>(
        `SELECT (SELECT count(*) FROM outbox)
              + (SELECT count(*) FROM media WHERE registered_at IS NOT NULL AND uploaded_at IS NULL AND file_deleted_at IS NULL) AS n`,
      );
      return row?.n ?? 0;
    },
    async problemCount(executionIds: string[]): Promise<number> {
      let n = 0;
      for (const id of executionIds) {
        const row = await db.first<ExecutionRow>('SELECT * FROM executions WHERE id = ?', [id]);
        if (!row) continue;
        const loaded = await content(row.checklist_version_id);
        if (loaded.kind === 'ok') n += deriveProblems(loaded.content, toExecution(row).answers).length;
      }
      return n;
    },
    start,
    patchAnswer,
    setProblem,
    attachMedia,
    removeMedia,
    complete,
    lockExpired,
  };
}

export type ExecutionStore = ReturnType<typeof createExecutionStore>;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (execution-store: 8 `startBlock` cases + 13 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/execution-store.ts apps/mobile/src/offline/execution-store.test.ts apps/mobile/src/offline/testing/fake-transport.ts apps/mobile/src/offline/testing/harness.ts
git commit -m "feat(mobile): add the execution store with atomic writes, media registration and the closes_at lock" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Media queue: one file at a time, photos first, resumable

**Files:**
- Create: `apps/mobile/src/offline/sync-api.ts`, `apps/mobile/src/offline/media-queue.ts`, `apps/mobile/src/offline/testing/fake-api.ts`
- Modify: `apps/mobile/src/offline/testing/harness.ts`
- Test: `apps/mobile/src/offline/sync-api.test.ts`, `apps/mobile/src/offline/media-queue.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 3–6
  - From `@taskop/api-client`: `ApiError`, `type ExecutionsApi`
  - From `@taskop/contracts`: the command and result types
- Produces:
  - `interface SyncApi` (the slice of `ExecutionsApi`: `sync.pull`, `executions.{claim, saveAnswers, complete, registerMedia}`, `media.confirmUploaded`). `api` from `@/lib/session` satisfies it.
  - `type Failure = { kind: 'retry' } | { kind: 'auth' } | { kind: 'permanent'; code; messageKey }`, `classifyError(e: unknown): Failure`
  - Media queue types:
    - `interface MediaTransport extends FileRemover { exists(uri); upload(uri, url, headers): Promise<number> }`
    - `MEDIA_MAX_ATTEMPTS = 5`, `LOCAL_FILE_KEEP_DAYS = 7`
    - `type DrainOutcome = 'ok' | 'retry' | 'auth'`, `MediaQueueEntry`, `mediaErrorKey(code)`
  - `createMediaQueue({ db, api, clock, transport, feed }): MediaQueue`, with these methods:
    - `drain()`, `cleanup()`, `counts()`, `list()`, `retryFailed()`
  - Testing:
    - `createFakeApi()` / `FakeApi` (`api`, `calls`, `defaults`, `sync`, `on(method, handler)`, `reset(method)`)
    - `Harness` gains `api` and `mediaQueue`

- [ ] **Step 1: Write the fake API and extend the harness**

`apps/mobile/src/offline/testing/fake-api.ts`:

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
  SyncResponse,
} from '@taskop/contracts';
import type { SyncApi } from '../sync-api';
import { ME, syncResponse, VERSION } from './fixtures';

export interface ApiHandlers {
  pull(knownVersionIds: string[]): Promise<SyncResponse>;
  claim(body: ClaimCommand): Promise<ClaimResult>;
  saveAnswers(id: string, body: SaveAnswersCommand): Promise<SaveAnswersResult>;
  complete(id: string, body: CompleteCommand): Promise<CompleteResult>;
  registerMedia(executionId: string, body: RegisterMediaCommand): Promise<MediaUploadTicket>;
  confirmUploaded(id: string): Promise<MediaConfirmResult>;
}
export type ApiMethod = keyof ApiHandlers;
export interface ApiCall {
  method: ApiMethod;
  /** The execution ID (answers, complete, registerMedia) or media ID (confirmUploaded). */
  id: string | null;
  body: unknown;
}

export interface FakeApi {
  api: SyncApi;
  calls: ApiCall[];
  /** What a healthy server answers; custom handlers may delegate to these. */
  defaults: ApiHandlers;
  /** The /me/sync response `defaults.pull` returns. */
  sync: SyncResponse;
  on<K extends ApiMethod>(method: K, handler: ApiHandlers[K]): void;
  reset(method: ApiMethod): void;
}

const progress = { answered: 0, total: 0, requiredMissing: 0 };

export function createFakeApi(): FakeApi {
  const calls: ApiCall[] = [];
  const handlers: Partial<ApiHandlers> = {};
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
      registerMedia: async (_executionId, b) => ({
        mediaId: b.id,
        status: 'pending',
        uploadUrl: `http://files.test/taskop-media/${b.id}`,
        headers: { 'Content-Type': b.mime, 'Content-Length': String(b.bytes) },
        expiresAt: '2026-11-02T05:00:00.000Z',
      }),
      confirmUploaded: async (id) => ({ mediaId: id, status: 'uploaded', uploadedAt: '2026-11-02T04:30:00.000Z' }),
    },
    api: {
      sync: {
        pull: async (known = []) => {
          calls.push({ method: 'pull', id: null, body: known });
          return (handlers.pull ?? fake.defaults.pull)(known);
        },
      },
      executions: {
        claim: async (b) => {
          calls.push({ method: 'claim', id: null, body: b });
          return (handlers.claim ?? fake.defaults.claim)(b);
        },
        saveAnswers: async (id, b) => {
          calls.push({ method: 'saveAnswers', id, body: b });
          return (handlers.saveAnswers ?? fake.defaults.saveAnswers)(id, b);
        },
        complete: async (id, b) => {
          calls.push({ method: 'complete', id, body: b });
          return (handlers.complete ?? fake.defaults.complete)(id, b);
        },
        registerMedia: async (executionId, b) => {
          calls.push({ method: 'registerMedia', id: executionId, body: b });
          return (handlers.registerMedia ?? fake.defaults.registerMedia)(executionId, b);
        },
      },
      media: {
        confirmUploaded: async (id) => {
          calls.push({ method: 'confirmUploaded', id, body: null });
          return (handlers.confirmUploaded ?? fake.defaults.confirmUploaded)(id);
        },
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

Replace `apps/mobile/src/offline/testing/harness.ts` with:

```ts
import type { SyncResponse } from '@taskop/contracts';
import { type ChangeFeed, createChangeFeed } from '../change-feed';
import type { Db } from '../db';
import { createExecutionStore, type ExecutionStore, type WriteKind } from '../execution-store';
import { createMediaQueue, type MediaQueue } from '../media-queue';
import { applyPull } from '../sync-pull';
import { ensureUser } from '../user-scope';
import { createFakeApi, type FakeApi } from './fake-api';
import { createFakeTransport, type FakeTransport } from './fake-transport';
import { type Checklist, checklist, DEVICE, ME, manualClock, type ManualClock, syncResponse, T, testIds, versionOf } from './fixtures';
import { openTestDb } from './node-db';

export interface Harness {
  db: Db;
  clock: ManualClock;
  feed: ChangeFeed;
  transport: FakeTransport;
  store: ExecutionStore;
  api: FakeApi;
  mediaQueue: MediaQueue;
  /** Every onWrite call, in order. */
  writes: WriteKind[];
  c: Checklist;
  /** Applies a /me/sync response; the default is one open occurrence (OCC) and its version. */
  seed(res?: SyncResponse): Promise<void>;
}

export async function createHarness(o: { at?: string; db?: Db } = {}): Promise<Harness> {
  const db = o.db ?? (await openTestDb());
  const clock = manualClock(o.at ?? T.open);
  const feed = createChangeFeed();
  const transport = createFakeTransport();
  await ensureUser(db, ME, transport);
  const writes: WriteKind[] = [];
  const store = createExecutionStore({ db, clock, newId: testIds(clock), device: DEVICE, files: transport, feed, onWrite: (kind) => writes.push(kind) });
  const api = createFakeApi();
  const mediaQueue = createMediaQueue({ db, api: api.api, clock, transport, feed });
  const c = checklist();
  const seed = async (res: SyncResponse = syncResponse({ checklistVersions: [versionOf(c.content)] })) => {
    await applyPull(db, res, 0, clock.now());
    feed.emit();
  };
  await seed();
  return { db, clock, feed, transport, store, api, mediaQueue, writes, c, seed };
}
```

- [ ] **Step 2: Write the failing tests**

`apps/mobile/src/offline/sync-api.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { classifyError } from './sync-api';

describe('classifyError', () => {
  it.each<[string, unknown, string]>([
    ['a network failure', ApiError.network(), 'retry'],
    ['a 5xx', new ApiError(503, 'INTERNAL', 'errors.INTERNAL'), 'retry'],
    ['rate limiting', new ApiError(429, 'RATE_LIMITED', 'errors.RATE_LIMITED'), 'retry'],
    ['an unparseable 2xx', new ApiError(200, 'INTERNAL', 'errors.INTERNAL'), 'retry'],
    ['a non-API exception', new TypeError('boom'), 'retry'],
    ['an expired session', new ApiError(401, 'UNAUTHENTICATED', 'errors.UNAUTHENTICATED'), 'auth'],
    ['a refused command', new ApiError(422, 'CLOCK_INVALID', 'errors.CLOCK_INVALID'), 'permanent'],
    ['a validation failure', new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED'), 'permanent'],
  ])('%s', (_name, error, kind) => {
    expect(classifyError(error).kind).toBe(kind);
  });

  it('keeps the code and message key of a permanent failure', () => {
    expect(classifyError(new ApiError(409, 'EXECUTION_NOT_ACTIVE', 'errors.EXECUTION_NOT_ACTIVE'))).toEqual({
      kind: 'permanent', code: 'EXECUTION_NOT_ACTIVE', messageKey: 'errors.EXECUTION_NOT_ACTIVE',
    });
  });
});
```

`apps/mobile/src/offline/media-queue.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { iso } from './local-model';
import { createMediaQueue, LOCAL_FILE_KEEP_DAYS, MEDIA_MAX_ATTEMPTS, mediaErrorKey } from './media-queue';
import { capturedPhoto, capturedVideo } from './testing/fake-transport';
import { ME, OCC, T } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

/** Starts, attaches a video (problem draft) then a photo, and marks both registered, as an acknowledged outbox would. */
async function twoMedia(h: Harness) {
  const id = await h.store.start(OCC, ME);
  const video = capturedVideo(h.transport, { capturedAt: '2026-11-02T04:11:00.000Z' });
  const photo = capturedPhoto(h.transport, { capturedAt: '2026-11-02T04:12:00.000Z' });
  const videoId = await h.store.attachMedia(id, video, { itemId: h.c.temp.id, field: 'problem' });
  const photoId = await h.store.attachMedia(id, photo, { itemId: h.c.photo.id, field: 'evidence' });
  await h.db.run('UPDATE media SET registered_at = ?', [T.open]);
  return { id, video, photo, videoId, photoId };
}

const rows = (h: Harness) =>
  h.db.all<{ id: string; uploaded_at: string | null; failed_code: string | null; attempts: number }>('SELECT id, uploaded_at, failed_code, attempts FROM media ORDER BY captured_at');

describe('media queue', () => {
  it('uploads one file at a time, photos before videos, with exactly the ticket headers', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    let active = 0;
    let peak = 0;
    h.transport.respond(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return 200;
    });
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads.map((u) => u.uri)).toEqual([m.photo.localUri, m.video.localUri]);
    expect(peak).toBe(1);
    expect(h.transport.uploads[0]).toEqual({
      uri: m.photo.localUri,
      url: `http://files.test/taskop-media/${m.photoId}`,
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '250000' },
    });
    expect(h.api.calls.map((c) => [c.method, c.id])).toEqual([
      ['registerMedia', m.id], ['confirmUploaded', m.photoId], ['registerMedia', m.id], ['confirmUploaded', m.videoId],
    ]);
    expect((await rows(h)).every((r) => r.uploaded_at !== null)).toBe(true);
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('resumes after the app is killed mid-upload', async () => {
    const h = await createHarness();
    await twoMedia(h);
    h.transport.respond(() => {
      throw new Error('connection reset');
    });
    expect(await h.mediaQueue.drain()).toBe('retry');
    expect((await rows(h)).map((r) => [r.uploaded_at, r.attempts])).toEqual([[null, 0], [null, 0]]);
    // A new process: a fresh queue over the same database and files.
    h.transport.respond(() => 200);
    const restarted = createMediaQueue({ db: h.db, api: h.api.api, clock: h.clock, transport: h.transport, feed: h.feed });
    expect(await restarted.drain()).toBe('ok');
    expect((await rows(h)).every((r) => r.uploaded_at !== null)).toBe(true);
  });

  it('retries a confirmation that raced the upload and parks the file after 5 attempts', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    await h.db.run('DELETE FROM media WHERE id = ?', [m.videoId]);
    h.api.on('confirmUploaded', async () => {
      throw new ApiError(422, 'MEDIA_NOT_FOUND_IN_STORAGE', 'errors.MEDIA_NOT_FOUND_IN_STORAGE');
    });
    for (let i = 1; i < MEDIA_MAX_ATTEMPTS; i++) expect(await h.mediaQueue.drain()).toBe('retry');
    expect(await h.mediaQueue.counts()).toEqual({ pending: 1, failed: 0 });
    expect(await h.mediaQueue.drain()).toBe('retry');
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 1 });
    expect((await h.mediaQueue.list())[0]).toMatchObject({ kind: 'photo', failedCode: 'UPLOAD_FAILED', checklistName: 'Açılış yoxlaması' });
    expect(await h.mediaQueue.drain()).toBe('ok');
    h.api.reset('confirmUploaded');
    await h.mediaQueue.retryFailed();
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(await h.mediaQueue.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('parks a medium the server refuses and moves on to the next', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    h.api.on('registerMedia', async (executionId, b) => {
      if (b.kind === 'photo') throw new ApiError(422, 'EVIDENCE_LIVE_ONLY', 'errors.EVIDENCE_LIVE_ONLY');
      return h.api.defaults.registerMedia(executionId, b);
    });
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads.map((u) => u.uri)).toEqual([m.video.localUri]);
    expect(await h.mediaQueue.list()).toMatchObject([{ id: m.photoId, failedCode: 'EVIDENCE_LIVE_ONLY' }]);
    expect(mediaErrorKey('EVIDENCE_LIVE_ONLY')).toBe('errors.EVIDENCE_LIVE_ONLY');
    expect(mediaErrorKey('FILE_MISSING')).toBe('mobile.sync.mediaErrors.FILE_MISSING');
  });

  it('marks a file missing from the phone as failed and skips the PUT when the server already has the file', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    h.transport.files.delete(m.photo.localUri);
    h.api.on('registerMedia', async (executionId, b) => ({ ...(await h.api.defaults.registerMedia(executionId, b)), status: 'uploaded' }));
    expect(await h.mediaQueue.drain()).toBe('ok');
    expect(h.transport.uploads).toEqual([]);
    expect(h.api.calls.map((c) => c.method)).toEqual(['registerMedia']);
    expect((await rows(h)).map((r) => [r.id, r.failed_code, r.uploaded_at !== null])).toEqual([
      [m.videoId, null, true],
      [m.photoId, 'FILE_MISSING', false],
    ]);
  });

  it('deletes a local file only after upload and 7 days after its execution finished syncing', async () => {
    const h = await createHarness();
    const m = await twoMedia(h);
    await h.mediaQueue.drain();
    h.clock.set('2026-12-31T00:00:00.000Z');
    expect(await h.mediaQueue.cleanup()).toBe(0); // the execution has not finished syncing
    h.clock.set(T.open);
    await h.db.run('UPDATE executions SET finished_synced_at = ?', [T.open]);
    h.clock.set(iso(Date.parse(T.open) + LOCAL_FILE_KEEP_DAYS * 86_400_000 - 1));
    expect(await h.mediaQueue.cleanup()).toBe(0);
    h.clock.advance(1);
    expect(await h.mediaQueue.cleanup()).toBe(2);
    expect([...h.transport.removed].sort()).toEqual([m.photo.localUri, m.video.localUri].sort());
    expect(await h.mediaQueue.cleanup()).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/sync-api.test.ts src/offline/media-queue.test.ts`
Expected: FAIL: `./sync-api` and `./media-queue` do not exist.

- [ ] **Step 4: Implement**

`apps/mobile/src/offline/sync-api.ts`:

```ts
import { ApiError, type ExecutionsApi } from '@taskop/api-client';

/** The slice of the API client the offline layer uses (Part 1 Task 5). `api` from '@/lib/session' satisfies it. */
export interface SyncApi {
  sync: Pick<ExecutionsApi['sync'], 'pull'>;
  executions: Pick<ExecutionsApi['executions'], 'claim' | 'saveAnswers' | 'complete' | 'registerMedia'>;
  media: Pick<ExecutionsApi['media'], 'confirmUploaded'>;
}

export type Failure = { kind: 'retry' } | { kind: 'auth' } | { kind: 'permanent'; code: string; messageKey: string };

/**
 * Spec §7.2: network errors and 5xx stop the run and retry with backoff; any other 4xx is permanent for that command.
 * 401 means the API client's refresh was rejected: wait for a new session instead of parking the command (decision 5).
 */
export function classifyError(e: unknown): Failure {
  if (!(e instanceof ApiError)) return { kind: 'retry' };
  if (e.status === 401) return { kind: 'auth' };
  if (e.code === 'NETWORK' || e.code === 'INTERNAL' || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500) {
    return { kind: 'retry' };
  }
  return { kind: 'permanent', code: e.code, messageKey: e.messageKey };
}
```

`apps/mobile/src/offline/media-queue.ts`:

```ts
import type { MediaUploadTicket } from '@taskop/contracts';
import type { ChangeFeed } from './change-feed';
import { clampOffset, type Clock, readOffset } from './clock';
import type { Db } from './db';
import { iso, type LocalMedia, type MediaRow, toMedia } from './local-model';
import { classifyError, type SyncApi } from './sync-api';
import type { FileRemover } from './user-scope';

export interface MediaTransport extends FileRemover {
  exists(uri: string): boolean;
  /** PUTs the file's bytes to a presigned URL with exactly `headers`; resolves with the HTTP status. */
  upload(uri: string, url: string, headers: Record<string, string>): Promise<number>;
}

export const MEDIA_MAX_ATTEMPTS = 5;
export const LOCAL_FILE_KEEP_DAYS = 7;
const DAY_MS = 86_400_000;

export type DrainOutcome = 'ok' | 'retry' | 'auth';

export interface MediaQueueEntry {
  id: string;
  kind: LocalMedia['kind'];
  checklistName: string | null;
  failedCode: string | null;
  attempts: number;
}

export interface MediaQueue {
  /** Uploads every waiting file, one at a time, photos first. Stops at the first retryable failure. */
  drain(): Promise<DrainOutcome>;
  /** Deletes local files uploaded and finished syncing more than 7 days ago. Returns how many. */
  cleanup(): Promise<number>;
  counts(): Promise<{ pending: number; failed: number }>;
  list(): Promise<MediaQueueEntry[]>;
  retryFailed(): Promise<void>;
}

/** The i18n key for a medium's failure: local reasons under mobile.sync.mediaErrors, API codes under errors. */
export const mediaErrorKey = (code: string): string =>
  code === 'FILE_MISSING' || code === 'UPLOAD_FAILED' ? `mobile.sync.mediaErrors.${code}` : `errors.${code}`;

/** Registered through the outbox, not uploaded, not parked. */
const WAITING = 'registered_at IS NOT NULL AND uploaded_at IS NULL AND failed_code IS NULL AND file_deleted_at IS NULL';

export function createMediaQueue(deps: { db: Db; api: SyncApi; clock: Clock; transport: MediaTransport; feed: ChangeFeed }): MediaQueue {
  const { db, api, clock, transport, feed } = deps;

  async function park(id: string, code: string): Promise<'next'> {
    await db.run('UPDATE media SET failed_code = ?, attempts = attempts + 1 WHERE id = ?', [code, id]);
    feed.emit();
    return 'next';
  }

  /** A failure a later try may fix (bad PUT status, confirm before the object landed). Network errors never count. */
  async function countAttempt(id: string): Promise<'retry'> {
    await db.run('UPDATE media SET attempts = attempts + 1 WHERE id = ?', [id]);
    const n = await db.run(`UPDATE media SET failed_code = 'UPLOAD_FAILED' WHERE id = ? AND attempts >= ?`, [id, MEDIA_MAX_ATTEMPTS]);
    if (n > 0) feed.emit();
    return 'retry';
  }

  async function uploadOne(m: LocalMedia): Promise<DrainOutcome | 'next'> {
    if (!transport.exists(m.localUri)) return park(m.id, 'FILE_MISSING');
    let ticket: MediaUploadTicket;
    try {
      // Registering a known ID again only returns a fresh presigned URL (Part 1 Task 10, decision 1).
      ticket = await api.executions.registerMedia(m.executionId, {
        id: m.id, itemId: m.itemId, kind: m.kind, source: m.source, mime: m.mime, bytes: m.bytes,
        width: m.width, height: m.height, durationMs: m.durationMs, capturedAt: m.capturedAt,
        deviceTime: iso(clock.now()), clientOffsetMs: clampOffset(await readOffset(db)),
      });
    } catch (e) {
      const f = classifyError(e);
      return f.kind === 'permanent' ? park(m.id, f.code) : f.kind;
    }
    if (ticket.status !== 'uploaded') {
      let status: number;
      try {
        status = await transport.upload(m.localUri, ticket.uploadUrl, ticket.headers);
      } catch {
        return 'retry';
      }
      if (status < 200 || status >= 300) return countAttempt(m.id);
      try {
        await api.media.confirmUploaded(m.id);
      } catch (e) {
        const f = classifyError(e);
        if (f.kind === 'permanent' && f.code === 'MEDIA_NOT_FOUND_IN_STORAGE') return countAttempt(m.id);
        return f.kind === 'permanent' ? park(m.id, f.code) : f.kind;
      }
    }
    await db.run('UPDATE media SET uploaded_at = ? WHERE id = ?', [iso(clock.now()), m.id]);
    feed.emit();
    return 'next';
  }

  return {
    async drain() {
      for (;;) {
        const row = await db.first<MediaRow>(`SELECT * FROM media WHERE ${WAITING} ORDER BY CASE kind WHEN 'photo' THEN 0 ELSE 1 END, captured_at, id LIMIT 1`);
        if (!row) return 'ok';
        const outcome = await uploadOne(toMedia(row));
        if (outcome !== 'next') return outcome;
      }
    },
    async cleanup() {
      const now = clock.now();
      const due = await db.all<{ id: string; local_uri: string }>(
        `SELECT m.id, m.local_uri FROM media m JOIN executions e ON e.id = m.execution_id
         WHERE m.uploaded_at IS NOT NULL AND m.file_deleted_at IS NULL
           AND e.finished_synced_at IS NOT NULL AND e.finished_synced_at <= ?`,
        [iso(now - LOCAL_FILE_KEEP_DAYS * DAY_MS)],
      );
      for (const r of due) {
        try {
          transport.remove(r.local_uri);
        } catch {
          // Already gone.
        }
        await db.run('UPDATE media SET file_deleted_at = ? WHERE id = ?', [iso(now), r.id]);
      }
      return due.length;
    },
    async counts() {
      const r = await db.first<{ pending: number; failed: number }>(
        `SELECT (SELECT count(*) FROM media WHERE ${WAITING}) AS pending,
                (SELECT count(*) FROM media WHERE failed_code IS NOT NULL AND uploaded_at IS NULL) AS failed`,
      );
      return { pending: r?.pending ?? 0, failed: r?.failed ?? 0 };
    },
    async list() {
      const found = await db.all<{ id: string; kind: LocalMedia['kind']; checklist_name: string | null; failed_code: string | null; attempts: number }>(
        `SELECT m.id, m.kind, oc.checklist_name, m.failed_code, m.attempts FROM media m
         JOIN executions e ON e.id = m.execution_id
         LEFT JOIN occurrences oc ON oc.id = e.occurrence_id
         WHERE m.registered_at IS NOT NULL AND m.uploaded_at IS NULL AND m.file_deleted_at IS NULL
         ORDER BY CASE m.kind WHEN 'photo' THEN 0 ELSE 1 END, m.captured_at, m.id`,
      );
      return found.map((r) => ({ id: r.id, kind: r.kind, checklistName: r.checklist_name, failedCode: r.failed_code, attempts: r.attempts }));
    },
    async retryFailed() {
      await db.run('UPDATE media SET failed_code = NULL, attempts = 0 WHERE failed_code IS NOT NULL AND uploaded_at IS NULL');
      feed.emit();
    },
  };
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (sync-api 9, media-queue 6; the store tests still pass with the new harness).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/sync-api.ts apps/mobile/src/offline/sync-api.test.ts apps/mobile/src/offline/media-queue.ts apps/mobile/src/offline/media-queue.test.ts apps/mobile/src/offline/testing/fake-api.ts apps/mobile/src/offline/testing/harness.ts
git commit -m "feat(mobile): add the resumable media upload queue and API error classification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sync engine: ordered push, backoff, parking, rejected claims and the pull

**Files:**
- Create: `apps/mobile/src/offline/sync-engine.ts`
- Modify: `apps/mobile/src/offline/testing/harness.ts`
- Test: `apps/mobile/src/offline/sync-engine.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7; the command and result types from `@taskop/contracts`.
- Produces:
  - Triggers:
    - `type SyncTrigger = 'start' | 'reconnect' | 'foreground' | 'interval' | 'local' | 'claim' | 'manual' | 'retry'`
    - `'interval'` and `'local'` wait out a running backoff; the others run at once.
  - Backoff: `BACKOFF = { firstMs: 5000, maxMs: 300000 }`, `backoffDelay(failures): number`
  - Status: `interface SyncStatus { pending; failed; running; online; lastSyncedAt; clockOffsetMs; blockedByAuth }`, `type Indicator = 'synced' | 'pending' | 'offline' | 'failed'`, `indicatorOf(status)`
  - `interface ClaimRejection { executionId; occurrenceId; reason: ClaimRejectionReason; byName: string | null }`
  - `createSyncEngine({ db, api, clock, feed, mediaQueue, isOnline, onClaimRejected, beforeRun? }): SyncEngine`, with these methods:
    - `run(trigger?)`: single-flight. A call during a run schedules one more pass.
    - `idle()`, `status()`, `subscribe(listener)`, `refresh()`, `retryFailed()`, `stop()`
  - `markFinishedSynced(db, now)`
  - `Harness` gains `engine`, `net: { online: boolean }` and `rejections: ClaimRejection[]`

A run: `beforeRun` (the local `closes_at` lock) → offline? stop → push the outbox oldest first → pull `/me/sync` → drain the media queue → mark finished executions → clean up old files.

- [ ] **Step 1: Extend the harness**

In `apps/mobile/src/offline/testing/harness.ts`:
- Add the imports `import { type ClaimRejection, createSyncEngine, type SyncEngine } from '../sync-engine';`.
- Add these fields to `Harness`:

```ts
  engine: SyncEngine;
  /** The engine's isOnline() reads this. */
  net: { online: boolean };
  rejections: ClaimRejection[];
```

and in `createHarness`, before `const c = checklist();`:

```ts
  const net = { online: true };
  const rejections: ClaimRejection[] = [];
  const engine = createSyncEngine({
    db, api: api.api, clock, feed, mediaQueue,
    isOnline: () => net.online,
    onClaimRejected: (r) => rejections.push(r),
    beforeRun: () => store.lockExpired(),
  });
```

and return them: `return { db, clock, feed, transport, store, api, mediaQueue, engine, net, rejections, writes, c, seed };`

- [ ] **Step 2: Write the failing test**

`apps/mobile/src/offline/sync-engine.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { ExecutionLockedError } from './execution-store';
import { listCommands, outboxCounts } from './outbox';
import { backoffDelay, indicatorOf, type SyncStatus } from './sync-engine';
import { capturedPhoto } from './testing/fake-transport';
import { ME, myExecution, OCC, OCC2, occurrence, OTHER, OTHER_EXECUTION, syncResponse, T, VERSION, versionOf } from './testing/fixtures';
import { createHarness, type Harness } from './testing/harness';

const methods = (h: Harness) => h.api.calls.map((c) => c.method);
const revs = (h: Harness) => h.api.calls.filter((c) => c.method === 'saveAnswers').map((c) => (c.body as { rev: number }).rev);

describe('pushing the outbox', () => {
  it('sends claim, media registration, answers and completion oldest first, then pulls and uploads', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.problem.id, { optionIds: [h.c.no.id] });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.store.attachMedia(id, capturedPhoto(h.transport), { itemId: h.c.photo.id, field: 'evidence' });
    expect(await h.store.complete(id)).toEqual({ ok: true });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'registerMedia', 'saveAnswers', 'complete', 'pull', 'registerMedia', 'confirmUploaded']);
    expect(revs(h)).toEqual([3]);
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(await h.store.execution(id)).toMatchObject({ state: 'completed', claim: 'accepted', syncedRev: 3, finishedSyncedAt: T.open });
    expect(h.engine.status()).toMatchObject({ pending: 0, failed: 0, running: false });
    expect(indicatorOf(h.engine.status())).toBe('synced');
  });

  it('stamps each command with its send time and the offset measured at the last pull', async () => {
    const h = await createHarness();
    h.api.sync = syncResponse({ serverTime: '2026-11-02T04:08:00.000Z' });
    await h.engine.run('start');
    expect(h.engine.status().clockOffsetMs).toBe(120_000);
    await h.store.start(OCC, ME);
    h.clock.advance(5_000);
    await h.engine.run('manual');
    expect(h.api.calls.find((c) => c.method === 'claim')!.body).toMatchObject({ startedAt: T.open, deviceTime: '2026-11-02T04:10:05.000Z', clientOffsetMs: 120_000 });
  });

  it('collapses answers edited offline into the latest revision', async () => {
    const h = await createHarness();
    h.net.online = false;
    const id = await h.store.start(OCC, ME);
    for (const n of [3, 4, 5]) await h.store.patchAnswer(id, h.c.temp.id, { number: n });
    await h.engine.run('manual');
    expect(h.api.calls).toEqual([]);
    expect(h.engine.status()).toMatchObject({ online: false, pending: 2 });
    expect(indicatorOf(h.engine.status())).toBe('pending');
    h.net.online = true;
    await h.engine.run('reconnect');
    expect(revs(h)).toEqual([3]);
  });

  it('answers edited while their previous revision is in flight are sent next, in the same run', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    let entered!: () => void;
    const inFlight = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.api.on('saveAnswers', async (executionId, b) => {
      if (b.rev === 1) {
        entered();
        await gate;
      }
      return h.api.defaults.saveAnswers(executionId, b);
    });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 4 });
    const running = h.engine.run('manual');
    await inFlight;
    await h.store.patchAnswer(id, h.c.temp.id, { number: 6 });
    release();
    await running;
    expect(revs(h)).toEqual([1, 2]);
    expect(await h.store.execution(id)).toMatchObject({ rev: 2, syncedRev: 2, answers: { [h.c.temp.id]: { number: 6 } } });
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
  });
});

describe('failures', () => {
  it.each([
    [1, 5_000],
    [2, 10_000],
    [3, 20_000],
    [6, 160_000],
    [7, 300_000],
    [12, 300_000],
  ])('after %i failures the backoff is %i ms', (failures, ms) => {
    expect(backoffDelay(failures)).toBe(ms);
  });

  it.each<[string, () => Error]>([
    ['a NETWORK failure', () => ApiError.network()],
    ['a 5xx', () => new ApiError(503, 'INTERNAL', 'errors.INTERNAL')],
  ])('%s stops the run and keeps the command pending', async (_name, error) => {
    const h = await createHarness();
    h.api.on('claim', async () => {
      throw error();
    });
    await h.store.start(OCC, ME);
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim']);
    expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
    expect(indicatorOf(h.engine.status())).toBe('pending');
    h.engine.stop();
  });

  it('retries after 5 s, then 10 s; interval and local-write triggers wait, foreground does not', async () => {
    jest.useFakeTimers();
    try {
      const h = await createHarness();
      h.api.on('claim', async () => {
        throw ApiError.network();
      });
      await h.store.start(OCC, ME);
      const claims = () => h.api.calls.filter((c) => c.method === 'claim').length;
      await h.engine.run('manual');
      await h.engine.run('interval');
      await h.engine.run('local');
      expect(claims()).toBe(1);
      await jest.advanceTimersByTimeAsync(4_999);
      expect(claims()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      await h.engine.idle();
      expect(claims()).toBe(2);
      await jest.advanceTimersByTimeAsync(9_999);
      expect(claims()).toBe(2);
      await h.engine.run('foreground');
      expect(claims()).toBe(3);
      h.api.reset('claim');
      await jest.advanceTimersByTimeAsync(20_000);
      await h.engine.idle();
      expect(claims()).toBe(4);
      expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
      h.engine.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('parks a command refused with a 4xx, shows it red and moves on to the next execution', async () => {
    const h = await createHarness();
    await h.seed(syncResponse({ occurrences: [occurrence(), occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması' })], checklistVersions: [versionOf(h.c.content)] }));
    h.api.on('claim', async (b) => {
      if (b.occurrenceId === OCC) throw new ApiError(422, 'CLOCK_INVALID', 'errors.CLOCK_INVALID');
      return h.api.defaults.claim(b);
    });
    const first = await h.store.start(OCC, ME);
    const second = await h.store.start(OCC2, ME);
    await h.store.patchAnswer(first, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(methods(h)).toEqual(['claim', 'claim', 'pull']);
    expect(await listCommands(h.db)).toMatchObject([
      { executionId: first, kind: 'claim', status: 'failed', errorCode: 'CLOCK_INVALID', errorKey: 'errors.CLOCK_INVALID' },
      { executionId: first, kind: 'answers', status: 'pending' },
    ]);
    expect(await h.store.execution(second)).toMatchObject({ claim: 'accepted' });
    expect(indicatorOf(h.engine.status())).toBe('failed');
    h.api.reset('claim');
    await h.engine.retryFailed();
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
    expect(revs(h)).toEqual([1]);
  });

  it('a failed answers command is superseded by the next revision', async () => {
    const h = await createHarness();
    const id = await h.store.start(OCC, ME);
    await h.engine.run('manual');
    h.api.on('saveAnswers', async () => {
      throw new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED');
    });
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 1 });
    h.api.reset('saveAnswers');
    await h.store.patchAnswer(id, h.c.temp.id, { number: 6 });
    expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
    await h.engine.run('manual');
    expect(revs(h)).toEqual([1, 2]);
  });

  it('an expired session stops the run without failing or retrying the command', async () => {
    jest.useFakeTimers();
    try {
      const h = await createHarness();
      const id = await h.store.start(OCC, ME);
      h.api.on('saveAnswers', async () => {
        throw new ApiError(401, 'UNAUTHENTICATED', 'errors.UNAUTHENTICATED');
      });
      await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
      await h.engine.run('manual');
      expect(await outboxCounts(h.db)).toEqual({ pending: 1, failed: 0 });
      expect(h.engine.status()).toMatchObject({ blockedByAuth: true, failed: 0 });
      await jest.advanceTimersByTimeAsync(600_000);
      expect(revs(h)).toEqual([1]);
      h.api.reset('saveAnswers');
      await h.engine.run('foreground');
      expect(await outboxCounts(h.db)).toEqual({ pending: 0, failed: 0 });
      expect(h.engine.status().blockedByAuth).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('claims and the pull', () => {
  it('marks a rejected claim locally, tells the worker who holds it, and still sends what was done', async () => {
    const h = await createHarness();
    const holder = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
    h.api.on('claim', async (b) => ({ ...(await h.api.defaults.claim(b)), state: 'rejected', reason: 'ALREADY_CLAIMED', claim: holder }));
    const id = await h.store.start(OCC, ME);
    await h.store.patchAnswer(id, h.c.temp.id, { number: 5 });
    await h.engine.run('manual');
    expect(await h.store.execution(id)).toMatchObject({ state: 'rejected', claim: 'rejected', rejectedReason: 'ALREADY_CLAIMED', rejectedBy: 'Murad Həsənov' });
    expect(h.rejections).toEqual([{ executionId: id, occurrenceId: OCC, reason: 'ALREADY_CLAIMED', byName: 'Murad Həsənov' }]);
    expect(methods(h)).toEqual(['claim', 'saveAnswers', 'pull']);
    expect((await h.store.occurrence(OCC))!.claim).toEqual(holder);
    await expect(h.store.patchAnswer(id, h.c.temp.id, { number: 6 })).rejects.toBeInstanceOf(ExecutionLockedError);
    expect((await h.store.execution(id))!.finishedSyncedAt).toBe(T.open);
  });

  it('pulls claims, new occurrences and executions started on another phone', async () => {
    const h = await createHarness();
    const claim = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
    h.api.sync = syncResponse({
      occurrences: [occurrence({ status: 'started', claim }), occurrence({ id: OCC2 })],
      executions: [myExecution({ occurrenceId: OCC2, answersRev: 1, answers: { [h.c.temp.id]: { number: 5 } } })],
    });
    await h.engine.run('start');
    expect(h.api.calls[0]).toEqual({ method: 'pull', id: null, body: [VERSION] });
    const views = await h.store.occurrences();
    expect(views.find((o) => o.id === OCC)!.claim).toEqual(claim);
    expect(views.find((o) => o.id === OCC2)!.execution).toMatchObject({ claim: 'accepted', rev: 1, answers: { [h.c.temp.id]: { number: 5 } } });
    expect(h.engine.status().lastSyncedAt).toBe(T.open);
  });
});

describe('indicatorOf', () => {
  const s = (over: Partial<SyncStatus>): SyncStatus => ({ pending: 0, failed: 0, running: false, online: true, lastSyncedAt: null, clockOffsetMs: 0, blockedByAuth: false, ...over });
  it('is red on failures, amber while waiting or offline, green otherwise', () => {
    expect(indicatorOf(s({ failed: 1, pending: 3 }))).toBe('failed');
    expect(indicatorOf(s({ pending: 2, online: false }))).toBe('pending');
    expect(indicatorOf(s({ online: false }))).toBe('offline');
    expect(indicatorOf(s({}))).toBe('synced');
  });
});
```

- [ ] **Step 3: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/offline/sync-engine.test.ts`
Expected: FAIL: `Cannot find module './sync-engine'` (also from the harness).

- [ ] **Step 4: Implement**

`apps/mobile/src/offline/sync-engine.ts`:

```ts
import type {
  ClaimCommand,
  ClaimRejectionReason,
  ClaimResult,
  CompleteCommand,
  CompleteResult,
  RegisterMediaCommand,
  SaveAnswersCommand,
  SyncResponse,
} from '@taskop/contracts';
import type { ChangeFeed } from './change-feed';
import { clampOffset, type Clock, measureOffset, readOffset } from './clock';
import { type Db, getMeta } from './db';
import { iso, normIso } from './local-model';
import type { MediaQueue } from './media-queue';
import { ackCommand, failCommand, nextCommand, noteAttempt, type OutboxCommand, outboxCounts, retryFailedCommands } from './outbox';
import { classifyError, type SyncApi } from './sync-api';
import { applyPull, knownVersionIds } from './sync-pull';

export type SyncTrigger = 'start' | 'reconnect' | 'foreground' | 'interval' | 'local' | 'claim' | 'manual' | 'retry';

/** These wait out a running backoff; the others run at once (decision 14). */
const WAITS_FOR_BACKOFF: ReadonlySet<SyncTrigger> = new Set(['interval', 'local']);

export const BACKOFF = { firstMs: 5_000, maxMs: 300_000 } as const;

/** Spec §7.2: exponential from 5 s, capped at 5 min. */
export const backoffDelay = (failures: number): number => Math.min(BACKOFF.firstMs * 2 ** Math.max(failures - 1, 0), BACKOFF.maxMs);

export interface SyncStatus {
  /** Outbox commands and registered files still to send. */
  pending: number;
  failed: number;
  running: boolean;
  online: boolean;
  lastSyncedAt: string | null;
  clockOffsetMs: number;
  /** The API refused the session; commands wait for the next sign-in (decision 5). */
  blockedByAuth: boolean;
}

export type Indicator = 'synced' | 'pending' | 'offline' | 'failed';

/** Spec §7.3: red when something failed, amber while anything waits or the phone is offline, green otherwise. */
export function indicatorOf(s: SyncStatus): Indicator {
  if (s.failed > 0) return 'failed';
  if (s.pending > 0) return 'pending';
  if (!s.online) return 'offline';
  return 'synced';
}

export interface ClaimRejection {
  executionId: string;
  occurrenceId: string;
  reason: ClaimRejectionReason;
  /** Who holds the claim instead, when the server said. */
  byName: string | null;
}

export interface SyncEngineDeps {
  db: Db;
  api: SyncApi;
  clock: Clock;
  feed: ChangeFeed;
  mediaQueue: Pick<MediaQueue, 'drain' | 'cleanup' | 'counts' | 'retryFailed'>;
  isOnline: () => boolean;
  onClaimRejected: (r: ClaimRejection) => void;
  /** Runs at the start of every run, online or not: the local closes_at lock. */
  beforeRun?: () => Promise<unknown>;
}

export interface SyncEngine {
  run(trigger?: SyncTrigger): Promise<void>;
  /** Resolves when no run is in progress. */
  idle(): Promise<void>;
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** "Yenidən cəhd et": failed commands and files go back to pending, then a run starts. */
  retryFailed(): Promise<void>;
  stop(): void;
}

type Outcome = 'ok' | 'retry' | 'auth';

/** An execution has finished syncing when it left `active` and none of its commands is left (decision 8). */
export async function markFinishedSynced(db: Db, now: number): Promise<void> {
  await db.run(
    `UPDATE executions SET finished_synced_at = ?
     WHERE state <> 'active' AND finished_synced_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.execution_id = executions.id)`,
    [iso(now)],
  );
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { db, api, clock, feed, mediaQueue, isOnline, onClaimRejected, beforeRun } = deps;
  let status: SyncStatus = { pending: 0, failed: 0, running: false, online: isOnline(), lastSyncedAt: null, clockOffsetMs: 0, blockedByAuth: false };
  const listeners = new Set<() => void>();
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function publish(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch };
    listeners.forEach((l) => l());
  }

  async function refresh(): Promise<void> {
    const outbox = await outboxCounts(db);
    const media = await mediaQueue.counts();
    publish({
      pending: outbox.pending + media.pending,
      failed: outbox.failed + media.failed,
      online: isOnline(),
      lastSyncedAt: await getMeta(db, 'lastSyncedAt'),
      clockOffsetMs: await readOffset(db),
    });
  }
  feed.subscribe(() => void refresh());

  function clearRetry(): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(): void {
    failures += 1;
    clearRetry();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void run('retry');
    }, backoffDelay(failures));
  }

  async function send(cmd: OutboxCommand): Promise<unknown> {
    const body = { ...cmd.payload, deviceTime: iso(clock.now()), clientOffsetMs: clampOffset(await readOffset(db)) };
    switch (cmd.kind) {
      case 'claim':
        return api.executions.claim(body as ClaimCommand);
      case 'media':
        return api.executions.registerMedia(cmd.executionId, body as RegisterMediaCommand);
      case 'answers':
        return api.executions.saveAnswers(cmd.executionId, body as SaveAnswersCommand);
      case 'complete':
        return api.executions.complete(cmd.executionId, body as CompleteCommand);
    }
  }

  async function applyResult(tx: Db, cmd: OutboxCommand, result: unknown, now: number): Promise<ClaimRejection | null> {
    switch (cmd.kind) {
      case 'claim': {
        const r = result as ClaimResult;
        const e = await tx.first<{ occurrence_id: string }>('SELECT occurrence_id FROM executions WHERE id = ?', [cmd.executionId]);
        if (!e) return null;
        if (r.claim) {
          await tx.run('UPDATE occurrences SET claim_execution_id = ?, claim_user_id = ?, claim_name = ? WHERE id = ?', [
            r.claim.executionId, r.claim.executorUserId, r.claim.executorName, e.occurrence_id,
          ]);
        }
        if (r.state === 'rejected') {
          await tx.run(`UPDATE executions SET state = 'rejected', claim = 'rejected', rejected_reason = ?, rejected_by = ?, updated_at = ? WHERE id = ?`, [
            r.reason, r.claim?.executorName ?? null, iso(now), cmd.executionId,
          ]);
          return { executionId: cmd.executionId, occurrenceId: e.occurrence_id, reason: r.reason ?? 'ALREADY_CLAIMED', byName: r.claim?.executorName ?? null };
        }
        await tx.run(`UPDATE executions SET claim = 'accepted', started_at = ?, updated_at = ? WHERE id = ?`, [normIso(r.startedAt), iso(now), cmd.executionId]);
        await tx.run(`UPDATE occurrences SET status = 'started' WHERE id = ? AND status IN ('pending', 'overdue', 'missed')`, [e.occurrence_id]);
        return null;
      }
      case 'media':
        await tx.run('UPDATE media SET registered_at = ? WHERE id = ?', [iso(now), cmd.refId]);
        return null;
      case 'answers':
        // max(): a late success for an older revision must never lower what is known to be synced.
        await tx.run('UPDATE executions SET synced_rev = max(synced_rev, ?) WHERE id = ?', [cmd.rev, cmd.executionId]);
        return null;
      case 'complete': {
        const r = result as CompleteResult;
        await tx.run(
          'UPDATE executions SET state = ?, completed_at = coalesce(?, completed_at), synced_rev = max(synced_rev, ?), updated_at = ? WHERE id = ?',
          [r.state, r.completedAt ? normIso(r.completedAt) : null, cmd.rev, iso(now), cmd.executionId],
        );
        return null;
      }
    }
  }

  async function push(): Promise<Outcome> {
    for (;;) {
      if (stopped) return 'ok';
      const cmd = await nextCommand(db);
      if (!cmd) return 'ok';
      let result: unknown;
      try {
        result = await send(cmd);
      } catch (e) {
        const f = classifyError(e);
        if (f.kind === 'permanent') {
          await failCommand(db, cmd.seq, f.code, f.messageKey);
          feed.emit();
          continue;
        }
        if (f.kind === 'retry') await noteAttempt(db, cmd.seq);
        return f.kind;
      }
      // If the worker superseded this command while it was in flight, ack deletes nothing and the newer one goes next.
      const rejection = await db.transaction(async (tx) => {
        const r = await applyResult(tx, cmd, result, clock.now());
        await ackCommand(tx, cmd.seq);
        return r;
      });
      feed.emit();
      if (rejection) onClaimRejected(rejection);
    }
  }

  async function pull(): Promise<Outcome> {
    const known = await knownVersionIds(db);
    const sentAt = clock.now();
    let res: SyncResponse;
    try {
      res = await api.sync.pull(known);
    } catch (e) {
      return classifyError(e).kind === 'auth' ? 'auth' : 'retry';
    }
    const receivedAt = clock.now();
    await applyPull(db, res, clampOffset(measureOffset(res.serverTime, sentAt, receivedAt)), receivedAt);
    feed.emit();
    return 'ok';
  }

  async function cycle(): Promise<Outcome> {
    const pushed = await push();
    if (pushed !== 'ok' || stopped) return pushed;
    const pulled = await pull();
    if (pulled !== 'ok' || stopped) return pulled;
    const drained = await mediaQueue.drain();
    if (drained !== 'ok') return drained;
    await markFinishedSynced(db, clock.now());
    await mediaQueue.cleanup();
    return 'ok';
  }

  function run(trigger: SyncTrigger = 'manual'): Promise<void> {
    if (stopped) return Promise.resolve();
    if (WAITS_FOR_BACKOFF.has(trigger) && retryTimer) return running ?? Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      publish({ running: true });
      try {
        do {
          again = false;
          await beforeRun?.();
          if (!isOnline()) break;
          const outcome = await cycle().catch((): Outcome => 'retry');
          if (outcome === 'retry') {
            scheduleRetry();
            break;
          }
          if (outcome === 'auth') {
            publish({ blockedByAuth: true });
            break;
          }
          failures = 0;
          clearRetry();
          publish({ blockedByAuth: false });
        } while (again && !stopped);
      } finally {
        running = null;
        publish({ running: false });
        await refresh();
      }
    })();
    return running;
  }

  return {
    run,
    idle: () => running ?? Promise.resolve(),
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async retryFailed() {
      await retryFailedCommands(db);
      await mediaQueue.retryFailed();
      feed.emit();
      await run('manual');
    },
    stop() {
      stopped = true;
      clearRetry();
    },
  };
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (sync-engine: 4 + 6 backoff cases + 2 + 4 + 2 + 1). No test waits on wall-clock time.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline/sync-engine.ts apps/mobile/src/offline/sync-engine.test.ts apps/mobile/src/offline/testing/harness.ts
git commit -m "feat(mobile): add the sync engine with ordered push, backoff, 4xx parking and claim rejection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Sync triggers, offline services, native adapters and the provider

**Files:**
- Create:
  - In `apps/mobile/src/offline/`: `sync-triggers.ts`, `services.ts`, `context.tsx`, `hooks.ts`, `offline-provider.tsx`
  - In `apps/mobile/src/offline/native/`: `open-database.ts`, `media-files.ts`, `ports.ts`, `device.ts`, `create-native-services.ts`
  - In `apps/mobile/src/offline/testing/`: `test-services.ts`, `render.tsx`
  - `apps/mobile/src/features/sync/claim-rejection.ts`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/offline/sync-triggers.test.ts`, `apps/mobile/src/offline/services.test.ts`, `apps/mobile/src/features/sync/claim-rejection.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 3–8
  - `api` from `@/lib/session`
  - Expo modules: `expo-sqlite`, `expo-secure-store`, `expo-crypto`, `expo-file-system`, `expo-network`, `expo-constants`
  - `AppState` and `Platform` from `react-native`
- Produces:
  - Ports: `interface NetworkPort { isOnline(); subscribe(listener: (online) => void) }`, `interface AppStatePort { subscribe(listener: (active) => void) }`
  - Triggers: `SYNC_INTERVAL_MS = 30000`, `LOCAL_WRITE_DELAY_MS = 2000`, `startSyncTriggers({ run, network, appState }): SyncTriggers { requestSoon(); stop() }`
  - Services:
    - `interface ServiceDeps { db; api; clock; newId; device; transport; isOnline; triggers?: { network; appState }; onClaimRejected }`
    - `interface OfflineServices { userId; timeZone; db; clock; feed; store; engine; mediaQueue; syncNow(trigger?); clearAll(); dispose() }`
    - `createOfflineServices(deps, userId, timeZone): Promise<OfflineServices>`: migrate → ensureUser → lock → refresh → triggers
  - React: `OfflineServicesProvider({ services, children })`, `useOffline()`, `useLiveQuery(query, deps)`, `useSyncStatus()`, `useNow(intervalMs = 15000)`, `OfflineProvider({ userId, timeZone, children })`
  - Native adapters: `openEncryptedDatabase(): Promise<Db>`, `nativeMediaFiles: MediaTransport`, `mediaDirectory()`, `expoNetwork(): NetworkPort`, `rnAppState(): AppStatePort`, `deviceInfo(): DeviceInfo`, `createNativeServices(userId, timeZone, { onClaimRejected })`
  - `claimRejectionText(t: TFunction, reason: ClaimRejectionReason, byName: string | null): string`
  - Testing:
    - `createTestServices({ at?, userId?, db?, transport?, online? = false })` / `TestServices` (`services`, `api`, `clock`, `transport`, `db`, `net`, `rejections`, `c`, `seed(res?)`)
    - `renderWithServices(services, ui)`, `eventually(check)`

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/offline/sync-triggers.test.ts`:

```ts
import type { SyncTrigger } from './sync-engine';
import { type AppStatePort, LOCAL_WRITE_DELAY_MS, type NetworkPort, startSyncTriggers, SYNC_INTERVAL_MS } from './sync-triggers';

function ports(online: boolean) {
  const netListeners = new Set<(o: boolean) => void>();
  const appListeners = new Set<(a: boolean) => void>();
  let isOnline = online;
  const network: NetworkPort = {
    isOnline: () => isOnline,
    subscribe: (l) => {
      netListeners.add(l);
      return () => netListeners.delete(l);
    },
  };
  const appState: AppStatePort = {
    subscribe: (l) => {
      appListeners.add(l);
      return () => appListeners.delete(l);
    },
  };
  return {
    network,
    appState,
    setOnline(o: boolean) {
      isOnline = o;
      netListeners.forEach((l) => l(o));
    },
    setActive: (a: boolean) => appListeners.forEach((l) => l(a)),
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('sync triggers', () => {
  it('runs on start, on reconnect and on returning to the foreground', () => {
    const p = ports(false);
    const runs: SyncTrigger[] = [];
    const t = startSyncTriggers({ run: (x) => runs.push(x), network: p.network, appState: p.appState });
    p.setOnline(false);
    p.setOnline(true);
    p.setOnline(true);
    p.setActive(false);
    p.setActive(true);
    expect(runs).toEqual(['start', 'reconnect', 'foreground']);
    t.stop();
  });

  it('runs every 30 s only while online and in the foreground, and never after stop', () => {
    const p = ports(true);
    const runs: SyncTrigger[] = [];
    const t = startSyncTriggers({ run: (x) => runs.push(x), network: p.network, appState: p.appState });
    jest.advanceTimersByTime(SYNC_INTERVAL_MS * 2);
    expect(runs).toEqual(['start', 'interval', 'interval']);
    p.setOnline(false);
    jest.advanceTimersByTime(SYNC_INTERVAL_MS);
    p.setOnline(true);
    p.setActive(false);
    jest.advanceTimersByTime(SYNC_INTERVAL_MS);
    expect(runs).toEqual(['start', 'interval', 'interval', 'reconnect']);
    t.stop();
    p.setActive(true);
    jest.advanceTimersByTime(SYNC_INTERVAL_MS * 5);
    expect(runs).toHaveLength(4);
  });

  it('runs once, 2 s after the last of several local writes', () => {
    const p = ports(true);
    const runs: SyncTrigger[] = [];
    const t = startSyncTriggers({ run: (x) => runs.push(x), network: p.network, appState: p.appState });
    t.requestSoon();
    jest.advanceTimersByTime(1_500);
    t.requestSoon();
    jest.advanceTimersByTime(LOCAL_WRITE_DELAY_MS - 1);
    expect(runs).toEqual(['start']);
    jest.advanceTimersByTime(1);
    expect(runs).toEqual(['start', 'local']);
    t.stop();
  });
});
```

`apps/mobile/src/offline/services.test.ts`:

```ts
import { capturedPhoto } from './testing/fake-transport';
import { ME, OCC, OTHER } from './testing/fixtures';
import { createTestServices } from './testing/test-services';

describe('offline services', () => {
  it("signing in as another user clears the previous user's unsynced data and never sends it", async () => {
    const a = await createTestServices();
    await a.seed();
    const id = await a.services.store.start(OCC, ME);
    const photo = capturedPhoto(a.transport);
    await a.services.store.attachMedia(id, photo, { itemId: a.c.photo.id, field: 'evidence' });
    await a.services.dispose();

    const b = await createTestServices({ db: a.db, transport: a.transport, userId: OTHER, online: true });
    expect(await b.services.store.occurrences()).toEqual([]);
    expect(await b.services.store.unsyncedCount()).toBe(0);
    expect(await b.db.first('SELECT count(*) AS n FROM outbox')).toEqual({ n: 0 });
    expect(a.transport.removed).toEqual([photo.localUri]);
    await b.services.syncNow('manual');
    expect(b.api.calls.map((c) => c.method)).toEqual(['pull']);
  });

  it('signing in again as the same user keeps the unsynced data', async () => {
    const a = await createTestServices();
    await a.seed();
    await a.services.store.start(OCC, ME);
    await a.services.dispose();
    const again = await createTestServices({ db: a.db, transport: a.transport });
    expect(await again.services.store.unsyncedCount()).toBe(1);
  });

  it('claims at once when online', async () => {
    const t = await createTestServices({ online: true });
    await t.seed();
    await t.services.store.start(OCC, ME);
    await t.services.engine.idle();
    expect(t.api.calls.map((c) => c.method)).toEqual(['claim', 'pull']);
  });

  it('clearAll stops syncing and deletes every row and file', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    const photo = capturedPhoto(t.transport);
    await t.services.store.attachMedia(id, photo, { itemId: t.c.photo.id, field: 'evidence' });
    await t.services.clearAll();
    expect(await t.services.store.occurrences()).toEqual([]);
    expect(await t.services.store.unsyncedCount()).toBe(0);
    expect(t.transport.removed).toContain(photo.localUri);
    t.net.online = true;
    await t.services.syncNow('manual');
    expect(t.api.calls).toEqual([]);
  });
});
```

`apps/mobile/src/features/sync/claim-rejection.test.ts`:

```ts
import i18n from '@/lib/i18n';
import { claimRejectionText } from './claim-rejection';

describe('claimRejectionText', () => {
  const t = i18n.getFixedT(null);
  it('names the worker who won the claim, and explains the other reasons', () => {
    expect(claimRejectionText(t, 'ALREADY_CLAIMED', 'Murad')).toBe('Bu checklist artıq Murad tərəfindən icra olunur');
    expect(claimRejectionText(t, 'ALREADY_CLAIMED', null)).toBe('Bu checklist artıq başqa əməkdaş tərəfindən icra olunur.');
    expect(claimRejectionText(t, 'NOT_ON_SHIFT', null)).toBe('Bu gün bu növbədə işləmirsiniz.');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/sync-triggers.test.ts src/offline/services.test.ts src/features/sync/claim-rejection.test.ts`
Expected: FAIL: the modules do not exist.

- [ ] **Step 3: Implement the triggers, services, context and hooks**

`apps/mobile/src/offline/sync-triggers.ts`:

```ts
import type { SyncTrigger } from './sync-engine';

export interface NetworkPort {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface AppStatePort {
  /** `active` is true when the app comes to the foreground. */
  subscribe(listener: (active: boolean) => void): () => void;
}

export const SYNC_INTERVAL_MS = 30_000;
export const LOCAL_WRITE_DELAY_MS = 2_000;

export interface SyncTriggers {
  /** A local write happened: run 2 s after the last one. */
  requestSoon(): void;
  stop(): void;
}

/** Spec §7.2: app start, reconnect, foreground, every 30 s while online, 2 s after a local write. No background sync. */
export function startSyncTriggers(o: { run: (trigger: SyncTrigger) => void; network: NetworkPort; appState: AppStatePort }): SyncTriggers {
  let online = o.network.isOnline();
  let active = true;
  let soon: ReturnType<typeof setTimeout> | null = null;
  const offNetwork = o.network.subscribe((next) => {
    const was = online;
    online = next;
    if (next && !was) o.run('reconnect');
  });
  const offAppState = o.appState.subscribe((next) => {
    const was = active;
    active = next;
    if (next && !was) o.run('foreground');
  });
  const tick = setInterval(() => {
    if (online && active) o.run('interval');
  }, SYNC_INTERVAL_MS);
  o.run('start');
  return {
    requestSoon() {
      if (soon) clearTimeout(soon);
      soon = setTimeout(() => {
        soon = null;
        o.run('local');
      }, LOCAL_WRITE_DELAY_MS);
    },
    stop() {
      offNetwork();
      offAppState();
      clearInterval(tick);
      if (soon) clearTimeout(soon);
    },
  };
}
```

`apps/mobile/src/offline/services.ts`:

```ts
import type { DeviceInfo } from '@taskop/contracts';
import { type ChangeFeed, createChangeFeed } from './change-feed';
import type { Clock } from './clock';
import { type Db, migrate } from './db';
import { createExecutionStore, type ExecutionStore } from './execution-store';
import { createMediaQueue, type MediaQueue, type MediaTransport } from './media-queue';
import type { SyncApi } from './sync-api';
import { type ClaimRejection, createSyncEngine, type SyncEngine, type SyncTrigger } from './sync-engine';
import { type AppStatePort, type NetworkPort, startSyncTriggers, type SyncTriggers } from './sync-triggers';
import { clearLocalData, ensureUser } from './user-scope';

export interface ServiceDeps {
  db: Db;
  api: SyncApi;
  clock: Clock;
  newId: () => string;
  device: DeviceInfo;
  transport: MediaTransport;
  isOnline: () => boolean;
  /** Absent in tests: runs then happen only when a test asks. */
  triggers?: { network: NetworkPort; appState: AppStatePort };
  onClaimRejected: (r: ClaimRejection) => void;
}

export interface OfflineServices {
  readonly userId: string;
  readonly timeZone: string;
  readonly db: Db;
  readonly clock: Clock;
  readonly feed: ChangeFeed;
  readonly store: ExecutionStore;
  readonly engine: SyncEngine;
  readonly mediaQueue: MediaQueue;
  syncNow(trigger?: SyncTrigger): Promise<void>;
  /** Logout: stop syncing, wait for a running sync, then delete every row and file. */
  clearAll(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createOfflineServices(deps: ServiceDeps, userId: string, timeZone: string): Promise<OfflineServices> {
  const { db, api, clock, transport } = deps;
  await migrate(db);
  // Before anything can sync: another user's data must never go out with this user's token (spec §7.2).
  await ensureUser(db, userId, transport);
  const feed = createChangeFeed();
  let triggers: SyncTriggers | null = null;
  const mediaQueue = createMediaQueue({ db, api, clock, transport, feed });
  const store = createExecutionStore({
    db,
    clock,
    newId: deps.newId,
    device: deps.device,
    files: transport,
    feed,
    // An online start claims at once (spec §1); other changes wait 2 s for more edits.
    onWrite: (kind) => (kind === 'claim' ? void engine.run('claim') : triggers?.requestSoon()),
  });
  const engine = createSyncEngine({
    db, api, clock, feed, mediaQueue,
    isOnline: deps.isOnline,
    onClaimRejected: deps.onClaimRejected,
    beforeRun: () => store.lockExpired(),
  });
  await store.lockExpired();
  await engine.refresh();
  const unsubscribe: (() => void)[] = [];
  if (deps.triggers) {
    const { network, appState } = deps.triggers;
    unsubscribe.push(network.subscribe(() => void engine.refresh()));
    triggers = startSyncTriggers({ run: (trigger) => void engine.run(trigger), network, appState });
  }
  const shutDown = async () => {
    triggers?.stop();
    unsubscribe.splice(0).forEach((off) => off());
    engine.stop();
    await engine.idle();
  };
  return {
    userId,
    timeZone,
    db,
    clock,
    feed,
    store,
    engine,
    mediaQueue,
    syncNow: (trigger = 'manual') => engine.run(trigger),
    async clearAll() {
      await shutDown();
      await clearLocalData(db, transport);
      feed.emit();
    },
    dispose: shutDown,
  };
}
```

`apps/mobile/src/offline/context.tsx`:

```tsx
import { createContext, type ReactNode, useContext } from 'react';
import type { OfflineServices } from './services';

const OfflineContext = createContext<OfflineServices | null>(null);

export function OfflineServicesProvider({ services, children }: { services: OfflineServices; children: ReactNode }) {
  return <OfflineContext.Provider value={services}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineServices {
  const services = useContext(OfflineContext);
  if (!services) throw new Error('useOffline() needs an OfflineProvider');
  return services;
}
```

`apps/mobile/src/offline/hooks.ts`:

```ts
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useOffline } from './context';
import type { OfflineServices } from './services';
import type { SyncStatus } from './sync-engine';

/** Runs `query` now and again after every local change or sync result. `undefined` while the first run is pending. */
export function useLiveQuery<T>(query: (s: OfflineServices) => Promise<T>, deps: readonly unknown[]): T | undefined {
  const services = useOffline();
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void query(services).then((v) => {
        if (alive) setValue(v);
      });
    };
    load();
    const off = services.feed.subscribe(load);
    return () => {
      alive = false;
      off();
    };
    // `deps` lists what `query` reads; the repo's ESLint config has no react-hooks plugin to check it.
  }, [services, ...deps]);
  return value;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useOffline();
  return useSyncExternalStore(engine.subscribe, engine.status);
}

/** The offline clock's time, refreshed on an interval and on every change (so a passed closes_at shows promptly). */
export function useNow(intervalMs = 15_000): number {
  const { clock, feed } = useOffline();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const tick = () => setNow(clock.now());
    const id = setInterval(tick, intervalMs);
    const off = feed.subscribe(tick);
    return () => {
      clearInterval(id);
      off();
    };
  }, [clock, feed, intervalMs]);
  return now;
}
```

`apps/mobile/src/features/sync/claim-rejection.ts`:

```ts
import type { ClaimRejectionReason } from '@taskop/contracts';
import type { TFunction } from 'i18next';

/** Spec §7.2: "Bu checklist artıq {name} tərəfindən icra olunur" when the winner is known, else the reason. */
export function claimRejectionText(t: TFunction, reason: ClaimRejectionReason, byName: string | null): string {
  return reason === 'ALREADY_CLAIMED' && byName ? t('executions.alreadyClaimedBy', { name: byName }) : t(`executions.claimRejections.${reason}`);
}
```

- [ ] **Step 4: Implement the test helpers**

`apps/mobile/src/offline/testing/test-services.ts`:

```ts
import type { SyncResponse } from '@taskop/contracts';
import type { Db } from '../db';
import { createOfflineServices, type OfflineServices } from '../services';
import type { ClaimRejection } from '../sync-engine';
import { applyPull } from '../sync-pull';
import { createFakeApi, type FakeApi } from './fake-api';
import { createFakeTransport, type FakeTransport } from './fake-transport';
import { type Checklist, checklist, DEVICE, ME, manualClock, type ManualClock, syncResponse, T, testIds, versionOf } from './fixtures';
import { openTestDb } from './node-db';

export interface TestServices {
  services: OfflineServices;
  api: FakeApi;
  clock: ManualClock;
  transport: FakeTransport;
  db: Db;
  /** The services' isOnline() reads this. Offline by default, so actions never sync behind a test's back. */
  net: { online: boolean };
  rejections: ClaimRejection[];
  c: Checklist;
  /** Applies a /me/sync response (default: OCC open and its version) and refreshes the sync status. */
  seed(res?: SyncResponse): Promise<void>;
}

export async function createTestServices(
  o: { at?: string; userId?: string; db?: Db; transport?: FakeTransport; online?: boolean } = {},
): Promise<TestServices> {
  const db = o.db ?? (await openTestDb());
  const clock = manualClock(o.at ?? T.open);
  const api = createFakeApi();
  const transport = o.transport ?? createFakeTransport();
  const net = { online: o.online ?? false };
  const rejections: ClaimRejection[] = [];
  const services = await createOfflineServices(
    { db, api: api.api, clock, newId: testIds(clock), device: DEVICE, transport, isOnline: () => net.online, onClaimRejected: (r) => rejections.push(r) },
    o.userId ?? ME,
    'Asia/Baku',
  );
  const c = checklist();
  const seed = async (res: SyncResponse = syncResponse({ checklistVersions: [versionOf(c.content)] })) => {
    await applyPull(db, res, 0, clock.now());
    services.feed.emit();
    await services.engine.refresh();
  };
  return { services, api, clock, transport, db, net, rejections, c, seed };
}
```

`apps/mobile/src/offline/testing/render.tsx`:

```tsx
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { OfflineServicesProvider } from '../context';
import type { OfflineServices } from '../services';

export function renderWithServices(services: OfflineServices, ui: ReactElement) {
  return render(<OfflineServicesProvider services={services}>{ui}</OfflineServicesProvider>);
}

/** Retries an async assertion for up to 1 s: screens save through the store asynchronously after a press or blur. */
export async function eventually(check: () => Promise<void>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      await check();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await check();
}
```

- [ ] **Step 5: Implement the native adapters and the provider**

These files are typechecked but never loaded by Jest. Task 16 checks them on a device.

`apps/mobile/src/offline/native/open-database.ts`:

```ts
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { createDb, type Db, type SqlDriver, type SqlValue } from '../db';

const DB_NAME = 'taskop.db';
const KEY_NAME = 'taskop.dbKey';

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** 32 random bytes per install, kept in the keychain/keystore and never leaving the device (FR-10.10). */
async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const key = toHex(getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return key;
}

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => (await db.runAsync(sql, params)).changes,
    all: <T>(sql: string, params: SqlValue[]) => db.getAllAsync<T>(sql, params),
    close: () => db.closeAsync(),
  };
}

async function openWithKey(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  try {
    // The key must be the first statement on the connection; a raw hex key skips SQLCipher's key derivation.
    await db.execAsync(`PRAGMA key = "x'${key}'"`);
    await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master'); // "file is not a database" on a wrong key
    await db.execAsync('PRAGMA journal_mode = WAL');
    return db;
  } catch (e) {
    await db.closeAsync().catch(() => undefined);
    throw e;
  }
}

/**
 * Opens the encrypted database. A file the stored key cannot open (the keychain was restored without it) is
 * unreadable anyway: it is deleted and recreated empty, and the next sync downloads the user's data again.
 */
export async function openEncryptedDatabase(): Promise<Db> {
  const key = await databaseKey();
  try {
    return createDb(expoDriver(await openWithKey(key)));
  } catch (e) {
    if (!/not a database|encrypted/i.test(String(e))) throw e;
    await SQLite.deleteDatabaseAsync(DB_NAME);
    return createDb(expoDriver(await openWithKey(key)));
  }
}
```

`apps/mobile/src/offline/native/media-files.ts`:

```ts
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import type { MediaTransport } from '../media-queue';

/** Captured media live here (not in the cache, which the OS may clear) until uploaded and 7 days old. */
export function mediaDirectory(): Directory {
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export const nativeMediaFiles: MediaTransport = {
  exists: (uri) => new File(uri).exists,
  remove: (uri) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async upload(uri, url, headers) {
    // The presigned PUT signs Content-Type and Content-Length: send exactly the ticket's headers (Part 1 Task 10).
    const result = await new File(uri).upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers });
    return result.status;
  },
};
```

`apps/mobile/src/offline/native/ports.ts`:

```ts
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import type { AppStatePort, NetworkPort } from '../sync-triggers';

export function expoNetwork(): NetworkPort {
  let online = true;
  const listeners = new Set<(online: boolean) => void>();
  let subscription: { remove(): void } | null = null;
  const update = (s: Network.NetworkState) => {
    const next = s.isConnected === true && s.isInternetReachable !== false;
    if (next === online) return;
    online = next;
    listeners.forEach((l) => l(online));
  };
  void Network.getNetworkStateAsync().then(update);
  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      subscription ??= Network.addNetworkStateListener(update);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          subscription?.remove();
          subscription = null;
        }
      };
    },
  };
}

export function rnAppState(): AppStatePort {
  return {
    subscribe(listener) {
      const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
      return () => subscription.remove();
    },
  };
}
```

`apps/mobile/src/offline/native/device.ts`:

```ts
import type { DeviceInfo } from '@taskop/contracts';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function deviceInfo(): DeviceInfo {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    osVersion: String(Platform.Version).slice(0, 50),
    appVersion: (Constants.expoConfig?.version ?? '0.0.0').slice(0, 50),
  };
}
```

`apps/mobile/src/offline/native/create-native-services.ts`:

```ts
import { getRandomBytes } from 'expo-crypto';
import { api } from '@/lib/session';
import { systemClock } from '../clock';
import { uuidv7 } from '../ids';
import { createOfflineServices, type OfflineServices } from '../services';
import type { ClaimRejection } from '../sync-engine';
import { deviceInfo } from './device';
import { nativeMediaFiles } from './media-files';
import { openEncryptedDatabase } from './open-database';
import { expoNetwork, rnAppState } from './ports';

/** The previous user's connection must be closed before the next one opens the same file. */
let closing: Promise<void> = Promise.resolve();

export async function createNativeServices(
  userId: string,
  timeZone: string,
  hooks: { onClaimRejected: (r: ClaimRejection) => void },
): Promise<OfflineServices> {
  await closing;
  const db = await openEncryptedDatabase();
  const network = expoNetwork();
  let services: OfflineServices;
  try {
    services = await createOfflineServices(
      {
        db,
        api,
        clock: systemClock,
        newId: () => uuidv7(Date.now(), getRandomBytes),
        device: deviceInfo(),
        transport: nativeMediaFiles,
        isOnline: () => network.isOnline(),
        triggers: { network, appState: rnAppState() },
        onClaimRejected: hooks.onClaimRejected,
      },
      userId,
      timeZone,
    );
  } catch (e) {
    await db.close();
    throw e;
  }
  return {
    ...services,
    async dispose() {
      await services.dispose();
      closing = db.close();
      await closing;
    },
  };
}
```

`apps/mobile/src/offline/offline-provider.tsx`:

```tsx
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { claimRejectionText } from '@/features/sync/claim-rejection';
import i18n from '@/lib/i18n';
import { colors, spacing } from '@/lib/theme';
import { OfflineServicesProvider } from './context';
import { createNativeServices } from './native/create-native-services';
import type { OfflineServices } from './services';

/** Opens the encrypted store for the signed-in user and starts syncing; everything under (app) uses it. */
export function OfflineProvider({ userId, timeZone, children }: { userId: string; timeZone: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [services, setServices] = useState<OfflineServices | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let created: OfflineServices | null = null;
    setServices(null);
    setFailed(false);
    createNativeServices(userId, timeZone, {
      onClaimRejected: (r) => Alert.alert(claimRejectionText(i18n.getFixedT(null), r.reason, r.byName)),
    })
      .then((s) => {
        created = s;
        if (alive) setServices(s);
        else void s.dispose();
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      void created?.dispose();
    };
  }, [userId, timeZone]);

  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>{t('mobile.offline.failed')}</Text>
      </View>
    );
  }
  if (!services) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.text}>{t('mobile.offline.preparing')}</Text>
      </View>
    );
  }
  return <OfflineServicesProvider services={services}>{children}</OfflineServicesProvider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  text: { color: colors.muted, textAlign: 'center' },
});
```

Replace `apps/mobile/app/(app)/_layout.tsx` with:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { OfflineProvider } from '@/offline/offline-provider';

export default function AppLayout() {
  const { t } = useTranslation();
  const s = useSession();
  if (s.status !== 'authenticated') return null;
  return (
    <OfflineProvider userId={s.me.user.id} timeZone={s.me.tenant.timezone}>
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary }}>
        <Tabs.Screen name="index" options={{ title: t('mobile.tabs.home'), tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="profile" options={{ title: t('mobile.tabs.profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }} />
        <Tabs.Screen name="change-secret" options={{ href: null }} />
      </Tabs>
    </OfflineProvider>
  );
}
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS: triggers 3, services 4, claim-rejection 1, and every earlier suite. The typecheck covers the native adapters against the installed SDK 57 type definitions. If a signature differs from what Task 1 Step 3 recorded, fix only the adapter.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/offline/sync-triggers.ts apps/mobile/src/offline/sync-triggers.test.ts apps/mobile/src/offline/services.ts apps/mobile/src/offline/services.test.ts apps/mobile/src/offline/context.tsx apps/mobile/src/offline/hooks.ts apps/mobile/src/offline/offline-provider.tsx apps/mobile/src/offline/native apps/mobile/src/offline/testing/test-services.ts apps/mobile/src/offline/testing/render.tsx apps/mobile/src/features/sync/claim-rejection.ts apps/mobile/src/features/sync/claim-rejection.test.ts "apps/mobile/app/(app)/_layout.tsx"
git commit -m "feat(mobile): wire sync triggers, the encrypted store and the offline provider for the signed-in user" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Media capture: camera, gallery, resize and video checks

**Files:**
- Create: `apps/mobile/src/features/execution/media-capture.ts`, `apps/mobile/src/features/execution/capture.tsx`
- Test: `apps/mobile/src/features/execution/media-capture.test.ts`

**Interfaces:**
- Consumes:
  - `MEDIA_LIMITS` and the `MediaKind`/`MediaSource` types from `@taskop/contracts`
  - `CapturedMedia` (Task 6), `mediaDirectory` (Task 9), `uuidv7` (Task 4)
  - Expo modules: `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-video`, `expo-crypto`
- Produces:
  - Pure helpers (`media-capture.ts`):
    - `photoResize(width, height): { width } | { height } | null`
    - `videoMimeFor(uri, reported?): 'video/mp4' | 'video/quicktime'`
    - `type CaptureProblem = 'tooLong' | 'tooLarge' | 'resolution'`, `videoProblem({ durationMs, bytes, width, height }): CaptureProblem | null`
    - `CaptureError` (`.problem`), `fileExtension(mime)`
  - Native (`capture.tsx`, mocked in screen tests):
    - `preparePhoto({ uri, width, height }, source): Promise<CapturedMedia>`: resize to 1600 px long edge, JPEG 0.7, ≤ 5 MB, moved into `documents/media/`
    - `pickFromGallery(kind): Promise<CapturedMedia | null>`
    - `<CaptureModal kind onCaptured onClose />`: camera only, `videoQuality="720p"`, `recordAsync({ maxDuration: 60, maxFileSize: 60 MB })`
    - `<VideoPreview uri onClose />` (expo-video)
    - `persistCapture(media): CapturedMedia`

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/execution/media-capture.test.ts`:

```ts
import { CaptureError, fileExtension, photoResize, videoMimeFor, videoProblem } from './media-capture';

describe('media capture rules', () => {
  it.each([
    [4000, 3000, { width: 1600 }],
    [3000, 4000, { height: 1600 }],
    [1600, 1200, null],
    [1200, 900, null],
  ])('resizes a %ix%i photo to %j', (w, h, expected) => {
    expect(photoResize(w, h)).toEqual(expected);
  });

  it('picks the video MIME type from the picker, else from the file name', () => {
    expect(videoMimeFor('file:///x/clip.MOV')).toBe('video/quicktime');
    expect(videoMimeFor('file:///x/clip.mp4')).toBe('video/mp4');
    expect(videoMimeFor('file:///x/clip', 'video/quicktime')).toBe('video/quicktime');
    expect(videoMimeFor('file:///x/clip.mov', 'video/x-unknown')).toBe('video/quicktime');
  });

  it.each([
    [{ durationMs: 60_000, bytes: 62_914_560, width: 1280, height: 720 }, null],
    [{ durationMs: 60_001, bytes: 1000, width: null, height: null }, 'tooLong'],
    [{ durationMs: null, bytes: 62_914_561, width: null, height: null }, 'tooLarge'],
    [{ durationMs: 10_000, bytes: 1000, width: 1920, height: 1080 }, 'resolution'],
  ])('checks a video %j', (video, expected) => {
    expect(videoProblem(video)).toBe(expected);
  });

  it('maps MIME types to storage extensions', () => {
    expect(fileExtension('image/jpeg')).toBe('jpg');
    expect(fileExtension('video/quicktime')).toBe('mov');
    expect(new CaptureError('tooLong').problem).toBe('tooLong');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution/media-capture.test.ts`
Expected: FAIL: `Cannot find module './media-capture'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/features/execution/media-capture.ts`:

```ts
import { MEDIA_LIMITS } from '@taskop/contracts';

/** Spec §1: photos are resized on the phone to a 1600 px long edge. Null when already small enough. */
export function photoResize(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= MEDIA_LIMITS.photoLongEdge) return null;
  return width >= height ? { width: MEDIA_LIMITS.photoLongEdge } : { height: MEDIA_LIMITS.photoLongEdge };
}

export type VideoMime = 'video/mp4' | 'video/quicktime';

/** iOS records .mov (QuickTime), Android .mp4; the API accepts exactly these two (MEDIA_LIMITS.mimeTypes.video). */
export function videoMimeFor(uri: string, reported?: string | null): VideoMime {
  if (reported === 'video/mp4' || reported === 'video/quicktime') return reported;
  return /\.mov$/i.test(uri) ? 'video/quicktime' : 'video/mp4';
}

export type CaptureProblem = 'tooLong' | 'tooLarge' | 'resolution';

/** The server's video limits, checked before anything is queued (decision 9). Unknown values are not judged. */
export function videoProblem(v: { durationMs: number | null; bytes: number; width: number | null; height: number | null }): CaptureProblem | null {
  if (v.durationMs !== null && v.durationMs > MEDIA_LIMITS.videoMaxSeconds * 1000) return 'tooLong';
  if (v.bytes > MEDIA_LIMITS.videoMaxBytes) return 'tooLarge';
  if (v.width && v.height && Math.min(v.width, v.height) > MEDIA_LIMITS.videoMaxShortEdge) return 'resolution';
  return null;
}

export class CaptureError extends Error {
  constructor(readonly problem: CaptureProblem) {
    super(`Media refused: ${problem}`);
    this.name = 'CaptureError';
  }
}

export const fileExtension = (mime: string): string => (MEDIA_LIMITS.extensions as Record<string, string>)[mime] ?? 'bin';
```

`apps/mobile/src/features/execution/capture.tsx`:

```tsx
import { MEDIA_LIMITS, type MediaKind, type MediaSource } from '@taskop/contracts';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { getRandomBytes } from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import type { CapturedMedia } from '@/offline/execution-store';
import { uuidv7 } from '@/offline/ids';
import { mediaDirectory } from '@/offline/native/media-files';
import { CaptureError, fileExtension, photoResize, videoMimeFor, videoProblem } from './media-capture';

/** Moves a captured file out of the cache (which the OS may clear) into documents/media/<uuidv7>.<ext>. */
export function persistCapture(m: CapturedMedia): CapturedMedia {
  const source = new File(m.localUri);
  const target = new File(mediaDirectory(), `${uuidv7(Date.now(), getRandomBytes)}.${fileExtension(m.mime)}`);
  source.moveSync(target);
  return { ...m, localUri: target.uri, bytes: target.size };
}

/** Spec §1: 1600 px long edge, JPEG quality 0.7, ≤ 5 MB. Gallery PNGs are re-encoded too (decision 9). */
export async function preparePhoto(input: { uri: string; width: number; height: number }, source: MediaSource): Promise<CapturedMedia> {
  let { width, height } = input;
  if (!width || !height) {
    const probe = await ImageManipulator.manipulate(input.uri).renderAsync();
    width = probe.width;
    height = probe.height;
  }
  const context = ImageManipulator.manipulate(input.uri);
  const resize = photoResize(width, height);
  if (resize) context.resize(resize);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: MEDIA_LIMITS.jpegQuality });
  const bytes = new File(saved.uri).size;
  if (bytes > MEDIA_LIMITS.photoMaxBytes) throw new CaptureError('tooLarge');
  return persistCapture({
    kind: 'photo', source, mime: 'image/jpeg', bytes, width: saved.width, height: saved.height, durationMs: null,
    localUri: saved.uri, capturedAt: new Date().toISOString(),
  });
}

function prepareRecordedVideo(uri: string): CapturedMedia {
  const bytes = new File(uri).size;
  const problem = videoProblem({ durationMs: null, bytes, width: null, height: null });
  if (problem) throw new CaptureError(problem);
  return persistCapture({
    kind: 'video', source: 'camera', mime: videoMimeFor(uri), bytes, width: null, height: null, durationMs: null,
    localUri: uri, capturedAt: new Date().toISOString(),
  });
}

/** Never offered on live-only items: the screen shows only the camera chip there (FR-12.05–06). */
export async function pickFromGallery(kind: MediaKind): Promise<CapturedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'photo' ? ['images'] : ['videos'],
    quality: 1,
    videoMaxDuration: MEDIA_LIMITS.videoMaxSeconds,
    allowsMultipleSelection: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  if (kind === 'photo') return preparePhoto({ uri: asset.uri, width: asset.width, height: asset.height }, 'gallery');
  const video = {
    durationMs: asset.duration ? Math.round(asset.duration) : null,
    bytes: asset.fileSize ?? new File(asset.uri).size,
    width: asset.width || null,
    height: asset.height || null,
  };
  const problem = videoProblem(video);
  if (problem) throw new CaptureError(problem);
  return persistCapture({
    kind: 'video', source: 'gallery', mime: videoMimeFor(asset.uri, asset.mimeType), ...video,
    localUri: asset.uri, capturedAt: new Date().toISOString(),
  });
}

interface CaptureProps {
  kind: MediaKind;
  onCaptured: (media: CapturedMedia) => void;
  onClose: () => void;
}

/** Full-screen camera. Video: 720p, stops by itself at 60 s (spec §1). */
export function CaptureModal({ kind, onCaptured, onClose }: CaptureProps) {
  const { t } = useTranslation();
  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsMic = kind === 'video';
  const granted = Boolean(cameraPermission?.granted && (!needsMic || micPermission?.granted));

  const fail = (e: unknown) => Alert.alert(e instanceof CaptureError ? t(`mobile.evidence.${e.problem}`) : t('mobile.evidence.failed'));

  async function takePhoto() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 1 });
      if (shot) onCaptured(await preparePhoto(shot, 'camera'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (!camera.current) return;
    if (recording) {
      camera.current.stopRecording();
      return;
    }
    setRecording(true);
    try {
      const clip = await camera.current.recordAsync({ maxDuration: MEDIA_LIMITS.videoMaxSeconds, maxFileSize: MEDIA_LIMITS.videoMaxBytes });
      if (clip) onCaptured(prepareRecordedVideo(clip.uri));
    } catch (e) {
      fail(e);
    } finally {
      setRecording(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {granted ? (
        <View style={styles.fill}>
          <CameraView ref={camera} style={styles.fill} facing="back" mode={kind === 'video' ? 'video' : 'picture'} videoQuality="720p" />
          <SafeAreaView style={styles.bar} edges={['bottom']}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} disabled={recording || busy} />
            <PrimaryButton
              title={kind === 'photo' ? t('mobile.evidence.take') : recording ? t('mobile.evidence.stop') : t('mobile.evidence.record')}
              onPress={() => void (kind === 'photo' ? takePhoto() : toggleRecording())}
              disabled={busy}
            />
          </SafeAreaView>
        </View>
      ) : (
        <SafeAreaView style={styles.center}>
          <Text style={styles.text}>{t('mobile.evidence.cameraPermission')}</Text>
          <PrimaryButton
            title={t('mobile.evidence.grant')}
            onPress={() =>
              void (async () => {
                await requestCamera();
                if (needsMic) await requestMic();
              })()
            }
          />
          <PrimaryButton variant="outline" title={t('common.cancel')} onPress={onClose} />
        </SafeAreaView>
      )}
    </Modal>
  );
}

export function VideoPreview({ uri, onClose }: { uri: string; onClose: () => void }) {
  const { t } = useTranslation();
  const player = useVideoPlayer(uri, (p) => p.play());
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.fill}>
        <VideoView player={player} nativeControls contentFit="contain" style={styles.fill} />
        <View style={styles.bar}>
          <PrimaryButton title={t('common.close')} onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  text: { color: colors.text, textAlign: 'center', fontSize: 16 },
});
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution/media-capture.test.ts && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (4 resize cases, 4 video cases, 2 tests). The typecheck checks `capture.tsx` against the SDK 57 definitions of `CameraView`, `ImageManipulator.manipulate`, `File.moveSync` and `launchImageLibraryAsync`. If a name differs, follow the installed `.d.ts` and keep the behaviour: 1600 px, JPEG 0.7, 720p, 60 s, camera-only on live-only items.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/execution/media-capture.ts apps/mobile/src/features/execution/media-capture.test.ts apps/mobile/src/features/execution/capture.tsx
git commit -m "feat(mobile): capture photos and 720p videos within the media limits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Sync status indicator and the sync queue screen

**Files:**
- Create: `apps/mobile/src/features/sync/sync-indicator.tsx`, `apps/mobile/src/features/sync/sync-screen.tsx`, `apps/mobile/app/(app)/sync.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/features/sync/sync.test.tsx`

**Interfaces:**
- Consumes:
  - `useSyncStatus`, `useLiveQuery`, `useOffline` (Task 9); `indicatorOf` (Task 8)
  - `listCommands` (Task 5); `mediaErrorKey` (Task 7); `isClockSkewed` (Task 4)
  - `formatDateTime` from `@taskop/i18n`
- Produces:
  - `<SyncIndicator />`: a pill with `testID="sync-indicator-<synced|pending|offline|failed>"` that pushes `/sync`
  - `<SyncScreen />`:
    - one row per outbox command (`mobile.sync.kinds.*` · checklist name) and per waiting file, with the reason for a failure
    - the clock-skew warning and the "Yenidən cəhd et" button (FR-10.15)
  - Route `/sync` (a hidden tab)

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/sync/sync.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { SyncIndicator } from './sync-indicator';
import { SyncScreen } from './sync-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

beforeEach(() => mockPush.mockClear());

describe('sync indicator', () => {
  it('is green when everything is synced and opens the queue', async () => {
    const t = await createTestServices({ online: true });
    await t.seed();
    await renderWithServices(t.services, <SyncIndicator />);
    expect(screen.getByTestId('sync-indicator-synced')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sinxronlaşdırılıb' }));
    expect(mockPush).toHaveBeenCalledWith('/sync');
  });

  it('is amber "Oflayn" with nothing waiting, then amber with the number of waiting changes', async () => {
    const t = await createTestServices();
    await t.seed();
    await renderWithServices(t.services, <SyncIndicator />);
    expect(await screen.findByText('Oflayn')).toBeTruthy();
    await act(async () => {
      const id = await t.services.store.start(OCC, ME);
      await t.services.store.patchAnswer(id, t.c.temp.id, { number: 5 });
    });
    expect(await screen.findByText('2 gözləyir')).toBeTruthy();
    expect(screen.getByTestId('sync-indicator-pending')).toBeTruthy();
  });

  it('is red when a command was refused', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    await t.db.run(`UPDATE outbox SET status = 'failed', error_code = 'CLOCK_INVALID', error_key = 'errors.CLOCK_INVALID'`);
    await t.services.engine.refresh();
    await renderWithServices(t.services, <SyncIndicator />);
    expect(screen.getByText('1 xəta')).toBeTruthy();
    expect(screen.getByTestId('sync-indicator-failed')).toBeTruthy();
  });
});

describe('sync screen', () => {
  it('lists waiting and failed work with the reason, warns about the clock, and retries', async () => {
    const t = await createTestServices();
    await t.seed();
    const id = await t.services.store.start(OCC, ME);
    await t.services.store.patchAnswer(id, t.c.temp.id, { number: 5 });
    await t.db.run(`UPDATE outbox SET status = 'failed', error_code = 'CLOCK_INVALID', error_key = 'errors.CLOCK_INVALID' WHERE kind = 'claim'`);
    await t.db.run(`UPDATE meta SET value = '-420000' WHERE key = 'clockOffsetMs'`);
    await t.services.engine.refresh();
    await renderWithServices(t.services, <SyncScreen />);
    expect(await screen.findByText('Başlama · Açılış yoxlaması')).toBeTruthy();
    expect(screen.getByText('Telefonun saatını yoxlayın.')).toBeTruthy();
    expect(screen.getByText('Cavablar · Açılış yoxlaması')).toBeTruthy();
    expect(screen.getByText('Gözləyir')).toBeTruthy();
    expect(screen.getByText('Telefonun saatı serverdən 7 dəqiqə fərqlənir. Telefonun saatını yoxlayın.')).toBeTruthy();
    t.net.online = true;
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    await eventually(async () => expect(t.api.calls.map((c) => c.method)).toEqual(['claim', 'saveAnswers', 'pull']));
    expect(await screen.findByText('Göndəriləcək heç nə yoxdur.')).toBeTruthy();
  });
});
```

The `meta` row `clockOffsetMs` exists because `seed()` runs `applyPull`, which writes it.

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/sync/sync.test.tsx`
Expected: FAIL: `Cannot find module './sync-indicator'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/features/sync/sync-indicator.tsx`:

```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import { useSyncStatus } from '@/offline/hooks';
import { type Indicator, indicatorOf } from '@/offline/sync-engine';

const TONE: Record<Indicator, string> = { synced: colors.success, pending: colors.warning, offline: colors.warning, failed: colors.danger };

/** Spec §7.3: green (all synced), amber "N gözləyir" (offline or pending), red (failed). Opens the queue. */
export function SyncIndicator() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const state = indicatorOf(status);
  const label =
    state === 'synced'
      ? t('mobile.sync.synced')
      : state === 'pending'
        ? t('mobile.sync.pending', { count: status.pending })
        : state === 'offline'
          ? t('mobile.sync.offline')
          : t('mobile.sync.failed', { count: status.failed });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`sync-indicator-${state}`}
      onPress={() => router.push('/sync')}
      style={[styles.pill, { borderColor: TONE[state] }]}
    >
      <View style={[styles.dot, { backgroundColor: TONE[state] }]} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: 22, backgroundColor: colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { color: colors.text, fontSize: 13, fontWeight: '500' },
});
```

`apps/mobile/src/features/sync/sync-screen.tsx`:

```tsx
import { formatDateTime } from '@taskop/i18n';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { colors, spacing } from '@/lib/theme';
import { isClockSkewed } from '@/offline/clock';
import { useOffline } from '@/offline/context';
import { useLiveQuery, useSyncStatus } from '@/offline/hooks';
import { mediaErrorKey } from '@/offline/media-queue';
import { listCommands } from '@/offline/outbox';

interface Row {
  key: string;
  title: string;
  error: string | null;
}

/** FR-10.15: what is waiting, what failed and why, and "Yenidən cəhd et". */
export function SyncScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const queue = useLiveQuery(async (s) => ({ commands: await listCommands(s.db), media: await s.mediaQueue.list() }), []);
  const name = (n: string | null) => n ?? '—';
  const rows: Row[] = [
    ...(queue?.commands ?? []).map((c) => ({
      key: `c${c.seq}`,
      title: `${t(`mobile.sync.kinds.${c.kind}`)} · ${name(c.checklistName)}`,
      error: c.status === 'failed' ? t(c.errorKey ?? 'errors.INTERNAL', { requestId: '—' }) : null,
    })),
    ...(queue?.media ?? []).map((m) => ({
      key: `m${m.id}`,
      title: `${t('mobile.sync.kinds.upload')} · ${name(m.checklistName)}`,
      error: m.failedCode ? t(mediaErrorKey(m.failedCode)) : null,
    })),
  ];

  const retry = async () => {
    setBusy(true);
    try {
      await services.engine.retryFailed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{t('mobile.sync.title')}</Text>
      </View>
      <Text style={styles.muted}>
        {status.lastSyncedAt
          ? t('mobile.sync.lastSynced', { time: formatDateTime(status.lastSyncedAt, { locale: 'az', timeZone: services.timeZone }) })
          : t('mobile.sync.never')}
      </Text>
      {isClockSkewed(status.clockOffsetMs) ? (
        <Text style={styles.warning}>{t('mobile.sync.clockSkew', { minutes: Math.round(Math.abs(status.clockOffsetMs) / 60_000) })}</Text>
      ) : null}
      {status.blockedByAuth ? <Text style={styles.warning}>{t('mobile.sync.signInAgain')}</Text> : null}
      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('mobile.sync.empty')}</Text>
      ) : (
        rows.map((row) => (
          <View key={row.key} style={[styles.row, row.error ? styles.rowFailed : null]}>
            <Text style={styles.rowTitle}>{row.title}</Text>
            {row.error ? <Text style={styles.error}>{row.error}</Text> : <Text style={styles.muted}>{t('mobile.sync.states.pending')}</Text>}
          </View>
        ))
      )}
      <PrimaryButton title={t('mobile.sync.retry')} onPress={() => void retry()} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  warning: { color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  row: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  rowFailed: { borderColor: colors.danger },
  rowTitle: { color: colors.text, fontWeight: '500' },
  error: { color: colors.danger },
});
```

`apps/mobile/app/(app)/sync.tsx`:

```tsx
import { SyncScreen } from '@/features/sync/sync-screen';

export default SyncScreen;
```

In `apps/mobile/app/(app)/_layout.tsx`, add above `export default function AppLayout`:

```tsx
/** Screens reached from inside the app, not from the tab bar. */
const HIDDEN = { href: null, tabBarStyle: { display: 'none' } } as const;
```

and add this after the `change-secret` screen:

```tsx
        <Tabs.Screen name="sync" options={HIDDEN} />
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/sync && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (sync 4, claim-rejection 1).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/sync/sync-indicator.tsx apps/mobile/src/features/sync/sync-screen.tsx apps/mobile/src/features/sync/sync.test.tsx "apps/mobile/app/(app)/sync.tsx" "apps/mobile/app/(app)/_layout.tsx"
git commit -m "feat(mobile): show sync status in the header and list the outbox with retry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: My checklists (home): sections, claim badges and real tile counts

**Files:**
- Create: `apps/mobile/src/lib/time.ts`, `apps/mobile/src/features/checklists/group-occurrences.ts`, `apps/mobile/src/features/checklists/occurrence-card.tsx`
- Modify:
  - `apps/mobile/src/features/home/home-screen.tsx` (rewritten)
  - `apps/mobile/src/components/primary-button.tsx` (adds `accessibilityLabel`)
  - `packages/i18n/src/az/mobile.ts` (drops the unused `home.recent`)
- Test: `apps/mobile/src/lib/time.test.ts`, `apps/mobile/src/features/checklists/group-occurrences.test.ts`, `apps/mobile/src/features/home/home-screen.test.tsx`

**Interfaces:**
- Consumes:
  - `OccurrenceView`, `StartRefusedError` (Task 6); `useOffline`, `useLiveQuery`, `useNow` (Task 9); `SyncIndicator` (Task 11)
  - `intlLocale` from `@taskop/i18n`
- Produces:
  - `formatTime(iso, timeZone): string` (`HH:MM`), `localDate(ms, timeZone): string` (`YYYY-MM-DD`)
  - Grouping:
    - `GROUP_KEYS = ['now', 'inProgress', 'upcoming', 'done']`, `type GroupKey`, `type CardAction = 'start' | 'continue' | 'view' | 'none'`
    - `interface CardModel { occurrence; overdue; late; claimedBy: string | null; action }`, `type Groups`
    - `groupOccurrences(list, userId, now, today): Groups`
  - Tiles: `interface HomeStats { myTasks; overdue; completed; issues }`, `homeStats(groups, problemsToday): HomeStats`
  - `<OccurrenceCard card group timeZone onStart onOpen />`, with `testID="occurrence-<id>"`
  - `PrimaryButton` gains an optional `accessibilityLabel`

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/lib/time.test.ts`:

```ts
import { formatTime, localDate } from './time';

describe('tenant-time formatting', () => {
  it('shows times and dates in the tenant time zone', () => {
    expect(formatTime('2026-11-02T04:00:00.000Z', 'Asia/Baku')).toBe('08:00');
    expect(formatTime('2026-11-02T19:05:00.000Z', 'Asia/Baku')).toBe('23:05');
    expect(localDate(Date.parse('2026-11-02T20:30:00.000Z'), 'Asia/Baku')).toBe('2026-11-03');
  });
});
```

`apps/mobile/src/features/checklists/group-occurrences.test.ts`:

```ts
import type { OccurrenceView } from '@/offline/execution-store';
import type { LocalExecution } from '@/offline/local-model';
import { ME, OCC, OTHER, OTHER_EXECUTION, T, VERSION } from '@/offline/testing/fixtures';
import { groupOccurrences, homeStats } from './group-occurrences';

const view = (over: Partial<OccurrenceView> = {}): OccurrenceView => ({
  id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
  startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'pending', checklistVersionId: VERSION, claim: null, execution: null, ...over,
});
const execution = (over: Partial<LocalExecution> = {}): LocalExecution => ({
  id: 'e', occurrenceId: OCC, checklistVersionId: VERSION, state: 'active', claim: 'accepted', rejectedReason: null, rejectedBy: null,
  startedAt: T.open, completedAt: null, lockedAt: null, answers: {}, rev: 0, syncedRev: 0, finishedSyncedAt: null, ...over,
});
const at = (iso: string) => Date.parse(iso);
const place = (o: OccurrenceView, now: string) => {
  const g = groupOccurrences([o], ME, at(now), '2026-11-02');
  const key = (Object.keys(g) as (keyof typeof g)[]).find((k) => g[k].length > 0) ?? null;
  return key ? { key, card: g[key][0]! } : null;
};

describe('groupOccurrences', () => {
  it.each<[string, OccurrenceView, string, string | null, object]>([
    ['open: startable', view(), T.open, 'now', { action: 'start', overdue: false }],
    ['open past due: overdue', view(), '2026-11-02T06:30:00.000Z', 'now', { overdue: true }],
    ['claimed by someone else: badge, no start', view({ status: 'started', claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad' } }), T.open, 'now', { action: 'none', claimedBy: 'Murad' }],
    ['my open execution: in progress', view({ execution: execution() }), T.open, 'inProgress', { action: 'continue' }],
    ['not open yet: upcoming, read-only', view({ startsAt: '2026-11-02T14:00:00.000Z' }), T.open, 'upcoming', { action: 'none' }],
    ['completed late today: done with late', view({ status: 'completed', execution: execution({ state: 'completed', completedAt: '2026-11-02T06:10:00.000Z' }) }), '2026-11-02T08:00:00.000Z', 'done', { action: 'view', late: true }],
    ['my execution past closes_at: done', view({ execution: execution() }), T.closes, 'done', { action: 'view' }],
    ['missed today without an execution: done', view({ status: 'missed' }), '2026-11-02T08:00:00.000Z', 'done', { action: 'none' }],
    ['finished yesterday: not shown', view({ status: 'completed', localDate: '2026-11-01' }), T.open, null, {}],
  ])('%s', (_name, o, now, key, card) => {
    const placed = place(o, now);
    expect(placed?.key ?? null).toBe(key);
    if (placed) expect(placed.card).toMatchObject(card);
  });

  it('counts my open and in-progress work, overdue ones, today\'s completions and problems', () => {
    const list = [
      view({ id: 'a' }),
      view({ id: 'b', execution: execution({ id: 'eb', occurrenceId: 'b' }) }),
      view({ id: 'c', claim: { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad' } }),
      view({ id: 'd', status: 'completed' }),
    ];
    const g = groupOccurrences(list, ME, at('2026-11-02T06:30:00.000Z'), '2026-11-02');
    expect(homeStats(g, 3)).toEqual({ myTasks: 2, overdue: 2, completed: 1, issues: 3 });
  });
});
```

`apps/mobile/src/features/home/home-screen.test.tsx`:

```tsx
import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { ME, OCC, OCC2, OCC3, OCC4, OCC5, occurrence, OTHER, OTHER_EXECUTION, syncResponse, VERSION2, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { HomeScreen } from './home-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { user: { fullName: 'Aysel Əliyeva' } } }),
}));

beforeEach(() => mockPush.mockClear());

/** OCC open, OCC2 claimed by Murad, OCC3 later today, OCC4 completed, OCC5 open (optionally on a too-new version). */
async function world(extra: { version?: string } = {}): Promise<TestServices> {
  const t = await createTestServices();
  const claim = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
  await t.seed(
    syncResponse({
      occurrences: [
        occurrence(),
        occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması', status: 'started', claim }),
        occurrence({ id: OCC3, checklistName: 'Bağlanış yoxlaması', startsAt: '2026-11-02T14:00:00.000Z', dueAt: '2026-11-02T16:00:00.000Z', closesAt: '2026-11-02T17:00:00.000Z' }),
        occurrence({ id: OCC4, checklistName: 'Anbar yoxlaması', status: 'completed' }),
        occurrence({ id: OCC5, checklistName: 'Mətbəx yoxlaması', ...(extra.version ? { checklistVersionId: extra.version } : {}) }),
      ],
      checklistVersions: [versionOf(t.c.content), versionOf({ schemaVersion: 2 }, VERSION2, 2)],
    }),
  );
  return t;
}

describe('My checklists', () => {
  it('groups my checklists, marks overdue and claimed ones, and counts the tiles', async () => {
    const t = await world();
    const id = await t.services.store.start(OCC, ME);
    await t.services.store.patchAnswer(id, t.c.temp.id, { number: 10 }); // a rule problem
    t.clock.set('2026-11-02T06:30:00.000Z'); // 10:30 in Baku: past due, before close
    await renderWithServices(t.services, <HomeScreen />);
    for (const title of ['İndi', 'Davam edən', 'Gələcək', 'Bitmiş']) expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText('Murad Həsənov icra edir')).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC5}`)).getByText('Gecikir')).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC}`)).getByRole('button', { name: 'Davam et: Açılış yoxlaması' })).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC3}`)).getByText('18:00-da açılır')).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC3}`)).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId(`occurrence-${OCC2}`)).queryByRole('button')).toBeNull();
    expect(within(await screen.findByTestId('stat-myTasks')).getByText('2')).toBeTruthy();
    expect(within(screen.getByTestId('stat-overdue')).getByText('2')).toBeTruthy();
    expect(within(screen.getByTestId('stat-completed')).getByText('1')).toBeTruthy();
    expect(await within(screen.getByTestId('stat-issues')).findByText('1')).toBeTruthy();
  });

  it('starts an open checklist and opens its execution', async () => {
    const t = await world();
    await renderWithServices(t.services, <HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Başla: Mətbəx yoxlaması' }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: expect.any(String) } }));
    const views = await t.services.store.occurrences();
    expect(views.find((o) => o.id === OCC5)!.execution).toMatchObject({ state: 'active', claim: 'pending' });
  });

  it('explains why a start is refused', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const t = await world({ version: VERSION2 });
    await renderWithServices(t.services, <HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Başla: Mətbəx yoxlaması' }));
    await eventually(async () => expect(alert).toHaveBeenCalledWith('Tətbiqi yeniləyin'));
    expect(mockPush).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/lib/time.test.ts src/features/checklists src/features/home`
Expected: FAIL: the modules do not exist.

- [ ] **Step 3: Implement**

`apps/mobile/src/lib/time.ts`:

```ts
import { intlLocale } from '@taskop/i18n';

/** HH:MM in the tenant's time zone (24 h). */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(intlLocale('az'), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
}

/** The tenant-local calendar date of an instant, as YYYY-MM-DD (the form of `localDate` on occurrences). */
export function localDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
```

`apps/mobile/src/features/checklists/group-occurrences.ts`:

```ts
import type { OccurrenceView } from '@/offline/execution-store';

export const GROUP_KEYS = ['now', 'inProgress', 'upcoming', 'done'] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export type CardAction = 'start' | 'continue' | 'view' | 'none';

export interface CardModel {
  occurrence: OccurrenceView;
  /** Past due and not finished: shown in red (FR-10.02). */
  overdue: boolean;
  /** Finished at or after due_at. */
  late: boolean;
  /** "Murad icra edir" when someone else holds the claim. */
  claimedBy: string | null;
  action: CardAction;
}

export type Groups = Record<GroupKey, CardModel[]>;

const CLOSED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'missed', 'cancelled', 'audit_pending', 'audited']);

/** Spec §7.3: İndi (open; overdue in red), Davam edən (my open execution), Gələcək (not open yet), Bitmiş (finished today). */
export function groupOccurrences(list: OccurrenceView[], userId: string, now: number, today: string): Groups {
  const groups: Groups = { now: [], inProgress: [], upcoming: [], done: [] };
  for (const o of list) {
    const e = o.execution;
    const due = Date.parse(o.dueAt);
    const closes = Date.parse(o.closesAt);
    const claimedBy = o.claim && o.claim.executorUserId !== userId ? o.claim.executorName : null;
    if (e?.state === 'active' && now < closes) {
      groups.inProgress.push({ occurrence: o, overdue: now >= due, late: false, claimedBy: null, action: 'continue' });
    } else if (e || CLOSED_STATUSES.has(o.status) || now >= closes) {
      if (o.localDate !== today) continue;
      const late = e?.completedAt ? Date.parse(e.completedAt) >= due : false;
      groups.done.push({ occurrence: o, overdue: false, late, claimedBy, action: e ? 'view' : 'none' });
    } else if (now < Date.parse(o.startsAt)) {
      groups.upcoming.push({ occurrence: o, overdue: false, late: false, claimedBy, action: 'none' });
    } else {
      groups.now.push({ occurrence: o, overdue: now >= due || o.status === 'overdue', late: false, claimedBy, action: claimedBy ? 'none' : 'start' });
    }
  }
  return groups;
}

export interface HomeStats {
  myTasks: number;
  overdue: number;
  completed: number;
  issues: number;
}

/** The home tiles, for today (decision 1). Occurrences someone else holds are not my tasks. */
export function homeStats(groups: Groups, problemsToday: number): HomeStats {
  const mine = [...groups.now.filter((c) => !c.claimedBy), ...groups.inProgress];
  return {
    myTasks: mine.length,
    overdue: mine.filter((c) => c.overdue).length,
    completed: groups.done.filter((c) => (c.occurrence.execution?.state ?? c.occurrence.status) === 'completed').length,
    issues: problemsToday,
  };
}
```

In `apps/mobile/src/components/primary-button.tsx`:
- Add `accessibilityLabel?: string;` to `Props`.
- Destructure it: `export function PrimaryButton({ title, onPress, disabled, variant = 'primary', accessibilityLabel }: Props)`.
- Pass `accessibilityLabel={accessibilityLabel ?? title}` to the `Pressable`.

`apps/mobile/src/features/checklists/occurrence-card.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { formatTime } from '@/lib/time';
import { colors, spacing } from '@/lib/theme';
import type { CardModel, GroupKey } from './group-occurrences';

type Tone = 'danger' | 'warning' | 'muted';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  danger: { bg: '#FEE2E2', fg: colors.danger },
  warning: { bg: '#FEF3C7', fg: '#92400E' },
  muted: { bg: '#EEF2FF', fg: colors.primary },
};

function Badge({ tone, text }: { tone: Tone; text: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: TONES[tone].bg }]}>
      <Text style={[styles.badgeText, { color: TONES[tone].fg }]}>{text}</Text>
    </View>
  );
}

interface Props {
  card: CardModel;
  group: GroupKey;
  timeZone: string;
  onStart: () => void;
  onOpen: () => void;
}

export function OccurrenceCard({ card, group, timeZone, onStart, onOpen }: Props) {
  const { t } = useTranslation();
  const o = card.occurrence;
  const e = o.execution;
  const status = e && e.state !== 'active' ? t(`executions.states.${e.state}`) : !e && o.status !== 'pending' ? t(`scheduling.statuses.${o.status}`) : null;
  return (
    <View testID={`occurrence-${o.id}`} style={[styles.card, card.overdue ? styles.overdue : null]}>
      <Text style={styles.title}>{o.checklistName}</Text>
      <Text style={styles.muted}>{o.shiftName ? `${o.siteName} · ${o.shiftName}` : o.siteName}</Text>
      <Text style={styles.muted}>{t('mobile.checklists.window', { from: formatTime(o.startsAt, timeZone), to: formatTime(o.closesAt, timeZone) })}</Text>
      <View style={styles.badges}>
        {card.overdue ? <Badge tone="danger" text={t('mobile.checklists.overdue')} /> : null}
        {card.late ? <Badge tone="warning" text={t('executions.flags.late')} /> : null}
        {card.claimedBy ? <Badge tone="muted" text={t('mobile.checklists.claimedBy', { name: card.claimedBy })} /> : null}
        {status && !card.claimedBy ? <Badge tone="muted" text={status} /> : null}
      </View>
      {group === 'upcoming' ? (
        <Text style={styles.muted}>{t('mobile.checklists.opensAt', { time: formatTime(o.startsAt, timeZone) })}</Text>
      ) : null}
      {card.action === 'start' ? (
        <PrimaryButton title={t('mobile.checklists.start')} accessibilityLabel={`${t('mobile.checklists.start')}: ${o.checklistName}`} onPress={onStart} />
      ) : null}
      {card.action === 'continue' ? (
        <PrimaryButton title={t('mobile.checklists.continue')} accessibilityLabel={`${t('mobile.checklists.continue')}: ${o.checklistName}`} onPress={onOpen} />
      ) : null}
      {card.action === 'view' ? (
        <PrimaryButton variant="outline" title={t('mobile.checklists.view')} accessibilityLabel={`${t('mobile.checklists.view')}: ${o.checklistName}`} onPress={onOpen} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  overdue: { borderColor: colors.danger, borderLeftWidth: 4 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  badge: { borderRadius: 8, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
```

Upcoming cards are read-only until the window opens (spec §7.3). They show when they open instead of a button.

Replace `apps/mobile/src/features/home/home-screen.tsx` with:

```tsx
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { GROUP_KEYS, groupOccurrences, homeStats, type HomeStats } from '@/features/checklists/group-occurrences';
import { OccurrenceCard } from '@/features/checklists/occurrence-card';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { useSession } from '@/lib/session';
import { localDate } from '@/lib/time';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { type OccurrenceView, StartRefusedError } from '@/offline/execution-store';
import { useLiveQuery, useNow } from '@/offline/hooks';

const STATS: { key: keyof HomeStats; color: string }[] = [
  { key: 'myTasks', color: colors.text },
  { key: 'overdue', color: colors.danger },
  { key: 'completed', color: colors.success },
  { key: 'issues', color: colors.danger },
];

/** "My checklists" (spec §7.3, FR-10.01–02). */
export function HomeScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const now = useNow();
  const list = useLiveQuery((x) => x.store.occurrences(), []);
  const groups = list ? groupOccurrences(list, services.userId, now, localDate(now, services.timeZone)) : null;
  const executionIds = groups ? [...groups.inProgress, ...groups.done].flatMap((c) => (c.occurrence.execution ? [c.occurrence.execution.id] : [])) : [];
  const problems = useLiveQuery((x) => x.store.problemCount(executionIds), [executionIds.join(',')]);
  if (s.status !== 'authenticated') return null;
  const stats = groups ? homeStats(groups, problems ?? 0) : null;
  const firstName = s.me.user.fullName.split(' ')[0];

  const start = async (o: OccurrenceView) => {
    try {
      const id = await services.store.start(o.id, services.userId);
      router.push({ pathname: '/execution/[id]', params: { id } });
    } catch (e) {
      Alert.alert(e instanceof StartRefusedError ? t(`mobile.checklists.startBlocked.${e.reason}`) : t('errors.INTERNAL', { requestId: '—' }));
    }
  };
  const open = (o: OccurrenceView) => {
    if (o.execution) router.push({ pathname: '/execution/[id]', params: { id: o.execution.id } });
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.greeting}>{t('mobile.home.greeting', { name: firstName })}</Text>
        <SyncIndicator />
      </View>
      {s.offline ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>{t('mobile.home.offline')}</Text>
        </View>
      ) : null}
      <Text style={styles.subtitle}>{t('mobile.home.subtitle')}</Text>
      <View style={styles.grid}>
        {STATS.map((stat) => (
          <View key={stat.key} testID={`stat-${stat.key}`} style={styles.tile}>
            <Text style={[styles.value, { color: stat.color }]}>{stats ? String(stats[stat.key]) : '—'}</Text>
            <Text style={styles.tileLabel}>{t(`mobile.home.${stat.key}`)}</Text>
          </View>
        ))}
      </View>
      {groups ? (
        GROUP_KEYS.map((key) => (
          <View key={key} style={styles.group}>
            <Text style={styles.section}>{t(`mobile.checklists.sections.${key}`)}</Text>
            {groups[key].length === 0 ? (
              <Text style={styles.subtitle}>{t('mobile.checklists.emptySection')}</Text>
            ) : (
              groups[key].map((card) => (
                <OccurrenceCard
                  key={card.occurrence.id}
                  card={card}
                  group={key}
                  timeZone={services.timeZone}
                  onStart={() => void start(card.occurrence)}
                  onOpen={() => open(card.occurrence)}
                />
              ))
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
  offline: { backgroundColor: '#FEF3C7', borderRadius: 10, padding: spacing.md },
  offlineText: { color: '#92400E' },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.text, flexShrink: 1 },
  subtitle: { color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  value: { fontSize: 28, fontWeight: '700' },
  tileLabel: { color: colors.muted },
  group: { gap: spacing.sm },
  section: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
});
```

In `packages/i18n/src/az/mobile.ts`, delete the line `recent: 'Son tapşırıqlar',` from `home`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n build && pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck`
Expected: PASS: time 1, group-occurrences 9 + 1, home 3, and every earlier suite.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/time.ts apps/mobile/src/lib/time.test.ts apps/mobile/src/features/checklists apps/mobile/src/features/home/home-screen.tsx apps/mobile/src/features/home/home-screen.test.tsx apps/mobile/src/components/primary-button.tsx packages/i18n/src/az/mobile.ts
git commit -m "feat(mobile): show my checklists grouped as now, in progress, upcoming and done with real tile counts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Execution screen: sections, every item type, follow-ups, evidence and problem flags

**Files:**
- Create:
  - `apps/mobile/src/components/commit-input.tsx`
  - In `apps/mobile/src/features/execution/`: `datetime-format.ts`, `parts.tsx`, `item-field.tsx`, `problem-sheet.tsx`, `use-execution.ts`, `execution-screen.tsx`
  - `apps/mobile/app/(app)/execution/[id]/index.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/features/execution/datetime-format.test.ts`, `apps/mobile/src/features/execution/execution-screen.test.tsx`

**Interfaces:**
- Consumes:
  - From `@taskop/contracts`: `visibleItems`, `progress`, `requirements`, `deriveProblems`, `evidenceAllows`, `mediaLimitFor`, `ruleMatches`, `hasRules`, `MEDIA_KINDS`, `MEDIA_LIMITS`, `EXECUTION_LIMITS`, `PROBLEM_SEVERITIES`
  - The store errors (Task 6), the hooks (Task 9), `CaptureModal`/`pickFromGallery`/`VideoPreview`/`CaptureError` (Task 10), `SyncIndicator` and `claimRejectionText` (Tasks 9, 11)
- Produces:
  - `<CommitInput value onCommit … />`: autosaves 500 ms after typing stops, on blur and on unmount (`COMMIT_DELAY_MS = 500`)
  - Date/time formats: `toAnswerDatetime(mode, text): string | null`, `fromAnswerDatetime(mode, value): string`, `nowInputFor(mode, ms): string`
  - Building blocks: `Choice`, `Chip`, `MediaStrip`, `EvidenceRow`; `<ItemField … />` with `testID="item-<id>"`
  - Problem sheet: `type ProblemDraft = { itemId; severity; note; mediaIds }`, `<ProblemSheet … />`
  - `useExecution(id): ExecutionData | null | undefined` (`{ execution, occurrence, content, media }`)
  - `<ExecutionScreen executionId focusItemId? />`
  - Route `/execution/[id]` (param `itemId`), a hidden tab. Tabs get `backBehavior="history"`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/features/execution/datetime-format.test.ts`:

```ts
import { fromAnswerDatetime, nowInputFor, toAnswerDatetime } from './datetime-format';

describe('date and time answers', () => {
  it('accepts dates and times in the stored formats and refuses impossible ones', () => {
    expect(toAnswerDatetime('date', ' 2026-11-02 ')).toBe('2026-11-02');
    expect(toAnswerDatetime('date', '2026-02-30')).toBeNull();
    expect(toAnswerDatetime('time', '08:05')).toBe('08:05');
    expect(toAnswerDatetime('time', '24:00')).toBeNull();
    expect(toAnswerDatetime('datetime', '2026-11-02T08:00')).toBeNull();
  });

  it('stores a local date-time as a UTC instant and shows it back unchanged', () => {
    const stored = toAnswerDatetime('datetime', '2026-11-02 08:30')!;
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fromAnswerDatetime('datetime', stored)).toBe('2026-11-02 08:30');
    expect(fromAnswerDatetime('date', undefined)).toBe('');
  });

  it('fills "İndi" in the field format', () => {
    const ms = new Date(2026, 10, 2, 8, 5).getTime();
    expect(nowInputFor('date', ms)).toBe('2026-11-02');
    expect(nowInputFor('time', ms)).toBe('08:05');
    expect(nowInputFor('datetime', ms)).toBe('2026-11-02 08:05');
  });
});
```

`apps/mobile/src/features/execution/execution-screen.test.tsx`:

```tsx
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, myExecution, OCC, occurrence, syncResponse, T, VERSION2, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { ExecutionScreen } from './execution-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('./capture', () => ({ CaptureModal: () => null, VideoPreview: () => null, pickFromGallery: jest.fn() }));

type Opened = TestServices & { id: string };

async function opened(focusItemId?: (t: TestServices) => string): Promise<Opened> {
  const t = await createTestServices();
  await t.seed();
  const id = await t.services.store.start(OCC, ME);
  await renderWithServices(t.services, <ExecutionScreen executionId={id} focusItemId={focusItemId?.(t)} />);
  await screen.findByText(focusItemId ? 'Vitrin' : 'Zal');
  return { ...t, id };
}
const answers = async (t: Opened) => (await t.services.store.execution(t.id))!.answers;

describe('ExecutionScreen', () => {
  it('shows one section at a time with progress, and follow-ups appear inline', async () => {
    const t = await opened();
    expect(screen.getByText('Bölmə 1/2')).toBeTruthy();
    expect(screen.getByText('0/4 cavablandı')).toBeTruthy();
    expect(screen.queryByText('Problemi təsvir edin')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'Bəli' }));
    expect(await screen.findByText('Problemi təsvir edin')).toBeTruthy();
    expect(screen.getByText('1/5 cavablandı')).toBeTruthy();
    expect(screen.getByText('Foto lazımdır')).toBeTruthy();
    expect(await answers(t)).toEqual({ [t.c.problem.id]: { optionIds: [t.c.yes.id] } });
    await fireEvent.press(screen.getByRole('button', { name: 'Növbəti bölmə' }));
    expect(await screen.findByText('Vitrin')).toBeTruthy();
    expect(screen.getByText('Bölmə 2/2')).toBeTruthy();
  });

  it('saves a number on blur and then asks for the note its rule requires', async () => {
    const t = await opened();
    const input = screen.getByLabelText('Temperatur');
    await fireEvent.changeText(input, '10');
    await fireEvent(input, 'blur');
    const note = await screen.findByLabelText('Qeyd: Temperatur');
    expect(await answers(t)).toEqual({ [t.c.temp.id]: { number: 10 } });
    expect(screen.getByText('Problem qeyd olunub')).toBeTruthy();
    await fireEvent.changeText(note, 'Kondisioner xarabdır');
    await fireEvent(note, 'blur');
    await eventually(async () => expect((await answers(t))[t.c.temp.id]).toEqual({ number: 10, note: 'Kondisioner xarabdır' }));
  });

  it('offers only the camera on live-only items and attaches gallery photos elsewhere', async () => {
    const t = await opened();
    const problemCard = screen.getByTestId(`item-${t.c.problem.id}`);
    expect(within(problemCard).getByRole('button', { name: 'Foto: Kamera' })).toBeTruthy();
    const { pickFromGallery } = jest.requireMock('./capture') as { pickFromGallery: jest.Mock };
    pickFromGallery.mockResolvedValue(capturedPhoto(t.transport, { source: 'gallery' }));
    await fireEvent.press(within(problemCard).getByRole('button', { name: 'Foto: Qalereya' }));
    await eventually(async () => expect((await answers(t))[t.c.problem.id]?.photos).toHaveLength(1));
    expect(pickFromGallery).toHaveBeenCalledWith('photo');

    await fireEvent.press(screen.getByRole('button', { name: 'Növbəti bölmə' }));
    const photoCard = await screen.findByTestId(`item-${t.c.photo.id}`);
    expect(within(photoCard).getByRole('button', { name: 'Foto: Kamera' })).toBeTruthy();
    expect(within(photoCard).queryByRole('button', { name: 'Foto: Qalereya' })).toBeNull();
    expect(within(photoCard).getByText('Yalnız kamera')).toBeTruthy();
  });

  it('flags a manual problem with a severity and a required note', async () => {
    const t = await opened();
    await fireEvent.press(screen.getByRole('button', { name: 'Problem qeyd et: Temperatur' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText('Təsvir yazın.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Kritik' }));
    await fireEvent.changeText(screen.getByLabelText('Təsvir'), 'Termometr sınıb');
    await fireEvent.press(screen.getByRole('button', { name: 'Yadda saxla' }));
    await eventually(async () =>
      expect((await answers(t))[t.c.temp.id]).toEqual({ problem: { severity: 'critical', note: 'Termometr sınıb', mediaIds: [] } }),
    );
    expect(await screen.findByText('Problem qeyd olunub')).toBeTruthy();
  });

  it('locks the execution when the device clock reaches closes_at', async () => {
    const t = await opened();
    await act(async () => {
      t.clock.set(T.closes);
      t.services.feed.emit();
    });
    expect(await screen.findByText('İcra vaxtı bitib — cavablar yarımçıq kimi saxlanıldı.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bəli' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('shows who won the claim on a rejected execution', async () => {
    const t = await opened();
    await act(async () => {
      await t.db.run(`UPDATE executions SET state = 'rejected', claim = 'rejected', rejected_reason = 'ALREADY_CLAIMED', rejected_by = 'Murad Həsənov'`);
      t.services.feed.emit();
    });
    expect(await screen.findByText('Bu checklist artıq Murad Həsənov tərəfindən icra olunur')).toBeTruthy();
  });

  it('asks to update the app for a checklist schema newer than it understands', async () => {
    const t = await createTestServices();
    await t.seed(
      syncResponse({
        occurrences: [occurrence({ checklistVersionId: VERSION2 })],
        checklistVersions: [versionOf({ schemaVersion: 2 }, VERSION2, 2)],
        executions: [myExecution({ checklistVersionId: VERSION2 })],
      }),
    );
    await renderWithServices(t.services, <ExecutionScreen executionId={myExecution().id} />);
    expect(await screen.findByText('Tətbiqi yeniləyin')).toBeTruthy();
  });

  it('opens the section of the item the finish screen jumped to', async () => {
    await opened((t) => t.c.photo.id);
    expect(screen.getByText('Bölmə 2/2')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution`
Expected: FAIL. `./datetime-format` and `./execution-screen` do not exist.

- [ ] **Step 3: Implement the shared input and the date formats**

`apps/mobile/src/components/commit-input.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { colors, spacing } from '@/lib/theme';

export const COMMIT_DELAY_MS = 500;

interface Props extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value: string;
  /** Called 500 ms after typing stops, on blur, and on unmount with unsaved text. */
  onCommit: (text: string) => void;
}

/** A text field that autosaves (spec §7.3) without writing SQLite and the outbox on every keystroke. */
export function CommitInput({ value, onCommit, onBlur, style, ...rest }: Props) {
  const [text, setText] = useState(value);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    if (pending.current === null) setText(value);
  }, [value]);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null) commit.current(next);
  }, []);
  useEffect(() => flush, [flush]);
  return (
    <TextInput
      {...rest}
      value={text}
      placeholderTextColor={colors.muted}
      style={[styles.input, rest.multiline ? styles.multiline : null, style]}
      onChangeText={(next) => {
        setText(next);
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, COMMIT_DELAY_MS);
      }}
      onBlur={(e) => {
        flush();
        onBlur?.(e);
      }}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  multiline: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
});
```

`apps/mobile/src/features/execution/datetime-format.ts`:

```ts
import type { DateTimeMode } from '@taskop/contracts';

const pad = (n: number) => String(n).padStart(2, '0');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2}) (([01]\d|2[0-3]):[0-5]\d)$/;

const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A real calendar date: 2026-02-30 does not survive the round trip. */
function isDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00`);
  return !Number.isNaN(d.getTime()) && formatLocal(d).slice(0, 10) === s;
}

/** What the worker typed → the stored answer, in the formats `answerIssues` accepts; null when invalid. */
export function toAnswerDatetime(mode: DateTimeMode, text: string): string | null {
  const s = text.trim();
  if (mode === 'date') return isDate(s) ? s : null;
  if (mode === 'time') return TIME.test(s) ? s : null;
  const m = DATETIME.exec(s);
  if (!m || !isDate(m[1]!)) return null;
  // Device local time → a UTC instant.
  return new Date(`${m[1]}T${m[2]}`).toISOString();
}

/** The stored answer → what the field shows (date-times in device local time). */
export function fromAnswerDatetime(mode: DateTimeMode, value: string | undefined): string {
  if (!value) return '';
  return mode === 'datetime' ? formatLocal(new Date(value)) : value;
}

/** "İndi": the current device time in the field's format. */
export function nowInputFor(mode: DateTimeMode, ms: number): string {
  const s = formatLocal(new Date(ms));
  return mode === 'date' ? s.slice(0, 10) : mode === 'time' ? s.slice(11) : s;
}
```

- [ ] **Step 4: Implement the building blocks, the item field and the problem sheet**

`apps/mobile/src/features/execution/parts.tsx`:

```tsx
import type { MediaKind, MediaSource } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/lib/theme';
import type { LocalMedia } from '@/offline/local-model';

export function Choice(p: { label: string; selected: boolean; role: 'radio' | 'checkbox'; disabled?: boolean; onPress: () => void }) {
  const disabled = Boolean(p.disabled);
  return (
    <Pressable
      accessibilityRole={p.role}
      accessibilityLabel={p.label}
      accessibilityState={p.role === 'checkbox' ? { checked: p.selected, disabled } : { selected: p.selected, disabled }}
      disabled={disabled}
      onPress={p.onPress}
      style={[styles.choice, p.selected ? styles.choiceOn : null, disabled ? styles.dim : null]}
    >
      <Text style={[styles.choiceText, p.selected ? styles.choiceTextOn : null]}>{p.label}</Text>
    </Pressable>
  );
}

export function Chip(p: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ disabled: Boolean(p.disabled) }}
      disabled={p.disabled}
      onPress={p.onPress}
      style={[styles.chip, p.disabled ? styles.dim : null]}
    >
      <Text style={styles.chipText}>{p.label}</Text>
    </Pressable>
  );
}

/** Thumbnails; a long press asks to remove, a tap plays a video. Files already cleaned up after upload show "Yükləndi". */
export function MediaStrip(p: { ids: string[]; media: ReadonlyMap<string, LocalMedia>; disabled?: boolean; onRemove: (id: string) => void; onOpenVideo: (uri: string) => void }) {
  const { t } = useTranslation();
  if (p.ids.length === 0) return null;
  return (
    <View style={styles.strip}>
      {p.ids.map((id, i) => {
        const m = p.media.get(id);
        const kind = m?.kind ?? 'photo';
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={`${t(`executions.mediaKinds.${kind}`)} ${i + 1}`}
            onPress={() => {
              if (m && !m.fileDeletedAt && m.kind === 'video') p.onOpenVideo(m.localUri);
            }}
            onLongPress={() => {
              if (!p.disabled) p.onRemove(id);
            }}
            style={styles.thumb}
          >
            {!m || m.fileDeletedAt ? (
              <Text style={styles.thumbText}>{t('mobile.evidence.uploaded')}</Text>
            ) : m.kind === 'photo' ? (
              <Image source={{ uri: m.localUri }} style={styles.thumbImage} />
            ) : (
              <Text style={styles.thumbText}>▶</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Evidence of one kind: thumbnails, then camera (and gallery unless live-only) chips while under the limit. */
export function EvidenceRow(p: {
  kind: MediaKind;
  ids: string[];
  limit: number;
  liveOnly: boolean;
  readOnly: boolean;
  media: ReadonlyMap<string, LocalMedia>;
  onCapture: (kind: MediaKind, source: MediaSource) => void;
  onRemove: (id: string) => void;
  onOpenVideo: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`executions.mediaKinds.${p.kind}`);
  const open = !p.readOnly && p.ids.length < p.limit;
  return (
    <View style={styles.evidence}>
      <MediaStrip ids={p.ids} media={p.media} disabled={p.readOnly} onRemove={p.onRemove} onOpenVideo={p.onOpenVideo} />
      <View style={styles.chips}>
        {open ? <Chip label={`${label}: ${t('mobile.evidence.camera')}`} onPress={() => p.onCapture(p.kind, 'camera')} /> : null}
        {open && !p.liveOnly ? <Chip label={`${label}: ${t('mobile.evidence.gallery')}`} onPress={() => p.onCapture(p.kind, 'gallery')} /> : null}
        {p.liveOnly ? <Text style={styles.hint}>{t('mobile.evidence.liveOnly')}</Text> : null}
        <Text style={styles.hint}>{t('mobile.evidence.count', { count: p.ids.length, limit: p.limit })}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: { minHeight: 44, minWidth: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceText: { color: colors.text, fontSize: 15 },
  choiceTextOn: { color: colors.primaryText, fontWeight: '600' },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.primary, fontWeight: '500' },
  dim: { opacity: 0.5 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImage: { width: 64, height: 64 },
  thumbText: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  evidence: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  hint: { color: colors.muted, fontSize: 13 },
});
```

`apps/mobile/src/features/execution/item-field.tsx`:

```tsx
import {
  type Answer,
  type DateTimeItem,
  evidenceAllows,
  EXECUTION_LIMITS,
  hasRules,
  type Item,
  MEDIA_KINDS,
  type MediaKind,
  mediaLimitFor,
  type MediaSource,
  type Missing,
  type NumberItem,
  ruleMatches,
} from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CommitInput } from '@/components/commit-input';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import type { LocalMedia } from '@/offline/local-model';
import { fromAnswerDatetime, nowInputFor, toAnswerDatetime } from './datetime-format';
import { Chip, Choice, EvidenceRow } from './parts';

export interface ItemFieldProps {
  item: Item;
  answer: Answer | undefined;
  missing: Missing[];
  /** A rule or manual problem is recorded for this item. */
  hasProblem: boolean;
  readOnly: boolean;
  media: ReadonlyMap<string, LocalMedia>;
  onPatch: (patch: Partial<Answer>) => void;
  onCapture: (kind: MediaKind, source: MediaSource) => void;
  onRemoveMedia: (mediaId: string) => void;
  onOpenVideo: (uri: string) => void;
  onFlag: () => void;
}

function Options(p: { options: readonly { id: string; label: string }[]; selected: string[]; multi: boolean; disabled: boolean; onChange: (ids: string[]) => void }) {
  return (
    <View style={styles.options}>
      {p.options.map((o) => {
        const on = p.selected.includes(o.id);
        return (
          <Choice
            key={o.id}
            label={o.label}
            selected={on}
            role={p.multi ? 'checkbox' : 'radio'}
            disabled={p.disabled}
            onPress={() => p.onChange(p.multi ? (on ? p.selected.filter((x) => x !== o.id) : [...p.selected, o.id]) : [o.id])}
          />
        );
      })}
    </View>
  );
}

function NumberInput(p: { item: NumberItem; value: number | undefined; disabled: boolean; onChange: (n: number | undefined) => void }) {
  const { t } = useTranslation();
  const [invalid, setInvalid] = useState(false);
  const { item } = p;
  const commit = (text: string) => {
    const s = text.trim().replace(',', '.');
    if (!s) {
      setInvalid(false);
      p.onChange(undefined);
      return;
    }
    const n = Number(s);
    const ok = Number.isFinite(n) && (item.min === null || n >= item.min) && (item.max === null || n <= item.max);
    setInvalid(!ok);
    if (ok) p.onChange(Math.round(n * 10 ** item.decimals) / 10 ** item.decimals);
  };
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <CommitInput accessibilityLabel={item.label} keyboardType="decimal-pad" value={p.value === undefined ? '' : String(p.value)} editable={!p.disabled} onCommit={commit} style={styles.flex} />
        {item.unit ? <Text style={styles.unit}>{item.unit}</Text> : null}
      </View>
      {item.min !== null && item.max !== null ? <Text style={styles.help}>{t('mobile.execution.numberRange', { min: item.min, max: item.max })}</Text> : null}
      {invalid ? <Text style={styles.missing}>{t('mobile.execution.invalidNumber')}</Text> : null}
    </View>
  );
}

function DateTimeInput(p: { item: DateTimeItem; value: string | undefined; disabled: boolean; onChange: (v: string | undefined) => void }) {
  const { t } = useTranslation();
  const { clock } = useOffline();
  const [invalid, setInvalid] = useState(false);
  const commit = (text: string) => {
    if (!text.trim()) {
      setInvalid(false);
      p.onChange(undefined);
      return;
    }
    const v = toAnswerDatetime(p.item.mode, text);
    setInvalid(v === null);
    if (v !== null) p.onChange(v);
  };
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <CommitInput
          accessibilityLabel={p.item.label}
          placeholder={t(`mobile.execution.datePlaceholder.${p.item.mode}`)}
          value={fromAnswerDatetime(p.item.mode, p.value)}
          editable={!p.disabled}
          onCommit={commit}
          style={styles.flex}
        />
        <Chip label={t('mobile.execution.now')} disabled={p.disabled} onPress={() => commit(nowInputFor(p.item.mode, clock.now()))} />
      </View>
      {invalid ? <Text style={styles.missing}>{t('mobile.execution.invalidDate')}</Text> : null}
    </View>
  );
}

function AnswerInput(p: ItemFieldProps) {
  const { t } = useTranslation();
  const { item, answer } = p;
  const evidence = (kind: MediaKind, limit: number) => (
    <EvidenceRow
      kind={kind}
      ids={(kind === 'photo' ? answer?.photos : answer?.videos) ?? []}
      limit={limit}
      liveOnly={item.evidence.liveOnly}
      readOnly={p.readOnly}
      media={p.media}
      onCapture={p.onCapture}
      onRemove={p.onRemoveMedia}
      onOpenVideo={p.onOpenVideo}
    />
  );
  switch (item.type) {
    case 'yes_no':
    case 'confirm_deny': {
      const options = (item.options as readonly { id: string; key: string }[]).map((o) => ({ id: o.id, label: t(`checklists.builder.fixedOptions.${o.key}`) }));
      return <Options options={options} selected={answer?.optionIds ?? []} multi={false} disabled={p.readOnly} onChange={(optionIds) => p.onPatch({ optionIds })} />;
    }
    case 'single_choice':
    case 'multi_choice':
      return <Options options={item.options} selected={answer?.optionIds ?? []} multi={item.type === 'multi_choice'} disabled={p.readOnly} onChange={(optionIds) => p.onPatch({ optionIds })} />;
    case 'number':
      return <NumberInput item={item} value={answer?.number} disabled={p.readOnly} onChange={(number) => p.onPatch({ number })} />;
    case 'text':
    case 'comment':
      return (
        <CommitInput
          accessibilityLabel={item.label}
          value={answer?.text ?? ''}
          editable={!p.readOnly}
          multiline={item.type === 'comment'}
          maxLength={item.maxLength}
          onCommit={(text) => p.onPatch({ text: text.trim() ? text : undefined })}
        />
      );
    case 'datetime':
      return <DateTimeInput item={item} value={answer?.datetime} disabled={p.readOnly} onChange={(datetime) => p.onPatch({ datetime })} />;
    case 'photo':
    case 'video':
      return evidence(item.type, item.maxCount);
  }
}

/** One item: its input, evidence, the note its rule asks for, what is still missing, and the ⚑ problem flag. */
export function ItemField(p: ItemFieldProps) {
  const { t } = useTranslation();
  const { item, answer } = p;
  const needsNote = (hasRules(item) && item.rules.some((r) => r.then.requireNote && ruleMatches(r, item, answer))) || Boolean(answer?.note);
  const evidenceKinds = item.type === 'photo' || item.type === 'video' ? [] : MEDIA_KINDS.filter((k) => evidenceAllows(item, k));
  return (
    <View testID={`item-${item.id}`} style={[styles.card, p.missing.length > 0 ? styles.cardMissing : null]}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{item.label}</Text>
        {item.required ? <Text style={styles.required}>*</Text> : null}
      </View>
      {item.helpText ? <Text style={styles.help}>{item.helpText}</Text> : null}
      <AnswerInput {...p} />
      {evidenceKinds.map((kind) => (
        <EvidenceRow
          key={kind}
          kind={kind}
          ids={(kind === 'photo' ? answer?.photos : answer?.videos) ?? []}
          limit={mediaLimitFor(item, kind)}
          liveOnly={item.evidence.liveOnly}
          readOnly={p.readOnly}
          media={p.media}
          onCapture={p.onCapture}
          onRemove={p.onRemoveMedia}
          onOpenVideo={p.onOpenVideo}
        />
      ))}
      {needsNote ? (
        <CommitInput
          accessibilityLabel={`${t('mobile.execution.note')}: ${item.label}`}
          placeholder={t('mobile.execution.notePlaceholder')}
          value={answer?.note ?? ''}
          editable={!p.readOnly}
          multiline
          maxLength={EXECUTION_LIMITS.answerNote}
          onCommit={(note) => p.onPatch({ note: note.trim() ? note : undefined })}
        />
      ) : null}
      {p.missing
        .filter((m) => m.kind !== 'answer')
        .map((m) => (
          <Text key={m.kind} style={styles.missing}>
            {t(`mobile.finish.missingKinds.${m.kind}`)}
          </Text>
        ))}
      <View style={styles.footer}>
        {p.hasProblem ? <Text style={styles.problem}>{t('mobile.execution.problemFlagged')}</Text> : <View />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('mobile.execution.flagProblem')}: ${item.label}`}
          accessibilityState={{ disabled: p.readOnly }}
          disabled={p.readOnly}
          onPress={p.onFlag}
          style={styles.flag}
        >
          <Text style={[styles.flagText, answer?.problem ? styles.flagActive : null]}>⚑ {t('mobile.execution.flagProblem')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  cardMissing: { borderColor: colors.warning },
  labelRow: { flexDirection: 'row', gap: spacing.xs },
  label: { fontSize: 16, fontWeight: '600', color: colors.text, flexShrink: 1 },
  required: { color: colors.danger, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  unit: { color: colors.muted, fontSize: 16 },
  missing: { color: colors.danger, fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  problem: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  flag: { minHeight: 44, justifyContent: 'center' },
  flagText: { color: colors.muted },
  flagActive: { color: colors.danger, fontWeight: '600' },
});
```

`apps/mobile/src/features/execution/problem-sheet.tsx`:

```tsx
import { EXECUTION_LIMITS, type ManualProblem, MEDIA_KINDS, MEDIA_LIMITS, type MediaKind, type MediaSource, PROBLEM_SEVERITIES, type ProblemSeverity } from '@taskop/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormError } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { colors, spacing } from '@/lib/theme';
import type { LocalMedia } from '@/offline/local-model';
import { Chip, Choice, MediaStrip } from './parts';

export interface ProblemDraft {
  itemId: string;
  severity: ProblemSeverity;
  note: string;
  mediaIds: string[];
}

interface Props {
  draft: ProblemDraft;
  itemLabel: string;
  liveOnly: boolean;
  media: ReadonlyMap<string, LocalMedia>;
  /** The item already has a saved manual problem (offers "Problemi sil"). */
  existing: boolean;
  onChange: (draft: ProblemDraft) => void;
  onCapture: (kind: MediaKind, source: MediaSource) => void;
  onSave: (problem: ManualProblem | null) => void;
  onClose: () => void;
}

/** FR-13.01–03: severity, a note (1–2000 characters) and up to 5 photos or videos. */
export function ProblemSheet(p: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const full = p.draft.mediaIds.length >= MEDIA_LIMITS.problemMaxMedia;
  const save = () => {
    const note = p.draft.note.trim();
    if (!note) {
      setError(t('mobile.problem.noteRequired'));
      return;
    }
    p.onSave({ severity: p.draft.severity, note, mediaIds: p.draft.mediaIds });
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={p.onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('mobile.problem.title')}</Text>
          <Text style={styles.muted}>{p.itemLabel}</Text>
          <Text style={styles.label}>{t('mobile.problem.severity')}</Text>
          <View style={styles.row}>
            {PROBLEM_SEVERITIES.map((s) => (
              <Choice key={s} role="radio" label={t(`executions.severities.${s}`)} selected={p.draft.severity === s} onPress={() => p.onChange({ ...p.draft, severity: s })} />
            ))}
          </View>
          <Text style={styles.label}>{t('mobile.problem.note')}</Text>
          <TextInput
            accessibilityLabel={t('mobile.problem.note')}
            value={p.draft.note}
            onChangeText={(note) => {
              setError(null);
              p.onChange({ ...p.draft, note });
            }}
            multiline
            maxLength={EXECUTION_LIMITS.problemNote}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <FormError message={error} />
          <Text style={styles.label}>{t('mobile.problem.media')}</Text>
          <MediaStrip
            ids={p.draft.mediaIds}
            media={p.media}
            onRemove={(id) => p.onChange({ ...p.draft, mediaIds: p.draft.mediaIds.filter((x) => x !== id) })}
            onOpenVideo={() => undefined}
          />
          {full ? null : (
            <View style={styles.row}>
              {MEDIA_KINDS.map((kind) => (
                <View key={kind} style={styles.row}>
                  <Chip label={`${t(`executions.mediaKinds.${kind}`)}: ${t('mobile.evidence.camera')}`} onPress={() => p.onCapture(kind, 'camera')} />
                  {p.liveOnly ? null : (
                    <Chip label={`${t(`executions.mediaKinds.${kind}`)}: ${t('mobile.evidence.gallery')}`} onPress={() => p.onCapture(kind, 'gallery')} />
                  )}
                </View>
              ))}
            </View>
          )}
          <View style={styles.actions}>
            <PrimaryButton variant="outline" title={t('common.cancel')} onPress={p.onClose} />
            <PrimaryButton title={t('mobile.problem.save')} onPress={save} />
          </View>
          {p.existing ? <PrimaryButton variant="outline" title={t('mobile.problem.remove')} onPress={() => p.onSave(null)} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  label: { fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.sm },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: spacing.md, fontSize: 16, backgroundColor: colors.surface, color: colors.text, textAlignVertical: 'top' },
});
```

- [ ] **Step 5: Implement the screen and its route**

`apps/mobile/src/features/execution/use-execution.ts`:

```ts
import type { ContentLoad } from '@/offline/content';
import { useLiveQuery } from '@/offline/hooks';
import type { LocalExecution, LocalMedia, LocalOccurrence } from '@/offline/local-model';

export interface ExecutionData {
  execution: LocalExecution;
  occurrence: LocalOccurrence;
  content: ContentLoad;
  media: LocalMedia[];
}

/** `undefined` while loading, `null` when the execution (or its occurrence) is not on this phone. */
export function useExecution(executionId: string): ExecutionData | null | undefined {
  return useLiveQuery(async ({ store }) => {
    const execution = await store.execution(executionId);
    if (!execution) return null;
    const occurrence = await store.occurrence(execution.occurrenceId);
    if (!occurrence) return null;
    return { execution, occurrence, content: await store.content(execution.checklistVersionId), media: await store.media(executionId) };
  }, [executionId]);
}
```

`apps/mobile/src/features/execution/execution-screen.tsx`:

```tsx
import { deriveProblems, type MediaKind, type MediaSource, progress, requirements, visibleItems } from '@taskop/contracts';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/primary-button';
import { claimRejectionText } from '@/features/sync/claim-rejection';
import { SyncIndicator } from '@/features/sync/sync-indicator';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { type CapturedMedia, ExecutionLockedError, LiveOnlyError, MediaLimitError, type MediaTarget } from '@/offline/execution-store';
import { useNow } from '@/offline/hooks';
import { CaptureModal, pickFromGallery, VideoPreview } from './capture';
import { ItemField } from './item-field';
import { CaptureError } from './media-capture';
import { type ProblemDraft, ProblemSheet } from './problem-sheet';
import { useExecution } from './use-execution';

function Centered({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.center}>{children}</SafeAreaView>;
}

/** Spec §7.3: one scrolling screen per section, progress bar, every item type, inline follow-ups, evidence, ⚑ problems. Autosaves. */
export function ExecutionScreen({ executionId, focusItemId }: { executionId: string; focusItemId?: string }) {
  const { t } = useTranslation();
  const { store } = useOffline();
  const data = useExecution(executionId);
  const now = useNow();
  const [sectionIndex, setSectionIndex] = useState(0);
  const [capture, setCapture] = useState<{ kind: MediaKind; target: MediaTarget } | null>(null);
  const [draft, setDraft] = useState<ProblemDraft | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const content = data?.content.kind === 'ok' ? data.content.content : null;
  const answers = data?.execution.answers;

  // A jump from the finish screen opens the item's section; the item's onLayout then scrolls to it.
  useEffect(() => {
    if (!content || !answers || !focusItemId) return;
    const target = visibleItems(content, answers).find((v) => v.item.id === focusItemId);
    const index = target ? content.sections.findIndex((s) => s.id === target.sectionId) : -1;
    if (index >= 0) setSectionIndex(index);
    // Only when the target changes or the content first arrives, not on every answer.
  }, [content, focusItemId]);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [sectionIndex]);

  if (data === undefined) {
    return (
      <Centered>
        <ActivityIndicator color={colors.primary} />
      </Centered>
    );
  }
  if (data === null) {
    return (
      <Centered>
        <Text style={styles.muted}>{t('mobile.execution.notFound')}</Text>
      </Centered>
    );
  }
  if (!content) {
    return (
      <Centered>
        <Text style={styles.title}>{data.content.kind === 'needsUpdate' ? t('mobile.execution.needsUpdate') : t('mobile.checklists.startBlocked.notDownloaded')}</Text>
        {data.content.kind === 'needsUpdate' ? <Text style={styles.muted}>{t('mobile.execution.needsUpdateHint')}</Text> : null}
      </Centered>
    );
  }

  const { execution, occurrence } = data;
  const current = execution.answers;
  const visible = visibleItems(content, current);
  const prog = progress(content, current);
  const missing = requirements(content, current);
  const problemItems = new Set(deriveProblems(content, current).map((p) => p.itemId));
  const readOnly = execution.state !== 'active' || now >= Date.parse(occurrence.closesAt);
  const index = Math.min(sectionIndex, content.sections.length - 1);
  const section = content.sections[index];
  const mediaById = new Map(data.media.map((m) => [m.id, m]));
  const draftItem = draft ? (visible.find((v) => v.item.id === draft.itemId)?.item ?? null) : null;
  const banner =
    execution.state === 'rejected'
      ? claimRejectionText(t, execution.rejectedReason ?? 'ALREADY_CLAIMED', execution.rejectedBy)
      : execution.state === 'completed'
        ? t('mobile.execution.completedBanner')
        : readOnly
          ? t('mobile.execution.locked')
          : null;

  const report = (e: unknown) => {
    if (e instanceof ExecutionLockedError) return; // the banner already says why
    if (e instanceof MediaLimitError || e instanceof LiveOnlyError) Alert.alert(t('mobile.evidence.limitReached'));
    else if (e instanceof CaptureError) Alert.alert(t(`mobile.evidence.${e.problem}`));
    else Alert.alert(t('mobile.evidence.failed'));
  };
  const run = (job: () => Promise<unknown>) => void job().catch(report);
  const attach = async (m: CapturedMedia, target: MediaTarget) => {
    const id = await store.attachMedia(executionId, m, target);
    if (target.field === 'problem') setDraft((d) => (d ? { ...d, mediaIds: [...d.mediaIds, id] } : d));
  };
  const startCapture = (kind: MediaKind, source: MediaSource, target: MediaTarget) => {
    if (source === 'camera') {
      setCapture({ kind, target });
      return;
    }
    run(async () => {
      const picked = await pickFromGallery(kind);
      if (picked) await attach(picked, target);
    });
  };
  const confirmRemove = (mediaId: string) =>
    Alert.alert(t('mobile.evidence.removeTitle'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.evidence.remove'), style: 'destructive', onPress: () => run(() => store.removeMedia(executionId, mediaId)) },
    ]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {occurrence.checklistName}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {occurrence.siteName}
          </Text>
        </View>
        <SyncIndicator />
      </View>
      <View style={styles.progressWrap}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${prog.total ? Math.round((prog.answered / prog.total) * 100) : 0}%` }]} />
        </View>
        <Text style={styles.muted}>{t('mobile.execution.progress', { answered: prog.answered, total: prog.total })}</Text>
      </View>
      {banner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {section ? (
          <>
            <Text style={styles.muted}>{t('mobile.execution.section', { n: index + 1, total: content.sections.length })}</Text>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.instructions ? <Text style={styles.muted}>{section.instructions}</Text> : null}
            {visible
              .filter((v) => v.sectionId === section.id)
              .map(({ item, depth }) => (
                <View
                  key={item.id}
                  style={{ marginLeft: depth * spacing.md }}
                  onLayout={(e) => {
                    if (item.id === focusItemId) scroll.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: true });
                  }}
                >
                  <ItemField
                    item={item}
                    answer={current[item.id]}
                    missing={missing.filter((m) => m.itemId === item.id)}
                    hasProblem={problemItems.has(item.id)}
                    readOnly={readOnly}
                    media={mediaById}
                    onPatch={(patch) => run(() => store.patchAnswer(executionId, item.id, patch))}
                    onCapture={(kind, source) => startCapture(kind, source, { itemId: item.id, field: 'evidence' })}
                    onRemoveMedia={confirmRemove}
                    onOpenVideo={setPreview}
                    onFlag={() => {
                      const p = current[item.id]?.problem;
                      setDraft({ itemId: item.id, severity: p?.severity ?? 'normal', note: p?.note ?? '', mediaIds: p?.mediaIds ?? [] });
                    }}
                  />
                </View>
              ))}
          </>
        ) : null}
        <View style={styles.pager}>
          <PrimaryButton variant="outline" title={t('mobile.execution.previous')} disabled={index === 0} onPress={() => setSectionIndex(index - 1)} />
          {index < content.sections.length - 1 ? (
            <PrimaryButton title={t('mobile.execution.next')} onPress={() => setSectionIndex(index + 1)} />
          ) : (
            <PrimaryButton title={t('mobile.execution.finish')} onPress={() => router.push({ pathname: '/execution/[id]/finish', params: { id: executionId } })} />
          )}
        </View>
      </ScrollView>
      {draft && draftItem && !capture ? (
        <ProblemSheet
          draft={draft}
          itemLabel={draftItem.label}
          liveOnly={draftItem.evidence.liveOnly}
          media={mediaById}
          existing={Boolean(current[draft.itemId]?.problem)}
          onChange={setDraft}
          onCapture={(kind, source) => startCapture(kind, source, { itemId: draft.itemId, field: 'problem' })}
          onSave={(problem) =>
            run(async () => {
              await store.setProblem(executionId, draft.itemId, problem);
              setDraft(null);
            })
          }
          onClose={() => setDraft(null)}
        />
      ) : null}
      {capture ? (
        <CaptureModal
          kind={capture.kind}
          onClose={() => setCapture(null)}
          onCaptured={(m) => {
            const target = capture.target;
            setCapture(null);
            run(() => attach(m, target));
          }}
        />
      ) : null}
      {preview ? <VideoPreview uri={preview} onClose={() => setPreview(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  muted: { color: colors.muted },
  progressWrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.primary },
  banner: { marginHorizontal: spacing.md, borderRadius: 10, padding: spacing.md, backgroundColor: '#FEF3C7' },
  bannerText: { color: '#92400E' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg * 2 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  pager: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md },
});
```

`apps/mobile/app/(app)/execution/[id]/index.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { ExecutionScreen } from '@/features/execution/execution-screen';

export default function ExecutionRoute() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId?: string }>();
  // A new key per execution, so section and sheet state never leak from one execution to another.
  return <ExecutionScreen key={id} executionId={id} focusItemId={itemId} />;
}
```

In `apps/mobile/app/(app)/_layout.tsx`:
- Add `backBehavior="history"` to `<Tabs …>`, so the back arrow returns to the previous screen and not to the first tab.
- Add `<Tabs.Screen name="execution/[id]/index" options={HIDDEN} />` after the `sync` screen.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (datetime-format 3, execution-screen 8, media-capture from Task 10).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/components/commit-input.tsx apps/mobile/src/features/execution/datetime-format.ts apps/mobile/src/features/execution/datetime-format.test.ts apps/mobile/src/features/execution/parts.tsx apps/mobile/src/features/execution/item-field.tsx apps/mobile/src/features/execution/problem-sheet.tsx apps/mobile/src/features/execution/use-execution.ts apps/mobile/src/features/execution/execution-screen.tsx apps/mobile/src/features/execution/execution-screen.test.tsx "apps/mobile/app/(app)/execution/[id]/index.tsx" "apps/mobile/app/(app)/_layout.tsx"
git commit -m "feat(mobile): execute checklists section by section with follow-ups, evidence and problem flags" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Finish screen: missing requirements, score preview and "Tamamla"

**Files:**
- Create: `apps/mobile/src/features/execution/finish-screen.tsx`, `apps/mobile/app/(app)/execution/[id]/finish.tsx`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/features/execution/finish-screen.test.tsx`

**Interfaces:**
- Consumes: `requirements`, `computeScore`, `deriveProblems`, `walkItems` (contracts); `useExecution` (Task 13); `store.complete`, `ExecutionLockedError` (Task 6); `useNow` (Task 9).
- Produces:
  - `<FinishScreen executionId />`:
    - One row per `Missing` (`<item label>: <mobile.finish.missingKinds.kind>`). Pressing a row pushes `/execution/[id]` with `itemId`.
    - The score preview (`percent%` or "Bal hesablanmır") and "Problemlər: N".
    - "Tamamla", disabled while anything is missing or the execution is read-only. It completes, alerts "Checklist tamamlandı." and replaces to `/`.
  - Route `/execution/[id]/finish`, a hidden tab

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/execution/finish-screen.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { capturedPhoto } from '@/offline/testing/fake-transport';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { FinishScreen } from './finish-screen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() } }));

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
});

async function started() {
  const t = await createTestServices();
  await t.seed();
  const id = await t.services.store.start(OCC, ME);
  return { t, id };
}

describe('FinishScreen', () => {
  it('lists what is missing, keeps "Tamamla" disabled, and jumps to the item', async () => {
    const { t, id } = await started();
    await renderWithServices(t.services, <FinishScreen executionId={id} />);
    const row = await screen.findByRole('button', { name: 'Soyuducuda problem varmı?: Cavab verilməyib' });
    expect(screen.getByRole('button', { name: 'Temperatur: Cavab verilməyib' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vitrinin şəkli: Cavab verilməyib' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tamamla' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id, itemId: t.c.problem.id } });
  });

  it('previews the score and problems, then completes', async () => {
    const { t, id } = await started();
    await t.services.store.patchAnswer(id, t.c.problem.id, { optionIds: [t.c.no.id] });
    await t.services.store.patchAnswer(id, t.c.temp.id, { number: 10, note: 'isti' });
    await t.services.store.attachMedia(id, capturedPhoto(t.transport), { itemId: t.c.photo.id, field: 'evidence' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <FinishScreen executionId={id} />);
    expect(await screen.findByText('Bütün tələblər yerinə yetirilib.')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('Problemlər: 1')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tamamla' }));
    await eventually(async () => expect(await t.services.store.execution(id)).toMatchObject({ state: 'completed' }));
    expect(alert).toHaveBeenCalledWith('Checklist tamamlandı.');
    expect(mockReplace).toHaveBeenCalledWith('/');
    alert.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution/finish-screen.test.tsx`
Expected: FAIL: `Cannot find module './finish-screen'`.

- [ ] **Step 3: Implement**

`apps/mobile/src/features/execution/finish-screen.tsx`:

```tsx
import { computeScore, deriveProblems, requirements, walkItems } from '@taskop/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { colors, spacing } from '@/lib/theme';
import { useOffline } from '@/offline/context';
import { ExecutionLockedError } from '@/offline/execution-store';
import { useNow } from '@/offline/hooks';
import { useExecution } from './use-execution';

/** Spec §7.3: what still blocks completion (tap to jump), a score preview, and "Tamamla" (FR-08.06). */
export function FinishScreen({ executionId }: { executionId: string }) {
  const { t } = useTranslation();
  const { store } = useOffline();
  const data = useExecution(executionId);
  const now = useNow();
  const [busy, setBusy] = useState(false);

  if (data === undefined) return <ActivityIndicator color={colors.primary} />;
  if (data === null) return <Text style={styles.muted}>{t('mobile.execution.notFound')}</Text>;
  if (data.content.kind !== 'ok') return <Text style={styles.title}>{t('mobile.execution.needsUpdate')}</Text>;

  const content = data.content.content;
  const answers = data.execution.answers;
  const missing = requirements(content, answers);
  const score = computeScore(content, answers);
  const problems = deriveProblems(content, answers);
  const labels = new Map<string, string>();
  walkItems(content, (item) => labels.set(item.id, item.label));
  const readOnly = data.execution.state !== 'active' || now >= Date.parse(data.occurrence.closesAt);

  const complete = async () => {
    setBusy(true);
    try {
      const result = await store.complete(executionId);
      if (result.ok) {
        Alert.alert(t('mobile.finish.completed'));
        router.replace('/');
      }
    } catch (e) {
      if (!(e instanceof ExecutionLockedError)) Alert.alert(t('errors.INTERNAL', { requestId: '—' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => router.push({ pathname: '/execution/[id]', params: { id: executionId } })}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>{t('mobile.finish.title')}</Text>
          <Text style={styles.muted}>{data.occurrence.checklistName}</Text>
        </View>
      </View>
      <Text style={styles.section}>{t('mobile.finish.missingTitle')}</Text>
      {missing.length === 0 ? (
        <Text style={styles.muted}>{t('mobile.finish.none')}</Text>
      ) : (
        missing.map((m) => {
          const label = labels.get(m.itemId) ?? '';
          const kind = t(`mobile.finish.missingKinds.${m.kind}`);
          return (
            <Pressable
              key={`${m.itemId}-${m.kind}`}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${kind}`}
              onPress={() => router.push({ pathname: '/execution/[id]', params: { id: executionId, itemId: m.itemId } })}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.missing}>{kind}</Text>
            </Pressable>
          );
        })
      )}
      <View style={styles.card}>
        <Text style={styles.muted}>{t('mobile.finish.score')}</Text>
        <Text style={styles.score}>{content.scoring.enabled && score.percent !== null ? `${score.percent}%` : t('mobile.finish.noScore')}</Text>
        <Text style={styles.muted}>{t('mobile.finish.problems', { count: problems.length })}</Text>
      </View>
      <PrimaryButton title={t('mobile.finish.complete')} disabled={busy || readOnly || missing.length > 0} onPress={() => void complete()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: colors.primary },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  section: { fontSize: 16, fontWeight: '600', color: colors.text },
  row: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.warning, padding: spacing.md, gap: spacing.xs },
  rowLabel: { color: colors.text, fontWeight: '500' },
  missing: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  score: { fontSize: 32, fontWeight: '700', color: colors.text },
});
```

`apps/mobile/app/(app)/execution/[id]/finish.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { FinishScreen } from '@/features/execution/finish-screen';

export default function FinishRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FinishScreen key={id} executionId={id} />;
}
```

In `apps/mobile/app/(app)/_layout.tsx`, add `<Tabs.Screen name="execution/[id]/finish" options={HIDDEN} />` after the execution screen.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/features/execution && pnpm --filter @taskop/mobile typecheck`
Expected: PASS (finish-screen 2 plus the Task 13 suites).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/execution/finish-screen.tsx apps/mobile/src/features/execution/finish-screen.test.tsx "apps/mobile/app/(app)/execution/[id]/finish.tsx" "apps/mobile/app/(app)/_layout.tsx"
git commit -m "feat(mobile): add the finish screen with missing requirements, score preview and completion" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Logout warning with unsynced data

**Files:**
- Modify: `apps/mobile/src/features/profile/profile-screen.tsx`
- Test: `apps/mobile/src/features/profile/profile-screen.test.tsx`

**Interfaces:**
- Consumes: `useOffline` (`store.unsyncedCount`, `clearAll`) (Task 9); `session.signOut` (Foundation).
- Produces the logout flow (spec §7.4):
  - With nothing unsynced: `clearAll()` then `signOut()`.
  - Otherwise a blocking alert, then a second confirmation. Data is deleted only after "Sil və çıx".

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/features/profile/profile-screen.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import '@/lib/i18n';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ProfileScreen } from './profile-screen';

const mockSignOut = jest.fn(async () => undefined);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/session', () => ({
  session: { signOut: () => mockSignOut() },
  useSession: () => ({
    status: 'authenticated',
    offline: false,
    me: {
      user: { fullName: 'Aysel Əliyeva', jobTitle: null, username: 'aysel', email: null },
      role: { name: 'Worker', systemKey: 'worker' },
      tenant: { name: 'Acme' },
    },
  }),
}));

const press = (buttons: AlertButton[] | undefined, text: string) => buttons!.find((b) => b.text === text)!.onPress?.();

beforeEach(() => mockSignOut.mockClear());

describe('logout', () => {
  it('warns twice before deleting unsynced data', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    const [title, body, buttons] = alert.mock.calls[0]!;
    expect([title, body]).toEqual(['Göndərilməmiş məlumat var', '1 dəyişiklik hələ serverə göndərilməyib. Çıxsanız, onlar bu telefondan silinəcək.']);
    press(buttons, 'Yenə də çıx');
    expect(alert.mock.calls[1]![0]).toBe('Əminsiniz?');
    expect(mockSignOut).not.toHaveBeenCalled();
    press(alert.mock.calls[1]![2], 'Sil və çıx');
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(await t.services.store.occurrences()).toEqual([]);
    expect(await t.services.store.unsyncedCount()).toBe(0);
    alert.mockRestore();
  });

  it('keeps everything when the worker cancels', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    press(alert.mock.calls[0]![2], 'Ləğv et');
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(await t.services.store.unsyncedCount()).toBe(1);
    alert.mockRestore();
  });

  it('clears local data and signs out at once when everything is synced', async () => {
    const t = await createTestServices();
    await t.seed();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
    expect(await t.services.store.occurrences()).toEqual([]);
    alert.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/features/profile/profile-screen.test.tsx`
Expected: FAIL. No alert is shown: the current button calls `session.signOut()` directly, and the occurrences are not cleared.

- [ ] **Step 3: Implement**

In `apps/mobile/src/features/profile/profile-screen.tsx`:
- Add `Alert` to the `react-native` import and `import { useOffline } from '@/offline/context';`.
- Call `const services = useOffline();` right after `const s = useSession();` (before the early return).
- Add this function after `rows` is defined:

```tsx
  /** Spec §7.4: unsynced data blocks logout until the worker confirms twice; local data never outlives the session. */
  const logout = async () => {
    const finish = async () => {
      await services.clearAll();
      await session.signOut();
    };
    const unsynced = await services.store.unsyncedCount();
    if (unsynced === 0) {
      await finish();
      return;
    }
    Alert.alert(t('mobile.logout.unsyncedTitle'), t('mobile.logout.unsyncedBody', { count: unsynced }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('mobile.logout.continue'),
        style: 'destructive',
        onPress: () =>
          Alert.alert(t('mobile.logout.confirmTitle'), t('mobile.logout.confirmBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('mobile.logout.confirm'), style: 'destructive', onPress: () => void finish() },
          ]),
      },
    ]);
  };
```

- Change the logout button to `<PrimaryButton title={t('mobile.profile.logout')} onPress={() => void logout()} />`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS: profile 3 and every other suite.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/features/profile/profile-screen.tsx apps/mobile/src/features/profile/profile-screen.test.tsx
git commit -m "feat(mobile): warn twice before logging out with unsynced data and clear local data on logout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Full verification and the manual device checklist

**Files:**
- None created. Findings go into the pull request description. A real defect found here becomes a fix in the task that owns the file, with its own test and commit.

**Interfaces:**
- Consumes: everything above, and a running API with Part 1 Tasks 1–18 merged.
- Produces: a verified development build on a real phone.

- [ ] **Step 1: Run every automated check**

```bash
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
pnpm --filter @taskop/i18n test
pnpm --filter @taskop/mobile test
pnpm --filter @taskop/mobile typecheck
pnpm --filter @taskop/mobile lint
pnpm --filter @taskop/mobile exec expo config --type prebuild > /dev/null
pnpm --filter @taskop/mobile exec expo-doctor
```

Expected:
- All suites pass. No test is skipped, and Jest reports no open handles.
- `expo-doctor` reports no SDK 57 version mismatch. If it suggests fixes, run `pnpm --filter @taskop/mobile exec expo install --fix`, rerun the suite and commit `apps/mobile/package.json` and `pnpm-lock.yaml`.

- [ ] **Step 2: Start the stack for a phone on the LAN**

```bash
docker compose up -d                       # Postgres, Mailpit, SeaweedFS (Part 1 Task 6)
ipconfig getifaddr en0                     # e.g. 192.168.1.20
# apps/api/.env:    S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333
# apps/mobile/.env: EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
pnpm db:setup && pnpm db:seed              # demo tenant with a worker and today's occurrences
pnpm --filter @taskop/api dev
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
pnpm --filter @taskop/mobile android -- --device
```

Expected: the app installs as a development build, and a seeded worker can log in. "Mənim tapşırıqlarım" shows today's occurrences under İndi / Gələcək, and the header indicator turns green after the first sync.

- [ ] **Step 3: Run the manual device checklist (spec §10)**

Tick each item in the PR description, with the phone model and OS version:

1. **Encrypted at rest.** On the iOS simulator, run `find "$(xcrun simctl get_app_container booted az.taskop.app data)" -name 'taskop.db' -exec head -c 16 {} \; | xxd`. Expected: random bytes, **not** `SQLite format 3`.
2. **Airplane mode.**
   - Turn on airplane mode. Start an open occurrence, answer every item, take a photo, flag a manual problem with a video, and complete.
   - Expected while offline: the indicator is amber "N gözləyir", and the card moves to Bitmiş.
   - Turn airplane mode off and bring the app to the foreground. Expected: green within 30 s.
   - Expected on the web schedule drawer's "İcra" tab: the answers, both media, the problems, and device vs received times.
3. **Live-only.** On a live-only item, only "Foto: Kamera" is offered and no gallery chip appears. On a normal item, the gallery works.
4. **Kill mid-upload.**
   - Record a 50 s video on a slow connection (Network Link Conditioner "3G"). Kill the app while the indicator is amber, then reopen it.
   - Expected: the upload restarts by itself, the indicator turns green, and the video plays in the web lightbox.
5. **Two phones, one shared occurrence, both offline.**
   - Both workers start and answer offline. Phone A goes online first, then phone B.
   - Expected on B: the alert "Bu checklist artıq {A's name} tərəfindən icra olunur", the indicator turning green once B's queued commands are sent, and the execution read-only with the banner.
   - Expected on the web: B under "Rədd edilmiş icralar" with its answers.
6. **closes_at lock.**
   - Start an occurrence whose window closes in 2 minutes and leave it open. When the device time passes `closes_at`, the banner shows "İcra vaxtı bitib…" and the inputs are disabled.
   - Set the phone clock back 1 h. Expected: still locked.
7. **Logout with unsynced data.** Go offline, answer something, then log out. Expected: two confirmations, and after "Sil və çıx" the login screen. Logging in as another worker shows none of the first worker's data.
8. **Media limits.**
   - A photo from a 12 MP camera arrives as a JPEG with a 1600 px long edge (check `width`/`height` in `GET /api/v1/executions/:id`).
   - A camera video stops by itself at 60 s.
   - On iOS, download the uploaded video through its presigned URL. `ffprobe` must show a short edge of at most 720 px. If it does not, record it as a follow-up for `videoQuality` on iOS (Task 1 Step 3 note).
9. **Clock warning.** Set the phone clock 10 min ahead and open the sync screen after a sync. Expected: "Telefonun saatı serverdən 10 dəqiqə fərqlənir…".

- [ ] **Step 4: Record and finish**

Add the checklist results to the PR description. For each failed item, open a fix in the owning task's files, with a regression test where Jest can express it, and commit it as `fix(mobile): …`. Do not commit device-only notes into the repo.

---

## Self-review

**Spec §7 coverage**

| Spec | Where |
|---|---|
| §7.1 SDK 57 modules via development builds; SQLCipher via config plugin; random key in SecureStore | Task 1 (install, plugins, `expo run:*`); Task 9 `open-database.ts`; decision 10 (`expo-crypto`) |
| §7.2 `db.ts`: schema, forward-only migrations, six tables, user-scoped data | Task 3; Task 5 `user-scope.ts`; Task 9 `createOfflineServices` (ensureUser before the engine) |
| §7.2 `execution-store.ts`: start/answer/media/problem/complete, one transaction with the outbox; uses `visibleItems`, `requirements`, `computeScore`, `progress`, `deriveProblems` | Task 6 (store; `requirements`, `mediaLimitFor`, `deriveProblems`); Tasks 13–14 (`visibleItems`, `progress`, `computeScore` on screen) |
| §7.2 sync triggers | Task 9 `sync-triggers.ts`; claim runs at once (Task 9 services) |
| §7.2 sync behaviour: oldest first, backoff 5 s → 5 min, 4xx parks and moves on, failed answers superseded, collapse to latest rev | Task 5 outbox; Task 8 engine tests |
| §7.2 pull `/me/sync`, claims, `clientOffsetMs` | Task 5 `applyPull`; Task 8 (`stamps each command…`, `pulls claims…`) |
| §7.2 rejected claim → local rejected + "Bu checklist artıq {name} tərəfindən icra olunur" | Task 8 (state, `onClaimRejected`); Task 9 provider alert and `claimRejectionText`; Task 13 banner |
| §7.2 `media-queue.ts`: one file at a time, photos first, resume after kill, delete after uploaded + 7 days | Task 7 |
| §7.3 My checklists (sections, overdue red, late and claim badges, real tile counts) | Task 12 (decision 1 for the tiles) |
| §7.3 Execution (per-section scroll, progress bar, all SP2 types, inline follow-ups, evidence chips camera-only when live-only, ⚑ sheet, autosave) | Task 13; capture in Task 10 |
| §7.3 Finish (missing list with jump, score preview, Tamamla) | Task 14 |
| §7.3 Sync indicator green / amber "N gözləyir" / red, queue with "Yenidən cəhd et" | Task 11 |
| §7.4 start rules, closes_at lock, logout warning, no background sync, newer `schemaVersion` refused | Task 6 `startBlock`/`guard`/`lockExpired`; Task 15; Task 9 (no background tasks, interval only while active); Task 4 `loadContent` + Tasks 6/12/13 |
| §9 `EXPO_PUBLIC_API_URL` and `S3_PUBLIC_ENDPOINT` on the Mac's LAN IP | Task 1 (`.env.example`, README); Task 16 Step 2 |
| §10 mobile Jest suites | sync engine with a fake API (Task 8), DB migrations (Task 3), media queue resume (Task 7), execution screen with follow-ups (Task 13), finish missing list (Task 14), sync indicator states (Task 11) |
| §10 manual device checklist | Task 16 Step 3, items 2–5, plus extra checks for encryption, lock, logout, limits and clock |

**Placeholder scan.** No "TBD", "TODO", "handle errors" or "similar to Task N". Two steps are conditional, with a concrete action and no open decision: Task 1 Step 3 (record API differences) and Task 16 Step 3 item 8 (iOS 720p).

**Name consistency with Part 1 "Interfaces for Parts 2 and 3".** Used exactly as Part 1 defines them:
- Execution logic: `progress`, `deriveProblems`, `ExecutionState`, `ClaimRejectionReason`, `ProblemSeverity`, `PROBLEM_SEVERITIES`, `MISSING_KINDS`, `ManualProblem`, `Answer.problem`
- Limits and helpers: `MEDIA_LIMITS` (`photoLongEdge`, `jpegQuality`, `photoMaxBytes`, `videoMaxSeconds`, `videoMaxBytes`, `videoMaxShortEdge`, `extensions`, `problemMaxMedia`), `EXECUTION_LIMITS` (`problemNote`, `answerNote`, `clockSkewMs`), `MEDIA_KINDS`, `evidenceAllows`, `mediaLimitFor`
- Commands and results: `DeviceInfo`, `ClaimCommand`, `SaveAnswersCommand`, `CompleteCommand`, `RegisterMediaCommand`, `ClaimResult`, `CompleteResult`, `MediaUploadTicket`
- Read models: `SyncResponse`, `SyncOccurrence`, `SyncChecklistVersion`, `MyExecution`
- API client: `ExecutionsApi`; `sync.pull`, `executions.{claim, saveAnswers, complete, registerMedia}`, `media.confirmUploaded`; `ApiError`
- i18n keys: `executions.alreadyClaimedBy`, `executions.claimRejections.*`, `executions.states.*`, `executions.severities.*`, `executions.mediaKinds.*`, `executions.flags.late`, `errors.CLOCK_INVALID`

The phone's own strings live only under `az.mobile`, as Part 1 Task 4 reserves.

**Contradictions or gaps found in Part 1** (none block this plan):
- Part 1 says the upload is "a plain `fetch` / `FileSystem.uploadAsync`". In SDK 57's default `expo-file-system` API it is `new File(uri).upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers })`, used in Task 9. `uploadAsync` exists only in `expo-file-system/legacy`.
- Part 1's `completeCommandSchema` requires `rev ≥ 1`. An execution completed with no answers is sent with `rev: 1` (decision 6). The server treats it as fresh and stores `{}`, which is correct.
- Camera recordings have unknown `width`, `height` and `durationMs` at registration. They are sent as `null`, which Part 1's schema allows (`nullable().optional()`), so the server's resolution check only applies when dimensions are given. Task 16 item 8 verifies the iOS output really is 720p.
