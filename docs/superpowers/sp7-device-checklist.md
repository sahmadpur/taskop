# SP7 reports: manual device checklist (mobile Komanda tab)

Everything here needs a simulator, a real phone or the web admin, so Jest and the agents cannot run it. Spec: `docs/superpowers/specs/` (SP7 reports design, sections 7 to 9). Tick each item in the pull request description, with the phone model and OS version for the items that need the real phone (6 and 9: airplane mode).

**Run this after Part 1 (API) is merged on this branch.** The Team tab reads `/reports/*`, and the run screen reads `GET /occurrences/:id`, `GET /executions/:id` and `GET /media/:id/url` with `reports.view`. The web app (Part 3) is optional and only used to compare numbers (item 2), to deactivate and reactivate elvin with the owner account (item 5), and to create or edit a custom role and a second staff user (item 10).

Never commit device notes or credentials.

## A. Start the stack against a local database

The demo database already lives in the `foundation` compose project, so start that project; do not create a new one:

```bash
docker compose -p foundation start         # the existing demo Postgres (5432) and S3 (8333)
ipconfig getifaddr en0                     # e.g. 192.168.1.20 (needed for a real phone; the simulator can use localhost)
cp -n apps/api/.env.example apps/api/.env
cp -n apps/mobile/.env.example apps/mobile/.env
pnpm --filter @taskop/api keys:generate    # only if apps/api/.env has empty JWT_PRIVATE_KEY / JWT_PUBLIC_KEY: paste its output into apps/api/.env
```

Do not run `docker compose up -d` from this worktree: it would create a second compose project that collides with `foundation` on ports 5432 and 8333.

Edit the two gitignored files:

- `apps/api/.env`: `JOBS_ENABLED=true` (occurrences come from the cron), and for a real phone `S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333`.
- `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=http://localhost:3000` for the simulator, `http://192.168.1.20:3000` for a real phone.

`db:setup`, `db:seed` and `db:seed-report-volume` change the existing demo database (additively: they apply migrations and add demo rows and, for the volume seed, a second "perf" tenant).

```bash
pnpm db:setup && pnpm db:seed              # applies 0013_reports and 0014_reports_permissions, creates the demo tenant
pnpm --filter @taskop/api db:seed-report-volume   # optional, about a minute: the "perf" tenant for item 8
pnpm --filter @taskop/api dev              # API on http://localhost:3000
pnpm --filter @taskop/web dev              # optional web admin on http://localhost:5173 (proxies /api to :3000)
```

Mobile app in the iOS Simulator (Expo needs the full Xcode toolchain):

```bash
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios
# real phone (items 6 and 9): DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
```

A profile cached before the migration lacks `reports.view` until the app refreshes it, so kill and reopen the app once after `db:setup`.

### Accounts (the repo's dev seed)

| Who | Sign in | Credentials |
|---|---|---|
| Leyla, Manager, scope `site_subtree` | Rəhbər tab, email | `manager@demo.taskop.az` / `DemoPassword123` |
| Owner, scope `all` | Rəhbər tab, email | `owner@demo.taskop.az` / `DemoPassword123` |
| Workers `elvin` and `nigar` | Worker tab, org code `demo` | PIN `482915` |
| Perf manager, scope `site_subtree` (optional tenant) | Rəhbər tab, email | `perf-manager@taskop.test` / `PerfPassword123` |

Seed data used below: yesterday's partial "Səhər təmizliyi" run by elvin with two problems (one rule problem "Pis qoxu var?" = yes, one manual). A daily "Səhər təmizliyi" assignment for elvin (shift Səhər 08:00 to 16:00) produces today's occurrence once the API cron has run. Leyla's `site_subtree` scope gives her only elvin as a person (not nigar), so her employee picker offers just elvin.

### Getting `<token>` for curl

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login/staff -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.taskop.az","password":"DemoPassword123","client":"web"}'
```

Read `accessToken` from the JSON reply. Use the owner's login for the all-tenant numbers, or `manager@demo.taskop.az` to compare with Leyla's phone.

## B. Checklist

1. **Workers never see the tab.**
   - Sign in as `elvin` (org code `demo`, PIN `482915`). Expected: the tabs Əsas, Tapşırıqlar and Profil, with no Komanda.
   - On the simulator run `xcrun simctl openurl booted taskop://team`. Expected: the app stays on Əsas.
   - Run `xcrun simctl openurl booted taskop://team/run/<any occurrence id>`. Expected: Əsas.
2. **The manager's tab and today's tiles.**
   - Log out and sign in as Leyla on the Rəhbər tab. Expected: a Komanda tab between Tapşırıqlar and Profil, opening on "Bu gün".
   - Expected: six tiles: Tamamlanıb, Tamamlanmayıb, Gecikib, Yarımçıq, Problemli, Tamamlanma faizi.
   - The numbers match the web dashboard for "Bu gün", or `curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/v1/reports/summary?from=<today>&to=<today>"` (get `<token>` as described below). "Tamamlanmayıb" = due minus completed.
3. **Periods.**
   - Tap "7 gün". Expected: the tiles change, and yesterday's partial "Səhər təmizliyi" run is in the list, its badge "Yarımçıq" and "Problem: 2" (one rule problem, one manual).
   - Tap "30 gün", then "Bu gün" again.
   - Expected: with nothing due, "Tamamlanma faizi" shows "—".
