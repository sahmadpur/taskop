# Taskop Notifications — Part 3: Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every web user a notification bell with an unread badge and a popover of the latest ten, plus a full `/notifications` inbox; give `notifications.manage` holders a "Bildirişlər" tab in Settings to edit the tenant's rules; give `notifications.send` holders a "Mesajlar" page to compose, preview, confirm and send manual messages and to follow their delivery; give everyone an email opt-out in the user menu. Finish with the spec §9 Playwright flow.

**Architecture:**
- **New feature folder `apps/web/src/features/notifications/`**, built like `features/tasks/`: pure helpers in `labels.ts`, `rules-form.ts` and `message-form.ts`; React Query hooks and query keys in `queries.ts`; components that call `api.*` from `@/lib/session`; every string from `az.notifications` (plus `az.nav`, `az.common`, `az.settings.org.title`).
- **Polling, not push.** The unread count is one query (`['notifications', 'unread-count']`) shared by the bell and the inbox page, refetched every 30 s and on window focus. Every action that changes read state invalidates the whole `['notifications', …]` family, so the badge, the popover and the inbox page agree within one round trip.
- **Links come from one helper.** `notificationLink(item)` turns `targetKind` / `targetId` / `targetDate` / `type` into a typed TanStack Router destination (`/schedule?date&occurrence[&tab=execution]` or `/tasks?task`), or `null` for "no page of its own". The bell and the inbox page open notifications through one hook, `useOpenNotification`, that marks the row read first and never lets a failed mark-read block the navigation.
- **Rules are edited row by row.** Each rule row keeps a local draft, sends the full rule (`ruleBody`) on "Yadda saxla", and replaces itself in the cached list with the server's answer; "Defolta qaytar" does the same with `DELETE`.
- **Messages are previewed before they are sent.** "Göndər" asks `POST …/preview` for the recipient count and opens a confirm dialog; the confirm button sends exactly the previewed body. The detail is a deep link, `/messages?message=<id>`, like the SP5 task drawer.

**Tech Stack:** React 19.2.3, TanStack Router 1 + Query 5, shadcn/ui on `radix-ui` (`Tabs`, `Dialog`, `DropdownMenu`, `Checkbox`, and two new primitives, `Popover` and `Switch`), i18next, lucide-react, sonner, Vitest 5 + Testing Library + user-event, Playwright (all already in the repo). **No new npm package.**

**Spec:** `docs/superpowers/specs/2026-10-13-notifications-design.md` — this plan implements §8 and the web and Playwright parts of §9. **Interface source:** `docs/superpowers/plans/2026-10-13-notifications-1-api.md`, section *Interfaces for Parts 2 and 3*; this plan uses only names listed there or already in the repo.

**This plan is Part 3 of 3.**
- **Before starting:** Part 1 **Tasks 1–4** must be merged into the feature branch: the contracts in `packages/contracts/src/notifications.ts` (and the `sync`, `auth`, `permissions`, `audit` changes), the `az.notifications` namespace with `az.nav.notifications` / `az.nav.messages`, and the `@taskop/api-client` methods `notifications.*`, `preferences.update`, `notificationRules.*`, `messages.*`.
- **Tasks 1–8** need nothing else. They test against a mocked `@/lib/session`.
- **Task 9 (Playwright)** needs **all of Part 1** merged (migrations `0011`/`0012`, the outbox, the fan-out and deliver workers, the endpoints) and an API running with jobs on (`JOBS_ENABLED=true`, the default).
- Part 2 (`apps/mobile`) is independent of this part.

## Global Constraints

