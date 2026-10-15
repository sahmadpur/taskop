# SP8 audit and corrections: manual device checklist (mobile)

Everything here needs a simulator, a real phone or the web admin, so Jest and the agents cannot run it. Spec: `docs/superpowers/specs/2026-10-15-audit-corrections-design.md` (§8.1, §8.2, §9, §10). Tick each item in the pull request description, with the phone model and OS version for the items that need the real phone (2: push; 3 and 6: airplane mode).

**Run this after Part 1 (API) is merged on this branch.** The phone reads `/me/sync` with rework runs, sends `POST /executions/:id/resubmit`, and the Team tab calls `/audits/*`, `/executions/:id/corrections`, `/executions/:id/send-back` and `/executions/:id/send-back/cancel`. The web app (Part 3) is optional: it shows the original-versus-current comparison (item 8) and downloads the audit PDF (item 10). The audit report PDF is web-only: the phone never offers it.

Never commit device notes or credentials.

## A. Start the stack against the demo database

```bash
docker compose -p foundation start         # the existing demo Postgres (5432), S3 (8333) and Mailpit (8025)
ipconfig getifaddr en0                     # e.g. 192.168.1.20 (needed for a real phone; the simulator can use localhost)
cp -n apps/api/.env.example apps/api/.env
cp -n apps/mobile/.env.example apps/mobile/.env
```

Edit the two gitignored files:

- `apps/api/.env`: `JOBS_ENABLED=true` (occurrences come from the cron, the audit report is a job); for a real phone `S3_PUBLIC_ENDPOINT=http://192.168.1.20:8333`.
- `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=http://localhost:3000` for the simulator, `http://192.168.1.20:3000` for a real phone.

```bash
pnpm db:setup && pnpm db:seed              # applies 0015_audit_corrections and 0016_audit_corrections_tables
pnpm --filter @taskop/api dev              # API on http://localhost:3000
pnpm --filter @taskop/web dev              # optional web admin on http://localhost:5173
pnpm --filter @taskop/contracts --filter @taskop/i18n --filter @taskop/api-client build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios
# real phone: DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm --filter @taskop/mobile ios -- --device
```

`0016` gives the Manager role `executions.correct` and the Auditor role `audits.perform`. A profile cached before the migration lacks them until the app refreshes it, so kill and reopen the app once after `db:setup`.

Push (item 2) needs the SP6 push setup (EAS project, APNs key, a development build signed by the paid team): `docs/superpowers/sp6-device-checklist.md`, section A.

### Accounts (the repo's dev seed)

| Who | Sign in | Credentials |
|---|---|---|
| Leyla, Manager (`executions.correct`), scope `site_subtree` | Rəhbər tab, email | `manager@demo.taskop.az` / `DemoPassword123` |
| Owner (every key, scope `all`): the auditor below | Rəhbər tab, email | `owner@demo.taskop.az` / `DemoPassword123` |
| Worker elvin | Worker tab, org code `demo` | PIN `482915` |

Use two devices: elvin on the real phone, Leyla or the owner on the simulator.