4. **Status chips.**
   - Let elvin's run of today pass its due time unstarted. Expected: "Gecikmiş" lists it with a red "Gecikib" badge.
   - Expected: "Problemli" lists yesterday's run, "Buraxılmış" lists missed runs, and "Hamısı" lists everything, cancelled runs included.
   - The tiles do not change when the chip changes.
5. **Employee picker.**
   - Tap "Əməkdaş: Bütün əməkdaşlar". Expected: only elvin is offered (the seed gives Leyla no other people), and "Təyin edilməyib" is never offered.
   - Pick elvin. Expected: the tiles and the list narrow to elvin.
   - Switch to "30 gün". Expected: the button still says elvin.
   - Choose "Bütün əməkdaşlar". Expected: everyone in Leyla's scope is back.
   - Deactivation mark: on the web admin deactivate elvin (Users page). On the phone pull to refresh, then reopen the picker. Expected: elvin is listed as "(Deaktiv)" while he has runs in the period. Reactivate elvin afterwards.
   - Optional, to see several people and the ordering: sign in as the owner (item 11), whose picker offers elvin and nigar.
6. **Read-only executed run, device versus server time.** (real phone for airplane mode)
   - On the worker phone, sign in as elvin. Turn on airplane mode, start today's run and complete it with a photo and a "Bəli" problem. Wait 2 minutes, then turn airplane mode off and let it sync.
   - On Leyla's Komanda tab, pull to refresh and open the run.
   - Expected: checklist, site, date (DD.MM.YYYY) and the status badge, plus İcraçı "Elvin …".
   - Expected: "Başlayıb" and "Tamamlayıb" with the device times, and "Serverə çatıb: …" under the one that synced over a minute later. "Bal", and "Gecikib" and "Telefon saatı şübhəlidir" when set.
   - Expected: the answers with the option chips greyed and unchangeable, the photo loading, and under "Problemlər" the problem with its severity, note and photo.
   - Expected: nothing on the screen can be edited, and back returns to the list where it was.
7. **Read-only unexecuted run.** Open an overdue or missed run. Expected: the header, "İcraçılar" with the assignees (or "Təyin edilməyib"), and "Hələ icra edilməyib". No answers are requested.
8. **Paging on a big tenant.**
   - Sign in as `perf-manager@taskop.test` on the Rəhbər tab, choose "30 gün" and "Hamısı", and scroll fast to the bottom several times.
   - Expected: rows keep coming 50 at a time with a spinner at the bottom, no row appears twice, and scrolling stops at the end.
   - Pull to refresh at the top. Expected: the list restarts at the first page.
9. **Offline.** (real phone, or Network Link Conditioner on the simulator)
   - With Leyla on the Komanda tab, turn on airplane mode. Expected: only "Komandanı görmək üçün internetə qoşulun" and "Yenidən cəhd et", and no old numbers.
   - Go back online, open a run, then turn airplane mode on again. Expected: the run screen shows the same message, and no answers.
   - Turn airplane mode off. Expected: the tab loads by itself within a few seconds.
   - The Sync screen shows nothing pending from the Team tab.
10. **Role changed while the app is open.**
    - On the web, create a custom role with `reports.view` and the `site_subtree` scope, and give it to a second staff user. Sign in as that user on the phone and open Komanda.
    - On the web, remove `reports.view` from the role. On the phone, pull to refresh.
    - Expected: "Bu əməliyyat üçün icazəniz yoxdur." briefly, then the Komanda tab disappears and the app shows Əsas.
11. **Another manager on the same phone.** Log out Leyla and sign in as `owner@demo.taskop.az`. Open Komanda. Expected: the owner's numbers (scope `all`). Leyla's tiles never appear, not even for a moment.
12. **The tenant's day, not the phone's.**
    - In iOS Settings, General, Date & Time, turn off "Set Automatically" and pick New York.
    - At a Baku time between 00:00 and 08:00 (still the previous day in New York), open Komanda. Expected: "Bu gün" shows the Baku day's numbers, the same as the web dashboard.
    - Restore the setting.
13. **The worker flow is unchanged.** Sign in as elvin and start and complete a checklist. Expected: options, numbers, notes, dates with "İndi", photos, problems and the finish screen behave exactly as before this part.

Copyable list for the pull request description (add phone model and OS for items 6 and 9):

- [ ] 1. Workers never see the tab
- [ ] 2. The manager's tab and today's tiles
- [ ] 3. Periods
- [ ] 4. Status chips
- [ ] 5. Employee picker (incl. "(Deaktiv)" after deactivating elvin)
- [ ] 6. Read-only executed run, device versus server time
- [ ] 7. Read-only unexecuted run
- [ ] 8. Paging on a big tenant
- [ ] 9. Offline
- [ ] 10. Role changed while the app is open
- [ ] 11. Another manager on the same phone
- [ ] 12. The tenant's day, not the phone's
- [ ] 13. The worker flow is unchanged

For a failed item: fix it in the owning task's files with a regression test where Jest can express it, committed as `fix(mobile): ...`.
