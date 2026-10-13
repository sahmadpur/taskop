# SP6 notifications: manual device checklist (mobile)

Everything here needs a real phone or your accounts, so Jest and the agents cannot run it. Spec: `docs/superpowers/specs/2026-10-13-notifications-design.md` (sections 9 and 10). Tick each item in the pull request description with the phone model and OS version. 
**Run this checklist after Part 3 (web) is complete on this branch.** Items marked (web) need the web app's Mesajlar page, rules or "Bildiriş ayarları" menu.

Never commit device notes, credentials, `google-services.json`, `.p8` or service-account keys.

## A. Prerequisites (once)

1. **EAS project.** In `apps/mobile`: `npx eas-cli@latest login`, then `npx eas-cli@latest init`. Because `app.config.ts` exists, `eas init` prints the project id instead of writing it. Paste it into `apps/mobile/app.json` under `expo`: `"owner": "<your Expo account>"` and `"extra": { "eas": { "projectId": "<id>" } }`.
   - Check: `pnpm --filter @taskop/mobile exec expo config --type public | grep projectId` prints the id.
   - Commit: `git add apps/mobile/app.json && git commit -m "chore(mobile): EAS project id"`.
2. **APNs key (iOS).** Apple Developer, Certificates, IDs & Profiles, Keys: create a key with Apple Push Notifications service. Download the `.p8` (gitignored). Run `npx eas-cli@latest credentials -p ios`, bundle id `az.taskop.app`, "Push Notifications: Manage your Apple Push Notifications Key", upload it. The development build must be signed by the paid team: a personal team cannot sign the push entitlement.
3. **FCM V1 key (Android).** Firebase console: create a project, add an Android app with package `az.taskop.app`.
   - Download `google-services.json` to `apps/mobile/google-services.json` (gitignored local file). `app.config.ts` picks it up automatically.
   - Project settings, Service accounts, "Generate new private key". Run `npx eas-cli@latest credentials -p android`, "Google Service Account", "Manage your Google Service Account Key for Push Notifications (FCM V1)", upload that JSON.
   - For EAS cloud builds, also provide the file as an EAS file env var: `npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment development --environment preview --environment production`.
4. **API env** (created in section B): `JOBS_ENABLED=true` and `NOTIFICATIONS_PUSH_ENABLED=true` (the code defaults it to true outside `NODE_ENV=test`, and `.env.example` already sets both). `EXPO_ACCESS_TOKEN` stays empty unless enhanced push security is on in the Expo account.

## B. Build and start for phones on the LAN

```bash
docker compose up -d
ipconfig getifaddr en0                     # e.g. 192.168.1.20 (use your value below)
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env
```

Then edit the two new files (both are gitignored):

- `apps/api/.env`: set `S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333` (existing line), and check `JOBS_ENABLED=true` and `NOTIFICATIONS_PUSH_ENABLED=true` are present (they are in the example).
- `apps/mobile/.env`: set `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000` (existing line).

```bash
pnpm db:setup && pnpm db:seed
pnpm --filter @taskop/api dev
pnpm --filter @taskop/mobile exec expo prebuild --clean
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
pnpm --filter @taskop/mobile android -- --device
```

Expected: both phones install the development build. `expo prebuild --clean` regenerates `ios/` and `android/` with the notifications plugin, the `aps-environment` entitlement and the Firebase file.

Seed accounts: manager `manager@demo.taskop.az` / `DemoPassword123`; workers `elvin` and `nigar`, org code `demo`, PIN `482915`. Mailpit: `http://localhost:8025`. The web app (Part 3) sends messages and changes rules; without it use the API endpoints directly.

Database check used in items 1 and 9 (run from the repo root; the compose `postgres` service, owner role `taskop_owner`, database `taskop`; if the stack was started under another compose project name, add `-p <name>` after `docker compose`, for example `-p foundation`):

```bash
docker compose exec postgres psql -U taskop_owner taskop -c "select platform, disabled_at, last_seen_at from push_devices order by last_seen_at desc"
```

## C. Checklist (spec section 9)

