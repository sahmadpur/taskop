# Taskop Notifications — Part 2: Mobile App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone registers for Expo push after sign-in, shows push in the foreground, opens the right occurrence or task when a notification is tapped (from a running or a closed app), shows the unread count on a Home bell and on the app icon, lists the inbox, and lets the user switch email notifications off and see the push permission in Profile. Logout stops push to the phone.

**Architecture:**
- **One native file.** `src/notifications/native.ts` is the only code that imports `expo-notifications`, `expo-device` and `expo-constants` for push. It implements three small ports (`src/notifications/ports.ts`): `PushPort` (device, permission, Expo token, Android channel, badge), `PushTokenStore` (the registered token in SecureStore) and `NotificationEvents` (taps, the launch tap, foreground receipts). Every other module takes the ports, so Jest tests run on fakes (`src/notifications/testing/fakes.ts`).
- **Registration** (`push-registration.ts`): `NotificationsBridge`, mounted inside `OfflineProvider` once the signed-in user's services are ready, starts it at every app start and after login, and again on each return to the foreground until it has succeeded. Logout removes the device (`DELETE /me/push-devices/:token`) with a 3 s budget before the session ends.
- **Tap routing** (`notification-router.ts`): pure functions decide where a push or an inbox row leads, after a sync of at most 5 s, by looking at the local store. The bridge feeds them taps, the launch tap and foreground receipts.
- **Unread count:** `/me/sync` carries `unreadNotifications`. The pull stores it in the local `meta` table in the same transaction; the engine hands it to the app badge; `useUnreadNotifications()` feeds the Home bell. The inbox writes a fresh count after mark-read.
- **Screens:** a bell on Home, a hidden `/notifications` route with the online-only inbox, and a "Bildirişlər" card in Profile.
- **Build setup:** the `expo-notifications` config plugin in `app.json`, `app.config.ts` for Android's Firebase file, and `eas.json` with the three deployment profiles.

**Tech Stack:** Expo SDK 57 (React Native 0.86, React 19.2.3, TypeScript 6 in `apps/mobile`), Expo Router (typed routes, `Tabs` with hidden screens), expo-notifications ~57.0.22 and expo-device ~57.0.2 (**new**), expo-constants, expo-secure-store, expo-sqlite (SQLCipher), i18next, Jest 29 (`jest-expo`) + React Native Testing Library 14, `node:sqlite` (tests only), EAS CLI ≥ 24.13.

**Spec:** `docs/superpowers/specs/2026-10-13-notifications-design.md`. This plan covers §7 and the mobile parts of §9. The interface source is `docs/superpowers/plans/2026-10-13-notifications-1-api.md` → **Interfaces for Parts 2 and 3**. Names from that section are used exactly; this plan invents no endpoint and no field.

**This plan is Part 2 of 3.** **It depends on Part 1 Tasks 1–4 being merged into the feature branch.** Those tasks deliver the contracts (`PushData`, `pushDataSchema`, `NotificationItem`, `SyncResponse.unreadNotifications`, `Me.user.emailNotifications`), the `az.notifications` strings and `createNotificationsApi` (`notifications.*`, `pushDevices.*`, `preferences.update`). Every Jest test here runs against fakes. The device run in Task 9 needs the whole of Part 1: the jobs, the Expo sender and the seed.

## Global Constraints

- All Foundation Part 3, SP4 Part 2 and SP5 Part 2 mobile constraints still apply:
  - All text comes from `@taskop/i18n`. This part adds keys under `az.mobile.notifications` only. It also uses Part 1's `az.notifications.{title, markAllRead, empty}`, plus `az.common.retry` and `az.errors.*`.
  - Touch targets are at least 44 pt. A network failure never logs the user out.
  - Inside a `db.transaction` callback, only the `tx` handle is used.
- **Native modules stay out of the code Jest loads:**
  - `expo-notifications`, `expo-device` and the push use of `expo-constants` are imported only by `src/notifications/native.ts`.
  - Its own test, `native.test.ts`, mocks those three modules explicitly.
  - Every other test that renders code importing `@/notifications/native` mocks it with `jest.mock('@/notifications/native', …)`, built from `@/notifications/testing/fakes`.
  - Code that imports `@/offline/native/ports` is tested with that module mocked.
- **The shared packages ship `dist/`.** Before any mobile test or typecheck, run `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build`.
- **Tests:**
  - The mobile tests are Jest (`jest-expo`), run with `pnpm --filter @taskop/mobile test -- <path>`. RNTL 14's `render`, `fireEvent.*` and `act` are awaited.
  - `packages/i18n` tests are Vitest.
- **Dependencies:**
  - Add `expo-notifications` and `expo-device` only through `pnpm --filter @taskop/mobile exec expo install …`. Expo SDK 57 pins `expo-notifications` to `~57.0.22` and `expo-device` to `~57.0.2` (`expo/bundledNativeModules.json`).
  - `expo-dev-client` is **not** added (decision 11).
- **Exact values:**
  - Android channel id `'default'`, exported as `PUSH_CHANNEL_ID`, with importance `AndroidImportance.HIGH` and sound `'default'`. The config plugin's `defaultChannel` is `'default'`.
  - Plugin options: `{ "icon": "./assets/android-icon-monochrome.png", "color": "#1D5BD8", "defaultChannel": "default" }`.
  - Inbox page size **30** (`INBOX_PAGE_SIZE`), sent as `limit: 30`.
  - Tap routing waits at most **5,000 ms** for its sync (`SYNC_WAIT_MS`).
  - Logout gives the push device removal, including a registration still running, at most **3,000 ms** in total (`PUSH_REMOVE_TIMEOUT_MS`).
  - The Home bell shows the count, and `99+` above 99.
  - The inbox route is `/notifications`, file `app/(app)/notifications.tsx`. It is a hidden `Tabs` screen (`HIDDEN`), like every other pushed screen in this app.
  - The registered Expo token is kept in SecureStore under `taskop.pushToken` (`STORAGE_KEYS.pushToken`).
  - The unread count is kept in the local `meta` table under `unreadNotifications`. No local database migration: `meta` is a key-value table.
  - EAS profiles are `development`, `preview` and `production`. `preview` and `production` set `EXPO_PUBLIC_API_URL=https://admin.taskop.app`. `production` has `autoIncrement: true`. The CLI has `appVersionSource: "remote"`.
- **Permission:** push permission is requested only while the OS reports it `undetermined`. A denial is respected and never asked again. The user turns push on in the OS settings, which Profile opens.
- **Logs** carry messages only, never push tokens, request bodies or notification text.
- **Typed routes:** a fresh worktree has no `.expo/types`, so `router.push` takes the loose `Href` type. Do not run `expo start` until Task 7 has added `app/(app)/notifications.tsx`. Task 9 starts the dev server, which generates the route types with every route present.
- Commits use explicit paths (`git add <paths>`, never `-A`). Messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Spec decisions (ambiguities resolved against the real code)

1. **`/notifications` is a hidden tab screen, not a separate stack.**
   - `app/(app)/_layout.tsx` is a `Tabs` navigator whose pushed screens (`sync`, `task/[id]`, `review/[id]`, …) are `Tabs.Screen` entries with `HIDDEN` options. The inbox follows that pattern.
   - Tabs keep a visited screen mounted, so the inbox reloads on every focus (`useFocusEffect`), not only on mount.