- The product name is **Taskop**. Azerbaijani (`az`) is the only locale.
- Every visible string is an i18n key. New web strings go into `az.notifications` (`packages/i18n/src/az/notifications.ts`, Part 1 Task 3's file) as **new keys only**: `bell`, `inbox`, `rules`, `messages`, `preferences`. Part 1's keys (`types`, `groups`, `audiences`, `channels`, `deliveryStatuses`, `issues`, `leadMinutes`, `title`, `markAllRead`, `empty`), `az.nav.notifications` and `az.nav.messages` are reused, never renamed. The Settings tab "Təşkilat" is `settings.org.title`; the tab "Bildirişlər" is `notifications.title`.
- Install nothing. Two UI primitives are added as files on the existing `radix-ui` dependency: `src/components/ui/popover.tsx` (Task 4) and `src/components/ui/switch.tsx` (Task 5). Otherwise use the existing `Badge`, `Button`, `Card`, `Checkbox`, `CheckboxList`, `Dialog`, `DropdownMenu`, `Input`, `Label`, `NativeSelect`, `PageHeader`, `FormError`, `Table`, `Tabs`, `Textarea`.
- **Unread count:** `api.notifications.unreadCount()` under the key `['notifications', 'unread-count']`, `refetchInterval: 30_000`, `refetchOnWindowFocus: true`, `staleTime: 0` (the app's defaults, 30 s stale and no focus refetch, are overridden for this query only).
- **Bell:** left of the user name in the header. Badge hidden at 0, the number for 1–99, **`99+`** above 99. Accessible name "Bildirişlər" (`nav.notifications`) or "Bildirişlər: N oxunmamış". The popover asks for the **10** latest (`api.notifications.list({ limit: 10 })`) only while open; it has "Hamısını oxunmuş et" and the link "Hamısına bax" (`/notifications`).
- **Targets** (spec §8): `occurrence` → `/schedule?date=<targetDate>&occurrence=<targetId>`, plus `&tab=execution` when `isProblemType(type)`; `task` → `/tasks?task=<targetId>`; `none`, or a missing `targetId` → no page: the bell opens `/notifications`, the inbox page stays put. An unread row is marked read (`api.notifications.markRead`) before navigating; a failed mark-read never blocks the navigation; afterwards every `['notifications', …]` query is invalidated.
- **`/notifications`:** any signed-in user; pages of **30** (`limit: 30`), keyset cursor, "Daha çox göstər" while `nextCursor` is set; "Yalnız oxunmamışlar" sends `unread: 'true'`; "Hamısını oxunmuş et" is enabled while the unread count is above 0.
- **Settings:** the page gets tabs "Təşkilat" | "Bildirişlər" only for holders of **`notifications.manage`**; for everyone else it renders exactly as today. The rules tab loads only when opened.
- **Rules:** `PUT /notification-rules/:type` always carries the full rule (all seven fields of `UpdateNotificationRuleInput`); audiences not in `NOTIFICATION_TYPE_META[type].audiences` are sent `false`; `leadMinutes` is one of `LEAD_MINUTES` (15, 30, 60, 120) when `hasLeadTime`, else `null`; `roleIds` without duplicates. Role options are `GET /roles` (`useRoles`): active roles plus any already chosen.
- **Messages:** route `/messages` (`?message=<id>` opens the detail), menu entry "Mesajlar" (`nav.messages`, `Megaphone`) for holders of **`notifications.send`**; the route itself is not guarded (as every page). Limits from `MESSAGE_LIMITS`: title 1–**80** and body 1–**500** after trimming, at most **1,000** recipients, at most **200** users, teams or sites each. History pages of **50**. Preview counts 0 or above 1,000 block the confirm button with `notifications.issues.noRecipients` / `tooManyRecipients`.
- **Preferences:** user menu → "Bildiriş ayarları" → one switch, `PATCH /me/preferences`; the signed-in user is updated through `session.setMe`; initial value `me.user.emailNotifications`.
- Tests mock `@/lib/session` exactly as the existing feature tests do. Only the bell's interval test uses fake timers; no test depends on the machine's time zone.
- Commits use `git add <explicit paths>` (never `-A`). Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the second `-m`).

## Spec decisions (ambiguities resolved against the real code)

1. **One target picker, not three.** Users, teams and sites are three groups of one inline combobox ("Alıcılar") with several picks each, shown as removable chips. It follows the SP5 `AssigneePicker` (input + `role="listbox"` with `role="group"`s, arrow keys and Enter, Escape closes only the list) because the repo has no command/combobox component. `messages.options` filters users and teams by `q` on the server but returns every site in scope, so the picker filters sites in the browser.
2. **`Popover` and `Switch` are new files, not new packages.** `radix-ui` (already a dependency) ships both primitives; `popover.tsx` and `switch.tsx` are written in the same shape as the generated `dropdown-menu.tsx` / `checkbox.tsx` (`cn` from `"cn"`, primitives from `"radix-ui"`, `data-slot`, radix-nova classes). `src/components/ui/**` is outside lint, as today.
3. **The user menu is the name block.** The header's name and role become a `DropdownMenu` trigger with one item, "Bildiriş ayarları". The logout icon button stays where it is (the foundation e2e and the app-shell tests press "Çıxış"). The menu is `modal={false}` so the dialog it opens gets focus and pointer events.
4. **Settings tabs only when there are two.** Without `notifications.manage` the page has a single section, so it keeps today's layout (no one-tab tab bar). The password card stays under "Təşkilat" next to the organisation card.
5. **"Stays in the inbox" on the web** means: a `none` row in the bell opens `/notifications`; on `/notifications` it is only marked read. Rows show the full body there and two lines in the popover.
6. **A failed mark-read never blocks.** A row older than 90 days may have been cleaned up (`404`), or the network may drop; the user still reaches the target and the following refetch shows the true state.
7. **The bell's accessible name carries the count** ("Bildirişlər: 3 oxunmamış"), since the badge is a visual detail. Without unread ones it is `nav.notifications` ("Bildirişlər"). No menu item is added for `/notifications` (spec §8 adds only "Mesajlar"); the bell and "Hamısına bax" lead there.
8. **Rules save per row with an explicit button.** Each row has "Yadda saxla" (enabled when the draft differs from the stored rule) and, for customised rows, "Defolta qaytar"; the answer replaces the row in the cached list and resets the draft (the server may drop duplicate or deleted role ids). The "Dəyişdirilib" badge follows `isDefault`.
9. **Rule controls are named "`<type label>` — `<control>`"** (`notifications.rules.control`), so a screen reader and the tests can tell 13 rows of identical checkboxes apart. Audience cells that do not apply show "—".
10. **The roles picker needs `GET /roles` (`roles.view`).** A custom role with `notifications.manage` but without `roles.view` gets `403` there: the tab says the list could not load, every row shows "N rol" on a disabled button, and saves keep the stored `roleIds` unchanged. Widening `GET /roles` is not part of SP6.
11. **Field errors are shown per row.** `VALIDATION_FAILED` (and `REFERENCE_NOT_FOUND` with `fields.roleIds`) carry i18n keys in `fields`; the row shows each translated key in a `role="alert"` line. Other errors use `errorText`.
12. **Preview, then confirm, then send what was previewed.** `preview` skips the 0 and 1,000 checks (Part 1), so the web checks the count: 0 → `issues.noRecipients`, above 1,000 → `issues.tooManyRecipients`, both with the send button disabled. A send refused with `fields.userIds` (`noRecipients` / `tooManyRecipients`, the expansion changed meanwhile) shows the reason under the picker and keeps the draft; `403` (a target outside the scope) shows `errors.FORBIDDEN`.
13. **Delivery counts are shown per channel.** The history table has a Push and an E-poçt column, each listing the non-zero statuses in `DELIVERY_STATUSES` order ("Çatdırılıb: 2 · Uğursuz: 1", labels from `deliveryStatuses`); a message not yet fanned out (`processed: false`) shows "Göndərilir…"; e-mail not ticked shows "İstənilməyib".
14. **History pages of 50** (`cursorQuerySchema`'s default); the inbox uses the spec's 30.
15. **Preferences save on toggle.** The switch flips at once, calls `PATCH /me/preferences`, then `session.setMe({ ...me, user: { ...me.user, emailNotifications } })` from the answer; on failure it flips back and shows the error. Users without an e-mail address see that the setting has no effect (Part 1: they may still set it).
16. **The e2e member is a worker signed in to the web through the API.** Staff invites need the e-mailed token (no mailbox in CI) and the web login form is staff-only, so the test signs the worker in with `POST /auth/login/worker` and `client: 'web'` from `page.request` (it shares the page's cookies; the API sets the refresh cookie), then loads `/`: `session.bootstrap()` restores the session from that cookie.
17. **"The admin changes the task.assigned rule"** = ticks E-poçt on the `task.assigned` row and saves (verified in the UI and through `GET /notification-rules`); the owner then gives a task to the member's team through the API, which yields a `task.assigned` notification for the member (team members while nobody accepted it, spec §3.3). The member has no e-mail address, so the e-mail channel creates no delivery and CI needs no SMTP. The member registers no push device, so no Expo call happens either.
18. **Texts the API renders are never hard-coded.** Rule-type labels come from `az.notifications.types` (Part 1) in tests and e2e; notification titles in the e2e come from the member's `GET /me/notifications`.

## Review Focus

These are the five inputs most likely to bite real users that no spec test names. Each line gives the task whose test pins it.

1. **A very large or zero unread count.** A manager back from leave has 240 unread: the badge must read "99+" (not overflow the header), the button must still say 240 to a screen reader; at 0 there is no badge at all. Pinned in Task 4 (`counts above 99 as 99+ and shows no badge at zero`).
2. **A notification whose target is incomplete.** A `task` notification with `targetId: null`, or an occurrence notification without `targetDate`, must not produce `/tasks?task=null` or a broken schedule link: no id → no page; no date → the schedule's current week with the occurrence. Pinned in Task 2 (`gives a notification without a target id no page, and an occurrence without a date the current week`).
3. **Mark-read fails.** The row was cleaned up after 90 days (`404`) or the network dropped while clicking: the user must still land on the task, and the badge must refresh. Pinned in Task 4 (`a row whose mark-read fails still opens its target`).
4. **A rules manager who may not list roles.** A custom role with `notifications.manage` but not `roles.view`: the tab must still load and save, show how many roles a rule has, and never wipe the stored roles on save. Pinned in Task 5 (`without the roles list keeps the chosen roles and still saves the row`).
5. **A message that reaches nobody, or too many people, or has blank text.** A team with no active members, a site tree of 3,000 people, a title of spaces: "Göndər" must stay disabled for blank text, and the confirm dialog must explain and refuse instead of sending (the API would answer `VALIDATION_FAILED`). Pinned in Task 6 (`offers Göndər only for a recipient and non-blank text, and will not send to nobody or to more than 1000`).

---

## File Structure

```
packages/i18n/src/
  az/notifications.ts            + web keys: bell, inbox, rules, messages, preferences
  i18n.test.ts                   + notification web translations
apps/web/src/
  components/ui/popover.tsx      Popover, PopoverTrigger, PopoverContent, PopoverAnchor (radix-ui)
  components/ui/switch.tsx       Switch (radix-ui)
  features/notifications/
    labels.ts                    notificationLink, unreadBadgeText, deliverySummary
    labels.test.ts
    queries.ts                   constants, notificationKeys, useUnreadCount, useLatestNotifications, useInbox,
                                 useMarkAllRead, useNotificationRules, useMessageTargetOptions, useMessages, useMessage
    fixtures.ts                  test data (tests only)
    open-notification.ts         useOpenNotification
    notification-row.tsx         NotificationRow
    notifications-page.tsx       NotificationsPage (/notifications)
    notifications-page.test.tsx
    notification-bell.tsx        NotificationBell
    notification-bell.test.tsx
    rules-form.ts                RuleDraft, draftOf, ruleBody, sameDraft
    rules-form.test.ts
    rules-tab.tsx                NotificationRulesTab (RuleRow, RolePicker)
    rules-tab.test.tsx
    message-form.ts              MessageTargets, MessageDraft, canPreview, sendBody, previewVerdict
    message-form.test.ts
    target-picker.tsx            TargetPicker
    target-picker.test.tsx
    compose-message.tsx          ComposeMessage
    compose-message.test.tsx
    message-history.tsx          MessageHistory, MessageDetailDialog
    routes.ts                    MessagesSearch, messagesSearch
    messages-page.tsx            MessagesPage (/messages)
    messages-page.test.tsx
    preferences-dialog.tsx       NotificationPreferencesDialog
    preferences-dialog.test.tsx
  features/settings/
    settings-page.tsx            tabs "Təşkilat" | "Bildirişlər"
    settings-page.test.tsx       (new)
  layouts/
    app-shell.tsx                + bell, user menu, "Mesajlar"
    app-shell.test.tsx
    user-menu.tsx                UserMenu
  router.tsx                     + /notifications, /messages
apps/web/e2e/notifications.spec.ts
```

---

### Task 1: Web strings for the bell, the inbox, the rules tab, the messages page and the preferences dialog

**Files:**
- Modify: `packages/i18n/src/az/notifications.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: Part 1 Task 3's `az.notifications` (`types`, `groups`, `audiences`, `channels`, `deliveryStatuses`, `issues`, `leadMinutes`, `title`, `markAllRead`, `empty`) and `az.nav.messages`.
- Produces (used by Tasks 2–9): `notifications.bell.*`, `notifications.inbox.*`, `notifications.rules.*` (incl. `columns.*`), `notifications.messages.*` (incl. `columns.*`), `notifications.preferences.*`, exactly as written in Step 3.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('notification web translations', () => {
  it('has the strings the bell, the inbox, the rules tab, the messages page and the preferences dialog use', () => {
    expect(az.notifications.bell.unread).toBe('Bildirişlər: {{count}} oxunmamış');
    expect(az.notifications.bell.viewAll).toBe('Hamısına bax');
    expect(az.notifications.inbox.unreadOnly).toBe('Yalnız oxunmamışlar');
    expect(az.notifications.inbox.more).toBe('Daha çox göstər');
    expect(az.notifications.rules.control).toBe('{{type}} — {{control}}');
    expect(az.notifications.rules.customized).toBe('Dəyişdirilib');
    expect(az.notifications.rules.reset).toBe('Defolta qaytar');
    expect(az.notifications.rules.rolesCount).toContain('{{count}}');
    for (const k of ['type', 'enabled', 'roles', 'leadTime'] as const) expect(az.notifications.rules.columns[k], k).toBeTypeOf('string');
    expect(az.notifications.messages.confirm).toBe('{{count}} nəfərə göndəriləcək');
    expect(az.notifications.messages.counter).toBe('{{count}}/{{max}}');
    expect(az.notifications.messages.remove).toContain('{{name}}');
    expect(az.notifications.messages.totals).toContain('{{recipients}}');
    for (const k of ['sentAt', 'sender', 'title', 'recipients', 'read', 'push', 'email'] as const) {
      expect(az.notifications.messages.columns[k], k).toBeTypeOf('string');
    }
    expect(az.notifications.preferences.menu).toBe('Bildiriş ayarları');
    expect(az.notifications.preferences.email).toBe('E-poçt bildirişləri');
    // Part 1's keys are untouched.
    expect(az.notifications.title).toBe('Bildirişlər');
    expect(az.notifications.markAllRead).toBe('Hamısını oxunmuş et');
    expect(az.nav.messages).toBe('Mesajlar');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.notifications.bell` is `undefined`.

- [ ] **Step 3: Implement**

In `packages/i18n/src/az/notifications.ts`, add these keys at the end of the exported object, after Part 1's last key (before `} as const;`):

```ts
  // ---- Web (Part 3): the bell, the inbox page, the rules tab, the messages page and the preferences dialog ----
  bell: {
    unread: 'Bildirişlər: {{count}} oxunmamış',
    viewAll: 'Hamısına bax',
  },
  inbox: {
    unread: 'Oxunmamış',
    unreadOnly: 'Yalnız oxunmamışlar',
    emptyUnread: 'Oxunmamış bildiriş yoxdur',
    more: 'Daha çox göstər',
  },
  rules: {
    intro:
      'Hər bildiriş növü üçün kanalları və alıcıları seçin. Aktiv qayda üçün bildiriş tətbiqdə həmişə görünür; push və e-poçt əlavə kanallardır.',
    columns: { type: 'Bildiriş', enabled: 'Aktiv', roles: 'Rollar', leadTime: 'Xatırlatma vaxtı' },
    control: '{{type}} — {{control}}',
    customized: 'Dəyişdirilib',
    reset: 'Defolta qaytar',
    resetDone: 'Defolt qayda bərpa edildi',
    noRoles: 'Rol seçilməyib',
    rolesCount: '{{count}} rol',
    rolesUnavailable: 'Rolların siyahısı yüklənmədi; seçilmiş rollar dəyişməz qalır.',
  },
  messages: {
    compose: 'Yeni mesaj',
    recipients: 'Alıcılar',
    recipientsPlaceholder: 'Əməkdaş, komanda və ya obyekt axtarın',
    people: 'Əməkdaşlar',
    teams: 'Komandalar',
    sites: 'Obyektlər',
    members: '{{count}} üzv',
    chosen: 'Seçilmiş alıcılar',
    remove: 'Sil: {{name}}',
    targetLimit: 'Hər növdən ən çox {{count}} seçmək olar.',
    titleLabel: 'Başlıq',
    bodyLabel: 'Mətn',
    counter: '{{count}}/{{max}}',
    email: 'E-poçt ilə də göndər',
    send: 'Göndər',
    confirmTitle: 'Mesajı göndər',
    confirm: '{{count}} nəfərə göndəriləcək',
    sent: 'Mesaj göndərildi',
    history: 'Göndərilmiş mesajlar',
    columns: { sentAt: 'Tarix', sender: 'Göndərən', title: 'Başlıq', recipients: 'Alıcılar', read: 'Oxunub', push: 'Push', email: 'E-poçt' },
    emptyHistory: 'Hələ mesaj göndərilməyib.',
    more: 'Daha çox göstər',
    processing: 'Göndərilir…',
    notRequested: 'İstənilməyib',
    detailTitle: 'Mesaj',
    sentBy: '{{name}} · {{time}}',
    targets: 'Hədəflər',
    totals: 'Alıcılar: {{recipients}} · Oxunub: {{read}}',
    recipient: 'Alıcı',
    notRead: 'Oxunmayıb',
    devices: '{{count}} cihaz',
    noDevice: 'Cihaz yoxdur',
    noRecipientsYet: 'Alıcılar hələ hesablanır.',
  },
  preferences: {
    menu: 'Bildiriş ayarları',
    title: 'Bildiriş ayarları',
    description: 'Bildirişlər tətbiqdə həmişə görünür. Push bildirişlərini telefonun ayarlarından idarə edin.',
    email: 'E-poçt bildirişləri',
    noEmail: 'Hesabınızda e-poçt ünvanı yoxdur; e-poçt bildirişləri göndərilmir.',
    saved: 'Ayar yadda saxlanıldı',
  },
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS. The build makes the new keys visible to `apps/web`.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/az/notifications.ts packages/i18n/src/i18n.test.ts
git commit -m "feat(i18n): add web strings for the bell, inbox, rules tab, messages page and preferences" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Notification links, badge text, delivery summary, queries and fixtures

**Files:**
- Create: `apps/web/src/features/notifications/labels.ts`, `apps/web/src/features/notifications/queries.ts`, `apps/web/src/features/notifications/fixtures.ts`
- Test: `apps/web/src/features/notifications/labels.test.ts`

**Interfaces:**
- Consumes:
  - Part 1: `isProblemType`, `DELIVERY_STATUSES`, `DEFAULT_RULES`, `RULE_TYPES`, types `NotificationItem`, `NotificationRuleDto`, `RuleType`, `DeliveryCounts`, `MessageSummary`, `MessageDetail`, `MessageTargetOptions`; `api.notifications.{list, unreadCount, markAllRead}`, `api.notificationRules.list`, `api.messages.{options, list, get}`
  - Existing: `ScheduleSearch` (`features/scheduling/routes.tsx`), `TasksSearch` (`features/tasks/routes.ts`), `RoleDto`
- Produces:
  - `labels.ts`: `type NotificationLink = { to: '/schedule'; search: ScheduleSearch } | { to: '/tasks'; search: TasksSearch }`; `notificationLink(n): NotificationLink | null`; `UNREAD_BADGE_MAX = 99`; `unreadBadgeText(count: number): string | null`; `deliverySummary(t, counts: DeliveryCounts): string`
  - `queries.ts`: `UNREAD_REFETCH_MS = 30_000`, `BELL_LIMIT = 10`, `INBOX_PAGE_SIZE = 30`, `MESSAGES_PAGE_SIZE = 50`; `notificationKeys` (`all`, `unreadCount`, `latest`, `inbox(unreadOnly)`, `rules`, `messages`, `messageList`, `message(id)`, `targetOptions(q)`); `useUnreadCount()`, `useLatestNotifications(enabled)`, `useInbox(unreadOnly)`, `useMarkAllRead()`, `useNotificationRules()`, `useMessageTargetOptions(q, enabled)`, `useMessages()`, `useMessage(id)`
  - `fixtures.ts` (tests only): `AT`, `SENDER`, `WORKER`, `ROLE_IDS`, `notificationItem(over?)`, `taskNote`, `problemNote`, `messageNote`, `ruleDto(type, over?)`, `allRules(over?)`, `roleList()`, `counts(over?)`, `messageSummary(over?)`, `messageDetail(over?)`, `targetOptions(over?)`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/labels.test.ts`:

```ts
import { az } from '@taskop/i18n';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { counts, notificationItem } from './fixtures';
import { deliverySummary, notificationLink, unreadBadgeText } from './labels';

const t = i18n.t.bind(i18n);

describe('notificationLink', () => {
  it('opens an occurrence on its day, a problem on the execution tab and a task in its drawer', () => {
    expect(notificationLink(notificationItem({ type: 'checklist.overdue', targetKind: 'occurrence', targetId: 'o1', targetDate: '2026-11-02' }))).toEqual({
      to: '/schedule',
      search: { date: '2026-11-02', occurrence: 'o1' },
    });
    expect(notificationLink(notificationItem({ type: 'problem.critical', targetKind: 'occurrence', targetId: 'o1', targetDate: '2026-11-02' }))).toEqual({
      to: '/schedule',
      search: { date: '2026-11-02', occurrence: 'o1', tab: 'execution' },
    });
    expect(notificationLink(notificationItem({ type: 'task.completed', targetKind: 'task', targetId: 't9' }))).toEqual({ to: '/tasks', search: { task: 't9' } });
    expect(notificationLink(notificationItem({ type: 'manual', targetKind: 'none', targetId: null }))).toBeNull();
  });

  it('gives a notification without a target id no page, and an occurrence without a date the current week', () => {
    expect(notificationLink(notificationItem({ targetKind: 'task', targetId: null }))).toBeNull();
    expect(notificationLink(notificationItem({ type: 'checklist.available', targetKind: 'occurrence', targetId: null, targetDate: '2026-11-02' }))).toBeNull();
    expect(notificationLink(notificationItem({ type: 'checklist.available', targetKind: 'occurrence', targetId: 'o2', targetDate: null }))).toEqual({
      to: '/schedule',
      search: { occurrence: 'o2' },
    });
  });
});

describe('unreadBadgeText', () => {
  it('hides the badge at zero and caps it at 99+', () => {
    expect(unreadBadgeText(0)).toBeNull();
    expect(unreadBadgeText(1)).toBe('1');
    expect(unreadBadgeText(99)).toBe('99');
    expect(unreadBadgeText(100)).toBe('99+');
  });
});

describe('deliverySummary', () => {
  it('lists the statuses that occur, in catalogue order, or a dash', () => {
    const L = az.notifications.deliveryStatuses;
    expect(deliverySummary(t, counts({ failed: 1, delivered: 2 }))).toBe(`${L.delivered}: 2 · ${L.failed}: 1`);
    expect(deliverySummary(t, counts({ queued: 3 }))).toBe(`${L.queued}: 3`);
    expect(deliverySummary(t, counts())).toBe('—');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/labels`
Expected: FAIL: `Failed to resolve import "./fixtures"`.

- [ ] **Step 3: Implement the helpers**

`apps/web/src/features/notifications/labels.ts`:

```ts
import { DELIVERY_STATUSES, type DeliveryCounts, isProblemType, type NotificationItem } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import type { ScheduleSearch } from '@/features/scheduling/routes';
import type { TasksSearch } from '@/features/tasks/routes';

export type NotificationLink = { to: '/schedule'; search: ScheduleSearch } | { to: '/tasks'; search: TasksSearch };

/**
 * Where a notification leads on the web (spec §8). `null`: it has no page of its own (manual messages, or a target
 * id that is missing) and the caller keeps the user in the inbox. Problems open the run's execution tab.
 */
export function notificationLink(n: Pick<NotificationItem, 'type' | 'targetKind' | 'targetId' | 'targetDate'>): NotificationLink | null {
  if (!n.targetId) return null;
  if (n.targetKind === 'task') return { to: '/tasks', search: { task: n.targetId } };
  if (n.targetKind === 'occurrence') {
    return {
      to: '/schedule',
      search: {
        // Without a date the schedule opens the current week; the drawer still opens the occurrence.
        ...(n.targetDate ? { date: n.targetDate } : {}),
        occurrence: n.targetId,
        ...(isProblemType(n.type) ? { tab: 'execution' as const } : {}),
      },
    };
  }
  return null;
}

export const UNREAD_BADGE_MAX = 99;

/** The bell's badge: nothing at 0, the number up to 99, then "99+". */
export const unreadBadgeText = (count: number): string | null =>
  count <= 0 ? null : count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count);

/** "Çatdırılıb: 2 · Uğursuz: 1": the statuses that occur on one channel, in DELIVERY_STATUSES order. */
export function deliverySummary(t: TFunction, counts: DeliveryCounts): string {
  const parts = DELIVERY_STATUSES.filter((s) => counts[s] > 0).map((s) => `${t(`notifications.deliveryStatuses.${s}`)}: ${counts[s]}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}
```

- [ ] **Step 4: Implement the queries**

`apps/web/src/features/notifications/queries.ts`:

```ts
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/session';

/** Spec §8: the badge polls every 30 s and on window focus. */
export const UNREAD_REFETCH_MS = 30_000;
/** The bell's popover lists the 10 latest. */
export const BELL_LIMIT = 10;
/** /notifications pages (spec §6.4: 30 per page). */
export const INBOX_PAGE_SIZE = 30;
/** Manual message history pages (cursorQuerySchema's default). */
export const MESSAGES_PAGE_SIZE = 50;

export const notificationKeys = {
  /** Every inbox query: invalidated after any read-state change. */
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  latest: ['notifications', 'latest'] as const,
  inbox: (unreadOnly: boolean) => ['notifications', 'inbox', unreadOnly] as const,
  rules: ['notification-rules'] as const,
  messages: ['notification-messages'] as const,
  messageList: ['notification-messages', 'list'] as const,
  message: (id: string) => ['notification-messages', 'detail', id] as const,
  targetOptions: (q: string) => ['notification-messages', 'options', q] as const,
};

/**
 * The unread badge. The app's defaults (30 s stale, no focus refetch) are overridden here: the count is always stale,
 * so it is asked again every 30 s and whenever the window gets focus.
 */
export const useUnreadCount = () =>
  useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: () => api.notifications.unreadCount(),
    refetchInterval: UNREAD_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

/** The bell's popover: asked only while it is open. */
export const useLatestNotifications = (enabled: boolean) =>
  useQuery({
    queryKey: notificationKeys.latest,
    queryFn: async () => (await api.notifications.list({ limit: BELL_LIMIT })).items,
    enabled,
    staleTime: 0,
  });

export const useInbox = (unreadOnly: boolean) =>
  useInfiniteQuery({
    queryKey: notificationKeys.inbox(unreadOnly),
    queryFn: ({ pageParam }) =>
      api.notifications.list({ cursor: pageParam, limit: INBOX_PAGE_SIZE, ...(unreadOnly ? { unread: 'true' as const } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSettled: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export const useNotificationRules = () => useQuery({ queryKey: notificationKeys.rules, queryFn: () => api.notificationRules.list() });

/** The message picker's options for `q` (people and teams are searched by the API; sites come whole). */
export const useMessageTargetOptions = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: notificationKeys.targetOptions(q),
    queryFn: () => api.messages.options(q ? { q } : {}),
    enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

export const useMessages = () =>
  useInfiniteQuery({
    queryKey: notificationKeys.messageList,
    queryFn: ({ pageParam }) => api.messages.list({ cursor: pageParam, limit: MESSAGES_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useMessage = (id: string) => useQuery({ queryKey: notificationKeys.message(id), queryFn: () => api.messages.get(id) });
```

- [ ] **Step 5: Add the shared test fixtures**

`apps/web/src/features/notifications/fixtures.ts`:

```ts
import {
  DEFAULT_RULES,
  type DeliveryCounts,
  type MessageDetail,
  type MessageSummary,
  type MessageTargetOptions,
  type NotificationItem,
  type NotificationRuleDto,
  type RoleDto,
  RULE_TYPES,
  type RuleType,
  type SystemRoleKey,
} from '@taskop/contracts';

/** Test data shared by the notification tests. Not imported by application code. */
export const AT = '2026-11-02T04:00:00.000Z';
export const SENDER = { id: 'mgr', fullName: 'Leyla Quliyeva' };
export const WORKER = { id: 'w1', fullName: 'Nigar Səfərli' };
export const ROLE_IDS: Record<SystemRoleKey, string> = { owner: 'r-own', admin: 'r-adm', manager: 'r-mgr', worker: 'r-wrk', auditor: 'r-aud' };

export const notificationItem = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  type: 'task.assigned',
  title: 'Yeni tapşırıq',
  body: 'Soyuducunun qapısını təmir edin',
  targetKind: 'task',
  targetId: 't1',
  targetDate: null,
  createdAt: AT,
  readAt: null,
  ...over,
});

/** Unread, opens task t1. */
export const taskNote = notificationItem();
/** Unread critical problem of occurrence o1 on 2 November: opens the execution tab. */
export const problemNote = notificationItem({
  id: 'n2',
  type: 'problem.critical',
  title: 'Kritik problem',
  body: 'Anbar №1 · Açılış: Kondisioner xarabdır',
  targetKind: 'occurrence',
  targetId: 'o1',
  targetDate: '2026-11-02',
});
/** A manual message, already read, with no page of its own. */
export const messageNote = notificationItem({
  id: 'n3',
  type: 'manual',
  title: 'Sabah iclas var',
  body: 'Saat 10:00-da ofisdə iclas olacaq.',
  targetKind: 'none',
  targetId: null,
  readAt: '2026-11-02T05:00:00.000Z',
});

/** The effective default of `type`, as GET /notification-rules returns it for a tenant without an override. */
export const ruleDto = (type: RuleType, over: Partial<NotificationRuleDto> = {}): NotificationRuleDto => {
  const d = DEFAULT_RULES[type];
  return {
    type,
    enabled: d.enabled,
    push: d.push,
    email: d.email,
    notifyAssignees: d.notifyAssignees,
    notifyCreator: d.notifyCreator,
    roleIds: d.systemRoles.map((k) => ROLE_IDS[k]),
    leadMinutes: d.leadMinutes,
    isDefault: true,
    ...over,
  };
};

export const allRules = (over: Partial<Record<RuleType, Partial<NotificationRuleDto>>> = {}): NotificationRuleDto[] =>
  RULE_TYPES.map((type) => ruleDto(type, over[type]));

const role = (systemKey: SystemRoleKey): RoleDto => ({
  id: ROLE_IDS[systemKey],
  name: systemKey,
  systemKey,
  dataScope: 'all',
  editable: systemKey !== 'owner',
  active: true,
  permissions: [],
  userCount: 1,
});

/** The five system roles and one inactive custom role. */
export const roleList = (): RoleDto[] => [
  role('owner'),
  role('admin'),
  role('manager'),
  role('worker'),
  role('auditor'),
  { id: 'r-old', name: 'Köhnə rol', systemKey: null, dataScope: 'own', editable: true, active: false, permissions: [], userCount: 0 },
];

export const counts = (over: Partial<DeliveryCounts> = {}): DeliveryCounts => ({ queued: 0, sent: 0, delivered: 0, failed: 0, skipped: 0, ...over });

/** Sent to three people: one read it; push delivered to one, failed for one, the third has no phone. */
export const messageSummary = (over: Partial<MessageSummary> = {}): MessageSummary => ({
  id: 'm1',
  title: 'Sabah iclas var',
  body: 'Saat 10:00-da ofisdə iclas olacaq.',
  sender: SENDER,
  sentAt: AT,
  emailRequested: false,
  processed: true,
  recipientCount: 3,
  readCount: 1,
  push: counts({ delivered: 1, failed: 1 }),
  email: counts(),
  ...over,
});

export const messageDetail = (over: Partial<MessageDetail> = {}): MessageDetail => ({
  ...messageSummary(),
  targets: { users: [WORKER], teams: [{ id: 'team1', name: 'Texniki xidmət' }], sites: [] },
  recipients: [
    { user: { id: 'w3', fullName: 'Aysel Məmmədova' }, readAt: null, push: { status: null, devices: 0, lastError: null }, email: { status: null, lastError: null } },
    {
      user: { id: 'w2', fullName: 'Murad Əliyev' },
      readAt: null,
      push: { status: 'failed', devices: 1, lastError: 'DeviceNotRegistered' },
      email: { status: null, lastError: null },
    },
    { user: WORKER, readAt: '2026-11-02T05:00:00.000Z', push: { status: 'delivered', devices: 2, lastError: null }, email: { status: null, lastError: null } },
  ],
  ...over,
});

export const targetOptions = (over: Partial<MessageTargetOptions> = {}): MessageTargetOptions => ({
  users: [
    { id: 'w1', fullName: 'Nigar Səfərli', jobTitle: 'Texnik' },
    { id: 'w2', fullName: 'Murad Əliyev', jobTitle: null },
  ],
  teams: [{ id: 'team1', name: 'Texniki xidmət', memberCount: 3 }],
  sites: [
    { id: 'site1', name: 'Anbar №1' },
    { id: 'site2', name: 'Ofis' },
  ],
  ...over,
});
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/notifications/labels && pnpm --filter @taskop/web typecheck`
Expected: PASS (4 tests). The typecheck covers `queries.ts` and `fixtures.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/notifications/labels.ts apps/web/src/features/notifications/labels.test.ts apps/web/src/features/notifications/queries.ts apps/web/src/features/notifications/fixtures.ts
git commit -m "feat(web): add notification links, badge text, delivery summaries, queries and fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The inbox page, opening a notification, and the `/notifications` route

**Files:**
- Create: `apps/web/src/features/notifications/open-notification.ts`, `apps/web/src/features/notifications/notification-row.tsx`, `apps/web/src/features/notifications/notifications-page.tsx`
- Modify: `apps/web/src/router.tsx`
- Test: `apps/web/src/features/notifications/notifications-page.test.tsx`

**Interfaces:**
- Consumes: Task 2's `notificationLink`, `notificationKeys`, `useInbox`, `useUnreadCount`, `useMarkAllRead`, fixtures; Part 1's `api.notifications.{list, markRead, markAllRead, unreadCount}`, `NotificationItem`; existing `useFormatDateTime`, `PageHeader`, `Checkbox`, `Label`, `errorText`.
- Produces:
  - `useOpenNotification(): (n: NotificationItem, opts: { inboxFallback: boolean }) => Promise<void>` — marks an unread row read (errors swallowed), invalidates `notificationKeys.all`, navigates to `notificationLink(n)`, or to `/notifications` when there is none and `inboxFallback` is set
  - `NotificationRow({ item, onOpen, compact? })` — an `<li>` with one `<button>`: bold title + dot + sr-only "Oxunmamış" when unread, body (two lines when `compact`), time
  - `NotificationsPage()`; route `/notifications` (no permission)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/notifications-page.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { messageNote, problemNote, taskNote } from './fixtures';
import { NotificationsPage } from './notifications-page';

const mocks = vi.hoisted(() => ({
  api: { notifications: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.notifications.unreadCount.mockResolvedValue({ count: 2 });
  mocks.api.notifications.markRead.mockResolvedValue(undefined);
  mocks.api.notifications.markAllRead.mockResolvedValue(undefined);
});

describe('NotificationsPage', () => {
  it('lists the inbox 30 at a time with unread rows marked, and loads more with the cursor', async () => {
    mocks.api.notifications.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor ? { items: [messageNote], nextCursor: null } : { items: [taskNote, problemNote], nextCursor: 'n2' },
    );
    renderWithRouter(<NotificationsPage />, '/notifications');
    const list = await screen.findByRole('list', { name: 'Bildirişlər' });
    expect(mocks.api.notifications.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 30 }));
    expect(mocks.api.notifications.list.mock.calls[0]![0]).not.toHaveProperty('unread');
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Yeni tapşırıq');
    expect(first).toHaveTextContent('Soyuducunun qapısını təmir edin');
    expect(first).toHaveTextContent('Oxunmamış');
    expect(second).toHaveTextContent('Kritik problem');
    await userEvent.click(screen.getByRole('button', { name: 'Daha çox göstər' }));
    expect(await within(list).findByText('Sabah iclas var')).toBeInTheDocument();
    expect(mocks.api.notifications.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'n2', limit: 30 }));
    expect(within(list).getAllByRole('listitem')[2]).not.toHaveTextContent('Oxunmamış');
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
  });

  it('shows unread ones only when asked', async () => {
    mocks.api.notifications.list.mockImplementation(async (q: { unread?: string }) =>
      q.unread ? { items: [], nextCursor: null } : { items: [messageNote], nextCursor: null },
    );
    renderWithRouter(<NotificationsPage />, '/notifications');
    await screen.findByText('Sabah iclas var');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Yalnız oxunmamışlar' }));
    expect(await screen.findByText('Oxunmamış bildiriş yoxdur')).toBeInTheDocument();
    expect(mocks.api.notifications.list).toHaveBeenLastCalledWith(expect.objectContaining({ unread: 'true', limit: 30 }));
  });

  it('marks a row read and opens its target: a problem on the execution tab; a message without a page stays here', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote, { ...messageNote, readAt: null }], nextCursor: null });
    const router = renderWithRouter(<NotificationsPage />, '/notifications');
    await userEvent.click(await screen.findByRole('button', { name: /Sabah iclas var/ }));
    await waitFor(() => expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n3'));
    expect(router.state.location.pathname).toBe('/notifications');
    await userEvent.click(screen.getByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n2');
    // The count and the lists are asked again after each mark.
    await waitFor(() => expect(mocks.api.notifications.unreadCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('marks everything read', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [taskNote], nextCursor: null });
    renderWithRouter(<NotificationsPage />, '/notifications');
    await screen.findByText('Yeni tapşırıq');
    const markAll = screen.getByRole('button', { name: 'Hamısını oxunmuş et' });
    await waitFor(() => expect(markAll).toBeEnabled());
    await userEvent.click(markAll);
    await waitFor(() => expect(mocks.api.notifications.markAllRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.api.notifications.list).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/notifications-page`
Expected: FAIL: `Failed to resolve import "./notifications-page"`.

- [ ] **Step 3: Implement opening a notification and the row**

`apps/web/src/features/notifications/open-notification.ts`:

```ts
import type { NotificationItem } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { api } from '@/lib/session';
import { notificationLink } from './labels';
import { notificationKeys } from './queries';

/**
 * Opening a notification (spec §8): an unread one is marked read first. A failure there (the row was cleaned up after
 * 90 days, 404, or the network dropped) never stops the user reaching the target; the refetch shows the true state.
 * Without a page of its own it opens the inbox when `inboxFallback` is set (the bell) or stays (the inbox page).
 */
export function useOpenNotification() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useCallback(
    async (n: NotificationItem, { inboxFallback }: { inboxFallback: boolean }): Promise<void> => {
      if (n.readAt === null) {
        try {
          await api.notifications.markRead(n.id);
        } catch {
          // Deliberately ignored: see above.
        }
        void qc.invalidateQueries({ queryKey: notificationKeys.all });
      }
      const link = notificationLink(n);
      if (link?.to === '/schedule') await navigate({ to: '/schedule', search: link.search });
      else if (link?.to === '/tasks') await navigate({ to: '/tasks', search: link.search });
      else if (inboxFallback) await navigate({ to: '/notifications' });
    },
    [qc, navigate],
  );
}
```

`apps/web/src/features/notifications/notification-row.tsx`:

```tsx
import type { NotificationItem } from '@taskop/contracts';
import { useTranslation } from 'react-i18next';
import { useFormatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  item: NotificationItem;
  onOpen: (item: NotificationItem) => void;
  /** The bell's popover: the body is cut to two lines. */
  compact?: boolean;
}

/** One inbox entry (bell and /notifications). The whole row is the button; unread ones are bold with a dot. */
export function NotificationRow({ item, onOpen, compact = false }: Props) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const unread = item.readAt === null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn('hover:bg-accent grid w-full gap-0.5 rounded-md px-3 py-2 text-left', unread && 'bg-accent/40')}
      >
        <span className="flex items-center gap-2">
          {unread && <span aria-hidden className="bg-primary size-2 shrink-0 rounded-full" />}
          <span className={cn('text-sm', unread ? 'font-semibold' : 'font-normal')}>{item.title}</span>
          {unread && <span className="sr-only">{t('notifications.inbox.unread')}</span>}
        </span>
        <span className={cn('text-muted-foreground text-sm whitespace-pre-line', compact && 'line-clamp-2')}>{item.body}</span>
        <span className="text-muted-foreground text-xs">{formatDateTime(item.createdAt)}</span>
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Implement the page**

`apps/web/src/features/notifications/notifications-page.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { errorText } from '@/lib/errors';
import { NotificationRow } from './notification-row';
import { useOpenNotification } from './open-notification';
import { useInbox, useMarkAllRead, useUnreadCount } from './queries';

/** Spec §8: the full inbox, newest first, 30 per page, with an "unread only" filter. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const inbox = useInbox(unreadOnly);
  const unread = useUnreadCount();
  const markAll = useMarkAllRead();
  const openNotification = useOpenNotification();
  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader
        title={t('notifications.title')}
        actions={
          <Button variant="outline" disabled={(unread.data?.count ?? 0) === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            {t('notifications.markAllRead')}
          </Button>
        }
      />
      <div className="flex items-center gap-2">
        <Checkbox id="notifications-unread-only" checked={unreadOnly} onCheckedChange={(c) => setUnreadOnly(c === true)} />
        <Label htmlFor="notifications-unread-only" className="font-normal">
          {t('notifications.inbox.unreadOnly')}
        </Label>
      </div>
      {inbox.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {inbox.error && <p className="text-destructive">{errorText(t, inbox.error)}</p>}
      {inbox.isSuccess && items.length === 0 && (
        <p className="text-muted-foreground">{unreadOnly ? t('notifications.inbox.emptyUnread') : t('notifications.empty')}</p>
      )}
      {items.length > 0 && (
        <ul aria-label={t('notifications.title')} className="grid gap-1 rounded-md border p-1">
          {items.map((n) => (
            <NotificationRow key={n.id} item={n} onOpen={(item) => void openNotification(item, { inboxFallback: false })} />
          ))}
        </ul>
      )}
      {inbox.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={inbox.isFetchingNextPage} onClick={() => void inbox.fetchNextPage()}>
          {t('notifications.inbox.more')}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add the route**

In `apps/web/src/router.tsx`:
- add after `import { HomePage } from '@/features/home/home-page';`:

```tsx
import { NotificationsPage } from '@/features/notifications/notifications-page';
```

- add after the `tasksRoute` line (line 116):

```tsx
const notificationsRoute = createRoute({ getParentRoute: () => appLayout, path: '/notifications', component: NotificationsPage });
```

- in `appLayout.addChildren([...])`, add `notificationsRoute,` after `tasksRoute,`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/notifications && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (4 page tests, 4 label tests); `router.test.tsx` still passes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/notifications/open-notification.ts apps/web/src/features/notifications/notification-row.tsx apps/web/src/features/notifications/notifications-page.tsx apps/web/src/features/notifications/notifications-page.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): add the notifications inbox page, its route and opening a notification" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The header bell with its popover

**Files:**
- Create: `apps/web/src/components/ui/popover.tsx`, `apps/web/src/features/notifications/notification-bell.tsx`
- Modify: `apps/web/src/layouts/app-shell.tsx:84` (the header's right-hand group)
- Test: `apps/web/src/features/notifications/notification-bell.test.tsx`, `apps/web/src/layouts/app-shell.test.tsx`

**Interfaces:**
- Consumes: Task 2's `useUnreadCount`, `useLatestNotifications`, `useMarkAllRead`, `unreadBadgeText`, `notificationKeys`, fixtures; Task 3's `useOpenNotification`, `NotificationRow`, route `/notifications`; `az.nav.notifications`, `az.notifications.{title, markAllRead, empty, bell.*}`.
- Produces:
  - `components/ui/popover.tsx`: `Popover`, `PopoverTrigger`, `PopoverContent` (portal, `align` default `"center"`, `sideOffset` 4; Radix gives it `role="dialog"`), `PopoverAnchor`
  - `NotificationBell()` — the header button (name "Bildirişlər" / "Bildirişlər: N oxunmamış", badge `unreadBadgeText`) and its popover (`aria-label` "Bildirişlər": "Hamısını oxunmuş et", the 10 latest as `NotificationRow compact`, "Hamısına bax")
  - `AppShell` renders `<NotificationBell />` left of the user name

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/notification-bell.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { focusManager, QueryClient } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { messageNote, problemNote, taskNote } from './fixtures';
import { NotificationBell } from './notification-bell';
import { notificationKeys } from './queries';

const mocks = vi.hoisted(() => ({
  api: { notifications: { list: vi.fn(), unreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

/** Opens the popover once the count (3 by default) has arrived, so its "Hamısını oxunmuş et" is enabled. */
const openBell = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Bildirişlər: 3 oxunmamış' }));
  return screen.findByRole('dialog', { name: 'Bildirişlər' });
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.notifications.unreadCount.mockResolvedValue({ count: 3 });
  mocks.api.notifications.list.mockResolvedValue({ items: [taskNote, problemNote, messageNote], nextCursor: null });
  mocks.api.notifications.markRead.mockResolvedValue(undefined);
  mocks.api.notifications.markAllRead.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('NotificationBell', () => {
  it('shows the unread count and asks again every 30 s and when the window gets focus', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.api.notifications.unreadCount.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 4 }).mockResolvedValue({ count: 5 });
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 3 oxunmamış' })).toHaveTextContent('3');
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 4 oxunmamış' })).toHaveTextContent('4');
    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 5 oxunmamış' })).toBeInTheDocument();
    // Closed, the popover asks for nothing.
    expect(mocks.api.notifications.list).not.toHaveBeenCalled();
  });

  it('counts above 99 as 99+ and shows no badge at zero', async () => {
    mocks.api.notifications.unreadCount.mockResolvedValue({ count: 120 });
    renderWithRouter(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 120 oxunmamış' })).toHaveTextContent('99+');
    cleanup();
    mocks.api.notifications.unreadCount.mockResolvedValue({ count: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    renderWithRouter(<NotificationBell />, '/', client);
    await waitFor(() => expect(client.getQueryData(notificationKeys.unreadCount)).toEqual({ count: 0 }));
    expect(screen.getByRole('button', { name: 'Bildirişlər' }).textContent).toBe('');
  });

  it('lists the 10 latest; a task row marks itself read, closes the popover and opens the task', async () => {
    const router = renderWithRouter(<NotificationBell />);
    const popover = await openBell();
    const rows = await within(popover).findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(mocks.api.notifications.list).toHaveBeenCalledWith({ limit: 10 });
    expect(rows[0]).toHaveTextContent('Oxunmamış');
    expect(rows[2]).not.toHaveTextContent('Oxunmamış');
    await userEvent.click(within(rows[0]!).getByRole('button'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
    expect(router.state.location.search).toEqual({ task: 't1' });
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.api.notifications.unreadCount).toHaveBeenCalledTimes(2));
  });

  it('opens a problem on the execution tab and a message without a page in the inbox, without marking read rows again', async () => {
    mocks.api.notifications.list.mockResolvedValue({ items: [problemNote, messageNote], nextCursor: null });
    const router = renderWithRouter(<NotificationBell />);
    await userEvent.click(await within(await openBell()).findByRole('button', { name: /Sabah iclas var/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    expect(mocks.api.notifications.markRead).not.toHaveBeenCalled();
    await userEvent.click(await within(await openBell()).findByRole('button', { name: /Kritik problem/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
    expect(mocks.api.notifications.markRead).toHaveBeenCalledWith('n2');
  });

  it('a row whose mark-read fails still opens its target', async () => {
    mocks.api.notifications.markRead.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    const router = renderWithRouter(<NotificationBell />);
    await userEvent.click(await within(await openBell()).findByRole('button', { name: /Yeni tapşırıq/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 't1' }));
    expect(router.state.location.pathname).toBe('/tasks');
    // The badge is asked again even though the mark failed.
    await waitFor(() => expect(mocks.api.notifications.unreadCount).toHaveBeenCalledTimes(2));
  });

  it('marks all read and links to the full inbox', async () => {
    const router = renderWithRouter(<NotificationBell />);
    const popover = await openBell();
    mocks.api.notifications.unreadCount.mockResolvedValue({ count: 0 });
    await userEvent.click(within(popover).getByRole('button', { name: 'Hamısını oxunmuş et' }));
    await waitFor(() => expect(mocks.api.notifications.markAllRead).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Bildirişlər' })).toBeInTheDocument();
    const all = within(popover).getByRole('link', { name: 'Hamısına bax' });
    expect(all).toHaveAttribute('href', '/notifications');
    await userEvent.click(all);
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

In `apps/web/src/layouts/app-shell.test.tsx`:
- replace the `api: { auth: { resendVerification: vi.fn() } },` line of the `vi.mock('@/lib/session', …)` factory with:

```tsx
  api: {
    auth: { resendVerification: vi.fn() },
    notifications: { unreadCount: vi.fn(async () => ({ count: 2 })), list: vi.fn(async () => ({ items: [], nextCursor: null })) },
  },
```

- add after the `shows tasks to holders of tasks.view or tasks.manage` test:

```tsx
  it('shows the notification bell with the unread count in the header', async () => {
    state.current = { status: 'authenticated', me: me([]) };
    renderShell();
    expect(await screen.findByRole('button', { name: 'Bildirişlər: 2 oxunmamış' })).toHaveTextContent('2');
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/notification-bell layouts/app-shell`
Expected: FAIL: `Failed to resolve import "./notification-bell"`; the new app-shell test finds no bell.

- [ ] **Step 3: Add the popover primitive**

`apps/web/src/components/ui/popover.tsx`:

```tsx
"use client"

import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger }
```

- [ ] **Step 4: Implement the bell**

`apps/web/src/features/notifications/notification-bell.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { errorText } from '@/lib/errors';
import { unreadBadgeText } from './labels';
import { NotificationRow } from './notification-row';
import { useOpenNotification } from './open-notification';
import { useLatestNotifications, useMarkAllRead, useUnreadCount } from './queries';

/** Spec §8: the header bell. The badge polls (30 s, focus); the popover lists the 10 latest while it is open. */
export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const latest = useLatestNotifications(open);
  const markAll = useMarkAllRead();
  const openNotification = useOpenNotification();
  const count = unread.data?.count ?? 0;
  const badge = unreadBadgeText(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count > 0 ? t('notifications.bell.unread', { count }) : t('nav.notifications')}
        >
          <Bell className="size-4" aria-hidden />
          {badge && (
            <span aria-hidden className="bg-destructive absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold text-white">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" aria-label={t('notifications.title')}>
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="font-medium">{t('notifications.title')}</span>
          <Button variant="ghost" size="sm" disabled={count === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            {t('notifications.markAllRead')}
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {latest.isPending && <p className="text-muted-foreground px-3 py-2">{t('common.loading')}</p>}
          {latest.isError && <p className="text-destructive px-3 py-2">{errorText(t, latest.error)}</p>}
          {latest.isSuccess && latest.data.length === 0 && <p className="text-muted-foreground px-3 py-2">{t('notifications.empty')}</p>}
          {latest.isSuccess && latest.data.length > 0 && (
            <ul aria-label={t('notifications.title')} className="grid gap-0.5">
              {latest.data.map((n) => (
                <NotificationRow
                  key={n.id}
                  item={n}
                  compact
                  onOpen={(item) => {
                    setOpen(false);
                    void openNotification(item, { inboxFallback: true });
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t px-3 py-2 text-right">
          <Link to="/notifications" className="text-sm font-medium underline-offset-4 hover:underline" onClick={() => setOpen(false)}>
            {t('notifications.bell.viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: Put the bell in the header**

In `apps/web/src/layouts/app-shell.tsx`:
- add after `import { Button } from '@/components/ui/button';`:

```tsx
import { NotificationBell } from '@/features/notifications/notification-bell';
```

- inside the header, make `<NotificationBell />` the first child of `<div className="flex items-center gap-3">` (line 84), before the `<div className="text-right text-sm">` name block:

```tsx
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="text-right text-sm">
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS: the whole web suite, including 6 bell tests and 5 app-shell tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/popover.tsx apps/web/src/features/notifications/notification-bell.tsx apps/web/src/features/notifications/notification-bell.test.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/layouts/app-shell.test.tsx
git commit -m "feat(web): add the header notification bell with unread badge, popover and mark-all-read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Settings tabs and the notification rules tab

**Files:**
- Create: `apps/web/src/components/ui/switch.tsx`, `apps/web/src/features/notifications/rules-form.ts`, `apps/web/src/features/notifications/rules-tab.tsx`
- Modify: `apps/web/src/features/settings/settings-page.tsx`
- Test: `apps/web/src/features/notifications/rules-form.test.ts`, `apps/web/src/features/notifications/rules-tab.test.tsx`, `apps/web/src/features/settings/settings-page.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `NOTIFICATION_GROUPS`, `NOTIFICATION_TYPE_META`, `LEAD_MINUTES`, `DEFAULT_RULES`, types `LeadMinutes`, `NotificationRuleDto`, `RuleType`, `UpdateNotificationRuleInput`; `api.notificationRules.{list, update, reset}`; `az.notifications.{types, groups, audiences, channels, issues, leadMinutes}`; permission `notifications.manage`
  - Task 2: `useNotificationRules`, `notificationKeys.rules`, fixtures `allRules`, `ruleDto`, `roleList`, `ROLE_IDS`; Task 4: `Popover*`
  - Existing: `useRoles`, `roleDisplayName` (`features/roles/queries.ts`), `CheckboxList`, `NativeSelect`, `Tabs*`, `Table*`, `useCan`, `errorText`
- Produces:
  - `components/ui/switch.tsx`: `Switch` (Radix, `role="switch"`)
  - `rules-form.ts`: `interface RuleDraft { enabled; push; email; notifyAssignees; notifyCreator; roleIds: string[]; leadMinutes: LeadMinutes | null }`, `draftOf(rule): RuleDraft`, `ruleBody(type, draft): UpdateNotificationRuleInput`, `sameDraft(a, b): boolean`
  - `NotificationRulesTab()` — sections per `NOTIFICATION_GROUPS` (`role="region"` named by the group), one row per rule; controls named "`<type label>` — `<control>`"
  - `SettingsPage`: tabs "Təşkilat" | "Bildirişlər" for `notifications.manage`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/rules-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ruleDto } from './fixtures';
import { draftOf, ruleBody, sameDraft } from './rules-form';

const all = { enabled: true, push: true, email: true, notifyAssignees: true, notifyCreator: true, roleIds: ['r1', 'r1', 'r2'], leadMinutes: 60 } as const;

describe('rule form', () => {
  it('sends the full rule with only the audiences and the lead time the type has, each role once', () => {
    expect(ruleBody('problem.critical', { ...all, roleIds: [...all.roleIds] })).toEqual({
      enabled: true,
      push: true,
      email: true,
      notifyAssignees: false,
      notifyCreator: false,
      roleIds: ['r1', 'r2'],
      leadMinutes: null,
    });
    expect(ruleBody('checklist.due_soon', { ...all, roleIds: [], leadMinutes: null })).toEqual({
      enabled: true,
      push: true,
      email: true,
      notifyAssignees: true,
      notifyCreator: false,
      roleIds: [],
      // A due-soon rule always carries a lead time: the default (30) when none was picked.
      leadMinutes: 30,
    });
    expect(ruleBody('task.overdue', { ...all, roleIds: [] })).toMatchObject({ notifyAssignees: true, notifyCreator: true, leadMinutes: null });
  });

  it('compares drafts by value, ignoring the order of roles', () => {
    const a = draftOf(ruleDto('problem.critical'));
    expect(sameDraft(a, { ...a, roleIds: [...a.roleIds].reverse() })).toBe(true);
    expect(sameDraft(a, { ...a, email: false })).toBe(false);
    expect(sameDraft(a, { ...a, roleIds: a.roleIds.slice(1) })).toBe(false);
  });
});
```

`apps/web/src/features/notifications/rules-tab.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import type { RuleType } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { allRules, ROLE_IDS, roleList, ruleDto } from './fixtures';
import { NotificationRulesTab } from './rules-tab';

const mocks = vi.hoisted(() => ({
  api: { notificationRules: { list: vi.fn(), update: vi.fn(), reset: vi.fn() }, roles: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

/** A rule row's control: "<type label> — <control>" (the type labels are Part 1's). */
const ctl = (type: RuleType, control: string) => `${az.notifications.types[type]} — ${control}`;
const { audiences, channels } = az.notifications;
const answer = async (type: RuleType, body: object) => ({ ...ruleDto(type), ...body, isDefault: false });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.notificationRules.list.mockResolvedValue(allRules({ 'problem.critical': { email: false, isDefault: false } }));
  mocks.api.roles.list.mockResolvedValue(roleList());
});

describe('NotificationRulesTab', () => {
  it('groups the rules, offers only the audiences and the lead time each type has, and marks customised rows', async () => {
    renderWithProviders(<NotificationRulesTab />);
    for (const g of ['checklist', 'problem', 'task'] as const) {
      expect(await screen.findByRole('region', { name: az.notifications.groups[g] })).toBeInTheDocument();
    }
    // Header row + problem.recorded + problem.critical.
    expect(within(screen.getByRole('region', { name: az.notifications.groups.problem })).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('checkbox', { name: ctl('problem.recorded', audiences.assignees) })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: ctl('checklist.overdue', audiences.creator) })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: ctl('task.overdue', audiences.creator) })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: ctl('checklist.missed', channels.push) })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: ctl('task.assigned', 'Aktiv') })).toBeChecked();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: ctl('checklist.due_soon', 'Xatırlatma vaxtı') })).toHaveValue('30');
    // Until GET /roles answers the button is a disabled count; then it names the roles.
    await waitFor(() => expect(screen.getByRole('button', { name: ctl('problem.critical', 'Rollar') })).toHaveTextContent('Administrator, Menecer'));
    const critical = screen.getByRole('button', { name: ctl('problem.critical', 'Yadda saxla') }).closest('tr')!;
    expect(critical).toHaveTextContent('Dəyişdirilib');
    expect(within(critical).getByRole('button', { name: ctl('problem.critical', 'Defolta qaytar') })).toBeInTheDocument();
    const recorded = screen.getByRole('button', { name: ctl('problem.recorded', 'Yadda saxla') });
    expect(recorded.closest('tr')).not.toHaveTextContent('Dəyişdirilib');
    expect(recorded).toBeDisabled();
  });

  it('saves one row with its full rule and shows the answer', async () => {
    mocks.api.notificationRules.update.mockImplementation(answer);
    renderWithProviders(<NotificationRulesTab />);
    const save = await screen.findByRole('button', { name: ctl('checklist.due_soon', 'Yadda saxla') });
    expect(save).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: ctl('checklist.due_soon', 'Xatırlatma vaxtı') }), '60');
    await userEvent.click(screen.getByRole('checkbox', { name: ctl('checklist.due_soon', channels.email) }));
    // The roles button becomes a popover trigger once GET /roles has answered.
    await waitFor(() => expect(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Rollar') })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Rollar') }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Administrator' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Rollar') })).toHaveTextContent('Administrator');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(mocks.api.notificationRules.update).toHaveBeenCalledWith('checklist.due_soon', {
        enabled: true,
        push: true,
        email: true,
        notifyAssignees: true,
        notifyCreator: false,
        roleIds: [ROLE_IDS.admin],
        leadMinutes: 60,
      }),
    );
    expect(await within(save.closest('tr')!).findByText('Dəyişdirilib')).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('puts a customised rule back to the default', async () => {
    mocks.api.notificationRules.reset.mockResolvedValue(ruleDto('problem.critical'));
    renderWithProviders(<NotificationRulesTab />);
    const email = await screen.findByRole('checkbox', { name: ctl('problem.critical', channels.email) });
    expect(email).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: ctl('problem.critical', 'Defolta qaytar') }));
    await waitFor(() => expect(mocks.api.notificationRules.reset).toHaveBeenCalledWith('problem.critical'));
    await waitFor(() => expect(email).toBeChecked());
    expect(screen.queryByRole('button', { name: ctl('problem.critical', 'Defolta qaytar') })).not.toBeInTheDocument();
    expect(email.closest('tr')).not.toHaveTextContent('Dəyişdirilib');
  });

  it("shows the server's reasons under the row", async () => {
    mocks.api.notificationRules.update.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { leadMinutes: 'notifications.issues.leadMinutesRequired' }),
    );
    renderWithProviders(<NotificationRulesTab />);
    await userEvent.click(await screen.findByRole('checkbox', { name: ctl('checklist.due_soon', channels.email) }));
    await userEvent.click(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Yadda saxla') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(az.notifications.issues.leadMinutesRequired);
  });

  it('without the roles list keeps the chosen roles and still saves the row', async () => {
    mocks.api.roles.list.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN'));
    mocks.api.notificationRules.update.mockImplementation(answer);
    renderWithProviders(<NotificationRulesTab />);
    expect(await screen.findByText('Rolların siyahısı yüklənmədi; seçilmiş rollar dəyişməz qalır.')).toBeInTheDocument();
    const roles = screen.getByRole('button', { name: ctl('checklist.overdue', 'Rollar') });
    expect(roles).toBeDisabled();
    expect(roles).toHaveTextContent('1 rol');
    await userEvent.click(screen.getByRole('checkbox', { name: ctl('checklist.overdue', channels.push) }));
    await userEvent.click(screen.getByRole('button', { name: ctl('checklist.overdue', 'Yadda saxla') }));
    await waitFor(() =>
      expect(mocks.api.notificationRules.update).toHaveBeenCalledWith('checklist.overdue', expect.objectContaining({ push: false, roleIds: [ROLE_IDS.manager] })),
    );
  });
});
```

`apps/web/src/features/settings/settings-page.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allRules, roleList } from '@/features/notifications/fixtures';
import { renderWithProviders } from '@/test/render';
import { SettingsPage } from './settings-page';