### Getting `<token>` and making the checklist require audit (item 10)

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login/staff -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.taskop.az","password":"DemoPassword123","client":"web"}'          # read accessToken
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/api/v1/checklists" | grep -o '"id":"[^"]*","name":"Gündəlik təmizlik yoxlaması"'
curl -s -X PATCH -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  "http://localhost:3000/api/v1/checklists/<checklist id>" -d '{"requiresAudit":true,"auditReportEmails":["qa@demo.taskop.az"]}'
```

## B. Checklist

1. **A completed run to work with.** As elvin, between 09:00 and 12:00 Baku time, start today's "Gündəlik təmizlik yoxlaması", answer everything, add one photo and complete it. Wait for the sync indicator to turn green.
2. **Send back, with a push (real phone for elvin).**
   - Lock elvin's phone. As Leyla: Komanda → "Bu gün" → the run.
   - Expected: the actions Correct and Send back; no Audit (Leyla has no `audits.perform`).
   - Tap Send back. Expected: "Düzəldilməli bəndləri seçin və hər biri üçün şərh yazın."
   - Pick two items, one of them the photo item. Write a comment for each. Due date: tomorrow `18:00` as `İİİİ-AA-GG SS:DD`. Send.
   - Expected: "İcra icraçıya qaytarıldı." The run shows the badge "Düzəliş tələb olunur" and the request block (round, due date in Baku time, both comments).
   - Expected on elvin's phone: a push about the correction. Tapping it opens the run's execution screen in rework mode.
3. **Rework offline (real phone).**
   - elvin, Home. Expected: a "Düzəliş tələb olunur" group above "İndi", whose card says "Raund 1 · 2 bənd düzəliş tələb edir", the due date and "Düzəliş et".
   - Turn on airplane mode and tap "Düzəliş et". Expected: the banner with the round and the due date; "Rəhbərin şərhi: …" on each flagged item; every other item dimmed, with its inputs and ⚑ disabled; the progress line "2/2 qaytarılan bənd hazırdır".
   - Change the flagged value. Long-press the old photo on the flagged photo item to remove it, and take a new one.
   - Go to the last section and tap "Yenidən təqdim et". The Resubmit screen lists both items as "Hazırdır". Tap "Yenidən təqdim et".
   - Expected: "Düzəlişlər göndərildi." and Home; the card is now under "Bitmiş", and the sync indicator is amber. On the Sync screen, "Fayl qeydiyyatı" and "Cavablar" come before "Yenidən təqdim".
   - Turn airplane mode off. Expected: the indicator turns green within seconds, the Sync screen is empty, and the photo uploads.
   - As Leyla, open the run again (pull to refresh the list). Expected: "Tamamlanıb" (or "Audit gözləyir" once item 10 made the checklist require audit), the "Düzəliş edilib" marker, and in "Düzəlişlər": round 1 with its comments and "Yenidən təqdim edilib: …", then one rework correction per changed item with elvin's before and after values.
   - Leyla's inbox (bell) has the notification "Düzəliş təqdim edildi". Tapping it opens the run on the Komanda tab (Leyla does not hold the run, and she has Team access).
   - Send the same run back once more. Expected: the card on elvin's Home reads "Raund 2 · …", with no leftover row on the Sync screen. The earlier resubmit never closes round 2 (the resubmit carries its round number, and a replay of round 1 is ignored by the server; a replay cannot be forced on a device, the API tests cover it).
4. **A passed due date.** Send another run back with a due date two minutes ahead. Wait. Expected: elvin's card turns red with "Gecikir" and a red due date. Nothing else happens: the run can still be fixed and resubmitted.
5. **Only flagged items, and the requirements.** Send a run back with only the photo item flagged. As elvin, remove its only photo. Expected: the progress shows "0/1", and the Resubmit screen shows "Kifayət qədər fayl yoxdur" (or "Foto lazımdır") with the button disabled. Add a photo; the button turns on.
   - **A follow-up the fix reveals.** Send a run back with only a yes/no question flagged whose other answer opens a follow-up ("Pis qoxu var?" in the seed checklist). As elvin, change the answer. Expected: the follow-up appears with "Yeni sual", editable, with no manager comment, and the progress counts it. Answer it and resubmit: the server accepts it. Change the answer back before resubmitting instead: the follow-up disappears, and the resubmit is still accepted.
6. **Withdraw while the worker is offline (real phone).**
   - Send a run back. As elvin, open it, turn on airplane mode, change a flagged value and resubmit (the resubmit is queued).
   - As Leyla, open the run → Withdraw → confirm. Expected: "Qaytarma geri götürüldü." and the run's status from before the send-back.
   - Turn elvin's airplane mode off. Expected within seconds: no red row on the Sync screen; the card shows "Server qəbul etmədi: Bu icra artıq bağlanıb və dəyişdirilə bilməz."; opening the run shows the server's answers, read-only. Those are the answers the run had before the send-back: elvin's half-done change is gone.
   - Variant (online): send a run back, as elvin change a flagged value without resubmitting, then withdraw as Leyla. After the next sync (pull to refresh, or a few seconds), the card leaves "Düzəliş tələb olunur" and the run shows the pre-send-back answers, not the half-done ones.
7. **Correct from the Team tab.**
   - As Leyla, open a completed run → Correct. Expected: "Foto və videolar dəyişdirilmir. …" and the item editors (choices, numbers, text, dates, notes).
   - Change one value and tap "Davam et". Write a reason and save. Expected: "Düzəliş yadda saxlanıldı.", the "Düzəliş edilib" marker, and a manual correction in "Düzəlişlər" with the reason.
   - Tap Correct again and "Davam et" without changing anything. Expected: "Heç bir cavab dəyişməyib."
8. **Two managers at once.** Open the same run's Correct mode as Leyla on the phone and as the owner on the web (or a second phone). Save on the web first, then on the phone. Expected on the phone: the conflict message and "Yenidən yüklə". Tapping it shows the web's values; a new correction saves. On the web, the run dialog's Corrections tab lists both.
9. **Offline in a mode.** In Correct mode, change a value, then turn on airplane mode (or Wi-Fi off on the simulator's Mac). Expected: "Komandanı görmək üçün internetə qoşulun", the changed value still there, and saving disabled. Reconnect: saving works with the same value.
10. **Audit on the phone (owner).**
    - Make the checklist require audit (section A), and let elvin complete a new run. As the owner: Komanda → the run. Expected: the status "Audit gözləyir" and the Audit start button.
    - Start it. Expected: the items with their answers and photos, the progress "0 / N bənd yoxlanılıb", and Finish disabled.
    - Approve all but one item. Reject the last: without a comment the sheet refuses; with a comment it saves. Expected: the progress "N / N" and Finish enabled.
    - Finish with "failed", a comment and `boss@demo.taskop.az` as an extra address. Expected: "Audit bitdi.", the result read-only with the score, and the report status turning ready on a reload.
    - Mailpit (`http://localhost:8025`) has one message for `qa@demo.taskop.az` and one for `boss@demo.taskop.az`, each with the PDF. On the web the PDF downloads (no PDF on the phone).
    - The run is now locked: the run screen offers only opening the audit.
    - Notifications ("Audit tamamlandı"): elvin, the executor, is always notified. Leyla, a manager, is notified only because the audit failed (the rule's default result filter is "Yalnız uğursuz auditlər"). Tapping it in Leyla's inbox opens the run on the Komanda tab, not Home, although she does not hold the run.
    - Repeat with a second run and finish it as "passed". Expected: elvin is notified, Leyla is not.
11. **A paused audit.** Start an audit on a completed run and approve some items. As Leyla, send the run back. As the owner, open the audit. Expected: "İcraçıya düzəlişə qaytarılıb — yenidən təqdim gözlənilir", verdicts still editable, and Finish disabled. After elvin resubmits, the verdicts of the changed items are cleared, and Finish becomes possible once they are reviewed again.
12. **Somebody else's audit.** Start an audit on the web as the owner, then tap the Audit start button on the phone as a second auditor (a custom role with `reports.view` and `audits.perform`, created on the web). Expected: the phone opens the existing audit instead of an error.
13. **Workers see no Team actions, and the worker flow is unchanged.** elvin has no Komanda tab. Start and complete a normal run: options, numbers, notes, dates with "İndi", photos, ⚑ problems and the finish screen behave as before this part.

Copyable list for the pull request description (add phone model and OS for items 2, 3 and 6):

- [ ] 1. A completed run to work with
- [ ] 2. Send back, with a push
- [ ] 3. Rework offline
- [ ] 4. A passed due date
- [ ] 5. Only flagged items, the requirements and a revealed follow-up
- [ ] 6. Withdraw while the worker is offline
- [ ] 7. Correct from the Team tab
- [ ] 8. Two managers at once
- [ ] 9. Offline in a mode
- [ ] 10. Audit on the phone (and its notifications)
- [ ] 11. A paused audit
- [ ] 12. Somebody else's audit
- [ ] 13. Workers see no Team actions, and the worker flow is unchanged

For a failed item: fix it in the owning task's files with a regression test where Jest can express it, committed as `fix(mobile): ...`.