2. **An occurrence notice opens the execution only when the phone holds an execution of it.**
   - `ExecutionScreen` shows "İcra tapılmadı" for an occurrence the phone has not started (`useExecution` returns `null`).
   - Starting stays the worker's choice, because it claims the checklist.
   - Routing for `targetKind: 'occurrence'`:
     - occurrence on the phone with an execution → `/execution/[id]` (the route param is the occurrence id);
     - on the phone without one → Home `/`, where its card has "Başla";
     - not on the phone (for example, a manager's problem notice) → the inbox.
3. **A task notice for a task the phone does not hold opens the review screen for `tasks.manage` holders, and the inbox otherwise.**
   - The phone's task list (`SyncResponse.tasks`) holds the user's own tasks. A creator's `task.submitted` and `task.completed` are usually about tasks that are not on the phone, and `/task/[id]` would show "Tapşırıq bu telefonda yoxdur".
   - `/review/[id]` (SP5) loads the task online and offers Approve or Reject when `canReview`.
   - A task in the local store always opens `/task/[id]`, as the spec says.
4. **Every tap with a target first syncs, for at most 5 s.** A notice often arrives before the next 30 s sync has brought its occurrence or task. A slow or unreachable API must not freeze a tap, so routing continues after 5 s with what the store holds.
5. **The foreground handler hides a push meant for someone else.**
   - On a shared phone, a push for the previous user can still arrive between a logout that failed offline and the next sign-in (spec §6.5: "the token claim covers a failed logout call").
   - The handler shows a push only when `data.userId` is the signed-in user. Data that does not parse as `PushData` (an Expo test message) is shown while someone is signed in. Nothing is shown to an anonymous app.
   - The OS shows background notifications regardless; a tap on one goes to the inbox (spec §7.3).
6. **Registration runs at every app start and after login, and again at each return to the foreground until it has succeeded.**
   - It stops trying once the outcome is `registered`, `simulator` or `noProject`.
   - It keeps trying after `denied` or `failed` without ever prompting again. A user who allows push in the OS settings is therefore registered as soon as they come back, without a restart. This covers the spec's "retried at the next start" and more.
7. **The registered token is kept in SecureStore** (`taskop.pushToken`) after a successful `PUT /me/push-devices`.
   - Logout removes the device with that stored token, so it works even when the app started offline and never fetched a token in this session.
   - The removal first waits for a registration still running, so that registration cannot re-register a signed-out phone.
   - The 3 s budget covers both waits. The stored token is forgotten in every case.
8. **The unread count lives in the local `meta` table.**
   - `mergePull` writes `meta.unreadNotifications` in the pull's transaction. `SyncEngineDeps.onUnreadNotifications` passes each pulled count to the app badge.
   - `OfflineServices.setUnreadNotifications(count)` lets the inbox write a fresh count after mark-read. It is guarded by `ownedTransaction`, so nothing is written after a logout or a user switch.
   - `clearAll` (logout) deletes `meta`, and logout sets the badge to 0.
9. **The launch tap is read with `getLastNotificationResponse()` and cleared with `clearLastNotificationResponse()`.**
   - In expo-notifications 57.0.22, the `…Async` variants named in the spec are marked deprecated in favour of these synchronous ones.
   - Each response is handled once per identifier: the listener can deliver the launching tap too.
   - Each response is cleared after it is handled, so a remount (another user signing in) never replays it.
10. **Android push needs Firebase's `google-services.json`.**
    - `app.config.ts` keeps `app.json` as the base and adds `android.googleServicesFile`. It takes the EAS file variable `GOOGLE_SERVICES_JSON` first, then `apps/mobile/google-services.json` when that file exists. The file is gitignored.
    - Without either, the app still builds, and Android registration fails and is logged.
    - `eas init` cannot write into a dynamic config, so the `projectId` goes into `app.json` → `expo.extra.eas.projectId` by hand (Task 9).
11. **The `development` EAS profile is a Debug build without `expo-dev-client`.** The project's development builds are `expo run:ios|android` Debug builds that load JS from Metro. Adding `expo-dev-client` would change that workflow, and the deployment spec ("dev client, local API") is met by the Debug build with the Mac's `.env`. The deployment spec (`2026-10-09-deployment-design.md` §12) is not on this branch; its profile values are copied into the Global Constraints.
12. **A profile cached by an earlier app version has no `emailNotifications`.**
    - `session.bootstrap()` validates the cached profile with `meSchema` when the phone starts offline. A missing field would sign the worker out offline.
    - The cache reader adds `emailNotifications: true`, the server's default, when the field is absent.
13. **The email switch in Profile is online-only and optimistic.**
    - It flips at once and calls `PATCH /me/preferences`.
    - On success, the server's answer is applied to the session and its offline copy (`session.patchUser`). On failure, the switch flips back and shows the error.
    - A user without an email address sees that no email is sent; the setting still saves (Part 1).
14. **Inbox mark-read is optimistic and never blocks navigation.**
    - The row turns read at once. `POST /me/notifications/:id/read` runs in the background, and a `404` for a row removed by cleanup is only logged.
    - After `markRead`, `markAllRead` or a refresh, the inbox reads `GET /me/notifications/unread-count`, so the bell and the badge update without waiting for a sync.
15. **The Android small icon is `assets/android-icon-monochrome.png`** (alpha-only, as Android requires), tinted with the primary colour `#1D5BD8`.
16. **No iOS `mode` option.** Expo's notifications docs for SDK 57 say the `aps-environment` entitlement is set to development and that Xcode changes it to production when it archives. The plugin's default is kept.

## Review Focus

These are the five failure modes most likely to bite real users that no spec test names. Each line names the task and the test that pins it.

1. **The first offline start after the update.** A worker opens the updated app in a basement. The cached profile was written by the previous version, without `emailNotifications`, and must still restore the session offline instead of signing them out. Pinned in Task 1 (`restores a profile cached by the previous app version when offline`).
2. **A shared phone after a logout that failed offline.** A push for the previous user arrives while user B is signed in, or while nobody is. It must not show in the foreground, and tapping it must not open the previous user's work. The tap that launched the app must be handled once, even when the listener delivers it too. Pinned in Task 2 (`shows a foreground notification only to the user it was sent to`) and Task 6 (`a push for another user opens the inbox without syncing` and `handles the launching tap once, even when the listener delivers it too, and clears it`).
3. **Logging out with no network, or with an API that does not answer.** Logout must still finish within 3 s more than before, forget the token and clear the badge. A registration still in flight must not re-register the signed-out phone. Pinned in Task 5 (`gives up on a removal that does not answer within 3 s` and `waits for a registration still running, so it cannot re-register a signed-out phone`).
4. **The notice's target is not on the phone, or not yet.** Four cases must never end on a "not found" screen or freeze the tap:
   - a manager's problem notice (the occurrence is not on the phone);
   - a creator's `task.submitted` (the task is not on the phone);
   - a `checklist.available` notice that arrives before the sync that brings the occurrence;
   - a tap while the API hangs.

   Pinned in Task 6 (`finds an occurrence that only the sync brings`, `sends a not-yet-started checklist to Home`, `opens the review screen for a task not on the phone when the user manages tasks`, `stops waiting for the sync after 5 s`).
5. **Inbox paging races.** The user pulls to refresh while the next page is still loading, or scrolls to the end twice quickly. The list must not show a row twice, append a stale page or ask for the same page twice. Pinned in Task 7 (`drops a next page that was loading when the list was refreshed, and asks for a page once`).

---

## File Structure

```
packages/i18n/src/az/mobile.ts                 + notifications.* (bell, channel, inbox, profile)
packages/i18n/src/i18n.test.ts                 + mobile notification strings
apps/mobile/
  package.json                                 + expo-notifications ~57.0.22, expo-device ~57.0.2
  app.json                                     + expo-notifications plugin
  app.config.ts                                (new) android.googleServicesFile from EAS or the app folder
  eas.json                                     (new) development / preview / production
  .gitignore                                   + google-services.json
  app/_layout.tsx                              configureNotifications() at startup
  app/(app)/_layout.tsx                        <NotificationsBridge />; hidden "notifications" screen
  app/(app)/notifications.tsx                  (new) inbox route
  src/app-config.test.ts                       + plugin, eas.json, app.config
  src/lib/session.ts (+ test)                  cached profile default; patchUser
  src/lib/secure-storage.ts                    + STORAGE_KEYS.pushToken
  src/notifications/
    ports.ts                                   PushPort, PushTokenStore, NotificationEvents, TapResponse, PUSH_CHANNEL_ID
    native.ts (+ test)                         the only expo-notifications / expo-device user
    push-data.ts (+ test)                      readPushData, foregroundBehavior
    settle-within.ts (+ test)                  settleWithin(promise, ms)
    push-registration.ts (+ test)              registerPush, startPushRegistration, unregisterPush
    notification-router.ts (+ test)            routeForTarget, routeForPush, createRouteContext, startTapRouting
    notifications-bridge.tsx (+ test)          registration + taps + receipts for the signed-in user
    use-push-permission.ts                     OS permission, re-read on foreground
    testing/fakes.ts                           fakePush, fakeTokens, fakePushApi, fakeAppState, fakeEvents
  src/offline/
    db.ts                                      MetaKey + 'unreadNotifications'
    unread.ts (+ test)                         readUnreadNotifications
    sync-pull.ts                               stores res.unreadNotifications
    sync-engine.ts                             onUnreadNotifications after each pull
    services.ts                                onUnreadNotifications dep; setUnreadNotifications()
    hooks.ts                                   useUnreadNotifications()
    native/create-native-services.ts           badge wiring
    testing/fixtures.ts                        unreadNotifications; pushData(); notificationItem()
    testing/test-services.ts                   unread: number[]
  src/features/
    home/home-screen.tsx (+ test)              bell in the header
    notifications/notification-bell.tsx (+ test)
    notifications/inbox-screen.tsx (+ test)
    profile/profile-screen.tsx (+ test)        logout removes the device; email switch; push permission
```

---

### Task 1: Phone strings, and the mobile suite on Part 1's contracts

**Files:**
- Modify: `packages/i18n/src/az/mobile.ts`
- Test: `packages/i18n/src/i18n.test.ts`
- Modify: `apps/mobile/src/offline/testing/fixtures.ts`
- Modify: `apps/mobile/src/lib/session.ts`
- Test: `apps/mobile/src/lib/session.test.ts`

**Interfaces:**
- Consumes (Part 1): `az.notifications.{title, markAllRead, empty}`; `SyncResponse.unreadNotifications: number`; `Me.user.emailNotifications: boolean`; `type PushData`; `type NotificationItem`.
- Produces:
  - `az.mobile.notifications.{bell, channel, unread, online}`;
  - `az.mobile.notifications.profile.{email, noEmail, online, push, pushStates.{granted, denied, undetermined, unavailable}, deniedHint, openSettings}`;
  - fixtures: `syncResponse()` now includes `unreadNotifications: 0`;
  - `NOTIFICATION`, `NOTIFICATION2`, `NOTIFICATION3`, `TENANT`;
  - `pushData(over?: Partial<PushData>): PushData`;
  - `notificationItem(over?: Partial<NotificationItem>): NotificationItem`.

- [ ] **Step 1: Write the failing i18n test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('mobile notification translations', () => {
  it('labels the bell, the inbox and the profile settings', () => {
    expect(az.mobile.notifications.bell.replace('{{count}}', '3')).toBe('Bildirişlər, 3 oxunmamış');
    for (const k of ['channel', 'unread', 'online'] as const) expect(az.mobile.notifications[k], k).toBeTypeOf('string');
    for (const k of ['email', 'noEmail', 'online', 'push', 'deniedHint', 'openSettings'] as const) {
      expect(az.mobile.notifications.profile[k], k).toBeTypeOf('string');
    }
    expect(Object.keys(az.mobile.notifications.profile.pushStates).sort()).toEqual(['denied', 'granted', 'unavailable', 'undetermined']);
  });

  it('shares the inbox wording with the web (Part 1)', () => {
    expect(az.notifications.title).toBe('Bildirişlər');
    expect(az.notifications.markAllRead).toBe('Hamısını oxunmuş et');
    expect(az.notifications.empty).toBe('Bildiriş yoxdur');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL, because `az.mobile.notifications` is undefined. The second test passes, since Part 1 Task 3 added `az.notifications`.

- [ ] **Step 3: Add the strings**

In `packages/i18n/src/az/mobile.ts`, add after the `logout` block (before the closing `} as const;`):

```ts
  notifications: {
    bell: 'Bildirişlər, {{count}} oxunmamış',
    channel: 'Taskop bildirişləri',
    unread: 'Oxunmamış',
    online: 'Bildirişlərə baxmaq üçün internet bağlantısı tələb olunur.',
    profile: {
      email: 'E-poçt bildirişləri',
      noEmail: 'Hesabınızda e-poçt ünvanı yoxdur, ona görə e-poçt göndərilmir.',
      online: 'Dəyişmək üçün internet bağlantısı tələb olunur.',
      push: 'Push bildirişləri',
      pushStates: { granted: 'Açıqdır', denied: 'Bağlıdır', undetermined: 'Hələ soruşulmayıb', unavailable: 'Bu cihazda dəstəklənmir' },
      deniedHint: 'Push bildirişlərini telefonun ayarlarından açın.',
      openSettings: 'Ayarları aç',
    },
  },
```

- [ ] **Step 4: Run the i18n tests and check they pass**

Run: `pnpm --filter @taskop/i18n test`
Expected: PASS.

- [ ] **Step 5: See the mobile suite fail on Part 1's contracts**

Run: `pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build && pnpm --filter @taskop/mobile typecheck`

Expected: FAIL with `Property 'unreadNotifications' is missing in type …` at `src/offline/testing/fixtures.ts` (`syncResponse`). Part 1 Task 2 added the field to `syncResponseSchema`; the mobile fixture predates it.

- [ ] **Step 6: Update the fixtures**

In `apps/mobile/src/offline/testing/fixtures.ts`, change the import from `@taskop/contracts` to also import `type NotificationItem` and `type PushData` (keep the existing names, alphabetical):

```ts
import {
  blankContent,
  type ChecklistContent,
  type DeviceInfo,
  type MyExecution,
  newItem,
  newRule,
  newSection,
  type NotificationItem,
  type NumberItem,
  type PhotoItem,
  type PushData,
  type SyncChecklistVersion,
  type SyncOccurrence,
  type SyncResponse,
  type SyncTask,
  type YesNoItem,
} from '@taskop/contracts';
```

Replace the `syncResponse` fixture with:

```ts
export const syncResponse = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  serverTime: T.open,
  occurrences: [occurrence()],
  checklistVersions: [],
  executions: [],
  tasks: [],
  removedTaskIds: [],
  unreadNotifications: 0,
  ...over,
});
```

Append at the end of the file:

```ts
export const NOTIFICATION = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea0';
export const NOTIFICATION2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea1';
export const NOTIFICATION3 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea2';
export const TENANT = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea3';

/** The `data` of a push to me about OCC (Part 1 `PushData`). */
export const pushData = (over: Partial<PushData> = {}): PushData => ({
  notificationId: NOTIFICATION,
  userId: ME,
  tenantId: TENANT,
  type: 'checklist.available',
  targetKind: 'occurrence',
  targetId: OCC,
  targetDate: '2026-11-02',
  ...over,
});

/** An unread inbox row about OCC (Part 1 `NotificationItem`). */
export const notificationItem = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: NOTIFICATION,
  type: 'checklist.available',
  title: 'Açılış yoxlaması açıldı',
  body: 'Bakı filialı 1 · 08:00–11:00',
  targetKind: 'occurrence',
  targetId: OCC,
  targetDate: '2026-11-02',
  createdAt: T.starts,
  readAt: null,
  ...over,
});
```

- [ ] **Step 7: Write the failing session test**

In `apps/mobile/src/lib/session.test.ts`, replace the `user` line of the `me` constant with one that carries the new field:

```ts
  user: { id, fullName: 'Elvin Məmmədov', jobTitle: null, kind: 'worker', email: null, username: 'elvin', emailVerified: false, credentialKind: 'pin', emailNotifications: true },
```

Add inside `describe('mobile session', …)`, after `restores the cached profile when offline`:

```ts
  it('restores a profile cached by the previous app version when offline', async () => {
    // Written before sub-project 6: no emailNotifications. The worker must stay signed in offline.
    const { emailNotifications: _dropped, ...oldUser } = me.user;
    mockStore.set('taskop.refreshToken', 'r1');
    mockStore.set('taskop.me', JSON.stringify({ ...me, user: oldUser }));
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await session.bootstrap();
    expect(session.get()).toMatchObject({ status: 'authenticated', offline: true, me: { user: { username: 'elvin', emailNotifications: true } } });
  });
```

- [ ] **Step 8: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/lib/session.test.ts`
Expected: FAIL in `restores a profile cached by the previous app version when offline`. It receives `{ status: 'anonymous' }`, because `meSchema` refuses the old profile.

- [ ] **Step 9: Default the field when reading the cache**

In `apps/mobile/src/lib/session.ts`, replace `loadCachedMe` with:

```ts
/** A profile cached before sub-project 6 has no emailNotifications; the server's default (true) stands in until the next refresh. */
function withPreferenceDefaults(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const user = (raw as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null || 'emailNotifications' in user) return raw;
  return { ...raw, user: { ...user, emailNotifications: true } };
}

async function loadCachedMe(): Promise<Me | null> {
  const raw = await secureStorage.get(STORAGE_KEYS.me);
  if (!raw) return null;
  try {
    const parsed = meSchema.safeParse(withPreferenceDefaults(JSON.parse(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 10: Run the whole mobile suite, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS, with the session tests included. The refresh tests now send a `me` that satisfies Part 1's `meSchema`.

- [ ] **Step 11: Commit**

```bash
git add packages/i18n/src/az/mobile.ts packages/i18n/src/i18n.test.ts apps/mobile/src/offline/testing/fixtures.ts apps/mobile/src/lib/session.ts apps/mobile/src/lib/session.test.ts
git commit -m "feat(mobile): notification strings, and the app on the sub-project 6 contracts with old cached profiles still restoring offline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Expo push setup: dependencies, config plugin, EAS profiles, native port and foreground handler

**Files:**
- Modify: `apps/mobile/package.json` (through `expo install`), `apps/mobile/app.json`, `apps/mobile/.gitignore`
- Create: `apps/mobile/app.config.ts`, `apps/mobile/eas.json`
- Modify: `apps/mobile/src/lib/secure-storage.ts`, `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/src/notifications/ports.ts`, `push-data.ts`, `native.ts`
- Test: `apps/mobile/src/app-config.test.ts`, `apps/mobile/src/notifications/push-data.test.ts`, `apps/mobile/src/notifications/native.test.ts`

**Interfaces:**
- Consumes: `pushDataSchema`, `type PushData`, `type PushPlatform` (Part 1); `az.mobile.notifications.channel` (Task 1); `pushData()` fixture (Task 1).
- Produces:
  - `ports.ts`: `PUSH_CHANNEL_ID = 'default'`, `type PushPermission = 'granted' | 'denied' | 'undetermined'`, `interface PushPort`, `interface PushTokenStore`, `interface TapResponse { identifier: string; data: unknown }`, `interface NotificationEvents`, all exactly as in Step 7.
  - `push-data.ts`: `readPushData(raw: unknown): PushData | null`; `foregroundBehavior(raw: unknown, signedInUserId: string | null): ForegroundBehavior`.
  - `native.ts`: `nativePush: PushPort`, `pushTokenStore: PushTokenStore`, `notificationEvents: NotificationEvents`, `configureNotifications(currentUserId: () => string | null): void`, `setAppBadge(count: number): void`, `openSettings(): Promise<void>`, `readProjectId(c): string | null`, `toPermission(s): PushPermission`.
  - `STORAGE_KEYS.pushToken = 'taskop.pushToken'`.
  - `app.config.ts`: `googleServicesFile(env?, exists?): string | undefined`, `withGoogleServices(config, file): ExpoConfig`, and the default export.

- [ ] **Step 1: Install the two modules at the versions Expo SDK 57 expects**

Run: `pnpm --filter @taskop/mobile exec expo install expo-notifications expo-device`
Expected: `apps/mobile/package.json` gains `"expo-device": "~57.0.2"` and `"expo-notifications": "~57.0.22"`, and the lockfile updates.

If `expo install` added a bare `"expo-notifications"` string to `app.json` → `plugins`, delete that string. Step 5 adds the configured entry, and only one entry may exist.

- [ ] **Step 2: Write the failing configuration tests**

In `apps/mobile/src/app-config.test.ts`, add after the existing imports:

```ts
import eas from '../eas.json';
import { googleServicesFile, withGoogleServices } from '../app.config';
```

Add inside `describe('native configuration', …)`:

```ts
  it('adds the notifications plugin once, with the default Android channel and the monochrome icon', () => {
    expect(plugins.filter((p) => (Array.isArray(p) ? p[0] : p) === 'expo-notifications')).toHaveLength(1);
    expect(options('expo-notifications')).toEqual({ icon: './assets/android-icon-monochrome.png', color: '#1D5BD8', defaultChannel: 'default' });
    for (const m of ['expo-notifications', 'expo-device']) expect(Object.keys(pkg.dependencies)).toContain(m);
  });

  it('builds development, preview and production with EAS, the latter two against admin.taskop.app', () => {
    expect(Object.keys(eas.build)).toEqual(['development', 'preview', 'production']);
    expect(eas.build.preview.env.EXPO_PUBLIC_API_URL).toBe('https://admin.taskop.app');
    expect(eas.build.production.env.EXPO_PUBLIC_API_URL).toBe('https://admin.taskop.app');
    expect(eas.build.production.autoIncrement).toBe(true);
    // The development build loads JS from Metro on the Mac, with the local API from apps/mobile/.env.
    expect('env' in eas.build.development).toBe(false);
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it("gives Android Firebase's file from EAS or from the app folder, and still builds without one", () => {
    expect(googleServicesFile({ GOOGLE_SERVICES_JSON: '/eas/files/google-services.json' }, () => false)).toBe('/eas/files/google-services.json');
    expect(googleServicesFile({}, () => true)).toBe('./google-services.json');
    expect(googleServicesFile({}, () => false)).toBeUndefined();
    const base = { name: 'Taskop', slug: 'taskop', android: { package: 'az.taskop.app' } };
    expect(withGoogleServices(base, './google-services.json').android).toEqual({ package: 'az.taskop.app', googleServicesFile: './google-services.json' });
    expect(withGoogleServices(base, undefined).android).toEqual({ package: 'az.taskop.app' });
    expect(withGoogleServices(base, undefined).name).toBe('Taskop');
  });
```

- [ ] **Step 3: Write the failing port tests**

Create `apps/mobile/src/notifications/push-data.test.ts`:

```ts
import { ME, OTHER, pushData, TASK } from '@/offline/testing/fixtures';
import { foregroundBehavior, readPushData } from './push-data';

const SHOWN = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true };
const HIDDEN = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };

describe('push data', () => {
  it('reads the data the API sends with every push and rejects anything else', () => {
    expect(readPushData(pushData())).toEqual(pushData());
    expect(readPushData(pushData({ type: 'task.assigned', targetKind: 'task', targetId: TASK, targetDate: null }))).toMatchObject({ targetKind: 'task', targetId: TASK });
    expect(readPushData({ ...pushData(), targetKind: 'site' })).toBeNull();
    expect(readPushData({ ...pushData(), userId: 'not-a-uuid' })).toBeNull();
    expect(readPushData(undefined)).toBeNull();
    expect(readPushData({ note: 'Expo push tool' })).toBeNull();
  });

  it('shows a foreground notification only to the user it was sent to', () => {
    expect(foregroundBehavior(pushData(), ME)).toEqual(SHOWN);
    expect(foregroundBehavior(pushData({ userId: OTHER }), ME)).toEqual(HIDDEN);
    expect(foregroundBehavior(pushData(), null)).toEqual(HIDDEN);
    // Not a Taskop push (an Expo test message): shown while someone is signed in, never to an anonymous app.
    expect(foregroundBehavior({ note: 'Expo push tool' }, ME)).toEqual(SHOWN);
    expect(foregroundBehavior({ note: 'Expo push tool' }, null)).toEqual(HIDDEN);
  });
});
```

Create `apps/mobile/src/notifications/native.test.ts`:

```ts
import { Platform } from 'react-native';
import { ME, OTHER, pushData } from '@/offline/testing/fixtures';

jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 6 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[abc]' })),
  setBadgeCountAsync: jest.fn(async () => true),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-eas-project-id' } } }, easConfig: null },
}));
jest.mock('@/lib/secure-storage', () => {
  const store = new Map<string, string>();
  return {
    STORAGE_KEYS: { pushToken: 'taskop.pushToken' },
    secureStorage: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => void store.set(k, v),
      remove: async (k: string) => void store.delete(k),
    },
  };
});

import { configureNotifications, nativePush, notificationEvents, pushTokenStore, readProjectId, setAppBadge } from './native';

type Mocked = {
  [K in
    | 'setNotificationHandler'
    | 'setNotificationChannelAsync'
    | 'getPermissionsAsync'
    | 'requestPermissionsAsync'
    | 'getExpoPushTokenAsync'
    | 'setBadgeCountAsync'
    | 'getLastNotificationResponse'
    | 'clearLastNotificationResponse'
    | 'addNotificationResponseReceivedListener'
    | 'addNotificationReceivedListener']: jest.Mock;
};
const N = jest.requireMock<Mocked>('expo-notifications');

const note = (data: unknown, identifier = 'n1') => ({ date: 0, request: { identifier, content: { data }, trigger: null } });
type Handler = { handleNotification(n: unknown): Promise<Record<string, boolean>> };

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('native push port', () => {
  it("shows foreground notifications for the signed-in user only and creates Android's 'default' channel at startup", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    let current: string | null = ME;
    configureNotifications(() => current);
    const handler = N.setNotificationHandler.mock.calls[0]![0] as Handler;
    expect((await handler.handleNotification(note(pushData()))).shouldShowBanner).toBe(true);
    expect((await handler.handleNotification(note(pushData({ userId: OTHER })))).shouldShowBanner).toBe(false);
    current = null;
    expect((await handler.handleNotification(note(pushData()))).shouldShowList).toBe(false);
    expect(N.setNotificationChannelAsync).toHaveBeenCalledWith('default', { name: 'Taskop bildirişləri', importance: 6, sound: 'default' });
  });

  it('creates no channel on iOS', async () => {
    await nativePush.ensureChannel();
    expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(nativePush.platform()).toBe('ios');
  });

  it("maps the OS permission, asks for it, and gets the Expo token with the project's id", async () => {
    N.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', granted: false, canAskAgain: false, expires: 'never' });
    expect(await nativePush.permission()).toBe('denied');
    N.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined', granted: false, canAskAgain: true, expires: 'never' });
    expect(await nativePush.permission()).toBe('undetermined');
    N.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' });
    expect(await nativePush.requestPermission()).toBe('granted');
    expect(nativePush.projectId()).toBe('test-eas-project-id');
    expect(await nativePush.expoToken('test-eas-project-id')).toBe('ExponentPushToken[abc]');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-eas-project-id' });
    expect(nativePush.isDevice).toBe(true);
  });

  it('reads the EAS project id from extra.eas or the EAS config, and nothing from a blank one', () => {
    expect(readProjectId({ expoConfig: { extra: { eas: { projectId: 'p-1' } } }, easConfig: null })).toBe('p-1');
    expect(readProjectId({ expoConfig: { extra: {} }, easConfig: { projectId: 'p-2' } })).toBe('p-2');
    expect(readProjectId({ expoConfig: { extra: { eas: { projectId: ' ' } } }, easConfig: null })).toBeNull();
    expect(readProjectId({ expoConfig: null, easConfig: null })).toBeNull();
  });

  it('hands taps, the launch tap and receipts over as their data, and unsubscribes', () => {
    expect(notificationEvents.lastResponse()).toBeNull();
    N.getLastNotificationResponse.mockReturnValueOnce({ actionIdentifier: 'default', notification: note(pushData(), 'launch') });
    expect(notificationEvents.lastResponse()).toEqual({ identifier: 'launch', data: pushData() });
    notificationEvents.clearLastResponse();
    expect(N.clearLastNotificationResponse).toHaveBeenCalledTimes(1);

    const remove = jest.fn();
    N.addNotificationResponseReceivedListener.mockReturnValueOnce({ remove });
    const taps: unknown[] = [];
    const off = notificationEvents.onResponse((r) => taps.push(r));
    (N.addNotificationResponseReceivedListener.mock.calls[0]![0] as (r: unknown) => void)({ actionIdentifier: 'default', notification: note(pushData(), 'n2') });
    expect(taps).toEqual([{ identifier: 'n2', data: pushData() }]);
    off();
    expect(remove).toHaveBeenCalledTimes(1);

    const received: unknown[] = [];
    notificationEvents.onReceived((d) => received.push(d));
    (N.addNotificationReceivedListener.mock.calls[0]![0] as (n: unknown) => void)(note(pushData()));
    expect(received).toEqual([pushData()]);
  });

  it('keeps the push token in secure storage and sets the badge, logging a badge failure', async () => {
    expect(await pushTokenStore.get()).toBeNull();
    await pushTokenStore.set('ExponentPushToken[abc]');
    expect(await pushTokenStore.get()).toBe('ExponentPushToken[abc]');
    await pushTokenStore.clear();
    expect(await pushTokenStore.get()).toBeNull();

    setAppBadge(3);
    expect(N.setBadgeCountAsync).toHaveBeenCalledWith(3);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    N.setBadgeCountAsync.mockRejectedValueOnce(new Error('no badge'));
    setAppBadge(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledWith('[push] Could not set the app badge', 'no badge');
  });
});
```

- [ ] **Step 4: Run the tests and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/app-config.test.ts src/notifications`
Expected: FAIL: cannot find module `../eas.json`, `../app.config`, `./push-data` and `./native`.

- [ ] **Step 5: Configure the plugin, Android's Firebase file and EAS**

In `apps/mobile/app.json`, add this entry to `expo.plugins` after `"expo-video"`:

```json
      [
        "expo-notifications",
        { "icon": "./assets/android-icon-monochrome.png", "color": "#1D5BD8", "defaultChannel": "default" }
      ],
```

Create `apps/mobile/app.config.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Android push needs Firebase's google-services.json (spec §7.1, decision 10). EAS builds get it from the file variable
 * GOOGLE_SERVICES_JSON; local builds read apps/mobile/google-services.json (gitignored). Without either the app still
 * builds, and Android push registration fails and is logged.
 */
export function googleServicesFile(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (env.GOOGLE_SERVICES_JSON) return env.GOOGLE_SERVICES_JSON;
  return exists(join(__dirname, 'google-services.json')) ? './google-services.json' : undefined;
}

export function withGoogleServices(config: ConfigContext['config'], file: string | undefined): ExpoConfig {
  const android = { ...config.android, ...(file ? { googleServicesFile: file } : {}) };
  return { ...config, android } as ExpoConfig;
}

/** app.json stays the static base (extra.eas.projectId lives there); this only adds what depends on the build machine. */
export default ({ config }: ConfigContext): ExpoConfig => withGoogleServices(config, googleServicesFile());
```

Create `apps/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 24.13.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "distribution": "internal",
      "ios": { "buildConfiguration": "Debug" },
      "android": { "buildType": "apk", "gradleCommand": ":app:assembleDebug" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://admin.taskop.app" }
    },
    "production": {
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://admin.taskop.app" }
    }
  },
  "submit": { "production": {} }
}
```

In `apps/mobile/.gitignore`, add after the `*.mobileprovision` line:

```
# Firebase config for Android push: EAS builds use the GOOGLE_SERVICES_JSON file variable (decision 10)
google-services.json
```

In `apps/mobile/src/lib/secure-storage.ts`, replace `STORAGE_KEYS` with:

```ts
export const STORAGE_KEYS = {
  refreshToken: 'taskop.refreshToken',
  me: 'taskop.me',
  orgCode: 'taskop.orgCode',
  /** The Expo push token this phone registered last (decision 7). */
  pushToken: 'taskop.pushToken',
} as const;
```

- [ ] **Step 6: Write the push data rules**

Create `apps/mobile/src/notifications/push-data.ts`:

```ts
import { type PushData, pushDataSchema } from '@taskop/contracts';

/** The `data` of a Taskop push (Part 1 `PushData`), or null for anything else. */
export function readPushData(raw: unknown): PushData | null {
  const parsed = pushDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** expo-notifications' NotificationBehavior. */
export interface ForegroundBehavior {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * Spec §7.1 (banner, sound and list in the foreground), limited by decision 5: a push for another user (a shared phone
 * whose last logout failed offline) or for an anonymous app is not shown. Data that is not a Taskop push is shown while signed in.
 */
export function foregroundBehavior(raw: unknown, signedInUserId: string | null): ForegroundBehavior {
  const data = readPushData(raw);
  const show = signedInUserId !== null && (data === null || data.userId === signedInUserId);
  return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: show };
}
```

- [ ] **Step 7: Write the ports**

Create `apps/mobile/src/notifications/ports.ts`:

```ts
import type { PushPlatform } from '@taskop/contracts';

/** Expo push sends every message with channelId 'default' (Part 1); the phone creates the channel. */
export const PUSH_CHANNEL_ID = 'default';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** The phone's push capabilities. `native.ts` implements it with expo-notifications; tests use `testing/fakes.ts`. */
export interface PushPort {
  /** False on simulators and emulators: they get no push token. */
  isDevice: boolean;
  platform(): PushPlatform;
  /** The EAS project id from the app config, or null before `eas init`. */
  projectId(): string | null;
  /** Android: creates the 'default' channel (needed before the permission prompt on Android 13+). No-op on iOS. */
  ensureChannel(): Promise<void>;
  permission(): Promise<PushPermission>;
  requestPermission(): Promise<PushPermission>;
  expoToken(projectId: string): Promise<string>;
  setBadge(count: number): Promise<void>;
}

/** The token this phone registered last (SecureStore). */
export interface PushTokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** A tap on a notification: its identifier (to handle it once) and its data. */
export interface TapResponse {
  identifier: string;
  data: unknown;
}

export interface NotificationEvents {
  /** The tap that launched the app (cold start), until cleared. */
  lastResponse(): TapResponse | null;
  clearLastResponse(): void;
  onResponse(listener: (response: TapResponse) => void): () => void;
  /** A notification received while the app is running. */
  onReceived(listener: (data: unknown) => void): () => void;
}
```

- [ ] **Step 8: Write the native implementation**

Create `apps/mobile/src/notifications/native.ts`:

```ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import i18n from '@/lib/i18n';
import { secureStorage, STORAGE_KEYS } from '@/lib/secure-storage';
import { type NotificationEvents, PUSH_CHANNEL_ID, type PushPermission, type PushPort, type PushTokenStore, type TapResponse } from './ports';
import { foregroundBehavior } from './push-data';

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** Expo's documented lookup: the EAS project id `eas init` gives the app (app.json → expo.extra.eas.projectId). */
export function readProjectId(c: { expoConfig?: { extra?: { [key: string]: unknown } } | null; easConfig?: { projectId?: string } | null }): string | null {
  const eas = c.expoConfig?.extra?.eas as { projectId?: unknown } | undefined;
  const id = eas?.projectId ?? c.easConfig?.projectId;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

export function toPermission(s: { granted: boolean; status: string }): PushPermission {
  if (s.granted) return 'granted';
  return s.status === 'denied' ? 'denied' : 'undetermined';
}

export const nativePush: PushPort = {
  isDevice: Device.isDevice,
  platform: () => (Platform.OS === 'ios' ? 'ios' : 'android'),
  projectId: () => readProjectId(Constants),
  async ensureChannel() {
    if (Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: i18n.t('mobile.notifications.channel'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  },
  permission: async () => toPermission(await Notifications.getPermissionsAsync()),
  requestPermission: async () => toPermission(await Notifications.requestPermissionsAsync()),
  expoToken: async (projectId) => (await Notifications.getExpoPushTokenAsync({ projectId })).data,
  async setBadge(count) {
    await Notifications.setBadgeCountAsync(count);
  },
};

export const pushTokenStore: PushTokenStore = {
  get: () => secureStorage.get(STORAGE_KEYS.pushToken),
  set: (token) => secureStorage.set(STORAGE_KEYS.pushToken, token),
  clear: () => secureStorage.remove(STORAGE_KEYS.pushToken),
};

const toTap = (r: Notifications.NotificationResponse): TapResponse => ({
  identifier: r.notification.request.identifier,
  data: r.notification.request.content.data,
});

/** Decision 9: the synchronous launch-response calls; their …Async twins are deprecated in expo-notifications 57. */
export const notificationEvents: NotificationEvents = {
  lastResponse() {
    const r = Notifications.getLastNotificationResponse();
    return r ? toTap(r) : null;
  },
  clearLastResponse: () => Notifications.clearLastNotificationResponse(),
  onResponse(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener((r) => listener(toTap(r)));
    return () => subscription.remove();
  },
  onReceived(listener) {
    const subscription = Notifications.addNotificationReceivedListener((n) => listener(n.request.content.data));
    return () => subscription.remove();
  },
};

/** Spec §7.1, called once when the app starts: the foreground handler and Android's 'default' channel. */
export function configureNotifications(currentUserId: () => string | null): void {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => foregroundBehavior(n.request.content.data, currentUserId()),
  });
  nativePush.ensureChannel().catch((e: unknown) => console.warn('[push] Could not create the notification channel', message(e)));
}

/** The app-icon badge (spec §7.3); best effort, since Android launchers may not support badges. */
export function setAppBadge(count: number): void {
  nativePush.setBadge(count).catch((e: unknown) => console.warn('[push] Could not set the app badge', message(e)));
}

/** Profile's "Ayarları aç" when push is denied (spec §7.4). */
export async function openSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.warn('[push] Could not open the settings', message(e));
  }
}
```

- [ ] **Step 9: Configure notifications at startup**

In `apps/mobile/app/_layout.tsx`, add after `import { colors } from '@/lib/theme';`:

```ts
import { configureNotifications } from '@/notifications/native';
```

And after `const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });` add:

```ts
// Spec §7.1: the foreground handler and Android's channel exist before any notification can arrive.
configureNotifications(() => {
  const s = session.get();
  return s.status === 'authenticated' ? s.me.user.id : null;
});
```

- [ ] **Step 10: Run the tests, typecheck, lint and the config check**

Run: `pnpm --filter @taskop/mobile test -- src/app-config.test.ts src/notifications && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint && pnpm --filter @taskop/mobile exec expo install --check && pnpm --filter @taskop/mobile exec expo config --type prebuild > /dev/null`
Expected: the tests PASS and typecheck and lint are clean. `expo install --check` reports that dependencies are up to date. `expo config` exits 0, because the plugin resolves its icon.

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/app.json apps/mobile/app.config.ts apps/mobile/eas.json apps/mobile/.gitignore apps/mobile/app/_layout.tsx apps/mobile/src/lib/secure-storage.ts apps/mobile/src/app-config.test.ts apps/mobile/src/notifications
git commit -m "feat(mobile): expo-notifications setup, EAS profiles, Android channel and a foreground handler that shows only the signed-in user's push" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The unread count from sync, and the app badge

**Files:**
- Modify: `apps/mobile/src/offline/db.ts`, `sync-pull.ts`, `sync-engine.ts`, `services.ts`, `hooks.ts`, `native/create-native-services.ts`, `testing/test-services.ts`
- Create: `apps/mobile/src/offline/unread.ts`
- Test: `apps/mobile/src/offline/unread.test.ts`

**Interfaces:**
- Consumes: `SyncResponse.unreadNotifications` (Part 1); `setAppBadge` (Task 2).
- Produces:
  - `MetaKey` gains `'unreadNotifications'`;
  - `readUnreadNotifications(db: Db): Promise<number>` (0 when unknown);
  - `SyncEngineDeps.onUnreadNotifications?: (count: number) => void`;
  - `ServiceDeps.onUnreadNotifications?: (count: number) => void`;
  - `OfflineServices.setUnreadNotifications(count: number): Promise<void>`;
  - `useUnreadNotifications(): number`;
  - `TestServices.unread: number[]` (every count handed to the badge).

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/offline/unread.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { applyPull } from './sync-pull';
import { syncResponse, T } from './testing/fixtures';
import { openTestDb } from './testing/node-db';
import { createTestServices } from './testing/test-services';
import { readUnreadNotifications } from './unread';

describe('unread notifications', () => {
  it('keeps the count of the last sync in the local store', async () => {
    const db = await openTestDb();
    expect(await readUnreadNotifications(db)).toBe(0);
    await applyPull(db, syncResponse({ unreadNotifications: 7 }), 0, Date.parse(T.open));
    expect(await readUnreadNotifications(db)).toBe(7);
    await applyPull(db, syncResponse({ unreadNotifications: 0 }), 0, Date.parse(T.open));
    expect(await readUnreadNotifications(db)).toBe(0);
  });

  it('hands every pulled count to the app badge, and nothing when the pull fails', async () => {
    const t = await createTestServices({ online: true });
    t.api.sync = syncResponse({ occurrences: [], unreadNotifications: 4 });
    await t.services.syncNow('manual');
    expect(await readUnreadNotifications(t.db)).toBe(4);
    expect(t.unread).toEqual([4]);
    t.api.sync = syncResponse({ occurrences: [], unreadNotifications: 0 });
    await t.services.syncNow('manual');
    expect(t.unread).toEqual([4, 0]);
    t.api.on('pull', async () => {
      throw ApiError.network();
    });
    await t.services.syncNow('manual');
    expect(t.unread).toEqual([4, 0]);
    await t.services.dispose();
  });

  it('stores a count the inbox read, and nothing once the user has logged out', async () => {
    const t = await createTestServices();
    await t.services.setUnreadNotifications(2);
    expect(await readUnreadNotifications(t.db)).toBe(2);
    expect(t.unread).toEqual([2]);
    await t.services.clearAll();
    expect(await readUnreadNotifications(t.db)).toBe(0);
    await t.services.setUnreadNotifications(5);
    expect(await readUnreadNotifications(t.db)).toBe(0);
    expect(t.unread).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/offline/unread.test.ts`
Expected: FAIL: cannot find module `./unread`.

- [ ] **Step 3: Store the count with each pull**

In `apps/mobile/src/offline/db.ts`, replace the `MetaKey` line with:

```ts
export type MetaKey = 'userId' | 'clockOffsetMs' | 'lastSyncedAt' | 'unreadNotifications';
```

Create `apps/mobile/src/offline/unread.ts`:

```ts
import { type Db, getMeta } from './db';

/** The unread count of the last sync or inbox read (spec §7.3); 0 before the first one. */
export async function readUnreadNotifications(db: Db): Promise<number> {
  const n = Number(await getMeta(db, 'unreadNotifications'));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
```

In `apps/mobile/src/offline/sync-pull.ts`, inside `mergePull`, add after `await setMeta(tx, 'lastSyncedAt', iso(now));`:

```ts
  await setMeta(tx, 'unreadNotifications', String(res.unreadNotifications));
```

In `apps/mobile/src/offline/sync-engine.ts`, make these three edits:

1. Add this field to `SyncEngineDeps` after `onTaskRemoved`:

   ```ts
     /** The unread notification count of every pull this engine applied (spec §7.3: the app badge). */
     onUnreadNotifications?: (count: number) => void;
   ```

2. Replace the destructuring line of `createSyncEngine` with:

   ```ts
     const { db, userId, api, clock, feed, mediaQueue, files, isOnline, onClaimRejected, onTaskRemoved, onUnreadNotifications, beforeRun } = deps;
   ```

3. In `pull()`, replace

   ```ts
       if (files === NOT_OWNER) return 'ok';
       files.forEach(removeFile);
       feed.emit();
       return 'ok';
   ```

   with

   ```ts
       if (files === NOT_OWNER) return 'ok';
       files.forEach(removeFile);
       feed.emit();
       onUnreadNotifications?.(res.unreadNotifications);
       return 'ok';
   ```

- [ ] **Step 4: Expose the count from the services**

In `apps/mobile/src/offline/services.ts`:

1. Replace `import { type Db, migrate } from './db';` with `import { type Db, migrate, setMeta } from './db';`.
2. Replace `import { clearLocalData, ensureUser, type FileRemover } from './user-scope';` with `import { clearLocalData, ensureUser, type FileRemover, NOT_OWNER, ownedTransaction } from './user-scope';`.
3. Add to `ServiceDeps` after `onTaskRemoved`:

   ```ts
     /** Every unread count the phone learns (a pull or the inbox): the app badge (spec §7.3). */
     onUnreadNotifications?: (count: number) => void;
   ```

4. Add to `OfflineServices` after `syncNow(…)`:

   ```ts
     /** The inbox read a fresh unread count: stored for the bell and handed to the badge. Nothing is written once the user changed. */
     setUnreadNotifications(count: number): Promise<void>;
   ```

5. In `createSyncEngine({ … })`, add after `onTaskRemoved: deps.onTaskRemoved,`:

   ```ts
       onUnreadNotifications: deps.onUnreadNotifications,
   ```

6. In the returned object, add after `syncNow: …,`:

   ```ts
       async setUnreadNotifications(count) {
         const n = Math.max(0, Math.floor(count));
         const written = await ownedTransaction(db, userId, (tx) => setMeta(tx, 'unreadNotifications', String(n)));
         if (written === NOT_OWNER) return;
         feed.emit();
         deps.onUnreadNotifications?.(n);
       },
   ```

In `apps/mobile/src/offline/hooks.ts`, add `import { readUnreadNotifications } from './unread';` after the existing imports, and append:

```ts
/** The unread notification count for the Home bell (spec §7.4); 0 until the first sync. */
export function useUnreadNotifications(): number {
  return useLiveQuery((s) => readUnreadNotifications(s.db), []) ?? 0;
}
```

In `apps/mobile/src/offline/native/create-native-services.ts`, add `import { setAppBadge } from '@/notifications/native';` after `import { api } from '@/lib/session';`. Then add to the deps object after `onTaskRemoved: hooks.onTaskRemoved,`:

```ts
          // Spec §7.3: the app icon shows the unread count after every sync.
          onUnreadNotifications: setAppBadge,
```

In `apps/mobile/src/offline/testing/test-services.ts`:

1. Add to `TestServices` after `removedTasks: TaskRemoved[];`:

   ```ts
     /** Every unread count handed to the app badge, in order. */
     unread: number[];
   ```

2. Add `const unread: number[] = [];` after `const removedTasks: TaskRemoved[] = [];`.
3. In the deps object passed to `createOfflineServices`, add `onUnreadNotifications: (n) => unread.push(n)` after `onTaskRemoved: (r) => removedTasks.push(r)`.
4. Return `unread` too: `return { services, api, clock, transport, db, net, rejections, removedTasks, unread, c, seed };`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/offline && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS. The existing services tests still expect `meta` to hold only `userId` after a pull that A's logout interrupted. That holds because `mergePull` runs inside `ownedTransaction`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/offline
git commit -m "feat(mobile): keep the unread notification count from each sync and show it on the app badge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Push registration after login and at every start

**Files:**
- Create: `apps/mobile/src/notifications/push-registration.ts`, `apps/mobile/src/notifications/notifications-bridge.tsx`, `apps/mobile/src/notifications/testing/fakes.ts`
- Modify: `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/notifications/push-registration.test.ts`, `apps/mobile/src/notifications/notifications-bridge.test.tsx`

**Interfaces:**
- Consumes:
  - `pushDevices.register(body: RegisterPushDeviceInput): Promise<void>` and `type NotificationsApi` (Part 1);
  - `PushPort`, `PushTokenStore`, `nativePush`, `pushTokenStore` (Task 2);
  - `AppStatePort` (`@/offline/sync-triggers`) and `rnAppState()` (`@/offline/native/ports`).
- Produces:
  - `interface PushDeps { push: PushPort; tokens: PushTokenStore; api: Pick<NotificationsApi, 'pushDevices'> }`;
  - `type RegisterOutcome = 'registered' | 'simulator' | 'denied' | 'noProject' | 'failed'`;
  - `registerPush(deps: PushDeps): Promise<RegisterOutcome>` (never rejects);
  - `pendingRegistration(): Promise<RegisterOutcome> | null`;
  - `startPushRegistration(deps: PushDeps & { appState: AppStatePort }): () => void`;
  - `NotificationsBridge` component;
  - fakes: `PROJECT_ID`, `PUSH_TOKEN`, `fakePush(o?)`/`FakePush`, `fakeTokens(value?)`/`FakeTokens`, `fakePushApi()`, `fakeAppState()`.

- [ ] **Step 1: Write the fakes**

Create `apps/mobile/src/notifications/testing/fakes.ts`:

```ts
import type { PushPlatform, RegisterPushDeviceInput } from '@taskop/contracts';
import type { AppStatePort } from '@/offline/sync-triggers';
import type { PushPermission, PushPort, PushTokenStore } from '../ports';

/** Test-only: nothing in the app imports this file. */
export const PROJECT_ID = 'test-eas-project-id';
export const PUSH_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

export type FakePush = PushPort & { ensureChannel: jest.Mock; permission: jest.Mock; requestPermission: jest.Mock; expoToken: jest.Mock; setBadge: jest.Mock };

/** A real phone with push granted, on Android, with an EAS project id, unless told otherwise. */
export function fakePush(o: { isDevice?: boolean; platform?: PushPlatform; projectId?: string | null } = {}): FakePush {
  return {
    isDevice: o.isDevice ?? true,
    platform: () => o.platform ?? 'android',
    projectId: () => (o.projectId === undefined ? PROJECT_ID : o.projectId),
    ensureChannel: jest.fn(async () => undefined),
    permission: jest.fn(async (): Promise<PushPermission> => 'granted'),
    requestPermission: jest.fn(async (): Promise<PushPermission> => 'granted'),
    expoToken: jest.fn(async (_projectId: string) => PUSH_TOKEN),
    setBadge: jest.fn(async (_count: number) => undefined),
  };
}

export type FakeTokens = PushTokenStore & { value: string | null };

export function fakeTokens(value: string | null = null): FakeTokens {
  const store: FakeTokens = {
    value,
    get: async () => store.value,
    set: async (token) => {
      store.value = token;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

export function fakePushApi() {
  return {
    pushDevices: {
      register: jest.fn(async (_body: RegisterPushDeviceInput) => undefined),
      remove: jest.fn(async (_token: string) => undefined),
    },
  };
}

export function fakeAppState(): AppStatePort & { emit(active: boolean): void; readonly listeners: number } {
  const listeners = new Set<(active: boolean) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (active) => listeners.forEach((l) => l(active)),
    get listeners() {
      return listeners.size;
    },
  };
}
```

- [ ] **Step 2: Write the failing registration tests**

Create `apps/mobile/src/notifications/push-registration.test.ts`:

```ts
import { ApiError } from '@taskop/api-client';
import { registerPush, startPushRegistration } from './push-registration';
import { fakeAppState, fakePush, fakePushApi, fakeTokens, PROJECT_ID, PUSH_TOKEN } from './testing/fakes';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('registerPush', () => {
  it("creates the channel first, gets the Expo token with the project's id and registers it as this phone", async () => {
    const push = fakePush();
    const tokens = fakeTokens();
    const api = fakePushApi();
    expect(await registerPush({ push, tokens, api })).toBe('registered');
    expect(push.ensureChannel.mock.invocationCallOrder[0]!).toBeLessThan(push.expoToken.mock.invocationCallOrder[0]!);
    expect(push.expoToken).toHaveBeenCalledWith(PROJECT_ID);
    expect(api.pushDevices.register).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'android' });
    expect(tokens.value).toBe(PUSH_TOKEN);
    expect(push.requestPermission).not.toHaveBeenCalled();
  });

  it('asks for permission once when the OS has not asked yet', async () => {
    const push = fakePush({ platform: 'ios' });
    push.permission.mockResolvedValue('undetermined');
    const api = fakePushApi();
    expect(await registerPush({ push, tokens: fakeTokens(), api })).toBe('registered');
    expect(push.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.pushDevices.register).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'ios' });
  });

  it('respects a denial silently: no prompt, no token, no request', async () => {
    const push = fakePush();
    push.permission.mockResolvedValue('denied');
    const api = fakePushApi();
    expect(await registerPush({ push, tokens: fakeTokens(), api })).toBe('denied');
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(push.expoToken).not.toHaveBeenCalled();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops when the user declines the prompt', async () => {
    const push = fakePush();
    push.permission.mockResolvedValue('undetermined');
    push.requestPermission.mockResolvedValue('denied');
    expect(await registerPush({ push, tokens: fakeTokens(), api: fakePushApi() })).toBe('denied');
    expect(push.expoToken).not.toHaveBeenCalled();
  });

  it('skips a simulator silently', async () => {
    const push = fakePush({ isDevice: false });
    expect(await registerPush({ push, tokens: fakeTokens(), api: fakePushApi() })).toBe('simulator');
    expect(push.permission).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips with a log when the app has no EAS project id yet', async () => {
    const push = fakePush({ projectId: null });
    const api = fakePushApi();
    expect(await registerPush({ push, tokens: fakeTokens(), api })).toBe('noProject');
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('eas init'));
  });

  it('never throws: a token or API failure is logged and reported as failed, with nothing stored', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens();
    expect(await registerPush({ push: fakePush(), tokens, api })).toBe('failed');
    expect(tokens.value).toBeNull();
    const push = fakePush();
    push.expoToken.mockRejectedValueOnce(new Error('Expo unreachable'));
    expect(await registerPush({ push, tokens, api })).toBe('failed');
    expect(warn).toHaveBeenCalledWith('[push] Registration failed; it is tried again later', 'Expo unreachable');
  });
});

describe('startPushRegistration', () => {
  it('registers at start and does not repeat once registered', async () => {
    const api = fakePushApi();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState });
    await flush();
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
    expect(appState.listeners).toBe(0);
  });

  it('tries a failed registration again when the app returns to the foreground', async () => {
    const api = fakePushApi();
    api.pushDevices.register.mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens, api, appState });
    await flush();
    expect(tokens.value).toBeNull();
    appState.emit(false);
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(2);
    expect(tokens.value).toBe(PUSH_TOKEN);
    stop();
  });

  it('never prompts again after a denial, and registers once the user allows push in the settings', async () => {
    const push = fakePush();
    push.permission.mockResolvedValue('denied');
    const api = fakePushApi();
    const appState = fakeAppState();
    const stop = startPushRegistration({ push, tokens: fakeTokens(), api, appState });
    await flush();
    appState.emit(true);
    await flush();
    expect(push.requestPermission).not.toHaveBeenCalled();
    expect(api.pushDevices.register).not.toHaveBeenCalled();
    push.permission.mockResolvedValue('granted');
    appState.emit(true);
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs one attempt at a time', async () => {
    const held = gate();
    const api = fakePushApi();
    api.pushDevices.register.mockImplementationOnce(() => held.opened.then(() => undefined));
    const appState = fakeAppState();
    const stop = startPushRegistration({ push: fakePush(), tokens: fakeTokens(), api, appState });
    await flush();
    appState.emit(true);
    appState.emit(true);
    held.open();
    await flush();
    expect(api.pushDevices.register).toHaveBeenCalledTimes(1);
    stop();
  });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/push-registration.test.ts`
Expected: FAIL: cannot find module `./push-registration`.

- [ ] **Step 4: Write the registration**

Create `apps/mobile/src/notifications/push-registration.ts`:

```ts
import type { NotificationsApi } from '@taskop/api-client';
import type { AppStatePort } from '@/offline/sync-triggers';
import type { PushPort, PushTokenStore } from './ports';

export interface PushDeps {
  push: PushPort;
  tokens: PushTokenStore;
  api: Pick<NotificationsApi, 'pushDevices'>;
}

export type RegisterOutcome = 'registered' | 'simulator' | 'denied' | 'noProject' | 'failed';

/** These end the attempts of this session; after 'denied' or 'failed' the next foreground tries again (decision 6). */
const FINAL: ReadonlySet<RegisterOutcome> = new Set(['registered', 'simulator', 'noProject']);

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

let inFlight: Promise<RegisterOutcome> | null = null;

/** The registration still running, if any: logout waits for it, so it cannot re-register a signed-out phone. */
export const pendingRegistration = (): Promise<RegisterOutcome> | null => inFlight;

async function attempt({ push, tokens, api }: PushDeps): Promise<RegisterOutcome> {
  if (!push.isDevice) return 'simulator';
  try {
    await push.ensureChannel();
    let permission = await push.permission();
    // Asked once: only while the OS has not asked yet. A denial is respected (spec §7.2).
    if (permission === 'undetermined') permission = await push.requestPermission();
    if (permission !== 'granted') return 'denied';
    const projectId = push.projectId();
    if (!projectId) {
      console.warn('[push] The app config has no EAS projectId (run `eas init`); push registration is skipped');
      return 'noProject';
    }
    const expoToken = await push.expoToken(projectId);
    await api.pushDevices.register({ expoToken, platform: push.platform() });
    await tokens.set(expoToken);
    return 'registered';
  } catch (e) {
    console.warn('[push] Registration failed; it is tried again later', message(e));
    return 'failed';
  }
}

/** Spec §7.2: PUT /me/push-devices with this phone's Expo token. Never rejects and never blocks the caller's flow. */
export function registerPush(deps: PushDeps): Promise<RegisterOutcome> {
  const run: Promise<RegisterOutcome> = attempt(deps).finally(() => {
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Registers now (app start or login) and at each return to the foreground until an outcome is final. */
export function startPushRegistration(deps: PushDeps & { appState: AppStatePort }): () => void {
  let done = false;
  let running = false;
  let stopped = false;
  const tryOnce = () => {
    if (done || running || stopped) return;
    running = true;
    void registerPush(deps).then((outcome) => {
      done = FINAL.has(outcome);
      running = false;
    });
  };
  const off = deps.appState.subscribe((active) => {
    if (active) tryOnce();
  });
  tryOnce();
  return () => {
    stopped = true;
    off();
  };
}
```

- [ ] **Step 5: Run the registration tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/push-registration.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing bridge test**

Create `apps/mobile/src/notifications/notifications-bridge.test.tsx`:

```tsx
import '@/lib/i18n';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { NotificationsBridge } from './notifications-bridge';
import { PUSH_TOKEN } from './testing/fakes';

const mockRegister = jest.fn();
jest.mock('@/lib/session', () => ({
  api: { pushDevices: { register: (...a: unknown[]) => mockRegister(...a), remove: jest.fn() } },
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: [] } }),
}));
jest.mock('@/notifications/native', () => {
  const { fakePush, fakeTokens } = jest.requireActual<typeof import('./testing/fakes')>('./testing/fakes');
  return { nativePush: fakePush(), pushTokenStore: fakeTokens() };
});
jest.mock('@/offline/native/ports', () => ({ rnAppState: () => ({ subscribe: () => () => undefined }) }));

beforeEach(() => {
  mockRegister.mockReset();
  mockRegister.mockResolvedValue(undefined);
});

describe('NotificationsBridge', () => {
  it('registers this phone for push once the signed-in app has opened, without waiting on anything', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <NotificationsBridge />);
    await eventually(async () => expect(mockRegister).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'android' }));
  });
});
```

- [ ] **Step 7: Run it and check it fails**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/notifications-bridge.test.tsx`
Expected: FAIL: cannot find module `./notifications-bridge`.

- [ ] **Step 8: Write the bridge and mount it**

Create `apps/mobile/src/notifications/notifications-bridge.tsx`:

```tsx
import { useEffect } from 'react';
import { api } from '@/lib/session';
import { useOffline } from '@/offline/context';
import { rnAppState } from '@/offline/native/ports';
import { nativePush, pushTokenStore } from './native';
import { startPushRegistration } from './push-registration';

/**
 * Spec §7.2: mounted inside OfflineProvider, so it runs after login and at every start while signed in, once the user's
 * local store is ready. It renders nothing and never blocks the app.
 */
export function NotificationsBridge() {
  const services = useOffline();
  useEffect(() => startPushRegistration({ push: nativePush, tokens: pushTokenStore, api, appState: rnAppState() }), [services.userId]);
  return null;
}
```

In `apps/mobile/app/(app)/_layout.tsx`, add `import { NotificationsBridge } from '@/notifications/notifications-bridge';` after the `OfflineProvider` import. Then replace

```tsx
    <OfflineProvider userId={s.me.user.id} timeZone={s.me.tenant.timezone}>
      <Tabs
```

with

```tsx
    <OfflineProvider userId={s.me.user.id} timeZone={s.me.tenant.timezone}>
      <NotificationsBridge />
      <Tabs
```

- [ ] **Step 9: Run the tests, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/notifications && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/notifications apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat(mobile): register for Expo push after login and at every start, asking for permission once and retrying in the foreground" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Logout removes the phone's push device and clears the badge

**Files:**
- Create: `apps/mobile/src/notifications/settle-within.ts`
- Modify: `apps/mobile/src/notifications/push-registration.ts`, `apps/mobile/src/features/profile/profile-screen.tsx`
- Test: `apps/mobile/src/notifications/settle-within.test.ts`, `apps/mobile/src/notifications/push-registration.test.ts`, `apps/mobile/src/features/profile/profile-screen.test.tsx`

**Interfaces:**
- Consumes: `pushDevices.remove(expoToken: string): Promise<void>` (Part 1); `PushDeps`, `registerPush`, `pendingRegistration` (Task 4); `nativePush`, `pushTokenStore` (Task 2).
- Produces:
  - `type Settled = 'done' | 'failed' | 'timeout'`;
  - `settleWithin(p: Promise<unknown>, ms: number): Promise<Settled>`;
  - `PUSH_REMOVE_TIMEOUT_MS = 3_000`;
  - `unregisterPush(deps: PushDeps, timeoutMs?: number): Promise<void>` (never rejects).

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/notifications/settle-within.test.ts`:

```ts
import { settleWithin } from './settle-within';

describe('settleWithin', () => {
  afterEach(() => jest.useRealTimers());

  it('reports a promise that settles in time, and one that fails', async () => {
    expect(await settleWithin(Promise.resolve(1), 1_000)).toBe('done');
    expect(await settleWithin(Promise.reject(new Error('x')), 1_000)).toBe('failed');
  });

  it('gives up on a promise that never settles', async () => {
    jest.useFakeTimers();
    let result: string | null = null;
    void settleWithin(new Promise(() => undefined), 3_000).then((r) => (result = r));
    await jest.advanceTimersByTimeAsync(2_999);
    expect(result).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(result).toBe('timeout');
  });
});
```

Append to `apps/mobile/src/notifications/push-registration.test.ts`. First, change the import of `./push-registration` to:

```ts
import { registerPush, startPushRegistration, unregisterPush } from './push-registration';
```

Then append:

```ts
describe('unregisterPush', () => {
  afterEach(() => jest.useRealTimers());

  it("removes this phone's device with the stored token, forgets the token and clears the badge", async () => {
    const push = fakePush();
    const tokens = fakeTokens(PUSH_TOKEN);
    const api = fakePushApi();
    await unregisterPush({ push, tokens, api });
    expect(api.pushDevices.remove).toHaveBeenCalledWith(PUSH_TOKEN);
    expect(tokens.value).toBeNull();
    expect(push.setBadge).toHaveBeenCalledWith(0);
  });

  it('asks nothing when this phone never registered, and never throws when the removal fails', async () => {
    const api = fakePushApi();
    await unregisterPush({ push: fakePush(), tokens: fakeTokens(), api });
    expect(api.pushDevices.remove).not.toHaveBeenCalled();
    api.pushDevices.remove.mockRejectedValueOnce(ApiError.network());
    const tokens = fakeTokens(PUSH_TOKEN);
    await expect(unregisterPush({ push: fakePush(), tokens, api })).resolves.toBeUndefined();
    expect(tokens.value).toBeNull();
  });

  it('gives up on a removal that does not answer within 3 s', async () => {
    jest.useFakeTimers();
    const api = fakePushApi();
    api.pushDevices.remove.mockImplementation(() => new Promise(() => undefined));
    const tokens = fakeTokens(PUSH_TOKEN);
    let finished = false;
    void unregisterPush({ push: fakePush(), tokens, api }).then(() => (finished = true));
    await jest.advanceTimersByTimeAsync(2_999);
    expect(finished).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(finished).toBe(true);
    expect(tokens.value).toBeNull();
  });

  it('waits for a registration still running, so it cannot re-register a signed-out phone', async () => {
    const held = gate();
    const api = fakePushApi();
    const order: string[] = [];
    api.pushDevices.register.mockImplementationOnce(() => held.opened.then(() => void order.push('register')));
    api.pushDevices.remove.mockImplementationOnce(async () => void order.push('remove'));
    const tokens = fakeTokens();
    const push = fakePush();
    void registerPush({ push, tokens, api });
    await flush();
    const leaving = unregisterPush({ push, tokens, api });
    held.open();
    await leaving;
    expect(order).toEqual(['register', 'remove']);
    expect(api.pushDevices.remove).toHaveBeenCalledWith(PUSH_TOKEN);
    expect(tokens.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/notifications`
Expected: FAIL: cannot find module `./settle-within`, and `unregisterPush` is not exported.

- [ ] **Step 3: Write `settleWithin` and `unregisterPush`**

Create `apps/mobile/src/notifications/settle-within.ts`:

```ts
export type Settled = 'done' | 'failed' | 'timeout';

/** Waits for `p` at most `ms`, never rejecting: a logout or a tap must not hang on a request that does not end. */
export function settleWithin(p: Promise<unknown>, ms: number): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Settled>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  const settled = p.then(
    (): Settled => 'done',
    (): Settled => 'failed',
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}
```

In `apps/mobile/src/notifications/push-registration.ts`, add `import { settleWithin } from './settle-within';` after the `./ports` import, and append:

```ts
/** Spec §7.2 "best-effort with a short timeout": logout waits at most this long for the device removal in total. */
export const PUSH_REMOVE_TIMEOUT_MS = 3_000;

/**
 * Logout, before the session ends (the request still carries this user's token): DELETE /me/push-devices/:token with the
 * stored token, then forget it and clear the badge. Never rejects. A removal that fails is covered by the next sign-in's token claim.
 */
export async function unregisterPush({ push, tokens, api }: PushDeps, timeoutMs = PUSH_REMOVE_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(deadline - Date.now(), 0);
  const running = pendingRegistration();
  if (running) await settleWithin(running, left());
  await push.setBadge(0).catch((e: unknown) => console.warn('[push] Could not clear the app badge', message(e)));
  let token: string | null = null;
  try {
    token = await tokens.get();
  } catch (e) {
    console.warn('[push] Could not read the stored push token', message(e));
  }
  if (token) {
    const removed = await settleWithin(api.pushDevices.remove(token), left());
    if (removed !== 'done') console.warn(`[push] The device was not removed (${removed}); the next sign-in on this phone claims it`);
  }
  await tokens.clear().catch((e: unknown) => console.warn('[push] Could not forget the push token', message(e)));
}
```

- [ ] **Step 4: Run them and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/notifications`
Expected: PASS.

- [ ] **Step 5: Write the failing Profile tests**

In `apps/mobile/src/features/profile/profile-screen.test.tsx`, replace everything from the first line down to the end of the existing `beforeEach(…)` block with:

```tsx
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import '@/lib/i18n';
import type { FakePush, FakeTokens } from '@/notifications/testing/fakes';
import { PUSH_TOKEN } from '@/notifications/testing/fakes';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ProfileScreen } from './profile-screen';

const mockSignOut = jest.fn();
const mockForceSignedOut = jest.fn();
const mockRemove = jest.fn();
const mockEvents: string[] = [];
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/session', () => ({
  api: { pushDevices: { remove: (...a: unknown[]) => mockRemove(...a) } },
  session: { signOut: () => mockSignOut(), forceSignedOut: () => mockForceSignedOut() },
  useSession: () => ({
    status: 'authenticated',
    offline: false,
    me: {
      user: { fullName: 'Aysel Əliyeva', jobTitle: null, username: 'aysel', email: null, emailNotifications: true },
      role: { name: 'Worker', systemKey: 'worker' },
      tenant: { name: 'Acme' },
      permissions: [],
    },
  }),
}));
jest.mock('@/notifications/native', () => {
  const { fakePush, fakeTokens } = jest.requireActual<typeof import('@/notifications/testing/fakes')>('@/notifications/testing/fakes');
  return { nativePush: fakePush(), pushTokenStore: fakeTokens(), openSettings: jest.fn(async () => undefined) };
});
const native = jest.requireMock<{ nativePush: FakePush; pushTokenStore: FakeTokens; openSettings: jest.Mock }>('@/notifications/native');

const press = (buttons: AlertButton[] | undefined, text: string) => act(async () => buttons!.find((b) => b.text === text)!.onPress?.());

beforeEach(() => {
  mockEvents.length = 0;
  mockSignOut.mockReset();
  mockSignOut.mockImplementation(async () => void mockEvents.push('signOut'));
  mockForceSignedOut.mockReset();
  mockRemove.mockReset();
  mockRemove.mockImplementation(async () => void mockEvents.push('remove'));
  native.pushTokenStore.value = null;
  native.nativePush.setBadge.mockClear();
});
```

Add inside `describe('logout', …)`:

```tsx
  it("removes this phone's push device before signing out, and clears the badge", async () => {
    const t = await createTestServices();
    await t.seed();
    native.pushTokenStore.value = PUSH_TOKEN;
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(mockRemove).toHaveBeenCalledWith(PUSH_TOKEN);
    expect(mockEvents).toEqual(['remove', 'signOut']);
    expect(native.nativePush.setBadge).toHaveBeenCalledWith(0);
    expect(native.pushTokenStore.value).toBeNull();
  });

  it('still signs out when removing the push device fails', async () => {
    const t = await createTestServices();
    await t.seed();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    native.pushTokenStore.value = PUSH_TOKEN;
    mockRemove.mockRejectedValueOnce(new Error('offline'));
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(mockSignOut).toHaveBeenCalled());
    expect(await t.services.store.occurrences()).toEqual([]);
    warn.mockRestore();
  });

  it('removes the device only after the worker confirmed deleting unsynced data', async () => {
    const t = await createTestServices();
    await t.seed();
    await t.services.store.start(OCC, ME);
    native.pushTokenStore.value = PUSH_TOKEN;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWithServices(t.services, <ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Çıxış' }));
    await eventually(async () => expect(alert).toHaveBeenCalledTimes(1));
    await press(alert.mock.calls[0]![2], 'Ləğv et');
    expect(mockRemove).not.toHaveBeenCalled();
    alert.mockRestore();
  });
```

- [ ] **Step 6: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/profile/profile-screen.test.tsx`
Expected: FAIL in `removes this phone's push device before signing out…`: `mockRemove` is never called. The earlier tests still pass.

- [ ] **Step 7: Remove the device in the logout flow**

In `apps/mobile/src/features/profile/profile-screen.tsx`:

1. Replace `import { session, useSession } from '@/lib/session';` with `import { api, session, useSession } from '@/lib/session';`.
2. Add after `import { colors, spacing } from '@/lib/theme';`:

   ```ts
   import { nativePush, pushTokenStore } from '@/notifications/native';
   import { unregisterPush } from '@/notifications/push-registration';
   ```

3. In `finish`, replace

   ```ts
       const finish = async () => {
         let cleared = false;
   ```

   with

   ```ts
       const finish = async () => {
         // Spec §7.2: before the session ends, so the request still carries this user's token. Never throws, at most 3 s.
         await unregisterPush({ push: nativePush, tokens: pushTokenStore, api });
         let cleared = false;
   ```

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/features/profile src/notifications && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/notifications apps/mobile/src/features/profile
git commit -m "feat(mobile): logout removes the phone's push device within 3 s and clears the app badge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tap routing, the launch tap and foreground receipts

**Files:**
- Create: `apps/mobile/src/notifications/notification-router.ts`
- Modify: `apps/mobile/src/notifications/notifications-bridge.tsx`, `apps/mobile/src/notifications/testing/fakes.ts`
- Test: `apps/mobile/src/notifications/notification-router.test.ts`, `apps/mobile/src/notifications/notifications-bridge.test.tsx`

**Interfaces:**
- Consumes:
  - `readPushData`, `NotificationEvents`, `TapResponse`, `notificationEvents` (Task 2);
  - `settleWithin` (Task 5);
  - `OfflineServices.{userId, syncNow, store.occurrences, tasks.task, newId}`;
  - `type NotificationTargetKind` (Part 1).
- Produces:
  - `SYNC_WAIT_MS = 5_000`;
  - `type NotificationRoute`;
  - `INBOX: NotificationRoute` (`{ pathname: '/notifications' }`) and `HOME: NotificationRoute` (`{ pathname: '/' }`);
  - `interface NotificationTarget { targetKind: NotificationTargetKind; targetId: string | null }`;
  - `interface RouteContext`;
  - `createRouteContext(services, canManageTasks: () => boolean): RouteContext`;
  - `routeForTarget(target: NotificationTarget, ctx: RouteContext): Promise<NotificationRoute>`;
  - `routeForPush(raw: unknown, ctx: RouteContext): Promise<NotificationRoute>`;
  - `startTapRouting(o: { events: NotificationEvents; ctx: RouteContext; navigate: (route: NotificationRoute) => void }): () => void`;
  - fakes `fakeEvents(last?)`/`FakeEvents`.

- [ ] **Step 1: Add the event fake**

Append to `apps/mobile/src/notifications/testing/fakes.ts`, and add `NotificationEvents` and `TapResponse` to its `../ports` type import:

```ts
export type FakeEvents = NotificationEvents & { last: TapResponse | null; cleared: number; tap(r: TapResponse): void; receive(data: unknown): void };

export function fakeEvents(last: TapResponse | null = null): FakeEvents {
  const responses = new Set<(r: TapResponse) => void>();
  const received = new Set<(data: unknown) => void>();
  const events: FakeEvents = {
    last,
    cleared: 0,
    lastResponse: () => events.last,
    clearLastResponse: () => {
      events.last = null;
      events.cleared += 1;
    },
    onResponse: (listener) => {
      responses.add(listener);
      return () => {
        responses.delete(listener);
      };
    },
    onReceived: (listener) => {
      received.add(listener);
      return () => {
        received.delete(listener);
      };
    },
    tap: (r) => responses.forEach((l) => l(r)),
    receive: (data) => received.forEach((l) => l(data)),
  };
  return events;
}
```

The import line becomes:

```ts
import type { NotificationEvents, PushPermission, PushPort, PushTokenStore, TapResponse } from '../ports';
```

- [ ] **Step 2: Write the failing router tests**

Create `apps/mobile/src/notifications/notification-router.test.ts`:

```ts
import { ME, OCC, OCC2, OCC3, occurrence, OTHER, pushData, syncResponse, syncTask, TASK, TASK2, versionOf } from '@/offline/testing/fixtures';
import { createTestServices } from '@/offline/testing/test-services';
import { createRouteContext, HOME, INBOX, type RouteContext, routeForPush, routeForTarget, startTapRouting } from './notification-router';
import { fakeEvents } from './testing/fakes';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** OCC started on this phone, OCC2 not started, TASK mine; the server answers every pull with the same. */
async function world(o: { manager?: boolean; serverAlsoHas?: 'OCC3' } = {}) {
  const t = await createTestServices({ online: true });
  const seeded = syncResponse({
    occurrences: [occurrence(), occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması' })],
    checklistVersions: [versionOf(t.c.content)],
    tasks: [syncTask()],
  });
  await t.seed(seeded);
  t.api.sync = seeded; // the claim's own sync must not drop OCC2
  await t.services.store.start(OCC, ME);
  await t.services.engine.idle();
  if (o.serverAlsoHas) t.api.sync = { ...seeded, occurrences: [...seeded.occurrences, occurrence({ id: OCC3, checklistName: 'Anbar yoxlaması' })] };
  const ctx = createRouteContext(t.services, () => o.manager ?? false);
  const pulls = () => t.api.calls.filter((c) => c.method === 'pull').length;
  return { t, ctx, pulls };
}

const stubCtx = (over: Partial<RouteContext> = {}): RouteContext => ({
  userId: ME,
  canManageTasks: () => false,
  sync: jest.fn(async () => undefined),
  occurrenceOnPhone: jest.fn(async () => 'execution' as const),
  taskOnPhone: jest.fn(async () => true),
  nonce: () => 'nonce-1',
  ...over,
});

describe('where a notification leads (spec §7.3)', () => {
  it('opens a started checklist by its occurrence id, after syncing first', async () => {
    const { ctx, pulls } = await world();
    const before = pulls();
    expect(await routeForPush(pushData({ targetId: OCC }), ctx)).toEqual({ pathname: '/execution/[id]', params: { id: OCC } });
    expect(pulls()).toBe(before + 1);
  });

  it('sends a not-yet-started checklist to Home, where its Başla is', async () => {
    const { ctx } = await world();
    expect(await routeForPush(pushData({ targetId: OCC2 }), ctx)).toEqual(HOME);
  });

  it('finds an occurrence that only the sync brings', async () => {
    const { ctx } = await world({ serverAlsoHas: 'OCC3' });
    expect(await routeForPush(pushData({ targetId: OCC3 }), ctx)).toEqual(HOME);
  });

  it('opens the inbox for an occurrence this phone does not hold (a manager’s problem notice)', async () => {
    const { ctx } = await world();
    expect(await routeForPush(pushData({ type: 'problem.critical', targetId: OCC3 }), ctx)).toEqual(INBOX);
  });

  it('opens a task on the phone', async () => {
    const { ctx } = await world();
    expect(await routeForPush(pushData({ type: 'task.assigned', targetKind: 'task', targetId: TASK, targetDate: null }), ctx)).toEqual({
      pathname: '/task/[id]',
      params: { id: TASK },
    });
  });

  it('opens the review screen for a task not on the phone when the user manages tasks, and the inbox otherwise', async () => {
    const manager = await world({ manager: true });
    const route = await routeForPush(pushData({ type: 'task.submitted', targetKind: 'task', targetId: TASK2, targetDate: null }), manager.ctx);
    expect(route).toMatchObject({ pathname: '/review/[id]', params: { id: TASK2 } });
    const worker = await world();
    expect(await routeForPush(pushData({ type: 'task.completed', targetKind: 'task', targetId: TASK2, targetDate: null }), worker.ctx)).toEqual(INBOX);
  });

  it('keeps a message without a target in the inbox, without syncing', async () => {
    const { ctx, pulls } = await world();
    const before = pulls();
    expect(await routeForPush(pushData({ type: 'manual', targetKind: 'none', targetId: null, targetDate: null }), ctx)).toEqual(INBOX);
    expect(pulls()).toBe(before);
  });

  it('a push for another user opens the inbox without syncing; unreadable data too', async () => {
    const { ctx, pulls } = await world();
    const before = pulls();
    expect(await routeForPush(pushData({ userId: OTHER }), ctx)).toEqual(INBOX);
    expect(await routeForPush({ note: 'Expo push tool' }, ctx)).toEqual(INBOX);
    expect(pulls()).toBe(before);
  });

  it('stops waiting for the sync after 5 s', async () => {
    jest.useFakeTimers();
    try {
      const ctx = stubCtx({ sync: () => new Promise(() => undefined) });
      let route: unknown = null;
      void routeForTarget({ targetKind: 'occurrence', targetId: OCC }, ctx).then((r) => (route = r));
      await jest.advanceTimersByTimeAsync(4_999);
      expect(route).toBeNull();
      await jest.advanceTimersByTimeAsync(1);
      expect(route).toEqual({ pathname: '/execution/[id]', params: { id: OCC } });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('startTapRouting', () => {
  it('handles the launching tap once, even when the listener delivers it too, and clears it', async () => {
    const launch = { identifier: 'launch-1', data: pushData() };
    const events = fakeEvents(launch);
    const navigate = jest.fn();
    const stop = startTapRouting({ events, ctx: stubCtx(), navigate });
    events.tap(launch);
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } });
    expect(events.cleared).toBe(1);
    expect(events.last).toBeNull();
    stop();
  });

  it('routes later taps, and none after it stopped', async () => {
    const events = fakeEvents();
    const navigate = jest.fn();
    const stop = startTapRouting({ events, ctx: stubCtx(), navigate });
    events.tap({ identifier: 'n1', data: pushData({ type: 'task.assigned', targetKind: 'task', targetId: TASK, targetDate: null }) });
    await flush();
    expect(navigate).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK } });
    stop();
    events.tap({ identifier: 'n2', data: pushData() });
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('syncs when a notification for the signed-in user arrives in the foreground, and not for another user', async () => {
    const events = fakeEvents();
    const ctx = stubCtx();
    const stop = startTapRouting({ events, ctx, navigate: jest.fn() });
    events.receive(pushData());
    events.receive(pushData({ userId: OTHER }));
    await flush();
    expect(ctx.sync).toHaveBeenCalledTimes(1);
    stop();
  });

  it('opens the inbox when the local store cannot be read', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const events = fakeEvents();
    const navigate = jest.fn();
    const stop = startTapRouting({ events, ctx: stubCtx({ occurrenceOnPhone: async () => Promise.reject(new Error('db')) }), navigate });
    events.tap({ identifier: 'n1', data: pushData() });
    await flush();
    expect(navigate).toHaveBeenCalledWith(INBOX);
    expect(error).toHaveBeenCalled();
    stop();
    error.mockRestore();
  });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/notification-router.test.ts`
Expected: FAIL: cannot find module `./notification-router`.

- [ ] **Step 4: Write the router**

Create `apps/mobile/src/notifications/notification-router.ts`:

```ts
import type { NotificationTargetKind } from '@taskop/contracts';
import type { OfflineServices } from '@/offline/services';
import type { NotificationEvents, TapResponse } from './ports';
import { readPushData } from './push-data';
import { settleWithin } from './settle-within';

/** Decision 4: a tap syncs first, but never waits longer than this (offline, or an API that does not answer). */
export const SYNC_WAIT_MS = 5_000;

export type NotificationRoute =
  | { pathname: '/notifications' }
  | { pathname: '/' }
  | { pathname: '/execution/[id]'; params: { id: string } }
  | { pathname: '/task/[id]'; params: { id: string } }
  | { pathname: '/review/[id]'; params: { id: string; n: string } };

export const INBOX: NotificationRoute = { pathname: '/notifications' };
export const HOME: NotificationRoute = { pathname: '/' };

export interface NotificationTarget {
  targetKind: NotificationTargetKind;
  targetId: string | null;
}

export interface RouteContext {
  /** The signed-in user. */
  userId: string;
  canManageTasks(): boolean;
  sync(): Promise<void>;
  /** 'execution' when the phone holds an execution of the occurrence, 'notStarted' when only the occurrence. */
  occurrenceOnPhone(id: string): Promise<'execution' | 'notStarted' | null>;
  taskOnPhone(id: string): Promise<boolean>;
  /** A fresh nonce for /review/[id] (SP5: every visit is a new screen). */
  nonce(): string;
}

export function createRouteContext(services: Pick<OfflineServices, 'userId' | 'syncNow' | 'store' | 'tasks' | 'newId'>, canManageTasks: () => boolean): RouteContext {
  return {
    userId: services.userId,
    canManageTasks,
    sync: () => services.syncNow('manual'),
    async occurrenceOnPhone(id) {
      const o = (await services.store.occurrences()).find((x) => x.id === id);
      if (!o) return null;
      return o.execution ? 'execution' : 'notStarted';
    },
    taskOnPhone: async (id) => (await services.tasks.task(id)) !== null,
    nonce: services.newId,
  };
}

/** Spec §7.3 with decisions 2–4. Used for pushes and for inbox rows. */
export async function routeForTarget(target: NotificationTarget, ctx: RouteContext): Promise<NotificationRoute> {
  if (target.targetKind === 'none' || target.targetId === null) return INBOX;
  const id = target.targetId;
  await settleWithin(ctx.sync(), SYNC_WAIT_MS);
  if (target.targetKind === 'occurrence') {
    const where = await ctx.occurrenceOnPhone(id);
    if (where === 'execution') return { pathname: '/execution/[id]', params: { id } };
    return where === 'notStarted' ? HOME : INBOX;
  }
  if (await ctx.taskOnPhone(id)) return { pathname: '/task/[id]', params: { id } };
  return ctx.canManageTasks() ? { pathname: '/review/[id]', params: { id, n: ctx.nonce() } } : INBOX;
}

/** A push meant for someone else, or data that is not a Taskop push, opens the inbox only. */
export async function routeForPush(raw: unknown, ctx: RouteContext): Promise<NotificationRoute> {
  const data = readPushData(raw);
  if (data === null || data.userId !== ctx.userId) return INBOX;
  return routeForTarget(data, ctx);
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/**
 * Taps (listener and the launch tap, each handled once and cleared) and foreground receipts (a sync).
 * Returns the stop function: nothing navigates after it was called (logout, user switch).
 */
export function startTapRouting(o: { events: NotificationEvents; ctx: RouteContext; navigate: (route: NotificationRoute) => void }): () => void {
  const handled = new Set<string>();
  let stopped = false;
  const open = (r: TapResponse) => {
    if (stopped || handled.has(r.identifier)) return;
    handled.add(r.identifier);
    try {
      o.events.clearLastResponse();
    } catch (e) {
      console.warn('[push] Could not clear the last notification response', message(e));
    }
    routeForPush(r.data, o.ctx).then(
      (route) => {
        if (!stopped) o.navigate(route);
      },
      (e: unknown) => {
        console.error('[push] Could not open a notification; showing the inbox', message(e));
        if (!stopped) o.navigate(INBOX);
      },
    );
  };
  const offResponse = o.events.onResponse(open);
  const offReceived = o.events.onReceived((raw) => {
    const data = readPushData(raw);
    if (stopped || (data !== null && data.userId !== o.ctx.userId)) return;
    o.ctx.sync().catch((e: unknown) => console.warn('[push] The sync after a notification failed', message(e)));
  });
  const launched = o.events.lastResponse();
  if (launched) open(launched);
  return () => {
    stopped = true;
    offResponse();
    offReceived();
  };
}
```

- [ ] **Step 5: Run the router tests and check they pass**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/notification-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing bridge tests**

Replace `apps/mobile/src/notifications/notifications-bridge.test.tsx` with:

```tsx
import '@/lib/i18n';
import { ME, OCC, occurrence, OTHER, pushData, syncResponse, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { NotificationsBridge } from './notifications-bridge';
import { type FakeEvents, PUSH_TOKEN } from './testing/fakes';

const mockRegister = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/session', () => ({
  api: { pushDevices: { register: (...a: unknown[]) => mockRegister(...a), remove: jest.fn() } },
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: [] } }),
}));
jest.mock('@/notifications/native', () => {
  const { fakeEvents, fakePush, fakeTokens } = jest.requireActual<typeof import('./testing/fakes')>('./testing/fakes');
  return { nativePush: fakePush(), pushTokenStore: fakeTokens(), notificationEvents: fakeEvents() };
});
jest.mock('@/offline/native/ports', () => ({ rnAppState: () => ({ subscribe: () => () => undefined }) }));
const native = jest.requireMock<{ notificationEvents: FakeEvents }>('@/notifications/native');

beforeEach(() => {
  mockRegister.mockReset();
  mockRegister.mockResolvedValue(undefined);
  mockPush.mockReset();
  native.notificationEvents.last = null;
  native.notificationEvents.cleared = 0;
});

async function startedOnPhone() {
  const t = await createTestServices({ online: true });
  const res = syncResponse({ occurrences: [occurrence()], checklistVersions: [versionOf(t.c.content)] });
  await t.seed(res);
  t.api.sync = res;
  await t.services.store.start(OCC, ME);
  await t.services.engine.idle();
  return t;
}

describe('NotificationsBridge', () => {
  it('registers this phone for push once the signed-in app has opened, without waiting on anything', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <NotificationsBridge />);
    await eventually(async () => expect(mockRegister).toHaveBeenCalledWith({ expoToken: PUSH_TOKEN, platform: 'android' }));
  });

  it('opens the checklist whose notification launched the app, once the local store is ready (cold start)', async () => {
    const t = await startedOnPhone();
    native.notificationEvents.last = { identifier: 'launch-1', data: pushData() };
    await renderWithServices(t.services, <NotificationsBridge />);
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } }));
    native.notificationEvents.tap({ identifier: 'launch-1', data: pushData() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(native.notificationEvents.cleared).toBe(1);
  });

  it("opens only the inbox for the previous user's notification on a shared phone", async () => {
    const t = await startedOnPhone();
    await renderWithServices(t.services, <NotificationsBridge />);
    native.notificationEvents.tap({ identifier: 'n-other', data: pushData({ userId: OTHER }) });
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/notifications' }));
  });

  it('pulls when a notification arrives in the foreground', async () => {
    const t = await startedOnPhone();
    await renderWithServices(t.services, <NotificationsBridge />);
    const pulls = () => t.api.calls.filter((c) => c.method === 'pull').length;
    const before = pulls();
    native.notificationEvents.receive(pushData());
    await eventually(async () => expect(pulls()).toBe(before + 1));
  });
});
```

- [ ] **Step 7: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/notifications/notifications-bridge.test.tsx`
Expected: FAIL in the three new tests: the bridge does not route taps yet.

- [ ] **Step 8: Route taps from the bridge**

Replace `apps/mobile/src/notifications/notifications-bridge.tsx` with:

```tsx
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { api, useSession } from '@/lib/session';
import { useOffline } from '@/offline/context';
import { rnAppState } from '@/offline/native/ports';
import { nativePush, notificationEvents, pushTokenStore } from './native';
import { createRouteContext, startTapRouting } from './notification-router';
import { startPushRegistration } from './push-registration';

/**
 * Spec §7.2–7.3, mounted inside OfflineProvider: it runs after login and at every start while signed in, once the user's
 * local store is ready (so a cold-start tap can look the occurrence up). Registration, taps and foreground receipts.
 */
export function NotificationsBridge() {
  const services = useOffline();
  const s = useSession();
  const canManageTasks = useRef(false);
  canManageTasks.current = s.status === 'authenticated' && s.me.permissions.includes('tasks.manage');
  useEffect(() => startPushRegistration({ push: nativePush, tokens: pushTokenStore, api, appState: rnAppState() }), [services.userId]);
  useEffect(
    () =>
      startTapRouting({
        events: notificationEvents,
        ctx: createRouteContext(services, () => canManageTasks.current),
        navigate: (route) => router.push(route),
      }),
    [services],
  );
  return null;
}
```

- [ ] **Step 9: Run the tests, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/notifications && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/notifications
git commit -m "feat(mobile): open the occurrence, task or inbox a notification points to, also from a cold start, and sync on receipt" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Home bell and the inbox screen

**Files:**
- Create: `apps/mobile/src/features/notifications/notification-bell.tsx`, `apps/mobile/src/features/notifications/inbox-screen.tsx`, `apps/mobile/app/(app)/notifications.tsx`
- Modify: `apps/mobile/src/features/home/home-screen.tsx`, `apps/mobile/app/(app)/_layout.tsx`
- Test: `apps/mobile/src/features/notifications/notification-bell.test.tsx`, `apps/mobile/src/features/notifications/inbox-screen.test.tsx`, `apps/mobile/src/features/home/home-screen.test.tsx`

**Interfaces:**
- Consumes:
  - `notifications.list(query: NotificationListQuery): Promise<Page<NotificationItem>>`, `notifications.markRead(id)`, `notifications.markAllRead()` and `notifications.unreadCount(): Promise<UnreadCount>` (Part 1);
  - `useUnreadNotifications()` and `OfflineServices.setUnreadNotifications` (Task 3);
  - `createRouteContext`, `routeForTarget` and `INBOX` (Task 6);
  - `notificationItem()`, `NOTIFICATION*` (Task 1).
- Produces: `NotificationBell`; `InboxScreen`; `INBOX_PAGE_SIZE = 30`; the hidden route `/notifications`.

- [ ] **Step 1: Write the failing bell test**

Create `apps/mobile/src/features/notifications/notification-bell.test.tsx`:

```tsx
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { NotificationBell } from './notification-bell';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('Home bell', () => {
  it('shows the unread count from the last sync, caps it at 99+, and opens the inbox', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Bildirişlər, 0 oxunmamış' })).toBeTruthy();
    expect(screen.queryByTestId('notification-bell-count')).toBeNull();
    await act(async () => {
      await t.services.setUnreadNotifications(3);
    });
    expect(await screen.findByRole('button', { name: 'Bildirişlər, 3 oxunmamış' })).toBeTruthy();
    expect(within(screen.getByTestId('notification-bell-count')).getByText('3')).toBeTruthy();
    await act(async () => {
      await t.services.setUnreadNotifications(120);
    });
    expect(await within(screen.getByTestId('notification-bell-count')).findByText('99+')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bildirişlər, 120 oxunmamış' }));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });
});
```

- [ ] **Step 2: Write the failing inbox tests**

Create `apps/mobile/src/features/notifications/inbox-screen.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '@/lib/i18n';
import { ME, NOTIFICATION, NOTIFICATION2, NOTIFICATION3, notificationItem, OCC, syncResponse, syncTask, T, TASK, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { readUnreadNotifications } from '@/offline/unread';
import { InboxScreen } from './inbox-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  // The screen is focused while rendered in a test.
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
const mockList = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();
const mockUnreadCount = jest.fn();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: [] } }),
  api: {
    notifications: {
      list: (...a: unknown[]) => mockList(...a),
      markRead: (...a: unknown[]) => mockMarkRead(...a),
      markAllRead: (...a: unknown[]) => mockMarkAllRead(...a),
      unreadCount: (...a: unknown[]) => mockUnreadCount(...a),
    },
  },
}));

const A = notificationItem({ id: NOTIFICATION, title: 'Açılış yoxlaması açıldı', targetKind: 'occurrence', targetId: OCC });
const B = notificationItem({ id: NOTIFICATION2, type: 'task.assigned', title: 'Yeni tapşırıq', targetKind: 'task', targetId: TASK, targetDate: null, readAt: T.open });
const C = notificationItem({ id: NOTIFICATION3, type: 'manual', title: 'Admin mesajı', body: 'Sabah iclas var.', targetKind: 'none', targetId: null, targetDate: null });
const CURSOR = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4ea9';

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

const rowIds = () => screen.queryAllByTestId(/^notification-0/).map((e) => e.props.testID as string);

/** Online; OCC started on this phone; TASK mine; the server answers pulls with the same. */
async function world(o: { online?: boolean } = {}) {
  const t = await createTestServices({ online: o.online ?? true });
  const res = syncResponse({ checklistVersions: [versionOf(t.c.content)], tasks: [syncTask()] });
  await t.seed(res);
  t.api.sync = res;
  await t.services.store.start(OCC, ME);
  await t.services.engine.idle();
  return t;
}

beforeEach(() => {
  mockPush.mockReset();
  mockList.mockReset();
  mockList.mockResolvedValue({ items: [A, B], nextCursor: null });
  mockMarkRead.mockReset();
  mockMarkRead.mockResolvedValue(undefined);
  mockMarkAllRead.mockReset();
  mockMarkAllRead.mockResolvedValue(undefined);
  mockUnreadCount.mockReset();
  mockUnreadCount.mockResolvedValue({ count: 0 });
});

describe('Bildirişlər inbox', () => {
  it('offline it says a connection is needed and asks nothing', async () => {
    const t = await world({ online: false });
    await renderWithServices(t.services, <InboxScreen />);
    expect(await screen.findByText('Bildirişlərə baxmaq üçün internet bağlantısı tələb olunur.')).toBeTruthy();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('lists the newest 30 with unread rows bold, loads the next page at the end, and stops at the last page', async () => {
    mockList.mockImplementation(async (q: { cursor?: string }) => (q.cursor ? { items: [C], nextCursor: null } : { items: [A, B], nextCursor: CURSOR }));
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    expect(await screen.findByRole('button', { name: 'Oxunmamış: Açılış yoxlaması açıldı' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yeni tapşırıq' })).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('Açılış yoxlaması açıldı').props.style).fontWeight).toBe('700');
    expect(StyleSheet.flatten(screen.getByText('Yeni tapşırıq').props.style).fontWeight).toBe('500');
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(await screen.findByText('Admin mesajı')).toBeTruthy();
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(mockList.mock.calls).toEqual([[{ limit: 30 }], [{ cursor: CURSOR, limit: 30 }]]);
    expect(rowIds()).toEqual([`notification-${A.id}`, `notification-${B.id}`, `notification-${C.id}`]);
  });

  it('drops a next page that was loading when the list was refreshed, and asks for a page once', async () => {
    const next = gate();
    let first = [A, B];
    mockList.mockImplementation(async (q: { cursor?: string }) => {
      if (q.cursor) {
        await next.opened;
        return { items: [B, C], nextCursor: null };
      }
      return { items: first, nextCursor: CURSOR };
    });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await screen.findByText('Açılış yoxlaması açıldı');
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    await fireEvent(screen.getByTestId('notification-list'), 'endReached');
    expect(mockList.mock.calls.filter(([q]) => (q as { cursor?: string }).cursor)).toHaveLength(1);
    first = [C, A, B];
    mockUnreadCount.mockResolvedValue({ count: 2 });
    await fireEvent(screen.getByTestId('notification-list'), 'refresh');
    await eventually(async () => expect(rowIds()).toEqual([`notification-${C.id}`, `notification-${A.id}`, `notification-${B.id}`]));
    next.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rowIds()).toEqual([`notification-${C.id}`, `notification-${A.id}`, `notification-${B.id}`]);
    expect(await readUnreadNotifications(t.db)).toBe(2);
  });

  it('a tap marks the row read, refreshes the count and opens the started checklist', async () => {
    const t = await world();
    await t.services.setUnreadNotifications(1);
    await renderWithServices(t.services, <InboxScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Oxunmamış: Açılış yoxlaması açıldı' }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } }));
    expect(mockMarkRead).toHaveBeenCalledWith(A.id);
    expect(screen.getByRole('button', { name: 'Açılış yoxlaması açıldı' })).toBeTruthy();
    await eventually(async () => expect(await readUnreadNotifications(t.db)).toBe(0));
  });

  it('opens a task row, and keeps a message without a target in the inbox', async () => {
    mockList.mockResolvedValue({ items: [B, C], nextCursor: null });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Yeni tapşırıq' }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK } }));
    expect(mockMarkRead).not.toHaveBeenCalled(); // already read
    await fireEvent.press(screen.getByRole('button', { name: 'Oxunmamış: Admin mesajı' }));
    await eventually(async () => expect(mockMarkRead).toHaveBeenCalledWith(C.id));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('Hamısını oxunmuş et marks every row read and refreshes the count', async () => {
    const t = await world();
    await t.services.setUnreadNotifications(1);
    await renderWithServices(t.services, <InboxScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Hamısını oxunmuş et' }));
    await eventually(async () => expect(screen.getByRole('button', { name: 'Açılış yoxlaması açıldı' })).toBeTruthy());
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Hamısını oxunmuş et' }).props.accessibilityState.disabled).toBe(true);
    expect(await readUnreadNotifications(t.db)).toBe(0);
  });

  it('says when there is nothing, and offers a retry when the list cannot be loaded', async () => {
    mockList.mockRejectedValueOnce(ApiError.network()).mockResolvedValueOnce({ items: [], nextCursor: null });
    const t = await world();
    await renderWithServices(t.services, <InboxScreen />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yenidən cəhd et' }));
    expect(await screen.findByText('Bildiriş yoxdur')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/features/notifications`
Expected: FAIL: cannot find modules `./notification-bell` and `./inbox-screen`.

- [ ] **Step 4: Write the bell**

Create `apps/mobile/src/features/notifications/notification-bell.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';
import { useUnreadNotifications } from '@/offline/hooks';

/** Spec §7.4: the Home header bell with the unread count of the last sync, opening the inbox. */
export function NotificationBell() {
  const { t } = useTranslation();
  const count = useUnreadNotifications();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.notifications.bell', { count })}
      testID="notification-bell"
      onPress={() => router.push('/notifications')}
      style={styles.bell}
    >
      <Ionicons name="notifications-outline" size={26} color={colors.text} />
      {count > 0 ? (
        <View testID="notification-bell-count" style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : String(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.primaryText, fontSize: 11, fontWeight: '700' },
});
```

- [ ] **Step 5: Write the inbox**

Create `apps/mobile/src/features/notifications/inbox-screen.tsx`:

```tsx
import type { NotificationItem } from '@taskop/contracts';
import { formatDateTime } from '@taskop/i18n';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { ScreenHeader } from '@/features/tasks/screen-header';
import { api, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { createRouteContext, INBOX, routeForTarget } from '@/notifications/notification-router';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';

/** Spec §6.4: GET /me/notifications returns 30 per page. */
export const INBOX_PAGE_SIZE = 30;

const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/** Spec §7.4: the inbox, online only (it is not part of the offline store). */
export function InboxScreen() {
  const { t } = useTranslation();
  const services = useOffline();
  const session = useSession();
  const { online } = useSyncStatus();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  /** Bumped by every reload: a page requested before it is dropped when it arrives. */
  const generation = useRef(0);
  const moreInFlight = useRef(false);
  const opening = useRef(false);
  const canManageTasks = useRef(false);
  canManageTasks.current = session.status === 'authenticated' && session.me.permissions.includes('tasks.manage');
  const nowIso = () => new Date(services.clock.now()).toISOString();

  /** Decision 14: the bell and the badge follow the server's count at once, not at the next sync. */
  const refreshUnread = useCallback(async () => {
    try {
      await services.setUnreadNotifications((await api.notifications.unreadCount()).count);
    } catch (e) {
      console.warn('[notifications] Could not refresh the unread count', message(e));
    }
  }, [services]);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    setError(null);
    try {
      const page = await api.notifications.list({ limit: INBOX_PAGE_SIZE });
      if (gen !== generation.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      if (gen === generation.current) setError(mobileErrorText(t, e));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      if (online) void Promise.all([reload(), refreshUnread()]);
    }, [online, reload, refreshUnread]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([reload(), refreshUnread()]);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!online || cursor === null || moreInFlight.current) return;
    const gen = generation.current;
    moreInFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await api.notifications.list({ cursor, limit: INBOX_PAGE_SIZE });
      if (gen !== generation.current) return;
      setItems((current) => {
        const have = new Set((current ?? []).map((i) => i.id));
        return [...(current ?? []), ...page.items.filter((i) => !have.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch (e) {
      if (gen === generation.current) setError(mobileErrorText(t, e));
    } finally {
      if (gen === generation.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  };

  const markAll = async () => {
    setMarkingAll(true);
    setError(null);
    try {
      await api.notifications.markAllRead();
      const at = nowIso();
      setItems((current) => current?.map((i) => (i.readAt ? i : { ...i, readAt: at })) ?? current);
      await refreshUnread();
    } catch (e) {
      setError(mobileErrorText(t, e));
    } finally {
      setMarkingAll(false);
    }
  };

  /** Spec §7.4: a tap marks the row read and opens its target as a push would (§7.3). */
  const open = async (item: NotificationItem) => {
    if (opening.current) return;
    opening.current = true;
    setOpeningId(item.id);
    try {
      if (item.readAt === null) {
        const at = nowIso();
        setItems((current) => current?.map((i) => (i.id === item.id ? { ...i, readAt: at } : i)) ?? current);
        api.notifications.markRead(item.id).then(
          () => refreshUnread(),
          (e: unknown) => console.warn('[notifications] Could not mark a notification read', message(e)),
        );
      }
      const route = await routeForTarget(item, createRouteContext(services, () => canManageTasks.current));
      if (route.pathname !== INBOX.pathname) router.push(route);
    } catch (e) {
      console.error('[notifications] Could not open a notification', message(e));
    } finally {
      opening.current = false;
      setOpeningId(null);
    }
  };

  const hasUnread = items?.some((i) => i.readAt === null) ?? false;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <ScreenHeader title={t('notifications.title')} />
        {online && items && items.length > 0 ? (
          <PrimaryButton variant="outline" title={t('notifications.markAllRead')} onPress={() => void markAll()} disabled={markingAll || !hasUnread} />
        ) : null}
      </View>
      {!online ? (
        <Text style={[styles.muted, styles.pad]}>{t('mobile.notifications.online')}</Text>
      ) : items === null ? (
        <View style={styles.pad}>
          {error ? (
            <>
              <FormError message={error} />
              <PrimaryButton title={t('common.retry')} onPress={() => void reload()} />
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <FlatList
          testID="notification-list"
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => <InboxRow item={item} timeZone={services.timeZone} opening={openingId === item.id} onPress={() => void open(item)} />}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<Text style={styles.muted}>{t('notifications.empty')}</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : <FormError message={error} />}
        />
      )}
    </SafeAreaView>
  );
}

function InboxRow({ item, timeZone, opening, onPress }: { item: NotificationItem; timeZone: string; opening: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const unread = item.readAt === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `${t('mobile.notifications.unread')}: ${item.title}` : item.title}
      testID={`notification-${item.id}`}
      onPress={onPress}
      style={[styles.row, unread && styles.unreadRow]}
    >
      <View style={styles.rowTop}>
        {unread ? <View style={styles.dot} /> : null}
        <Text style={[styles.title, unread && styles.bold]}>{item.title}</Text>
        {opening ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <Text style={styles.body}>{item.body}</Text>
      <Text style={styles.muted}>{formatDateTime(item.createdAt, { locale: 'az', timeZone })}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  pad: { padding: spacing.lg, gap: spacing.md },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: { minHeight: 44, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  unreadRow: { borderColor: colors.primary },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  title: { fontSize: 16, fontWeight: '500', color: colors.text, flexShrink: 1 },
  bold: { fontWeight: '700' },
  body: { color: colors.text },
  muted: { color: colors.muted },
});
```

Create `apps/mobile/app/(app)/notifications.tsx`:

```tsx
import { InboxScreen } from '@/features/notifications/inbox-screen';

export default InboxScreen;
```

In `apps/mobile/app/(app)/_layout.tsx`, add after `<Tabs.Screen name="review/[id]" options={HIDDEN} />`:

```tsx
        <Tabs.Screen name="notifications" options={HIDDEN} />
```

- [ ] **Step 6: Put the bell on Home**

In `apps/mobile/src/features/home/home-screen.tsx`:

1. Add `import { NotificationBell } from '@/features/notifications/notification-bell';` after the `OccurrenceCard` import.
2. Replace

   ```tsx
         <View style={styles.top}>
           <Text style={styles.greeting}>{t('mobile.home.greeting', { name: firstName })}</Text>
           <SyncIndicator />
         </View>
   ```

   with

   ```tsx
         <View style={styles.top}>
           <Text style={styles.greeting}>{t('mobile.home.greeting', { name: firstName })}</Text>
           <View style={styles.tools}>
             <NotificationBell />
             <SyncIndicator />
           </View>
         </View>
   ```

3. Add to `styles` after `top: …,`:

   ```ts
     tools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
   ```

In `apps/mobile/src/features/home/home-screen.test.tsx`, add after the `jest.mock('@/lib/session', …)` block:

```tsx
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
```

And add inside `describe('My checklists', …)`:

```tsx
  it('shows the notification bell with the unread count next to the sync indicator', async () => {
    const t = await world();
    await t.services.setUnreadNotifications(2);
    await renderWithServices(t.services, <HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Bildirişlər, 2 oxunmamış' }));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/features && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/features/notifications apps/mobile/src/features/home apps/mobile/app/'(app)'/notifications.tsx apps/mobile/app/'(app)'/_layout.tsx
git commit -m "feat(mobile): Home bell with the unread count and the online inbox with paging, refresh and mark read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Profile: email notifications switch and push permission

**Files:**
- Create: `apps/mobile/src/notifications/use-push-permission.ts`
- Modify: `apps/mobile/src/lib/session.ts`, `apps/mobile/src/features/profile/profile-screen.tsx`
- Test: `apps/mobile/src/lib/session.test.ts`, `apps/mobile/src/features/profile/profile-screen.test.tsx`

**Interfaces:**
- Consumes:
  - `preferences.update(body: UpdatePreferencesInput): Promise<Preferences>` and `Me.user.emailNotifications` (Part 1);
  - `nativePush` and `openSettings()` (Task 2);
  - `unregisterPush` (Task 5).
- Produces:
  - `session.patchUser(patch: Partial<Me['user']>): Promise<void>`;
  - `type PushPermissionState = PushPermission | 'unavailable'`;
  - `usePushPermission(push: Pick<PushPort, 'isDevice' | 'permission'>): PushPermissionState | null`.

- [ ] **Step 1: Write the failing session test**

In `apps/mobile/src/lib/session.test.ts`, add inside `describe('mobile session', …)`:

```ts
  it('applies a preference the server confirmed to the profile and its offline copy', async () => {
    await session.signedIn({ accessToken: 'a', accessTokenExpiresAt: '2026-10-07T10:00:00.000Z', refreshToken: 'r1', me } as never);
    await session.patchUser({ emailNotifications: false });
    expect(session.get()).toMatchObject({ status: 'authenticated', me: { user: { username: 'elvin', emailNotifications: false } } });
    expect(JSON.parse(mockStore.get('taskop.me')!).user.emailNotifications).toBe(false);
  });

  it('ignores a profile change when nobody is signed in', async () => {
    await session.bootstrap();
    await session.patchUser({ emailNotifications: false });
    expect(session.get()).toEqual({ status: 'anonymous' });
    expect(mockStore.has('taskop.me')).toBe(false);
  });
```

- [ ] **Step 2: Write the failing Profile tests**

In `apps/mobile/src/features/profile/profile-screen.test.tsx`, replace everything from the first line through the end of the `beforeEach(…)` block (as written in Task 5) with:

```tsx
import { ApiError } from '@taskop/api-client';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Alert, type AlertButton, AppState } from 'react-native';
import '@/lib/i18n';
import type { FakePush, FakeTokens } from '@/notifications/testing/fakes';
import { PUSH_TOKEN } from '@/notifications/testing/fakes';
import { ME, OCC } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { ProfileScreen } from './profile-screen';

const mockSignOut = jest.fn();
const mockForceSignedOut = jest.fn();
const mockRemove = jest.fn();
const mockUpdate = jest.fn();
const mockPatchUser = jest.fn();
const mockEvents: string[] = [];
let mockUser = { fullName: 'Aysel Əliyeva', jobTitle: null as string | null, username: 'aysel', email: null as string | null, emailNotifications: true };
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/session', () => ({
  api: {
    pushDevices: { remove: (...a: unknown[]) => mockRemove(...a) },
    preferences: { update: (...a: unknown[]) => mockUpdate(...a) },
  },
  session: { signOut: () => mockSignOut(), forceSignedOut: () => mockForceSignedOut(), patchUser: (...a: unknown[]) => mockPatchUser(...a) },
  useSession: () => ({
    status: 'authenticated',
    offline: false,
    me: { user: mockUser, role: { name: 'Worker', systemKey: 'worker' }, tenant: { name: 'Acme' }, permissions: [] },
  }),
}));
jest.mock('@/notifications/native', () => {
  const { fakePush, fakeTokens } = jest.requireActual<typeof import('@/notifications/testing/fakes')>('@/notifications/testing/fakes');
  return { nativePush: fakePush(), pushTokenStore: fakeTokens(), openSettings: jest.fn(async () => undefined) };
});
const native = jest.requireMock<{ nativePush: FakePush; pushTokenStore: FakeTokens; openSettings: jest.Mock }>('@/notifications/native');

const press = (buttons: AlertButton[] | undefined, text: string) => act(async () => buttons!.find((b) => b.text === text)!.onPress?.());
const emailSwitch = () => screen.getByRole('switch', { name: 'E-poçt bildirişləri' });

beforeEach(() => {
  mockEvents.length = 0;
  mockSignOut.mockReset();
  mockSignOut.mockImplementation(async () => void mockEvents.push('signOut'));
  mockForceSignedOut.mockReset();
  mockRemove.mockReset();
  mockRemove.mockImplementation(async () => void mockEvents.push('remove'));
  mockUpdate.mockReset();
  mockPatchUser.mockReset();
  mockPatchUser.mockResolvedValue(undefined);
  mockUser = { fullName: 'Aysel Əliyeva', jobTitle: null, username: 'aysel', email: null, emailNotifications: true };
  native.pushTokenStore.value = null;
  native.nativePush.setBadge.mockClear();
  native.nativePush.isDevice = true;
  native.nativePush.permission.mockReset();
  native.nativePush.permission.mockResolvedValue('granted');
  native.openSettings.mockClear();
});
```

Append after `describe('logout', …)`:

```tsx
describe('notification settings', () => {
  it('turns email notifications off and keeps what the server answered', async () => {
    mockUpdate.mockResolvedValue({ emailNotifications: false });
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <ProfileScreen />);
    expect(emailSwitch().props.value).toBe(true);
    expect(screen.getByText('Hesabınızda e-poçt ünvanı yoxdur, ona görə e-poçt göndərilmir.')).toBeTruthy();
    await fireEvent(emailSwitch(), 'valueChange', false);
    await eventually(async () => expect(mockPatchUser).toHaveBeenCalledWith({ emailNotifications: false }));
    expect(mockUpdate).toHaveBeenCalledWith({ emailNotifications: false });
    expect(emailSwitch().props.value).toBe(false);
  });

  it('puts the switch back and shows the error when saving fails', async () => {
    mockUser = { ...mockUser, email: 'aysel@demo.taskop.az' };
    mockUpdate.mockRejectedValue(new ApiError(500, 'INTERNAL', 'errors.INTERNAL'));
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <ProfileScreen />);
    expect(screen.queryByText('Hesabınızda e-poçt ünvanı yoxdur, ona görə e-poçt göndərilmir.')).toBeNull();
    await fireEvent(emailSwitch(), 'valueChange', false);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(emailSwitch().props.value).toBe(true);
    expect(mockPatchUser).not.toHaveBeenCalled();
  });

  it('offline the switch is disabled and says a connection is needed', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <ProfileScreen />);
    expect(await screen.findByText('Dəyişmək üçün internet bağlantısı tələb olunur.')).toBeTruthy();
    expect(emailSwitch().props.disabled).toBe(true);
  });

  it('shows the push permission, opens the settings when it is denied, and reads it again on return', async () => {
    native.nativePush.permission.mockResolvedValue('denied');
    const t = await createTestServices();
    await renderWithServices(t.services, <ProfileScreen />);
    expect(await screen.findByText('Bağlıdır')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ayarları aç' }));
    expect(native.openSettings).toHaveBeenCalledTimes(1);
    native.nativePush.permission.mockResolvedValue('granted');
    const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)![1] as (state: string) => void;
    await act(async () => onChange('active'));
    expect(await screen.findByText('Açıqdır')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ayarları aç' })).toBeNull();
  });

  it('says push is not available on a simulator', async () => {
    native.nativePush.isDevice = false;
    const t = await createTestServices();
    await renderWithServices(t.services, <ProfileScreen />);
    expect(await screen.findByText('Bu cihazda dəstəklənmir')).toBeTruthy();
    expect(native.nativePush.permission).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run them and check they fail**

Run: `pnpm --filter @taskop/mobile test -- src/lib/session.test.ts src/features/profile`
Expected: FAIL: `session.patchUser is not a function`; no switch named "E-poçt bildirişləri"; no text "Bağlıdır". The logout tests still pass.

- [ ] **Step 4: Add `patchUser` to the session**

In `apps/mobile/src/lib/session.ts`, add to the `session` object after `refreshMe`:

```ts
  /** Applies a change the server confirmed (PATCH /me/preferences) to the signed-in profile and its offline copy. */
  async patchUser(patch: Partial<Me['user']>): Promise<void> {
    if (state.status !== 'authenticated') return;
    const me: Me = { ...state.me, user: { ...state.me.user, ...patch } };
    set({ ...state, me });
    await cacheMe(me).catch((e: unknown) => console.warn('[session] Could not cache the profile', e instanceof Error ? e.message : 'unknown error'));
  },
```

- [ ] **Step 5: Write the permission hook**

Create `apps/mobile/src/notifications/use-push-permission.ts`:

```ts
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { PushPermission, PushPort } from './ports';

export type PushPermissionState = PushPermission | 'unavailable';

/** The OS notification permission, read again whenever the app returns to the foreground (e.g. from the Settings app). */
export function usePushPermission(push: Pick<PushPort, 'isDevice' | 'permission'>): PushPermissionState | null {
  const [state, setState] = useState<PushPermissionState | null>(push.isDevice ? null : 'unavailable');
  useEffect(() => {
    if (!push.isDevice) return undefined;
    let alive = true;
    const read = () => {
      push.permission().then(
        (p) => {
          if (alive) setState(p);
        },
        (e: unknown) => console.warn('[push] Could not read the notification permission', e instanceof Error ? e.message : 'unknown error'),
      );
    };
    read();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [push]);
  return state;
}
```

- [ ] **Step 6: Rewrite the Profile screen**

Replace `apps/mobile/src/features/profile/profile-screen.tsx` with:

```tsx
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { FormError, mobileErrorText } from '@/components/form-error';
import { PrimaryButton } from '@/components/primary-button';
import { Screen } from '@/components/screen';
import { api, session, useSession } from '@/lib/session';
import { colors, spacing } from '@/lib/theme';
import { nativePush, openSettings, pushTokenStore } from '@/notifications/native';
import { unregisterPush } from '@/notifications/push-registration';
import { usePushPermission } from '@/notifications/use-push-permission';
import { useOffline } from '@/offline/context';
import { useSyncStatus } from '@/offline/hooks';

export function ProfileScreen() {
  const { t } = useTranslation();
  const s = useSession();
  const services = useOffline();
  const { online } = useSyncStatus();
  const permission = usePushPermission(nativePush);
  const busy = useRef(false);
  const [isBusy, setBusy] = useState(false);
  const [email, setEmail] = useState(s.status === 'authenticated' ? s.me.user.emailNotifications : true);
  const saving = useRef(false);
  const [isSaving, setSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  if (s.status !== 'authenticated') return null;
  const { me } = s;
  const rows: [string, string][] = [
    [t('mobile.profile.role'), me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name],
    [t('mobile.profile.organization'), me.tenant.name],
    [t('mobile.profile.login'), me.user.username ?? me.user.email ?? ''],
  ];

  /** Spec §7.4 + decision 13: online only, optimistic, reverted when the server refuses. */
  const changeEmail = async (next: boolean) => {
    if (saving.current) return;
    saving.current = true;
    setSaving(true);
    setEmailError(null);
    setEmail(next);
    try {
      const saved = await api.preferences.update({ emailNotifications: next });
      setEmail(saved.emailNotifications);
      await session.patchUser({ emailNotifications: saved.emailNotifications });
    } catch (e) {
      setEmail(!next);
      setEmailError(mobileErrorText(t, e));
    } finally {
      saving.current = false;
      setSaving(false);
    }
  };

  /** Spec §7.4: unsynced data blocks logout until the worker confirms twice; local data never outlives the session. */
  const logout = async () => {
    if (busy.current) return;
    busy.current = true;
    setBusy(true);
    const release = () => {
      busy.current = false;
      setBusy(false);
    };
    const finish = async () => {
      // Spec §7.2: before the session ends, so the request still carries this user's token. Never throws, at most 3 s.
      await unregisterPush({ push: nativePush, tokens: pushTokenStore, api });
      let cleared = false;
      try {
        await services.clearAll();
        cleared = true;
      } catch (e) {
        // The worker already confirmed; the next sign-in clears another user's data anyway (ensureUser).
        console.error('[offline] Could not clear local data on logout', e instanceof Error ? e.message : 'unknown error');
      }
      try {
        await session.signOut();
      } catch (e) {
        console.error('[session] Sign-out failed', e instanceof Error ? e.message : 'unknown error');
        Alert.alert(t('errors.INTERNAL', { requestId: '—' }));
        // The local data is gone and the services are stopped: staying signed in would silently lose later work.
        if (cleared) session.forceSignedOut();
      } finally {
        release();
      }
    };
    const confirmDelete = () =>
      Alert.alert(
        t('mobile.logout.confirmTitle'),
        t('mobile.logout.confirmBody'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: release },
          { text: t('mobile.logout.confirm'), style: 'destructive', onPress: () => void finish() },
        ],
        { cancelable: false },
      );
    let unsynced: number | null;
    try {
      unsynced = await services.store.unsyncedCount();
    } catch (e) {
      console.error('[offline] Could not count unsynced data on logout', e instanceof Error ? e.message : 'unknown error');
      unsynced = null; // Unknown: assume unsynced data may exist.
    }
    if (unsynced === 0) {
      await finish();
      return;
    }
    if (unsynced === null) {
      confirmDelete();
      return;
    }
    Alert.alert(
      t('mobile.logout.unsyncedTitle'),
      t('mobile.logout.unsyncedBody', { count: unsynced }),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: release },
        { text: t('mobile.logout.continue'), style: 'destructive', onPress: confirmDelete },
      ],
      { cancelable: false },
    );
  };
  return (
    <Screen>
      <Text style={styles.name}>{me.user.fullName}</Text>
      {me.user.jobTitle ? <Text style={styles.muted}>{me.user.jobTitle}</Text> : null}
      <View style={styles.card}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>{t('notifications.title')}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.value}>{t('mobile.notifications.profile.email')}</Text>
          <Switch
            accessibilityLabel={t('mobile.notifications.profile.email')}
            value={email}
            disabled={!online || isSaving}
            onValueChange={(next) => void changeEmail(next)}
          />
        </View>
        {me.user.email ? null : <Text style={styles.muted}>{t('mobile.notifications.profile.noEmail')}</Text>}
        {online ? null : <Text style={styles.muted}>{t('mobile.notifications.profile.online')}</Text>}
        <FormError message={emailError} />
        <View style={styles.row}>
          <Text style={styles.muted}>{t('mobile.notifications.profile.push')}</Text>
          <Text testID="push-permission" style={styles.value}>
            {permission ? t(`mobile.notifications.profile.pushStates.${permission}`) : '—'}
          </Text>
        </View>
        {permission === 'denied' ? (
          <>
            <Text style={styles.muted}>{t('mobile.notifications.profile.deniedHint')}</Text>
            <PrimaryButton variant="outline" title={t('mobile.notifications.profile.openSettings')} onPress={() => void openSettings()} />
          </>
        ) : null}
      </View>
      <PrimaryButton variant="outline" title={t('mobile.profile.changeSecret')} onPress={() => router.push('/change-secret')} />
      <PrimaryButton title={t('mobile.profile.logout')} disabled={isBusy} onPress={() => void logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: spacing.md },
  section: { fontSize: 16, fontWeight: '600', color: colors.text },
  value: { color: colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
});
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm --filter @taskop/mobile test -- src/lib src/features/profile src/notifications && pnpm --filter @taskop/mobile typecheck && pnpm --filter @taskop/mobile lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/lib/session.ts apps/mobile/src/lib/session.test.ts apps/mobile/src/notifications/use-push-permission.ts apps/mobile/src/features/profile
git commit -m "feat(mobile): email notification switch and push permission state with a settings link in Profile" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification and the manual device checklist

**Files:**
- None created by the plan. The user adds the EAS `projectId` to `apps/mobile/app.json` (Step 2), and that is committed. Findings go into the pull request description. A real defect found here becomes a fix in the task that owns the file, with its own test and commit.

**Interfaces:**
- Consumes: everything above. Also:
  - a running API with all of Part 1 merged (`JOBS_ENABLED=true`, `NOTIFICATIONS_PUSH_ENABLED=true`) and its seed (`pnpm db:seed`: manager `manager@demo.taskop.az` / `DemoPassword123`, workers `elvin` and `nigar` at org code `demo` with PIN `482915`);
  - the web app from Part 3 for sending messages and changing rules. Without Part 3, use the API endpoints directly.
- Produces: verified development builds on a real iPhone and a real Android phone.

- [ ] **Step 1: Run every automated check**

```bash
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
pnpm --filter @taskop/i18n test
pnpm --filter @taskop/mobile test
pnpm --filter @taskop/mobile typecheck
pnpm --filter @taskop/mobile lint
pnpm --filter @taskop/mobile exec expo install --check
pnpm --filter @taskop/mobile exec expo config --type prebuild > /dev/null
grep -rln "from 'expo-notifications'\|from 'expo-device'" apps/mobile/src apps/mobile/app
```

Expected: all suites pass with none skipped, and Jest reports no open handles. `expo install --check` reports up-to-date dependencies. The `grep` prints exactly `apps/mobile/src/notifications/native.ts`.

- [ ] **Step 2: Accounts and credentials (the user does these once; spec §10)**

1. **EAS project:**
   - In `apps/mobile`, run `npx eas-cli@latest login` and then `npx eas-cli@latest init`.
   - `app.config.ts` exists, so `eas init` prints the project id instead of writing it. Add it to `apps/mobile/app.json` under `expo`: `"owner": "<your Expo account>"` and `"extra": { "eas": { "projectId": "<id>" } }`.
   - Check: `pnpm --filter @taskop/mobile exec expo config --type public | grep projectId` prints the id.
   - Commit it: `git add apps/mobile/app.json && git commit -m "chore(mobile): EAS project id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
2. **APNs:**
   - In the Apple Developer account, go to Certificates, IDs & Profiles → Keys, and create a key with Apple Push Notifications service (APNs). Download the `.p8` file and never commit it (`*.p8` is gitignored).
   - Run `npx eas-cli@latest credentials -p ios` → bundle id `az.taskop.app` → *Push Notifications: Manage your Apple Push Notifications Key* → upload the key.
   - The development build's signing team must be the paid team: a personal team cannot sign the push entitlement.
3. **FCM V1:**
   - In the Firebase console, create a project and add an Android app with package `az.taskop.app`. Download `google-services.json` to `apps/mobile/google-services.json`; it is gitignored.
   - Go to Project settings → Service accounts → *Generate new private key*.
   - Run `npx eas-cli@latest credentials -p android` → *Google Service Account* → *Manage your Google Service Account Key for Push Notifications (FCM V1)* → upload that JSON. Never commit it.
   - For later EAS builds, also run `npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment development --environment preview --environment production`.
4. **API:** in `apps/api/.env`, set `JOBS_ENABLED=true` and `NOTIFICATIONS_PUSH_ENABLED=true`. `EXPO_ACCESS_TOKEN` stays empty unless enhanced push security is switched on in the Expo account.

- [ ] **Step 3: Build and start the stack for phones on the LAN**

```bash
docker compose up -d
ipconfig getifaddr en0                     # e.g. 192.168.1.20
# apps/api/.env:    S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333
# apps/mobile/.env: EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
pnpm db:setup && pnpm db:seed
pnpm --filter @taskop/api dev
pnpm --filter @taskop/mobile exec expo prebuild --clean
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
pnpm --filter @taskop/mobile android -- --device
```

Expected: both phones install the development build. `expo prebuild --clean` regenerates `ios/` and `android/` with the notifications plugin, the `aps-environment` entitlement and the Firebase file.

- [ ] **Step 4: Run the manual device checklist (spec §9)**

Tick each item in the PR description, with the phone model and OS version.

1. **First start asks once.**
   - On a fresh install, sign in as `elvin`. Expected: one permission prompt, on iOS and on Android 13+.
   - Allow it. Expected: Profile shows "Push bildirişləri: Açıqdır".
   - Check the server: `psql "$DATABASE_OWNER_URL" -c "select platform, disabled_at from push_devices"` shows the phone.
   - Kill and reopen the app. Expected: no second prompt.
2. **Foreground banner.**
   - With the app open on Home, assign a task to `elvin` on the web. Expected within about 10 s: a banner with sound; the bell's count grows by one; the task appears under Tapşırıqlar without a manual sync.
3. **Tap from a closed app: occurrence.**
   - Kill the app. Let a checklist of `elvin` become available or due soon, or overdue (shorten the shift on the web to force it).
   - Tap the notification. Expected: the app opens straight on Home, with that checklist's "Başla", if it is not started. If `elvin` had started it, the app opens on its execution screen.
4. **Tap from a closed app: task.**
   - Kill the app, assign another task on the web, and tap the notification. Expected: the task screen of that task.
5. **Manager's notices.**
   - Sign in as `manager@demo.taskop.az` on the second phone.
   - Let `elvin` record a critical problem. Expected: a push on the manager's phone; tapping it opens the inbox, since the occurrence is not on the manager's phone.
   - Expected also: an email in Mailpit (`http://localhost:8025`) for the manager.
   - Let `elvin` submit a review task the manager created. Expected: tapping the push opens the Yoxlama screen with Təsdiqlə and Geri qaytar.
6. **Badge and inbox.**
   - Expected: the app icon shows the unread count.
   - Open the bell. Expected: unread rows are bold; pull to refresh works.
   - Send 35 messages to `elvin` from the web (Mesajlar). Expected: scrolling down loads the rest with no row twice.
   - Tap "Hamısını oxunmuş et". Expected: the bell and the icon badge clear.
   - In airplane mode, expected: the inbox says "Bildirişlərə baxmaq üçün internet bağlantısı tələb olunur.".
7. **Logout stops push.**
   - Log out on the phone, then send a message to `elvin` from the web. Expected: no push arrives, the app icon has no badge, and `push_devices` has no row for the phone.
8. **Switching users on one phone.**
   - With `elvin` signed in, turn on airplane mode and log out. The removal fails, and logout still finishes within about 3 s.
   - Turn airplane mode off and sign in as `nigar`.
   - Send one message to `elvin` and one to `nigar`. Expected: only `nigar`'s arrives.
   - While `nigar` is signed in, a push still on the lock screen from `elvin`'s session opens only the inbox.
9. **Denied permission.**
   - Reinstall and deny the prompt. Expected: Profile shows "Bağlıdır", the hint, and "Ayarları aç".
   - The button opens the app's page in the OS settings. Allow notifications there and return to the app. Expected: "Açıqdır" without a restart, and a message sent now arrives as push.
10. **Email switch.**
    - As the manager, turn "E-poçt bildirişləri" off in Profile. Let a critical problem be recorded. Expected: a push, but no new email in Mailpit.
    - The web user menu's "Bildiriş ayarları" shows the switch off.
    - In airplane mode, expected: the switch is disabled with "Dəyişmək üçün internet bağlantısı tələb olunur.".
11. **Simulator.**
    - Run `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios` on a simulator. Expected: no prompt, no error, and Profile shows "Bu cihazda dəstəklənmir".

- [ ] **Step 5: Record and finish**

Add the checklist results to the PR description. For each failed item, open a fix in the owning task's files, with a regression test where Jest can express it, and commit it as `fix(mobile): …`. Do not commit device-only notes, credentials, `google-services.json` or keys.

---

## Self-review

**Spec §7, §9 (mobile) and §10 coverage**

| Spec | Where |
|---|---|
| §7.1 `expo-notifications` and `expo-device` for SDK 57, config plugin | Task 2 (Steps 1, 5; `expo install --check`) |
| §7.1 `eas.json` profiles and EAS `projectId` in `extra.eas` | Task 2 (`eas.json`, `readProjectId`); Task 9 Step 2 (`eas init`) |
| §7.1 Android channel `default`, high importance, at startup | Task 2 (`configureNotifications`, `ensureChannel`); also before every registration (Task 4) |
| §7.1 foreground handler: banner, sound, list | Task 2 (`foregroundBehavior`, decision 5) |
| §7.2 after login and at each start: `isDevice`, permission once, token with `projectId`, `PUT /me/push-devices`; failures logged and retried; never blocks login | Task 4 (`registerPush`, `startPushRegistration`, bridge in `(app)/_layout`) |
| §7.2 logout: `DELETE /me/push-devices/:token`, best effort, short timeout, before the session is cleared | Task 5 (`unregisterPush`, Profile `finish`) |
| §7.2 simulators and denied permission skip silently | Task 4 tests (`skips a simulator silently`, `respects a denial silently`) |
| §7.3 foreground receipt → sync | Task 6 (`startTapRouting` → `ctx.sync`) |
| §7.3 tap: user mismatch → inbox; occurrence → sync, then execution if local; task → task; none → inbox; cold start | Task 6 (decisions 2–4, 9) |
| §7.3 badge after each sync; cleared on logout | Task 3 (engine hook, `setAppBadge`); Task 5 (`setBadge(0)`) |
| §7.4 Home bell with unread badge → `/notifications` | Task 7 (`NotificationBell`, hidden route) |
| §7.4 inbox: online-only, pull to refresh, infinite scroll, bold unread, "Hamısını oxunmuş et", tap marks read and routes, offline message | Task 7 (`InboxScreen`) |
| §7.4 Profile: email switch (`PATCH /me/preferences`), push permission, settings button when denied | Task 8 |
| §9 Jest: registration, logout, tap routing incl. cold start and mismatch, badge after sync, inbox online/offline/mark read/mark all, profile switch | Tasks 3–8 |
| §9 manual device checklist | Task 9 Step 4 |
| §10 accounts (APNs, FCM V1, `eas init`) | Task 9 Step 2 |

**Placeholder scan.** No "TBD", "TODO", "add validation" or "similar to Task N". Every edit to an existing file names the exact text it replaces or the anchor it follows. `<your Expo account>` and `<id>` in Task 9 Step 2 are values only the user's `eas init` produces.

**Type consistency.** These names are the same in every task that uses them:
- `PushPort`, `PushTokenStore`, `NotificationEvents`, `TapResponse` (Task 2);
- `PushDeps`, `RegisterOutcome`, `registerPush`, `pendingRegistration`, `startPushRegistration`, `unregisterPush`, `PUSH_REMOVE_TIMEOUT_MS` (Tasks 4–5);
- `settleWithin` (Task 5, used in Task 6);
- `RouteContext`, `createRouteContext`, `routeForTarget`, `routeForPush`, `startTapRouting`, `INBOX`, `HOME`, `SYNC_WAIT_MS` (Task 6, used in Task 7);
- `readUnreadNotifications`, `setUnreadNotifications`, `useUnreadNotifications`, `onUnreadNotifications` (Task 3, used in Task 7);
- `fakePush`, `fakeTokens`, `fakePushApi`, `fakeAppState`, `fakeEvents` (Tasks 4 and 6).

**Names used from Part 1 "Interfaces for Parts 2 and 3".**
- Contracts: `PushData`/`pushDataSchema`, `NotificationItem`, `NotificationTargetKind`, `NotificationListQuery` (`cursor`, `limit`), `UnreadCount`, `PushPlatform`, `RegisterPushDeviceInput`, `Preferences`, `UpdatePreferencesInput`, `SyncResponse.unreadNotifications`, `Me.user.emailNotifications`.
- i18n: `az.notifications.{title, markAllRead, empty}`.
- API client: `NotificationsApi`; `notifications.{list, unreadCount, markRead, markAllRead}`; `pushDevices.{register, remove}`; `preferences.update`.
- Server behaviour relied on: idempotent `PUT`/`DELETE` push devices with token claim; push `data: PushData` with `channelId: 'default'`; `markRead` 404/204.
- Existing repo names: `Page`, `ApiError`, `AppStatePort`, `rnAppState`, `ownedTransaction`, `NOT_OWNER`, `setMeta`, `useLiveQuery`, `useSyncStatus`, `ScreenHeader`, `HIDDEN`.

**Review Focus check.** Five uncovered input classes are listed, each with its pinning test in the owning task: the old cached profile (Task 1), the shared phone (Tasks 2 and 6), offline or hanging logout (Task 5), targets missing from the phone or not yet synced (Task 6), and inbox paging races (Task 7).

**Not needed from the shared interfaces.** The plan uses no endpoint, field or string beyond Part 1's section. The Android Firebase file and the EAS `projectId` are configuration that the user supplies (Task 9 Step 2).