const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  api: { tenant: { get: vi.fn() }, notificationRules: { list: vi.fn() }, roles: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: (...keys: string[]) => keys.every((k) => mocks.permissions.current.includes(k)),
  session: { setMe: vi.fn() },
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.tenant.get.mockResolvedValue({
    id: 't1',
    name: 'Acme',
    orgCode: 'acme',
    timezone: 'Asia/Baku',
    locale: 'az',
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  mocks.api.notificationRules.list.mockResolvedValue(allRules());
  mocks.api.roles.list.mockResolvedValue(roleList());
});

describe('SettingsPage', () => {
  it('without notifications.manage keeps the page as it was, without tabs', async () => {
    mocks.permissions.current = ['tenant.manage'];
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByLabelText('Təşkilatın adı')).toHaveValue('Acme');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(mocks.api.notificationRules.list).not.toHaveBeenCalled();
  });

  it('with notifications.manage shows Təşkilat and Bildirişlər tabs; the rules load on their tab', async () => {
    mocks.permissions.current = ['tenant.manage', 'notifications.manage'];
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByLabelText('Təşkilatın adı')).toHaveValue('Acme');
    expect(screen.getByRole('tab', { name: 'Təşkilat' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.notificationRules.list).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Bildirişlər' }));
    await waitFor(() => expect(mocks.api.notificationRules.list).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('region', { name: 'Tapşırıqlar' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Təşkilatın adı')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/rules features/settings`
Expected: FAIL: `Failed to resolve import "./rules-form"` and `"./rules-tab"`; the settings test finds no tablist.

- [ ] **Step 3: Add the switch primitive**

`apps/web/src/components/ui/switch.tsx`:

```tsx
"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-checked:translate-x-[calc(100%-2px)] data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

- [ ] **Step 4: Implement the rule form helpers**

`apps/web/src/features/notifications/rules-form.ts`:

```ts
import {
  DEFAULT_RULES,
  type LeadMinutes,
  NOTIFICATION_TYPE_META,
  type NotificationRuleDto,
  type RuleType,
  type UpdateNotificationRuleInput,
} from '@taskop/contracts';

/** A rule row while it is being edited. */
export interface RuleDraft {
  enabled: boolean;
  push: boolean;
  email: boolean;
  notifyAssignees: boolean;
  notifyCreator: boolean;
  roleIds: string[];
  leadMinutes: LeadMinutes | null;
}

export const draftOf = (r: NotificationRuleDto): RuleDraft => ({
  enabled: r.enabled,
  push: r.push,
  email: r.email,
  notifyAssignees: r.notifyAssignees,
  notifyCreator: r.notifyCreator,
  roleIds: [...r.roleIds],
  leadMinutes: r.leadMinutes,
});

/**
 * The full rule PUT /notification-rules/:type expects (Part 1: every field required). Audiences the type does not have
 * are false and the lead time is null unless the type has one, so the API never answers `audienceNotApplicable` or
 * `leadMinutesNotApplicable` for something the user could not see.
 */
export function ruleBody(type: RuleType, d: RuleDraft): UpdateNotificationRuleInput {
  const meta = NOTIFICATION_TYPE_META[type];
  return {
    enabled: d.enabled,
    push: d.push,
    email: d.email,
    notifyAssignees: meta.audiences.includes('assignees') && d.notifyAssignees,
    notifyCreator: meta.audiences.includes('creator') && d.notifyCreator,
    roleIds: [...new Set(d.roleIds)],
    leadMinutes: meta.hasLeadTime ? (d.leadMinutes ?? DEFAULT_RULES[type].leadMinutes) : null,
  };
}

export const sameDraft = (a: RuleDraft, b: RuleDraft): boolean =>
  a.enabled === b.enabled &&
  a.push === b.push &&
  a.email === b.email &&
  a.notifyAssignees === b.notifyAssignees &&
  a.notifyCreator === b.notifyCreator &&
  a.leadMinutes === b.leadMinutes &&
  a.roleIds.length === b.roleIds.length &&
  a.roleIds.every((id) => b.roleIds.includes(id));
```

- [ ] **Step 5: Implement the rules tab**

`apps/web/src/features/notifications/rules-tab.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import {
  LEAD_MINUTES,
  type LeadMinutes,
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPE_META,
  type NotificationRuleDto,
  type RoleDto,
  type UpdateNotificationRuleInput,
} from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckboxList } from '@/components/checkbox-list';
import { NativeSelect } from '@/components/native-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { roleDisplayName, useRoles } from '@/features/roles/queries';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { notificationKeys, useNotificationRules } from './queries';
import { draftOf, type RuleDraft, ruleBody, sameDraft } from './rules-form';

/** Spec §8, FR-15.09: the tenant's rules, grouped Checklist / Problem / Task; each row saves on its own. */
export function NotificationRulesTab() {
  const { t } = useTranslation();
  const rules = useNotificationRules();
  const roles = useRoles();
  if (rules.isPending) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  if (rules.isError) return <p className="text-destructive">{errorText(t, rules.error)}</p>;
  return (
    <div className="grid gap-6">
      <p className="text-muted-foreground text-sm">{t('notifications.rules.intro')}</p>
      {roles.isError && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('notifications.rules.rolesUnavailable')}
        </p>
      )}
      {NOTIFICATION_GROUPS.map((group) => (
        <section key={group} aria-labelledby={`rules-${group}`} className="grid gap-2">
          <h3 id={`rules-${group}`} className="font-medium">
            {t(`notifications.groups.${group}`)}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('notifications.rules.columns.type')}</TableHead>
                <TableHead>{t('notifications.rules.columns.enabled')}</TableHead>
                <TableHead>{t('notifications.channels.push')}</TableHead>
                <TableHead>{t('notifications.channels.email')}</TableHead>
                <TableHead>{t('notifications.audiences.assignees')}</TableHead>
                <TableHead>{t('notifications.audiences.creator')}</TableHead>
                <TableHead>{t('notifications.rules.columns.roles')}</TableHead>
                <TableHead>{t('notifications.rules.columns.leadTime')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.data
                .filter((r) => NOTIFICATION_TYPE_META[r.type].group === group)
                .map((r) => (
                  <RuleRow key={r.type} rule={r} roles={roles.isSuccess ? roles.data : null} />
                ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}

/** Field errors carry i18n keys (decision 11); anything else is the API's message. */
function rowError(t: TFunction, e: unknown): string {
  if (e instanceof ApiError && e.fields && Object.keys(e.fields).length > 0) return Object.values(e.fields).map((k) => t(k)).join(' ');
  return errorText(t, e);
}

function RuleRow({ rule, roles }: { rule: NotificationRuleDto; roles: RoleDto[] | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const meta = NOTIFICATION_TYPE_META[rule.type];
  const typeLabel = t(`notifications.types.${rule.type}`);
  const name = (control: string) => t('notifications.rules.control', { type: typeLabel, control });
  const [draft, setDraft] = useState<RuleDraft>(() => draftOf(rule));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  /** The server's answer replaces the row in the list and becomes the new draft (it may have dropped role ids). */
  const store = (saved: NotificationRuleDto) => {
    qc.setQueryData<NotificationRuleDto[]>(notificationKeys.rules, (list) => list?.map((r) => (r.type === saved.type ? saved : r)));
    setDraft(draftOf(saved));
    setError(null);
  };
  const save = useMutation({
    mutationFn: (body: UpdateNotificationRuleInput) => api.notificationRules.update(rule.type, body),
    onSuccess: (saved) => {
      store(saved);
      toast.success(t('common.saved'));
    },
    onError: (e) => setError(rowError(t, e)),
  });
  const reset = useMutation({
    mutationFn: () => api.notificationRules.reset(rule.type),
    onSuccess: (saved) => {
      store(saved);
      toast.success(t('notifications.rules.resetDone'));
    },
    onError: (e) => setError(rowError(t, e)),
  });
  const busy = save.isPending || reset.isPending;
  const dirty = !sameDraft(draft, draftOf(rule));

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{typeLabel}</span>
          {!rule.isDefault && <Badge variant="secondary">{t('notifications.rules.customized')}</Badge>}
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-1 text-sm">
            {error}
          </p>
        )}
      </TableCell>
      <TableCell>
        <Switch aria-label={name(t('notifications.rules.columns.enabled'))} checked={draft.enabled} onCheckedChange={(v) => set('enabled', v)} />
      </TableCell>
      <TableCell>
        <Checkbox aria-label={name(t('notifications.channels.push'))} checked={draft.push} onCheckedChange={(v) => set('push', v === true)} />
      </TableCell>
      <TableCell>
        <Checkbox aria-label={name(t('notifications.channels.email'))} checked={draft.email} onCheckedChange={(v) => set('email', v === true)} />
      </TableCell>
      <TableCell>
        {meta.audiences.includes('assignees') ? (
          <Checkbox
            aria-label={name(t('notifications.audiences.assignees'))}
            checked={draft.notifyAssignees}
            onCheckedChange={(v) => set('notifyAssignees', v === true)}
          />
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        {meta.audiences.includes('creator') ? (
          <Checkbox
            aria-label={name(t('notifications.audiences.creator'))}
            checked={draft.notifyCreator}
            onCheckedChange={(v) => set('notifyCreator', v === true)}
          />
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        <RolePicker label={name(t('notifications.rules.columns.roles'))} roles={roles} value={draft.roleIds} onChange={(ids) => set('roleIds', ids)} />
      </TableCell>
      <TableCell>
        {meta.hasLeadTime ? (
          <NativeSelect
            aria-label={name(t('notifications.rules.columns.leadTime'))}
            value={String(draft.leadMinutes ?? '')}
            onChange={(e) => set('leadMinutes', Number(e.target.value) as LeadMinutes)}
            className="w-36"
          >
            {LEAD_MINUTES.map((m) => (
              <option key={m} value={m}>
                {t('notifications.leadMinutes', { count: m })}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span aria-hidden>—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button size="sm" aria-label={name(t('common.save'))} disabled={!dirty || busy} onClick={() => save.mutate(ruleBody(rule.type, draft))}>
            {t('common.save')}
          </Button>
          {!rule.isDefault && (
            <Button size="sm" variant="outline" aria-label={name(t('notifications.rules.reset'))} disabled={busy} onClick={() => reset.mutate()}>
              {t('notifications.rules.reset')}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Roles whose holders in scope also get the notification. Without GET /roles (no roles.view, decision 10) the button
 * shows how many are chosen and is disabled; the stored ids travel unchanged in the draft.
 */
function RolePicker({ label, roles, value, onChange }: { label: string; roles: RoleDto[] | null; value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  if (!roles) {
    return (
      <Button variant="outline" size="sm" aria-label={label} disabled>
        {value.length > 0 ? t('notifications.rules.rolesCount', { count: value.length }) : t('notifications.rules.noRoles')}
      </Button>
    );
  }
  const options = roles.filter((r) => r.active || value.includes(r.id)).map((r) => ({ value: r.id, label: roleDisplayName(t, r) }));
  const names = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} className="max-w-56 justify-start truncate">
          {names.length > 0 ? names.join(', ') : t('notifications.rules.noRoles')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label={label}>
        <CheckboxList label={t('notifications.rules.columns.roles')} options={options} value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 6: Add the tabs to the Settings page**

Replace the whole of `apps/web/src/features/settings/settings-page.tsx` with:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotificationRulesTab } from '@/features/notifications/rules-tab';
import { api, useCan } from '@/lib/session';
import { ChangePasswordForm } from './change-password-form';
import { OrgSettingsForm } from './org-settings-form';

export function SettingsPage() {
  const { t } = useTranslation();
  const canEdit = useCan('tenant.manage');
  // Spec §8: the "Bildirişlər" tab is for notifications.manage; without it there is one section and no tab bar.
  const canManageNotifications = useCan('notifications.manage');
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const organisation = (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.org.title')}</CardTitle>
        </CardHeader>
        <CardContent>{tenant.data ? <OrgSettingsForm tenant={tenant.data} canEdit={canEdit} /> : <p>{t('common.loading')}</p>}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.password.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </>
  );
  return (
    <div className="grid gap-6">
      <PageHeader title={t('settings.title')} />
      {canManageNotifications ? (
        <Tabs defaultValue="org">
          <TabsList>
            <TabsTrigger value="org">{t('settings.org.title')}</TabsTrigger>
            <TabsTrigger value="notifications">{t('notifications.title')}</TabsTrigger>
          </TabsList>
          <TabsContent value="org" className="grid gap-6">
            {organisation}
          </TabsContent>
          <TabsContent value="notifications">
            <NotificationRulesTab />
          </TabsContent>
        </Tabs>
      ) : (
        organisation
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/notifications features/settings && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (2 rule-form tests, 5 rules-tab tests, 2 settings tests, and the earlier notification tests).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ui/switch.tsx apps/web/src/features/notifications/rules-form.ts apps/web/src/features/notifications/rules-form.test.ts apps/web/src/features/notifications/rules-tab.tsx apps/web/src/features/notifications/rules-tab.test.tsx apps/web/src/features/settings/settings-page.tsx apps/web/src/features/settings/settings-page.test.tsx
git commit -m "feat(web): add the notification rules tab to Settings with per-row save and reset" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Composing a message: the target picker, preview and confirm

**Files:**
- Create: `apps/web/src/features/notifications/message-form.ts`, `apps/web/src/features/notifications/target-picker.tsx`, `apps/web/src/features/notifications/compose-message.tsx`
- Test: `apps/web/src/features/notifications/message-form.test.ts`, `apps/web/src/features/notifications/target-picker.test.tsx`, `apps/web/src/features/notifications/compose-message.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `MESSAGE_LIMITS`, `SendMessageInput`, `MessageTargetOptions`; `api.messages.{options, preview, send}`; `az.notifications.issues.{noTargets, noRecipients, tooManyRecipients}`
  - Task 2: `useMessageTargetOptions`, `notificationKeys.messages`, fixtures `targetOptions`, `messageSummary`
  - Existing: `useDebounced` (`features/scheduling/labels.ts`), `Dialog*`, `Checkbox`, `Input`, `Textarea`, `Label`, `FormError`, `errorText`
- Produces:
  - `message-form.ts`: `interface TargetRef { id; name }`, `interface MessageTargets { users; teams; sites: TargetRef[] }`, `type TargetKind = keyof MessageTargets`, `TARGET_KINDS`, `NO_TARGETS`, `interface MessageDraft { targets; title; body; email }`, `EMPTY_MESSAGE`, `targetCount(t)`, `canPreview(d): boolean`, `sendBody(d): SendMessageInput`, `type PreviewVerdict`, `previewVerdict(recipientCount): PreviewVerdict`
  - `TargetPicker({ value, onChange })` — combobox "Alıcılar", groups "Əməkdaşlar" / "Komandalar" / "Obyektlər", toggling options (`aria-selected`), chips list "Seçilmiş alıcılar" with "Sil: <name>" buttons
  - `ComposeMessage()` — picker, "Başlıq" (counter, max 80), "Mətn" (counter, max 500), "E-poçt ilə də göndər", "Göndər" → preview → confirm dialog "Mesajı göndər" → send; invalidates `notificationKeys.messages` after a send

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/message-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canPreview, EMPTY_MESSAGE, type MessageDraft, previewVerdict, sendBody } from './message-form';

const draft = (over: Partial<MessageDraft> = {}): MessageDraft => ({
  targets: { users: [{ id: 'w1', name: 'Nigar' }], teams: [{ id: 'team1', name: 'Texniki xidmət' }], sites: [] },
  title: '  Sabah iclas var ',
  body: ' Saat 10:00-da. ',
  email: true,
  ...over,
});

describe('message form', () => {
  it('trims the text and lists the ids of each kind', () => {
    expect(sendBody(draft())).toEqual({ title: 'Sabah iclas var', body: 'Saat 10:00-da.', userIds: ['w1'], teamIds: ['team1'], siteIds: [], email: true });
  });

  it('can be previewed only with a target and a title and body that are not blank', () => {
    expect(canPreview(draft())).toBe(true);
    expect(canPreview(EMPTY_MESSAGE)).toBe(false);
    expect(canPreview(draft({ targets: { users: [], teams: [], sites: [] } }))).toBe(false);
    expect(canPreview(draft({ title: '   ' }))).toBe(false);
    expect(canPreview(draft({ body: '\n ' }))).toBe(false);
    expect(canPreview(draft({ title: 'x'.repeat(81) }))).toBe(false);
  });

  it('refuses a preview that reaches nobody or more than 1000 people', () => {
    expect(previewVerdict(1)).toEqual({ ok: true });
    expect(previewVerdict(1000)).toEqual({ ok: true });
    expect(previewVerdict(0)).toEqual({ ok: false, issue: 'notifications.issues.noRecipients' });
    expect(previewVerdict(1001)).toEqual({ ok: false, issue: 'notifications.issues.tooManyRecipients' });
  });
});
```

`apps/web/src/features/notifications/target-picker.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { targetOptions } from './fixtures';
import { type MessageTargets, NO_TARGETS } from './message-form';
import { TargetPicker } from './target-picker';

const mocks = vi.hoisted(() => ({ api: { messages: { options: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

function Harness({ onChange }: { onChange: (v: MessageTargets) => void }) {
  const [value, setValue] = useState<MessageTargets>(NO_TARGETS);
  return (
    <TargetPicker
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.messages.options.mockResolvedValue(targetOptions());
});

describe('TargetPicker', () => {
  it('lists people, teams and sites in groups; people and teams are searched by the API, sites here', async () => {
    renderWithProviders(<Harness onChange={vi.fn()} />);
    // Closed: nothing is asked for.
    expect(mocks.api.messages.options).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
    const list = await screen.findByRole('listbox', { name: 'Alıcılar' });
    expect(await within(list).findByRole('group', { name: 'Əməkdaşlar' })).toHaveTextContent('Texnik');
    expect(within(list).getByRole('group', { name: 'Komandalar' })).toHaveTextContent('3 üzv');
    expect(within(within(list).getByRole('group', { name: 'Obyektlər' })).getAllByRole('option')).toHaveLength(2);
    expect(mocks.api.messages.options).toHaveBeenCalledWith({});
    mocks.api.messages.options.mockResolvedValue(targetOptions({ users: [], teams: [] }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Alıcılar' }), 'anbar');
    await waitFor(() => expect(mocks.api.messages.options).toHaveBeenLastCalledWith({ q: 'anbar' }));
    await waitFor(() =>
      expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Anbar №1']),
    );
  });

  it('adds and removes people, teams and sites, keeping the list open', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Texniki xidmət' }));
    await userEvent.click(screen.getByRole('option', { name: 'Nigar Səfərli' }));
    await userEvent.click(screen.getByRole('option', { name: 'Ofis' }));
    expect(onChange).toHaveBeenLastCalledWith({
      users: [{ id: 'w1', name: 'Nigar Səfərli' }],
      teams: [{ id: 'team1', name: 'Texniki xidmət' }],
      sites: [{ id: 'site2', name: 'Ofis' }],
    });
    expect(screen.getByRole('option', { name: 'Ofis' })).toHaveAttribute('aria-selected', 'true');
    // A second click on a chosen option takes it out again.
    await userEvent.click(screen.getByRole('option', { name: 'Ofis' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sites: [] }));
    const chosen = screen.getByRole('list', { name: 'Seçilmiş alıcılar' });
    expect(within(chosen).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nigar Səfərli', 'Texniki xidmət']);
    await userEvent.click(within(chosen).getByRole('button', { name: 'Sil: Texniki xidmət' }));
    expect(onChange).toHaveBeenLastCalledWith({ users: [{ id: 'w1', name: 'Nigar Səfərli' }], teams: [], sites: [] });
  });

  it('picks with the arrow keys and Enter', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'Alıcılar' });
    await userEvent.click(box);
    await screen.findByRole('option', { name: 'Murad Əliyev' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ users: [{ id: 'w2', name: 'Murad Əliyev' }], teams: [], sites: [] });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

`apps/web/src/features/notifications/compose-message.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { renderWithProviders } from '@/test/render';
import { ComposeMessage } from './compose-message';
import { messageSummary, targetOptions } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { messages: { options: vi.fn(), preview: vi.fn(), send: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

async function fill({ title = '  Sabah iclas var ', body = ' Saat 10:00-da ofisdə. ' } = {}) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Texniki xidmət' }));
  await userEvent.type(screen.getByLabelText('Başlıq'), title);
  await userEvent.type(screen.getByLabelText('Mətn'), body);
}

const previewed = { title: 'Sabah iclas var', body: 'Saat 10:00-da ofisdə.', userIds: [], teamIds: ['team1'], siteIds: [], email: true };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.messages.options.mockResolvedValue(targetOptions());
});

describe('ComposeMessage', () => {
  it('previews, asks "N nəfərə göndəriləcək" and sends exactly what was previewed', async () => {
    mocks.api.messages.preview.mockResolvedValue({ recipientCount: 3 });
    mocks.api.messages.send.mockResolvedValue(messageSummary());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWithProviders(<ComposeMessage />, client);
    expect(screen.getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await fill();
    // '  Sabah iclas var ' is 18 characters as typed; the API gets it trimmed.
    expect(screen.getByText('18/80')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'E-poçt ilə də göndər' }));
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    await waitFor(() => expect(mocks.api.messages.preview).toHaveBeenCalledWith(previewed));
    const dialog = await screen.findByRole('dialog', { name: 'Mesajı göndər' });
    expect(dialog).toHaveTextContent('3 nəfərə göndəriləcək');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Göndər' }));
    await waitFor(() => expect(mocks.api.messages.send).toHaveBeenCalledWith(previewed));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Başlıq')).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Seçilmiş alıcılar' })).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notification-messages'] });
  });

  it('offers Göndər only for a recipient and non-blank text, and will not send to nobody or to more than 1000', async () => {
    renderWithProviders(<ComposeMessage />);
    await fill({ title: '   ', body: 'Mətn' });
    expect(screen.getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Başlıq'), 'İclas');
    mocks.api.messages.preview.mockResolvedValueOnce({ recipientCount: 0 }).mockResolvedValueOnce({ recipientCount: 1001 });
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    let dialog = await screen.findByRole('dialog', { name: 'Mesajı göndər' });
    expect(dialog).toHaveTextContent(i18n.t('notifications.issues.noRecipients', { count: 1000, max: 1000 }));
    expect(within(dialog).getByRole('button', { name: 'Göndər' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ləğv et' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    dialog = await screen.findByRole('dialog', { name: 'Mesajı göndər' });
    expect(dialog).toHaveTextContent(i18n.t('notifications.issues.tooManyRecipients', { count: 1000, max: 1000 }));
    expect(within(dialog).getByRole('button', { name: 'Göndər' })).toBeDisabled();
    expect(mocks.api.messages.send).not.toHaveBeenCalled();
  });

  it("shows the server's reasons: nobody left after expansion under the picker, a target out of scope as an error", async () => {
    mocks.api.messages.preview.mockResolvedValue({ recipientCount: 2 });
    mocks.api.messages.send
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { userIds: 'notifications.issues.noRecipients' }))
      .mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN'));
    renderWithProviders(<ComposeMessage />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Göndər' }));
    expect(await screen.findByText(i18n.t('notifications.issues.noRecipients'))).toBeInTheDocument();
    // The draft stays for another try.
    expect(screen.getByLabelText('Başlıq')).toHaveValue('  Sabah iclas var ');
    await userEvent.click(screen.getByRole('button', { name: 'Göndər' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Göndər' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu əməliyyat üçün icazəniz yoxdur.');
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/message-form features/notifications/target-picker features/notifications/compose-message`
Expected: FAIL: `Failed to resolve import "./message-form"`, `"./target-picker"`, `"./compose-message"`.

- [ ] **Step 3: Implement the form helpers**

`apps/web/src/features/notifications/message-form.ts`:

```ts
import { MESSAGE_LIMITS, type SendMessageInput } from '@taskop/contracts';

/** A picked target; the name is only for the chips. */
export interface TargetRef {
  id: string;
  name: string;
}

export interface MessageTargets {
  users: TargetRef[];
  teams: TargetRef[];
  sites: TargetRef[];
}

export type TargetKind = keyof MessageTargets;
export const TARGET_KINDS: readonly TargetKind[] = ['users', 'teams', 'sites'];
export const NO_TARGETS: MessageTargets = { users: [], teams: [], sites: [] };

export interface MessageDraft {
  targets: MessageTargets;
  title: string;
  body: string;
  email: boolean;
}

export const EMPTY_MESSAGE: MessageDraft = { targets: NO_TARGETS, title: '', body: '', email: false };

export const targetCount = (t: MessageTargets): number => t.users.length + t.teams.length + t.sites.length;

const within = (text: string, max: number): boolean => {
  const n = text.trim().length;
  return n > 0 && n <= max;
};

/** "Göndər" is offered only for what the API accepts: a target, and a title and a body that are not blank. */
export const canPreview = (d: MessageDraft): boolean =>
  targetCount(d.targets) > 0 && within(d.title, MESSAGE_LIMITS.titleMax) && within(d.body, MESSAGE_LIMITS.bodyMax);

export const sendBody = (d: MessageDraft): SendMessageInput => ({
  title: d.title.trim(),
  body: d.body.trim(),
  userIds: d.targets.users.map((x) => x.id),
  teamIds: d.targets.teams.map((x) => x.id),
  siteIds: d.targets.sites.map((x) => x.id),
  email: d.email,
});

export type PreviewVerdict = { ok: true } | { ok: false; issue: 'notifications.issues.noRecipients' | 'notifications.issues.tooManyRecipients' };

/** The preview does not refuse (Part 1); the confirm dialog does, with the reason the send would get. */
export const previewVerdict = (recipientCount: number): PreviewVerdict =>
  recipientCount === 0
    ? { ok: false, issue: 'notifications.issues.noRecipients' }
    : recipientCount > MESSAGE_LIMITS.maxRecipients
      ? { ok: false, issue: 'notifications.issues.tooManyRecipients' }
      : { ok: true };
```

- [ ] **Step 4: Implement the target picker**

`apps/web/src/features/notifications/target-picker.tsx`:

```tsx
import { MESSAGE_LIMITS } from '@taskop/contracts';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounced } from '@/features/scheduling/labels';
import { errorText } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { type MessageTargets, TARGET_KINDS, type TargetKind } from './message-form';
import { useMessageTargetOptions } from './queries';

interface Option {
  kind: TargetKind;
  id: string;
  name: string;
  detail: string | null;
}

const GROUP_LABEL: Record<TargetKind, string> = {
  users: 'notifications.messages.people',
  teams: 'notifications.messages.teams',
  sites: 'notifications.messages.sites',
};

interface Props {
  value: MessageTargets;
  onChange: (next: MessageTargets) => void;
}

/**
 * Spec §8: the message's people, teams and sites in one combobox (decision 1). Options come from
 * GET /notifications/messages/options (the sender's scope only); several of each kind, at most 200 per kind.
 */
export function TargetPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const label = t('notifications.messages.recipients');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 250);
  const options = useMessageTargetOptions(q, open);
  const inputRef = useRef<HTMLInputElement>(null);
  // Only a list that answers what is typed may be picked from with Enter (see AssigneePicker).
  const fresh = open && query.trim() === q && options.isSuccess && !options.isPlaceholderData;
  const needle = q.toLocaleLowerCase('az');
  const groups: Record<TargetKind, Option[]> = {
    users: (options.data?.users ?? []).map((u) => ({ kind: 'users', id: u.id, name: u.fullName, detail: u.jobTitle })),
    teams: (options.data?.teams ?? []).map((tm) => ({
      kind: 'teams',
      id: tm.id,
      name: tm.name,
      detail: t('notifications.messages.members', { count: tm.memberCount }),
    })),
    // The API returns every site in scope whatever q is; the search is applied here.
    sites: (options.data?.sites ?? [])
      .filter((s) => s.name.toLocaleLowerCase('az').includes(needle))
      .map((s) => ({ kind: 'sites', id: s.id, name: s.name, detail: null })),
  };
  const flat = TARGET_KINDS.flatMap((k) => groups[k]);
  const offset: Record<TargetKind, number> = { users: 0, teams: groups.users.length, sites: groups.users.length + groups.teams.length };
  const optionId = (i: number) => `${id}-option-${i}`;
  const isChosen = (o: Option) => value[o.kind].some((x) => x.id === o.id);
  const isFull = (k: TargetKind) => value[k].length >= MESSAGE_LIMITS.maxTargetsPerKind;

  const toggle = (o: Option) => {
    const list = value[o.kind];
    if (isChosen(o)) onChange({ ...value, [o.kind]: list.filter((x) => x.id !== o.id) });
    else if (!isFull(o.kind)) onChange({ ...value, [o.kind]: [...list, { id: o.id, name: o.name }] });
  };
  const remove = (kind: TargetKind, targetId: string) => onChange({ ...value, [kind]: value[kind].filter((x) => x.id !== targetId) });

  // Escape closes only the list: a window-capture listener runs before a parent Radix Dialog's own Escape handling.
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== inputRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      setQuery('');
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, id]);

  const chips = TARGET_KINDS.flatMap((k) => value[k].map((x) => ({ kind: k, ...x })));

  return (
    <div className="grid gap-1.5">
      <div className="relative grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={fresh && flat[active] ? optionId(active) : undefined}
          placeholder={t('notifications.messages.recipientsPlaceholder')}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setQuery('');
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              if (!fresh) return;
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => Math.max(0, Math.min(flat.length - 1, i + step)));
            } else if (e.key === 'Enter') {
              // Never submits the surrounding form.
              e.preventDefault();
              if (fresh && flat[active]) toggle(flat[active]);
            }
          }}
        />
        {open && (
          <div
            // Clicks on headers and padding must not blur the input (which would close the list).
            onMouseDown={(e) => e.preventDefault()}
            className="bg-popover text-popover-foreground absolute top-full z-50 mt-1 grid max-h-72 w-full gap-2 overflow-y-auto rounded-md border p-1 shadow-md"
          >
            {options.isPending && (
              <p role="status" className="text-muted-foreground px-2 py-1.5 text-sm">
                {t('common.loading')}
              </p>
            )}
            {options.isError && (
              <p role="status" className="text-destructive px-2 py-1.5 text-sm">
                {errorText(t, options.error)}
              </p>
            )}
            {fresh && flat.length === 0 && (
              <p role="status" className="text-muted-foreground px-2 py-1.5 text-sm">
                {t('common.noResults')}
              </p>
            )}
            <div id={`${id}-list`} role="listbox" aria-label={label} aria-multiselectable className="grid gap-2">
              {TARGET_KINDS.filter((k) => groups[k].length > 0).map((k) => (
                <div key={k} role="group" aria-label={t(GROUP_LABEL[k])}>
                  <p aria-hidden className="text-muted-foreground px-2 py-1 text-xs font-medium">
                    {t(GROUP_LABEL[k])}
                  </p>
                  {groups[k].map((o, j) => {
                    const i = offset[k] + j;
                    const chosen = isChosen(o);
                    const disabled = !chosen && isFull(k);
                    return (
                      <div
                        key={o.id}
                        id={optionId(i)}
                        role="option"
                        aria-label={o.name}
                        aria-selected={chosen}
                        aria-disabled={disabled || undefined}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => toggle(o)}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm',
                          i === active ? 'bg-accent' : 'hover:bg-accent/60',
                          disabled && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={cn('size-3.5 rounded-sm border', chosen && 'border-primary bg-primary')} />
                          {o.name}
                        </span>
                        {o.detail && <span className="text-muted-foreground text-xs">{o.detail}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {chips.length > 0 && (
        <ul aria-label={t('notifications.messages.chosen')} className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={`${c.kind}-${c.id}`} className="bg-secondary flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-sm">
              {c.name}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('notifications.messages.remove', { name: c.name })} onClick={() => remove(c.kind, c.id)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {TARGET_KINDS.some(isFull) && (
        <p className="text-muted-foreground text-xs">{t('notifications.messages.targetLimit', { count: MESSAGE_LIMITS.maxTargetsPerKind })}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement the compose form**

`apps/web/src/features/notifications/compose-message.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { MESSAGE_LIMITS, type SendMessageInput } from '@taskop/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';
import { api } from '@/lib/session';
import { canPreview, EMPTY_MESSAGE, type MessageDraft, previewVerdict, sendBody } from './message-form';
import { notificationKeys } from './queries';
import { TargetPicker } from './target-picker';

/** Spec §8, FR-15.08: compose → preview → "N nəfərə göndəriləcək" → send exactly what was previewed (decision 12). */
export function ComposeMessage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<MessageDraft>(EMPTY_MESSAGE);
  const [pending, setPending] = useState<{ body: SendMessageInput; recipientCount: number } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MessageDraft>(key: K, value: MessageDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.fields && Object.keys(e.fields).length > 0) setFields(e.fields);
    else setError(errorText(t, e));
  };
  const preview = useMutation({
    mutationFn: (body: SendMessageInput) => api.messages.preview(body),
    onMutate: () => {
      setFields({});
      setError(null);
    },
    onSuccess: (p, body) => setPending({ body, recipientCount: p.recipientCount }),
    onError: fail,
  });
  const send = useMutation({
    mutationFn: (body: SendMessageInput) => api.messages.send(body),
    onSuccess: async () => {
      setPending(null);
      setDraft(EMPTY_MESSAGE);
      toast.success(t('notifications.messages.sent'));
      await qc.invalidateQueries({ queryKey: notificationKeys.messages });
    },
    onError: (e) => {
      setPending(null);
      fail(e);
    },
  });
  const verdict = pending ? previewVerdict(pending.recipientCount) : null;
  const targetError = fields.userIds ?? fields.teamIds ?? fields.siteIds;

  return (
    <>
      <form
        className="grid max-w-2xl gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (canPreview(draft)) preview.mutate(sendBody(draft));
        }}
      >
        <TargetPicker value={draft.targets} onChange={(v) => set('targets', v)} />
        {targetError && <p className="text-destructive text-sm">{t(targetError)}</p>}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="message-title">{t('notifications.messages.titleLabel')}</Label>
            <span className="text-muted-foreground text-xs">{t('notifications.messages.counter', { count: draft.title.length, max: MESSAGE_LIMITS.titleMax })}</span>
          </div>
          <Input
            id="message-title"
            maxLength={MESSAGE_LIMITS.titleMax}
            value={draft.title}
            aria-invalid={Boolean(fields.title)}
            onChange={(e) => set('title', e.target.value)}
          />
          {fields.title && <p className="text-destructive text-sm">{t(fields.title)}</p>}
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="message-body">{t('notifications.messages.bodyLabel')}</Label>
            <span className="text-muted-foreground text-xs">{t('notifications.messages.counter', { count: draft.body.length, max: MESSAGE_LIMITS.bodyMax })}</span>
          </div>
          <Textarea
            id="message-body"
            rows={4}
            maxLength={MESSAGE_LIMITS.bodyMax}
            value={draft.body}
            aria-invalid={Boolean(fields.body)}
            onChange={(e) => set('body', e.target.value)}
          />
          {fields.body && <p className="text-destructive text-sm">{t(fields.body)}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="message-email" checked={draft.email} onCheckedChange={(c) => set('email', c === true)} />
          <Label htmlFor="message-email" className="font-normal">
            {t('notifications.messages.email')}
          </Label>
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-fit" disabled={!canPreview(draft) || preview.isPending}>
          {t('notifications.messages.send')}
        </Button>
      </form>
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && !send.isPending) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('notifications.messages.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {verdict?.ok === true && t('notifications.messages.confirm', { count: pending?.recipientCount })}
              {verdict?.ok === false && t(verdict.issue, { count: MESSAGE_LIMITS.maxRecipients, max: MESSAGE_LIMITS.maxRecipients })}
            </DialogDescription>
          </DialogHeader>
          {pending && <p className="font-medium">{pending.body.title}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={send.isPending} onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={verdict?.ok !== true || send.isPending} onClick={() => pending && send.mutate(pending.body)}>
              {t('notifications.messages.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/notifications && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (3 message-form tests, 3 picker tests, 3 compose tests, and the earlier notification tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/notifications/message-form.ts apps/web/src/features/notifications/message-form.test.ts apps/web/src/features/notifications/target-picker.tsx apps/web/src/features/notifications/target-picker.test.tsx apps/web/src/features/notifications/compose-message.tsx apps/web/src/features/notifications/compose-message.test.tsx
git commit -m "feat(web): compose manual messages with a people/teams/sites picker, preview and confirm" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Message history, the detail dialog, the "Mesajlar" page and its menu entry

**Files:**
- Create: `apps/web/src/features/notifications/message-history.tsx`, `apps/web/src/features/notifications/routes.ts`, `apps/web/src/features/notifications/messages-page.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/layouts/app-shell.tsx:3,12,26` (icon import, `NavItem.to`, `NAV_ITEMS`)
- Test: `apps/web/src/features/notifications/messages-page.test.tsx`, `apps/web/src/layouts/app-shell.test.tsx`

**Interfaces:**
- Consumes:
  - Part 1: `MessageSummary`, `MessageDetail`, `DeliveryChannel`; `api.messages.{list, get}`; `az.nav.messages`, `az.notifications.{channels, deliveryStatuses}`; permission `notifications.send`
  - Task 2: `useMessages`, `useMessage`, `deliverySummary`, fixtures `messageSummary`, `messageDetail`, `counts`; Task 6: `ComposeMessage`
  - Existing: `useFormatDateTime`, `PageHeader`, `Card*`, `Dialog*`, `Table*`, `errorText`
- Produces:
  - `routes.ts`: `interface MessagesSearch { message?: string }`, `messagesSearch(s): MessagesSearch`
  - `MessageHistory()` — table Tarix | Göndərən | Başlıq (link to `/messages?message=<id>`) | Alıcılar | Oxunub | Push | E-poçt, "Daha çox göstər"
  - `MessageDetailDialog({ id, onClose })` — dialog named by the message title: body, targets, totals, per-channel summaries, recipients table Alıcı | Oxunub | Push | E-poçt
  - `MessagesPage()`; route `/messages` (`validateSearch: messagesSearch`); `NavItem.to` gains `'/messages'`; menu entry "Mesajlar" (`Megaphone`, `notifications.send`) after "Tapşırıqlar"

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/messages-page.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { az } from '@taskop/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { counts, messageDetail, messageSummary } from './fixtures';
import { MessagesPage } from './messages-page';

const mocks = vi.hoisted(() => ({
  api: { messages: { list: vi.fn(), get: vi.fn(), options: vi.fn(), preview: vi.fn(), send: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const L = az.notifications.deliveryStatuses;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
});

describe('MessagesPage', () => {
  it('lists sent messages with sender, recipients, reads and per-channel counts, and loads more', async () => {
    mocks.api.messages.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor
        ? { items: [messageSummary({ id: 'm2', title: 'Köhnə mesaj', processed: false, recipientCount: 0, readCount: 0, push: counts() })], nextCursor: null }
        : { items: [messageSummary({ emailRequested: true, email: counts({ sent: 1 }) })], nextCursor: 'm1' },
    );
    renderWithRouter(<MessagesPage />, '/messages');
    expect(await screen.findByRole('heading', { name: 'Mesajlar' })).toBeInTheDocument();
    const row = (await screen.findByRole('link', { name: 'Sabah iclas var' })).closest('tr')!;
    expect(within(row).getAllByRole('cell').slice(1).map((c) => c.textContent)).toEqual([
      'Leyla Quliyeva',
      'Sabah iclas var',
      '3',
      '1',
      `${L.delivered}: 1 · ${L.failed}: 1`,
      `${L.sent}: 1`,
    ]);
    expect(mocks.api.messages.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    await userEvent.click(screen.getByRole('button', { name: 'Daha çox göstər' }));
    const second = (await screen.findByRole('link', { name: 'Köhnə mesaj' })).closest('tr')!;
    expect(within(second).getAllByRole('cell').slice(3).map((c) => c.textContent)).toEqual(['—', '—', 'Göndərilir…', 'Göndərilir…']);
    expect(mocks.api.messages.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'm1', limit: 50 }));
  });

  it('opens a message from the list: targets, totals, and each recipient with read state, channel status and error', async () => {
    mocks.api.messages.list.mockResolvedValue({ items: [messageSummary()], nextCursor: null });
    mocks.api.messages.get.mockResolvedValue(messageDetail());
    const router = renderWithRouter(<MessagesPage />, '/messages');
    await userEvent.click(await screen.findByRole('link', { name: 'Sabah iclas var' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ message: 'm1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sabah iclas var' });
    expect(mocks.api.messages.get).toHaveBeenCalledWith('m1');
    expect(dialog).toHaveTextContent('Saat 10:00-da ofisdə iclas olacaq.');
    expect(dialog).toHaveTextContent('Leyla Quliyeva');
    expect(dialog).toHaveTextContent('Əməkdaşlar: Nigar Səfərli');
    expect(dialog).toHaveTextContent('Komandalar: Texniki xidmət');
    expect(dialog).toHaveTextContent('Alıcılar: 3 · Oxunub: 1');
    expect(dialog).toHaveTextContent(`Push: ${L.delivered}: 1 · ${L.failed}: 1`);
    expect(dialog).toHaveTextContent('E-poçt: İstənilməyib');
    const recipient = (name: string) => within(dialog).getByRole('cell', { name }).closest('tr')!;
    expect(recipient('Murad Əliyev')).toHaveTextContent('Oxunmayıb');
    expect(recipient('Murad Əliyev')).toHaveTextContent(L.failed);
    expect(recipient('Murad Əliyev')).toHaveTextContent('DeviceNotRegistered');
    expect(recipient('Nigar Səfərli')).toHaveTextContent(L.delivered);
    expect(recipient('Nigar Səfərli')).toHaveTextContent('2 cihaz');
    expect(recipient('Nigar Səfərli')).not.toHaveTextContent('Oxunmayıb');
    expect(recipient('Aysel Məmmədova')).toHaveTextContent('Cihaz yoxdur');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('a link to a message the caller may not see shows the error in the dialog', async () => {
    mocks.api.messages.list.mockResolvedValue({ items: [], nextCursor: null });
    mocks.api.messages.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    renderWithRouter(<MessagesPage />, '/messages?message=m9');
    const dialog = await screen.findByRole('dialog', { name: 'Mesaj' });
    expect(await within(dialog).findByText('Məlumat tapılmadı.')).toBeInTheDocument();
    expect(screen.getByText('Hələ mesaj göndərilməyib.')).toBeInTheDocument();
  });
});
```

In `apps/web/src/layouts/app-shell.test.tsx`, add after `shows the notification bell with the unread count in the header`:

```tsx
  it('shows Mesajlar to holders of notifications.send', async () => {
    state.current = { status: 'authenticated', me: me(['notifications.send']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Mesajlar' })).toHaveAttribute('href', '/messages');
  });
```

and in `shows only the menu items the user may open`, add after the `Tapşırıqlar` assertion:

```tsx
    expect(screen.queryByRole('link', { name: 'Mesajlar' })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/messages-page layouts/app-shell`
Expected: FAIL: `Failed to resolve import "./messages-page"`; the app-shell test finds no "Mesajlar" link.

- [ ] **Step 3: Implement the history and the detail**

`apps/web/src/features/notifications/message-history.tsx`:

```tsx
import type { DeliveryChannel, MessageDetail, MessageSummary } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { deliverySummary } from './labels';
import { useMessage, useMessages } from './queries';

const COLUMNS = ['sentAt', 'sender', 'title', 'recipients', 'read', 'push', 'email'] as const;

/** One channel of a message: still fanning out, e-mail not asked for, or its status counts (decision 13). */
const channelText = (t: TFunction, m: MessageSummary, channel: DeliveryChannel): string =>
  !m.processed
    ? t('notifications.messages.processing')
    : channel === 'email' && !m.emailRequested
      ? t('notifications.messages.notRequested')
      : deliverySummary(t, m[channel]);

/** Spec §8: the tenant's manual messages, newest first (a sender without notifications.manage sees their own). */
export function MessageHistory() {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const messages = useMessages();
  const items = messages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="grid gap-3">
      {messages.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
      {messages.error && <p className="text-destructive">{errorText(t, messages.error)}</p>}
      {messages.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('notifications.messages.emptyHistory')}</p>}
      {items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((k) => (
                <TableHead key={k}>{t(`notifications.messages.columns.${k}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(m.sentAt)}</TableCell>
                <TableCell>{m.sender?.fullName ?? '—'}</TableCell>
                <TableCell>
                  <Link to="/messages" search={{ message: m.id }} className="font-medium underline-offset-4 hover:underline">
                    {m.title}
                  </Link>
                </TableCell>
                <TableCell>{m.processed ? m.recipientCount : '—'}</TableCell>
                <TableCell>{m.processed ? m.readCount : '—'}</TableCell>
                <TableCell>{channelText(t, m, 'push')}</TableCell>
                <TableCell>{channelText(t, m, 'email')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {messages.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
          {t('notifications.messages.more')}
        </Button>
      )}
    </div>
  );
}

/** Spec §8, NFR-11.02: who got the message, who read it, and each channel's status and last error. */
export function MessageDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const message = useMessage(id);
  const m = message.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{m?.title ?? t('notifications.messages.detailTitle')}</DialogTitle>
          <DialogDescription>
            {m
              ? t('notifications.messages.sentBy', { name: m.sender?.fullName ?? '—', time: formatDateTime(m.sentAt) })
              : message.isPending
                ? t('common.loading')
                : ''}
          </DialogDescription>
        </DialogHeader>
        {message.isError && <p className="text-destructive">{errorText(t, message.error)}</p>}
        {m && <MessageDetailBody m={m} />}
      </DialogContent>
    </Dialog>
  );
}

function MessageDetailBody({ m }: { m: MessageDetail }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const targets = [
    { key: 'people', names: m.targets.users.map((u) => u.fullName) },
    { key: 'teams', names: m.targets.teams.map((x) => x.name) },
    { key: 'sites', names: m.targets.sites.map((x) => x.name) },
  ].filter((g) => g.names.length > 0);
  return (
    <div className="grid max-h-[70vh] gap-4 overflow-y-auto">
      <p className="whitespace-pre-line">{m.body}</p>
      <section aria-label={t('notifications.messages.targets')} className="grid gap-1 text-sm">
        {targets.map((g) => (
          <p key={g.key}>{`${t(`notifications.messages.${g.key}`)}: ${g.names.join(', ')}`}</p>
        ))}
      </section>
      {!m.processed ? (
        <p className="text-muted-foreground">{t('notifications.messages.noRecipientsYet')}</p>
      ) : (
        <>
          <div className="grid gap-1 text-sm">
            <p>{t('notifications.messages.totals', { recipients: m.recipientCount, read: m.readCount })}</p>
            <p>{`${t('notifications.channels.push')}: ${deliverySummary(t, m.push)}`}</p>
            <p>{`${t('notifications.channels.email')}: ${m.emailRequested ? deliverySummary(t, m.email) : t('notifications.messages.notRequested')}`}</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('notifications.messages.recipient')}</TableHead>
                <TableHead>{t('notifications.messages.columns.read')}</TableHead>
                <TableHead>{t('notifications.channels.push')}</TableHead>
                <TableHead>{t('notifications.channels.email')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.recipients.map((r) => (
                <TableRow key={r.user.id}>
                  <TableCell>{r.user.fullName}</TableCell>
                  <TableCell>{r.readAt ? formatDateTime(r.readAt) : t('notifications.messages.notRead')}</TableCell>
                  <TableCell>
                    {r.push.status
                      ? `${t(`notifications.deliveryStatuses.${r.push.status}`)}${r.push.devices > 1 ? ` · ${t('notifications.messages.devices', { count: r.push.devices })}` : ''}`
                      : t('notifications.messages.noDevice')}
                    {r.push.lastError && <p className="text-destructive text-xs">{r.push.lastError}</p>}
                  </TableCell>
                  <TableCell>
                    {r.email.status ? t(`notifications.deliveryStatuses.${r.email.status}`) : '—'}
                    {r.email.lastError && <p className="text-destructive text-xs">{r.email.lastError}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement the search params and the page**

`apps/web/src/features/notifications/routes.ts`:

```ts
/** `/messages?message=<id>`: the message whose detail is open (decision: deep-linkable, like the task drawer). */
export interface MessagesSearch {
  message?: string;
}

export const messagesSearch = (s: Record<string, unknown>): MessagesSearch =>
  typeof s.message === 'string' && s.message ? { message: s.message } : {};
```

`apps/web/src/features/notifications/messages-page.tsx`:

```tsx
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ComposeMessage } from './compose-message';
import { MessageDetailDialog, MessageHistory } from './message-history';
import type { MessagesSearch } from './routes';

/** Spec §8: "Mesajlar" for notifications.send holders: compose, then the history; `?message=<id>` opens a detail. */
export function MessagesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as MessagesSearch;
  return (
    <div className="grid gap-6">
      <PageHeader title={t('nav.messages')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.messages.compose')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ComposeMessage />
        </CardContent>
      </Card>
      <section aria-labelledby="messages-history" className="grid gap-2">
        <h2 id="messages-history" className="text-lg font-semibold">
          {t('notifications.messages.history')}
        </h2>
        <MessageHistory />
      </section>
      {search.message && <MessageDetailDialog id={search.message} onClose={() => void navigate({ to: '/messages', search: {} })} />}
    </div>
  );
}
```

- [ ] **Step 5: Add the route and the menu entry**

In `apps/web/src/router.tsx`:
- add after `import { NotificationsPage } from '@/features/notifications/notifications-page';`:

```tsx
import { MessagesPage } from '@/features/notifications/messages-page';
import { messagesSearch } from '@/features/notifications/routes';
```

- add after the `notificationsRoute` line:

```tsx
const messagesRoute = createRoute({ getParentRoute: () => appLayout, path: '/messages', component: MessagesPage, validateSearch: messagesSearch });
```

- in `appLayout.addChildren([...])`, add `messagesRoute,` after `notificationsRoute,`.

In `apps/web/src/layouts/app-shell.tsx`:
- add `Megaphone` to the `lucide-react` import, after `LogOut`.
- in `NavItem`, add `| '/messages'` after `'/tasks'` in the `to` union.
- add after the `/tasks` entry of `NAV_ITEMS`:

```tsx
  { to: '/messages', labelKey: 'nav.messages', icon: Megaphone, permission: 'notifications.send' },
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS: the whole web suite, including 3 messages-page tests and 6 app-shell tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/notifications/message-history.tsx apps/web/src/features/notifications/routes.ts apps/web/src/features/notifications/messages-page.tsx apps/web/src/features/notifications/messages-page.test.tsx apps/web/src/router.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/layouts/app-shell.test.tsx
git commit -m "feat(web): add the Mesajlar page with message history, per-recipient delivery detail and the menu entry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The user menu and the notification preferences dialog

**Files:**
- Create: `apps/web/src/features/notifications/preferences-dialog.tsx`, `apps/web/src/layouts/user-menu.tsx`
- Modify: `apps/web/src/layouts/app-shell.tsx` (the name and role block right after `<NotificationBell />`)
- Test: `apps/web/src/features/notifications/preferences-dialog.test.tsx`, `apps/web/src/layouts/app-shell.test.tsx`

**Interfaces:**
- Consumes: Part 1's `api.preferences.update`, `Me.user.emailNotifications`, `Preferences`; Task 5's `Switch`; existing `DropdownMenu*`, `Dialog*`, `useMe`, `session.setMe`, `FormError`, `errorText`.
- Produces:
  - `NotificationPreferencesDialog({ open, onOpenChange })` — dialog "Bildiriş ayarları" with the switch "E-poçt bildirişləri"; saves on toggle; flips back on failure
  - `UserMenu({ me })` — the header's name + role as a menu button with the item "Bildiriş ayarları"

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/notifications/preferences-dialog.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { NotificationPreferencesDialog } from './preferences-dialog';

const mocks = vi.hoisted(() => ({ me: { current: null as unknown }, setMe: vi.fn(), api: { preferences: { update: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => mocks.me.current, session: { setMe: mocks.setMe } }));

const me = (user: Record<string, unknown> = {}) => ({
  user: { id: 'u1', fullName: 'Elvin Əhmədov', email: 'e@a.az', emailNotifications: true, ...user },
  tenant: { timezone: 'Asia/Baku', locale: 'az' },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('NotificationPreferencesDialog', () => {
  it('switches e-mail notifications off and updates the signed-in user', async () => {
    mocks.me.current = me();
    mocks.api.preferences.update.mockResolvedValue({ emailNotifications: false });
    renderWithProviders(<NotificationPreferencesDialog open onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Bildiriş ayarları' });
    const toggle = within(dialog).getByRole('switch', { name: 'E-poçt bildirişləri' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(mocks.api.preferences.update).toHaveBeenCalledWith({ emailNotifications: false }));
    await waitFor(() =>
      expect(mocks.setMe).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'u1', emailNotifications: false }) })),
    );
    expect(toggle).not.toBeChecked();
    expect(screen.queryByText('Hesabınızda e-poçt ünvanı yoxdur; e-poçt bildirişləri göndərilmir.')).not.toBeInTheDocument();
  });

  it('flips back when saving fails, and says the setting has no effect without an e-mail address', async () => {
    mocks.me.current = me({ email: null });
    mocks.api.preferences.update.mockRejectedValue(ApiError.network());
    renderWithProviders(<NotificationPreferencesDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Hesabınızda e-poçt ünvanı yoxdur; e-poçt bildirişləri göndərilmir.')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'E-poçt bildirişləri' });
    await userEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Serverlə əlaqə qurulmadı.');
    expect(toggle).toBeChecked();
    expect(mocks.setMe).not.toHaveBeenCalled();
  });
});
```

In `apps/web/src/layouts/app-shell.test.tsx`:
- change `import { act, screen } from '@testing-library/react';` to `import { act, screen, within } from '@testing-library/react';`, change `import { describe, expect, it, vi } from 'vitest';` to `import { beforeEach, describe, expect, it, vi } from 'vitest';`, and add `import userEvent from '@testing-library/user-event';` after it.
- in the `me` helper, add `emailNotifications: true` to `user` (after `credentialKind: 'password'`).
- in the `vi.mock('@/lib/session', …)` factory, change the `session` line to:

```tsx
  session: { signOut: vi.fn(), setMe: vi.fn(), subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)), get: () => state.current },
```

  and add `preferences: { update: vi.fn() },` inside `api`, after `notifications`.
- add after `const { AppShell } = await import('./app-shell');`:

```tsx
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
```

- add after `shows Mesajlar to holders of notifications.send`:

```tsx
  it('opens the notification settings from the user menu', async () => {
    state.current = { status: 'authenticated', me: me([]) };
    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: /Elvin Əhmədov/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bildiriş ayarları' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bildiriş ayarları' });
    expect(within(dialog).getByRole('switch', { name: 'E-poçt bildirişləri' })).toBeChecked();
    // Logging out stays one click away.
    expect(screen.getByRole('button', { name: 'Çıxış' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/notifications/preferences-dialog layouts/app-shell`
Expected: FAIL: `Failed to resolve import "./preferences-dialog"`; the app-shell test finds no menu item.

- [ ] **Step 3: Implement the dialog**

`apps/web/src/features/notifications/preferences-dialog.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { errorText } from '@/lib/errors';
import { api, session, useMe } from '@/lib/session';

/** Spec §8, B-12: the user's only notification setting is the e-mail opt-out; push is muted in the phone's settings. */
export function NotificationPreferencesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notifications.preferences.title')}</DialogTitle>
          <DialogDescription>{t('notifications.preferences.description')}</DialogDescription>
        </DialogHeader>
        <EmailSwitch />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog's content, so every opening starts from the signed-in user's current value. */
function EmailSwitch() {
  const { t } = useTranslation();
  const me = useMe();
  const [checked, setChecked] = useState(me.user.emailNotifications);
  const save = useMutation({
    mutationFn: (emailNotifications: boolean) => api.preferences.update({ emailNotifications }),
    onSuccess: (p) => {
      setChecked(p.emailNotifications);
      session.setMe({ ...me, user: { ...me.user, emailNotifications: p.emailNotifications } });
      toast.success(t('notifications.preferences.saved'));
    },
    onError: (_e, value) => setChecked(!value),
  });
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="preferences-email">{t('notifications.preferences.email')}</Label>
        <Switch
          id="preferences-email"
          checked={checked}
          disabled={save.isPending}
          onCheckedChange={(v) => {
            setChecked(v);
            save.mutate(v);
          }}
        />
      </div>
      {!me.user.email && <p className="text-muted-foreground text-sm">{t('notifications.preferences.noEmail')}</p>}
      <FormError message={save.isError ? errorText(t, save.error) : null} />
    </div>
  );
}
```

- [ ] **Step 4: Implement the user menu and use it in the header**

`apps/web/src/layouts/user-menu.tsx`:

```tsx
import type { Me } from '@taskop/contracts';
import { Bell, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { NotificationPreferencesDialog } from '@/features/notifications/preferences-dialog';

/** The header's name and role as a menu (decision 3): "Bildiriş ayarları" opens the preferences dialog. */
export function UserMenu({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState(false);
  return (
    <>
      {/* Not modal: the dialog opened from the item must get focus and pointer events. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-auto gap-2 py-1 text-right">
            <span className="grid text-sm">
              <span className="font-medium">{me.user.fullName}</span>
              <span className="text-muted-foreground text-xs">{me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name}</span>
            </span>
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => setPreferences(true)}>
            <Bell aria-hidden />
            {t('notifications.preferences.menu')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NotificationPreferencesDialog open={preferences} onOpenChange={setPreferences} />
    </>
  );
}
```

In `apps/web/src/layouts/app-shell.tsx`:
- add after `import { session } from '@/lib/session';`:

```tsx
import { UserMenu } from './user-menu';
```

- replace the name block that follows `<NotificationBell />` (originally lines 85–88; Tasks 4 and 7 moved it down by two lines):

```tsx
            <div className="text-right text-sm">
              <div className="font-medium">{me.user.fullName}</div>
              <div className="text-muted-foreground text-xs">{me.role.systemKey ? t(`roles.systemNames.${me.role.systemKey}`) : me.role.name}</div>
            </div>
```

  with:

```tsx
            <UserMenu me={me} />
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS: the whole web suite, including 2 preferences tests and 7 app-shell tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/notifications/preferences-dialog.tsx apps/web/src/features/notifications/preferences-dialog.test.tsx apps/web/src/layouts/user-menu.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/layouts/app-shell.test.tsx
git commit -m "feat(web): add the user menu with the e-mail notification preference" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end: a rule change, a team message and the member's bell

**Files:**
- Create: `apps/web/e2e/notifications.spec.ts`

**Interfaces:**
- Consumes the whole of this part and all of Part 1:
  - `POST /auth/signup`, `GET /roles`, `POST /teams`, `POST /users/workers` (with `teamIds`), `POST /tasks` (team assignee), `GET /notification-rules`, `POST /auth/login/worker` (`client: 'mobile'` for the API checks, `client: 'web'` for the browser session, decision 16), `GET /me/notifications`, `GET /me/notifications/unread-count`
  - the web: Settings → "Bildirişlər" tab, "Mesajlar" (compose, confirm, history, detail), the bell and its popover, `/notifications`
  - `az.notifications.types['task.assigned']`, `az.notifications.channels.email` from `@taskop/i18n` (Part 1's texts, decision 18)
- **Environment:** the API must run its job workers (`JOBS_ENABLED=true`: the default in `apps/api/src/config/config.ts` and in `apps/api/.env.example`; the CI e2e job does not override it). Fan-out is asynchronous, so the test waits with `expect.poll` (≤ 15 s), never with sleeps. No other setting is needed: the member registers no push device and has no e-mail address, so no Expo request or SMTP delivery is made (`NOTIFICATIONS_PUSH_ENABLED` and `SMTP_URL` stay as they are).

- [ ] **Step 1: Write the end-to-end test**

`apps/web/e2e/notifications.spec.ts`:

```ts
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { NotificationItem, NotificationRuleDto } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { uuidv7 } from 'uuidv7';

function apiAs(request: APIRequestContext, accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async function call<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

test('an admin changes the task.assigned rule and messages a team; the member sees both in the bell and marks them read', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-notif-${suffix}`;
  const email = `notif-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, a team and a worker in it.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E Bildiriş MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const owner = apiAs(request, ((await signup.json()) as { accessToken: string }).accessToken);
  const roles = await owner<Array<{ id: string; systemKey: string | null }>>('GET', '/roles');
  const team = await owner<{ id: string }>('POST', '/teams', { name: 'Texniki xidmət' });
  const worker = await owner<{ user: { id: string }; generatedSecret: string }>('POST', '/users/workers', {
    fullName: 'Nigar Səfərli',
    username: 'nigar',
    roleId: roles.find((r) => r.systemKey === 'worker')!.id,
    teamIds: [team.id],
  });

  // The owner on the web: e-mail on for "task assigned".
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();
  await page.getByRole('link', { name: 'Parametrlər' }).click();
  await page.getByRole('tab', { name: 'Bildirişlər' }).click();
  const control = (name: string) => `${az.notifications.types['task.assigned']} — ${name}`;
  const emailBox = page.getByRole('checkbox', { name: control(az.notifications.channels.email), exact: true });
  await expect(emailBox).not.toBeChecked();
  await emailBox.check();
  await page.getByRole('button', { name: control('Yadda saxla'), exact: true }).click();
  await expect(page.getByRole('row').filter({ has: emailBox }).getByText('Dəyişdirilib')).toBeVisible();
  const rules = await owner<NotificationRuleDto[]>('GET', '/notification-rules');
  expect(rules.find((r) => r.type === 'task.assigned')).toMatchObject({ enabled: true, push: true, email: true, notifyAssignees: true, isDefault: false });

  // A task for the team (the member is told while nobody has accepted it).
  const taskId = uuidv7();
  await owner('POST', '/tasks', { id: taskId, title: 'Soyuducunun qapısını təmir edin', assignee: { teamId: team.id } });

  // A message to the team: picker, preview, confirm.
  await page.getByRole('link', { name: 'Mesajlar' }).click();
  await page.getByRole('combobox', { name: 'Alıcılar' }).fill('Texniki');
  await page.getByRole('option', { name: 'Texniki xidmət' }).click();
  await expect(page.getByRole('list', { name: 'Seçilmiş alıcılar' })).toContainText('Texniki xidmət');
  await page.getByLabel('Başlıq', { exact: true }).fill('Sabah iclas var');
  await page.getByLabel('Mətn', { exact: true }).fill('Saat 10:00-da anbarda qısa iclas olacaq.');
  await page.getByRole('button', { name: 'Göndər', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Mesajı göndər' });
  await expect(confirm).toContainText('1 nəfərə göndəriləcək');
  await confirm.getByRole('button', { name: 'Göndər', exact: true }).click();
  await expect(confirm).toBeHidden();
  const historyRow = page.getByRole('row').filter({ hasText: 'Sabah iclas var' });
  await expect(historyRow).toContainText('Leyla Quliyeva');

  // Fan-out runs in jobs after the commits: wait for both notifications (≤ 15 s, no sleeps).
  const memberLogin = await request.post('/api/v1/auth/login/worker', {
    data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'mobile' },
  });
  expect(memberLogin.ok(), await memberLogin.text()).toBeTruthy();
  const member = apiAs(request, ((await memberLogin.json()) as { accessToken: string }).accessToken);
  await expect
    .poll(async () => (await member<{ count: number }>('GET', '/me/notifications/unread-count')).count, { timeout: 15_000 })
    .toBe(2);
  const inbox = await member<{ items: NotificationItem[] }>('GET', '/me/notifications');
  const taskNote = inbox.items.find((n) => n.type === 'task.assigned')!;
  const messageNote = inbox.items.find((n) => n.type === 'manual')!;
  expect(taskNote).toMatchObject({ targetKind: 'task', targetId: taskId, readAt: null });
  expect(messageNote).toMatchObject({ targetKind: 'none', targetId: null, readAt: null });

  // The owner sees who got the message: delivered in-app, unread, no phone registered.
  await page.reload();
  await historyRow.getByRole('link', { name: 'Sabah iclas var' }).click();
  const detail = page.getByRole('dialog', { name: 'Sabah iclas var' });
  await expect(detail).toContainText('Alıcılar: 1 · Oxunub: 0');
  const recipient = detail.getByRole('row').filter({ hasText: 'Nigar Səfərli' });
  await expect(recipient).toContainText('Oxunmayıb');
  await expect(recipient).toContainText('Cihaz yoxdur');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Çıxış' }).click();
  await expect(page.getByRole('heading', { name: 'Taskop-a daxil olun' })).toBeVisible();

  // The member on the web (decision 16): a worker session with the web client's refresh cookie.
  const web = await page.request.post('/api/v1/auth/login/worker', {
    data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'web' },
  });
  expect(web.ok(), await web.text()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'Bildirişlər: 2 oxunmamış' }).click();
  const popover = page.getByRole('dialog', { name: 'Bildirişlər' });
  await expect(popover.getByRole('listitem')).toHaveCount(2);
  await expect(popover.getByRole('listitem').filter({ hasText: messageNote.title })).toContainText('Oxunmamış');

  // The task notification opens the task and is read.
  await popover.getByRole('listitem').filter({ hasText: taskNote.title }).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${taskId}$`));
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);

  // The message is marked read with the rest.
  await page.getByRole('button', { name: 'Bildirişlər: 1 oxunmamış' }).click();
  await popover.getByRole('button', { name: 'Hamısını oxunmuş et' }).click();
  await expect(page.getByRole('button', { name: 'Bildirişlər', exact: true })).toBeVisible();
  await popover.getByRole('link', { name: 'Hamısına bax' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  const list = page.getByRole('list', { name: 'Bildirişlər' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText(messageNote.title);
  await expect(list).not.toContainText('Oxunmamış');
  expect(await member('GET', '/me/notifications/unread-count')).toEqual({ count: 0 });
});
```

- [ ] **Step 2: Run the end-to-end tests**

Prerequisites: all of Part 1 merged; `docker compose up -d` (Postgres, SeaweedFS, Mailpit); `apps/api/.env` filled in from `apps/api/.env.example` (with `JOBS_ENABLED=true`); `pnpm db:setup && pnpm db:seed` done (the migrations include `0011_notifications` and `0012_notifications_security`).

```bash
pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client build
pnpm --filter @taskop/api build
pnpm --filter @taskop/web e2e -- notifications foundation
```

Expected: PASS for both specs. `foundation.spec.ts` still finds the "Çıxış" button next to the new user menu.

If the poll times out at 0, the API is running without job workers: check `JOBS_ENABLED` in `apps/api/.env` and the API log for `notifications.fanout`; do not add sleeps.

- [ ] **Step 3: Run every check in the monorepo**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @taskop/web e2e
```

Expected: all green. The `foundation`, `checklists`, `scheduling`, `executions` and `tasks` end-to-end tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/notifications.spec.ts
git commit -m "test(web): add the notifications end-to-end flow from a rule change and a team message to the member's bell" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec §8 and §9 (web) coverage:**

| Requirement | Where |
|---|---|
| Bell left of the user name; unread badge from `GET /me/notifications/unread-count`, every 30 s and on focus | Task 4 (bell, header placement, interval and focus test); Task 2 (`useUnreadCount`) |
| Popover: 10 latest, "Hamısını oxunmuş et", "Hamısına bax" | Task 4 |
| A row marks itself read and navigates: occurrence → schedule (+ execution tab for problems), task → `/tasks?task=`, none → inbox | Task 2 (`notificationLink`); Task 3 (`useOpenNotification`); Tasks 3 and 4 tests; decisions 5, 6 |
| `/notifications`: paged full inbox, unread-only filter | Task 3 |
| Settings tabs "Təşkilat" / "Bildirişlər" for `notifications.manage` | Task 5 (`SettingsPage`); decision 4 |
| Rules grouped Checklist / Problem / Task; enabled switch, push and e-mail, applicable audiences, roles multi-select, lead time for due-soon; per-row save; "Defolta qaytar"; badge when not default | Task 5 (`rules-form.ts`, `rules-tab.tsx`); decisions 8–11 |
| "Mesajlar" nav item for `notifications.send` | Task 7 |
| Compose: users, teams, sites (scope-limited options), title, body, e-mail; "Göndər" → preview → "N nəfərə göndəriləcək" | Task 6; decisions 1, 12 |
| History: date, sender, title, recipient count, sent / delivered / failed | Task 7 (`MessageHistory`); decision 13 |
| Detail: each recipient with read state and per-channel status and error | Task 7 (`MessageDetailDialog`) |
| User menu → "Bildiriş ayarları" with the e-mail switch | Task 8; decisions 3, 15 |
| Strings in `packages/i18n/src/az/notifications.ts` | Task 1 |
| §9 web tests: bell count and popover, navigation per target kind, `/notifications`, rules table (edit, reset, lead time, roles), compose with preview and confirm, history and detail | Tasks 2–8 |
| §9 Playwright flow | Task 9; decisions 16–18 |

**Placeholder scan:** every step has complete code or an exact command with its expected result. Edits to existing files (router, app shell, its test, the i18n file) name the exact place and the exact text.

**Type consistency:** `notificationKeys`, `useUnreadCount`, `useLatestNotifications`, `useInbox`, `useMarkAllRead`, `useNotificationRules`, `useMessageTargetOptions`, `useMessages`, `useMessage` (Task 2) are used with the same names and arguments in Tasks 3–7; `useOpenNotification(n, { inboxFallback })` (Task 3) in Task 4; `RuleDraft` / `draftOf` / `ruleBody` / `sameDraft` (Task 5) only there; `MessageTargets` / `NO_TARGETS` / `MessageDraft` / `EMPTY_MESSAGE` / `canPreview` / `sendBody` / `previewVerdict` (Task 6) in Task 6's components and tests; `MessagesSearch` / `messagesSearch` (Task 7) in the router; the fixtures of Task 2 (`taskNote`, `problemNote`, `messageNote`, `ruleDto`, `allRules`, `roleList`, `ROLE_IDS`, `counts`, `messageSummary`, `messageDetail`, `targetOptions`) match their uses.

**Names used from Part 1's *Interfaces for Parts 2 and 3*:** `NOTIFICATION_GROUPS`, `NOTIFICATION_TYPE_META`, `RULE_TYPES`, `DEFAULT_RULES` (`systemRoles`, `leadMinutes`), `LEAD_MINUTES`, `isProblemType`, `MESSAGE_LIMITS` (`titleMax`, `bodyMax`, `maxRecipients`, `maxTargetsPerKind`), `DELIVERY_STATUSES`; types `NotificationItem`, `NotificationRuleDto`, `UpdateNotificationRuleInput`, `RuleType`, `LeadMinutes`, `DeliveryCounts`, `DeliveryChannel`, `SendMessageInput`, `MessageSummary`, `MessageDetail`, `MessageTargetOptions`; `Me.user.emailNotifications`; permissions `notifications.manage`, `notifications.send`; `api.notifications.{list, unreadCount, markRead, markAllRead}`, `api.preferences.update`, `api.notificationRules.{list, update, reset}`, `api.messages.{options, preview, send, list, get}`; `az.notifications.{types, groups, audiences, channels, deliveryStatuses, issues, leadMinutes, title, markAllRead, empty}`, `az.nav.{notifications, messages}`; the server behaviour for idempotent `markRead`, `404` on foreign ids, 90-day cleanup, asynchronous fan-out, actor exclusion, the `403` / `VALIDATION_FAILED` refusals of messages and rules. Nothing outside that section is assumed.