1. **First start asks once.** Fresh install, sign in as `elvin`: one permission prompt (iOS, and Android 13+). Allow: Profile shows "Push bildirişləri: Açıqdır". the database check from section B shows a row for the phone (`platform` ios or android, `disabled_at` empty). Kill and reopen: no second prompt.
2. **Foreground banner (web).** App open on Home, assign a task to `elvin` on the web (Tapşırıqlar, new task). Within about 10 s: a banner with sound, the bell count grows by one, the task shows under Tapşırıqlar without a manual sync.
3. **Tap from a closed app: occurrence.** Kill the app. (web) Make a checklist of `elvin` available, due soon or overdue (shorten the shift on the web). Tap the notification: the app opens on Home with that checklist's "Başla" if not started; if `elvin` had started it, on its execution screen.
4. **Tap from a closed app: task (web).** Kill the app, assign another task on the web, tap the notification: the task screen of that task.
5. **Cold-start tap routes to the inbox.** Kill the app. Trigger a push whose target is not on this phone (for example the manager's critical-problem push on the manager's phone, or a message-type notification). Tap it from the lock screen: the app starts and lands on the inbox (`/notifications`), with the Tabs layout mounted and no blank screen, error or redirect flash.
6. **Cold-start tap routes to Home.** Kill the app. Trigger an occurrence push for a checklist on this phone and tap it from the lock screen: the app starts and lands on Home. This proves the router is ready before Tabs mounts (no "navigate before mounting" error, no stuck splash).
7. **Manager notices.** Second phone signed in as the manager. `elvin` records a critical problem (on `elvin`'s phone: open a started checklist, tap "Problem qeyd et" on an item, choose severity "Kritik", add a note, save): push on the manager's phone; tapping it opens the inbox (the occurrence is not on the manager's phone). An email arrives in Mailpit for the manager. `elvin` submits a review task the manager created (manager creates a task for `elvin` with "requires review" on the web or in Tapşırıqlar; `elvin` completes it in Tapşırıqlar): tapping the push opens the Yoxlama screen with Təsdiqlə and Geri qaytar.
8. **Badge and inbox.** The app icon shows the unread count. Open the bell: unread rows are bold; pull to refresh works. (web) Send 35 messages to `elvin` from the web (Mesajlar): scrolling loads the rest with no row twice. "Hamısını oxunmuş et": the bell and the icon badge clear. In airplane mode the inbox says "Bildirişlərə baxmaq üçün internet bağlantısı tələb olunur.".
9. **Logout stops push.** Log out, then (web) message `elvin` from Mesajlar: no push arrives, the icon has no badge, and the database check from section B shows no row for the phone (an empty result, or only a row with `disabled_at` set).
10. **Switching users on one phone.** With `elvin` signed in, turn on airplane mode and log out: the removal fails and logout still finishes within about 3 s. Airplane mode off, sign in as `nigar`. (web) Send one message to `elvin` and one to `nigar` from Mesajlar: only `nigar`'s arrives. A push from `elvin`'s session still on the lock screen opens only the inbox while `nigar` is signed in.
11. **Denied permission shows in Profile.** Reinstall and deny the prompt: Profile shows "Bağlıdır", the hint and "Ayarları aç". The button opens the app's page in the OS settings. Allow notifications there and return: "Açıqdır" without a restart, and a message sent now (web, Mesajlar) arrives as a push.
12. **Email switch and critical problem email.** As the manager, turn "E-poçt bildirişləri" off in Profile and record a critical problem: a push, but no new email in Mailpit. (web) The web user menu's "Bildiriş ayarları" shows the switch off. Turn it back on and record another critical problem: the email reaches Mailpit. In airplane mode the switch is disabled with "Dəyişmək üçün internet bağlantısı tələb olunur.".
13. **Simulator.** `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios` on a simulator: no prompt, no error, Profile shows "Bu cihazda dəstəklənmir".
14. **Both platforms.** Run items 1 to 12 on a real iPhone (iOS development build) and a real Android phone (Android development build), and note model and OS version for each.

Copyable list for the pull request description (add phone model and OS per platform):

- [ ] 1. First start asks once
- [ ] 2. Foreground banner
- [ ] 3. Tap from closed app: occurrence
- [ ] 4. Tap from closed app: task
- [ ] 5. Cold-start tap routes to the inbox
- [ ] 6. Cold-start tap routes to Home
- [ ] 7. Manager notices (critical problem push + Mailpit email, review task push)
- [ ] 8. Badge and inbox (badge, bold unread, paging, mark all, offline message)
- [ ] 9. Logout stops push
- [ ] 10. Switching users on one phone
- [ ] 11. Denied permission shows in Profile
- [ ] 12. Email switch and critical problem email
- [ ] 13. Simulator
- [ ] 14. Both platforms: iPhone ____ / iOS ____, Android ____ / Android ____

For a failed item: fix it in the owning task's files with a regression test where Jest can express it, committed as `fix(mobile): ...`.
