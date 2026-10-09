# Taskop Mobile Execution — Part 3: Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let managers read executions on the web, read-only: a new "İcra" tab in the schedule drawer (executor, device and server times, flags, score, progress, answers in the pinned version's layout, problems, photo and video evidence, rejected executions), execution badges and columns on the schedule list, and a `/problems` page with filters whose rows open the drawer.

**Architecture:**
- **New feature folder `apps/web/src/features/executions/`**, next to `features/scheduling/`. It follows the existing pattern: React Query hooks in `queries.ts`, pure helpers in `labels.ts`, components that call `api.*` from `@/lib/session`, and shadcn/ui components.
- **The pinned layout comes from `@taskop/contracts`.** `visibleItems(content, answers)` decides which items show, in which order and at which depth. The web never re-implements follow-up logic, so it shows exactly what the phone showed.
- **Problems come from the server.** The drawer highlights the frozen `ExecutionDetail.problems` (spec §5.2), not a client-side derivation.
- **Media are private.** Each uploaded photo or video is shown through `GET /media/:id/url`, a presigned GET valid 5 minutes. A URL is cached for 4 minutes and fetched again once when the browser fails to load it. Pending media never ask for a URL.
- **Deep link.** `/schedule` accepts `?date=&occurrence=&tab=`. A problems row links there, and the schedule page opens that occurrence's drawer on that tab.
- **Scheduling stays the owner of the drawer.** `features/scheduling/occurrence-dialog.tsx` gains tabs and renders `ExecutionTab` from `features/executions`. `features/executions` imports only helpers from scheduling (`formatLocalDate`, `useTenantToday`), never its components.

**Tech Stack:** React 19.2.3, TanStack Router 1 + Query 5, shadcn/ui (Radix `Tabs` and `Dialog`), i18next, lucide-react, Vitest 5 + Testing Library, Playwright (all already in the repo). No new packages.

**Spec:** `docs/superpowers/specs/2026-10-09-mobile-execution-design.md`. This plan implements §8 and the web and Playwright parts of §10.

**This plan is Part 3 of 3.**
- **Before starting:** Part 1 (`docs/superpowers/plans/2026-10-09-mobile-execution-1-api.md`) **Tasks 1–5** must be merged into the feature branch. They provide every contract type and schema, the `az.executions` strings, the 9 error codes and the `@taskop/api-client` methods used here. Part 1 Task 3 already adds `executionBrief: null` and `execution: null, rejectedExecutions: []` to the fixtures of `schedule-page.test.tsx` and `assignment-pages.test.tsx`; this plan builds on those fixtures.
- **Tasks 1–7** need nothing else. They test against mocked `@/lib/session`.
- **Task 8 (Playwright)** needs Part 1 **Tasks 6–18** merged: the API endpoints, the SeaweedFS settings the API boots with, and the seed.
- Part 2 (`apps/mobile`) is independent of this part.

## Global Constraints

- The product name is **Taskop**. Azerbaijani (`az`) is the only locale.
- Every visible string is an i18n key. New web strings go into `az.executions` (Part 1 Task 4's file, **new keys only**; never rename Part 1's keys) and `az.nav.problems`. Reuse `executions.states`, `claimRejections`, `severities`, `problemSources`, `flags`, `mediaKinds` and `mediaSources` from Part 1.
- Install nothing. Use the existing components: `Badge`, `Button`, `Dialog`, `Tabs`, `Table`, `Input`, `Label`, `NativeSelect`, `PageHeader`.
- Times shown to users are in the **tenant timezone** (`useFormatDateTime`, `useTimeFormat`). Local dates (`YYYY-MM-DD`) use `formatLocalDate`, which formats in UTC so they never shift.
- **Read-only.** No screen in this part calls a mutating execution, media or problem endpoint.
- **Media URLs:**
  - `GET /media/:id/url` is called only for media with `status: 'uploaded'`. For pending media the API answers `MEDIA_NOT_FOUND_IN_STORAGE` (Part 1 Task 15).
  - A URL is fresh for `MEDIA_URL_FRESH_MS = (MEDIA_LIMITS.downloadUrlTtlSeconds − 60) × 1000` = 240,000 ms.
  - When an `<img>` or `<video>` fails to load, the URL is fetched again **once**. A second failure in a row shows "Fayl açılmadı".
- **Device and server times:** the server receipt is shown under a device time only when they differ by **more than 60,000 ms** (`RECEIPT_TOLERANCE_MS`).
- **Problems list:** the range is at most **92 days** (`EXECUTION_LIMITS.problemsMaxDays`), checked on the client before any request. The default is the last 7 days of the **tenant's** calendar, today included. The range filters the occurrence's local date, as the API does (Part 1 Task 16). Pages of 50 follow `nextCursor` with a "Daha çox göstər" button.
- **Permissions:** the "Problemlər" menu entry needs `assignments.view`, like "İcra cədvəli". As with every existing page, the route itself is not guarded; the API answers `403` and the page shows the error.
- Tests mock `@/lib/session` exactly as the existing feature tests do. Time-dependent components take a `today` prop, so tests never depend on the real clock. The one exception is the timezone test in Task 7, which fakes only `Date`.
- Commits use `git add <explicit paths>` (never `-A`). Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the second `-m`).

### Decisions this plan makes (ambiguities resolved)

1. **"Each row links to the occurrence drawer"** (spec §8). The SP3 drawer is local state on the schedule page. This plan adds validated search params to `/schedule`: `date` (`YYYY-MM-DD`, which week to show), `occurrence` (which drawer to open) and `tab` (`overview | execution`). A problems row links to `/schedule?date=<localDate>&occurrence=<occurrenceId>&tab=execution`.
2. **The partial badge** is the execution state badge "Yarımçıq" (`executions.states.partial`). `executions.flags.partial` (Part 1) would only repeat it, so the web does not use it. Late and clock-suspect are separate badges.
3. **Problem evidence is shown once.** A rule problem's media are the answer's own photos and videos (Part 1 `deriveProblems`), so they appear under the answer. A manual problem's media (often `itemId: null`) appear under that problem.
4. **Rejected executions show no problem highlights.** The API never writes `execution_problems` for rejected executions (spec §5.2), so their answers render without problems. This matches "stored, never counted".
5. **An execution with an empty answers document** shows "Bu icrada cavab yoxdur." instead of a list of unanswered items.
6. **Device info and clock offset.** The device line (`android 15 · tətbiq 1.0.0`) is always shown under the summary once the detail is loaded. The clock offset is added only when the execution is `clockSuspect`.
7. **Schedule list "columns".** SP3 list rows are buttons with inline cells, not a table. The counted execution adds four inline cells: executor name, progress (`9/10`), score (`87,5%`, omitted when null), and the late and clock-suspect badges. The status badge already names every status; `partial` becomes `destructive` and `started`/`in_progress` become `secondary`.
8. **The nav label** lives in `az.nav.problems` with the other menu labels, not in `az.executions`.

## Review Focus

These are the five input classes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **Answers to items that follow-up rules now hide.** The worker answered a follow-up, then changed the parent answer; the stored document still holds the follow-up's answer. The drawer must not show it, because it was never part of the result. Pinned in Task 4 (`does not show answers to follow-ups that the final answers hide`).
2. **A media URL that expires while the lightbox is open.** A manager leaves the lightbox open for 6 minutes, then the image or video reloads (for a video: the next range request). The page must fetch a fresh URL once and keep going, not show a broken image forever or loop on a failing URL. Pinned in Task 3 (`fetches a fresh URL once when the photo fails after its URL expired`, `fetches a fresh URL for a video that fails mid-play`).
3. **Media still pending upload.** The phone registered a photo but has not uploaded it yet. The drawer must show a "Yüklənməyib" placeholder and must not call `GET /media/:id/url`, which would fail with `MEDIA_NOT_FOUND_IN_STORAGE` for every thumbnail. Pinned in Task 3 (`shows pending media as not uploaded and never asks for its URL`) and Task 4 (`asks for URLs of uploaded photos only, marks pending ones and plays a video in the lightbox`).
4. **A rejected execution with no answers.** An offline claim lost the race before the worker answered anything. Expanding it must say "Bu icrada cavab yoxdur.", not render an empty frame or every item as unanswered. Pinned in Task 5 (`keeps rejected executions collapsed, and shows one without answers as having none`).
5. **The problems list across a timezone date boundary.** At 01:30 in Baku it is still yesterday in UTC. A default range built from the UTC date would hide today's problems. Pinned in Task 7 (`defaults to the last 7 days of the tenant's calendar, not UTC's`).

---

## File Structure

```
packages/i18n/src/
  az/executions.ts            + web keys: tabs, summary labels, media, rejected, problemsPage
  az/nav.ts                   + problems
  i18n.test.ts                + execution web translations
apps/web/src/
  features/executions/
    labels.ts                 receiptDiffers, formatPercent, executionStateVariant, severityVariant, answerValue,
                              problemRangeError, defaultProblemRange
    labels.test.ts
    queries.ts                useExecution, useMediaUrl (MEDIA_URL_FRESH_MS), useProblems, useChecklistOptions
    fixtures.ts               test data: content, answers, media, problems, summaries, occurrence detail
    media.tsx                 useViewableUrl, MediaThumb, MediaStrip, MediaLightbox
    media.test.tsx
    answers-view.tsx          AnswersView (pinned layout, follow-ups, problems, evidence)
    answers-view.test.tsx
    execution-tab.tsx         ExecutionTab (summary, answers, rejected executions)
    execution-tab.test.tsx
    problems-page.tsx         ProblemsPage (filters, table, pagination, links)
    problems-page.test.tsx
  features/scheduling/
    occurrence-dialog.tsx     Tabs: "Ümumi" (SP3 content) and "İcra"; initialTab; OccurrenceTab type
    schedule-page.tsx         initialOccurrenceId/initialTab; execution cells on rows
    routes.tsx                + scheduleSearch, ScheduleRoute
    labels.ts                 occurrenceVariant: partial → destructive, started/in_progress → secondary
    labels.test.ts, schedule-page.test.tsx
  layouts/app-shell.tsx       + Problemlər (assignments.view)
  layouts/app-shell.test.tsx
  router.tsx                  /schedule validateSearch + ScheduleRoute; + /problems
apps/web/e2e/executions.spec.ts
```

---

### Task 1: Web strings for the execution tab, the schedule list and the problems page

**Files:**
- Modify: `packages/i18n/src/az/executions.ts`, `packages/i18n/src/az/nav.ts`
- Test: `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: Part 1 Task 4's `az.executions` (`states`, `claimRejections`, `severities`, `problemSources`, `flags`, `mediaKinds`, `mediaSources`).
- Produces (used by Tasks 2–8):
  - `executions.tabs.{overview, execution}`
  - Summary: `notStarted`, `executor`, `startedAt`, `completedAt`, `notCompleted`, `receivedAt` (`{{time}}`), `score`, `noScore`, `percent` (`{{value}}`), `progress`, `progressValue` and `progressShort` (`{{answered}}`, `{{total}}`), `requiredMissing` (`{{count}}`), `device`, `clockOffset` (`{{seconds}}`)
  - Answers: `noAnswers`, `notAnswered`, `note` (`{{note}}`)
  - `executions.media.{pending, pendingLabel, open, failed, captured, duration}`
  - `executions.rejected.{title, reason, showAnswers, hideAnswers}`
  - `executions.problemsPage.*` (title, filters, `rangeInverted`, `empty`, `more`, `unknownItem`, `mediaCount`, `columns.*`)
  - `nav.problems`

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`:

```ts
describe('execution web translations', () => {
  it('has the strings the drawer, the schedule list and the problems page use', () => {
    expect(az.nav.problems).toBe('Problemlər');
    expect(az.executions.tabs).toEqual({ overview: 'Ümumi', execution: 'İcra' });
    expect(az.executions.rejected.title).toBe('Rədd edilmiş icralar ({{count}})');
    expect(az.executions.receivedAt).toContain('{{time}}');
    expect(az.executions.progressValue).toContain('{{answered}}');
    expect(az.executions.media.pendingLabel).toContain('{{kind}}');
    for (const k of ['date', 'site', 'checklist', 'item', 'severity', 'source', 'note', 'executor', 'media'] as const) {
      expect(az.executions.problemsPage.columns[k], k).toBeTypeOf('string');
    }
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.nav.problems` is `undefined` (and `az.executions.tabs` does not exist).

- [ ] **Step 3: Implement**

In `packages/i18n/src/az/executions.ts`, add these keys at the end of the object, after `mediaSources` (before `} as const;`):

```ts
  // ---- Web (Part 3): the schedule drawer's "İcra" tab, the schedule list and the problems page ----
  tabs: { overview: 'Ümumi', execution: 'İcra' },
  notStarted: 'Bu icra hələ başlanmayıb.',
  executor: 'İcraçı',
  startedAt: 'Başlayıb',
  completedAt: 'Tamamlayıb',
  notCompleted: 'Tamamlanmayıb',
  receivedAt: 'Serverə çatıb: {{time}}',
  score: 'Bal',
  noScore: 'Bal hesablanmır',
  percent: '{{value}}%',
  progress: 'Gedişat',
  progressValue: '{{answered}}/{{total}} cavab',
  progressShort: '{{answered}}/{{total}}',
  requiredMissing: '{{count}} tələb yerinə yetirilməyib',
  device: '{{platform}} {{osVersion}} · tətbiq {{appVersion}}',
  clockOffset: 'Telefon saatı serverdən {{seconds}} san fərqlənir',
  noAnswers: 'Bu icrada cavab yoxdur.',
  notAnswered: 'Cavab verilməyib',
  note: 'Qeyd: {{note}}',
  media: {
    pending: 'Yüklənməyib',
    pendingLabel: '{{kind}} hələ yüklənməyib',
    open: 'Bax: {{kind}}',
    failed: 'Fayl açılmadı',
    captured: '{{time}} · {{name}}',
    duration: '{{seconds}} san',
  },
  rejected: {
    title: 'Rədd edilmiş icralar ({{count}})',
    reason: 'Səbəb: {{reason}}',
    showAnswers: 'Cavablara bax',
    hideAnswers: 'Cavabları gizlət',
  },
  problemsPage: {
    title: 'Problemlər',
    from: 'Başlanğıc tarixi',
    to: 'Son tarix',
    site: 'Obyekt',
    allSites: 'Bütün obyektlər',
    severity: 'Ciddilik',
    allSeverities: 'Bütün ciddiliklər',
    checklist: 'Yoxlama vərəqəsi',
    allChecklists: 'Bütün vərəqələr',
    source: 'Mənbə',
    allSources: 'Bütün mənbələr',
    rangeInverted: 'Son tarix başlanğıc tarixindən əvvəl ola bilməz.',
    empty: 'Bu dövrdə problem qeydə alınmayıb.',
    more: 'Daha çox göstər',
    unknownItem: 'Silinmiş sual',
    mediaCount: '{{count}} fayl',
    columns: {
      date: 'Tarix',
      site: 'Obyekt',
      checklist: 'Vərəqə',
      item: 'Sual',
      severity: 'Ciddilik',
      source: 'Mənbə',
      note: 'Qeyd',
      executor: 'İcraçı',
      media: 'Fayllar',
    },
  },
```

In `packages/i18n/src/az/nav.ts`, add after `roster: 'Növbə cədvəli',`:

```ts
  problems: 'Problemlər',
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS. The build makes the new keys visible to `apps/web`.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/az/executions.ts packages/i18n/src/az/nav.ts packages/i18n/src/i18n.test.ts
git commit -m "feat(i18n): add web strings for the execution tab and the problems page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Execution helpers, queries and test fixtures

**Files:**
- Create: `apps/web/src/features/executions/labels.ts`, `apps/web/src/features/executions/queries.ts`, `apps/web/src/features/executions/fixtures.ts`
- Test: `apps/web/src/features/executions/labels.test.ts`

**Interfaces:**
- Consumes:
  - Part 1: `ExecutionState`, `ProblemSeverity`, `EXECUTION_LIMITS`, `MEDIA_LIMITS`, `ProblemListQuery`, `ExecutionDetail`, `ExecutionSummary`, `ExecutionMediaDto`, `ExecutionProblem`, `OccurrenceDetail`, `OccurrenceDto`; `api.executions.get`, `api.media.url`, `api.problems.list`
  - Existing: `optionLabel` (`features/checklists/labels.ts`), `formatLocalDate` (`features/scheduling/labels.ts`), `addDays`, `dayNumber`, `Answer`, `Item`; `api.checklists.list`
- Produces:
  - `labels.ts`:
    - `RECEIPT_TOLERANCE_MS = 60_000`, `receiptDiffers(deviceAt: string, receivedAt: string | null): boolean`
    - `formatPercent(value: number, locale = 'az'): string`
    - `executionStateVariant(s: ExecutionState)`, `severityVariant(s: ProblemSeverity)`
    - `answerValue(t, item, answer, formatDateTime): string | null`
    - `problemRangeError(from, to): string | null` (an i18n key), `defaultProblemRange(today): { from; to }`
  - `queries.ts`:
    - `MEDIA_URL_FRESH_MS = 240_000`
    - `useExecution(id: string | null)` (key `['executions', 'detail', id]`)
    - `useMediaUrl(id: string, enabled = true)` (key `['media', 'url', id]`, `staleTime` and `gcTime` = `MEDIA_URL_FRESH_MS`)
    - `type ProblemFilters = Omit<ProblemListQuery, 'cursor' | 'limit'>`, `useProblems(filters, enabled)` (infinite, pages of 50)
    - `useChecklistOptions()` (key `['checklists', 'options']`, up to 200)
  - `fixtures.ts` (tests only): `U1`, `U2`, `occurrenceDto(over?)`, `occurrenceDetail(over?)`, `summary(over?)`, `mediaDto(over)`, `executionFixture()`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/executions/labels.test.ts`:

```ts
import { type DateTimeItem, type MultiChoiceItem, newItem, type NumberItem, type YesNoItem } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import {
  answerValue,
  defaultProblemRange,
  executionStateVariant,
  formatPercent,
  problemRangeError,
  receiptDiffers,
  severityVariant,
} from './labels';

const t = i18n.t.bind(i18n);
const fmt = (iso: string) => `@${iso}`;

describe('execution labels', () => {
  it('shows the server receipt only when it differs from the device time by more than a minute', () => {
    const device = '2026-11-02T04:10:00.000Z';
    expect(receiptDiffers(device, '2026-11-02T04:11:00.000Z')).toBe(false);
    expect(receiptDiffers(device, '2026-11-02T04:11:00.001Z')).toBe(true);
    expect(receiptDiffers(device, '2026-11-02T04:09:00.000Z')).toBe(false);
    expect(receiptDiffers(device, '2026-11-02T03:00:00.000Z')).toBe(true);
    expect(receiptDiffers(device, null)).toBe(false);
  });

  it('formats percentages in Azerbaijani and colours states and severities', () => {
    expect(formatPercent(87.5)).toBe('87,5');
    expect(formatPercent(100)).toBe('100');
    expect(executionStateVariant('completed')).toBe('default');
    expect(executionStateVariant('partial')).toBe('destructive');
    expect(executionStateVariant('rejected')).toBe('outline');
    expect(severityVariant('critical')).toBe('destructive');
    expect(severityVariant('normal')).toBe('secondary');
  });

  it('turns an answer into text for each item type', () => {
    const yesNo = newItem('yes_no') as YesNoItem;
    const multi = newItem('multi_choice') as MultiChoiceItem;
    multi.options[0]!.label = 'Süd';
    const num = newItem('number') as NumberItem;
    num.unit = '°C';
    const day = newItem('datetime') as DateTimeItem;
    day.mode = 'date';
    const clock = newItem('datetime') as DateTimeItem;
    clock.mode = 'time';
    const at = newItem('datetime') as DateTimeItem;
    expect(answerValue(t, yesNo, { optionIds: [yesNo.options[1].id] }, fmt)).toBe('Xeyr');
    expect(answerValue(t, multi, { optionIds: multi.options.map((o) => o.id) }, fmt)).toBe('Süd, Seçim 2');
    expect(answerValue(t, multi, { optionIds: [] }, fmt)).toBeNull();
    expect(answerValue(t, num, { number: 10 }, fmt)).toBe('10 °C');
    expect(answerValue(t, newItem('text'), { text: '  ' }, fmt)).toBeNull();
    expect(answerValue(t, newItem('comment'), { text: 'Təmizdir' }, fmt)).toBe('Təmizdir');
    expect(answerValue(t, day, { datetime: '2026-11-02' }, fmt)).toContain('2026');
    expect(answerValue(t, clock, { datetime: '08:30' }, fmt)).toBe('08:30');
    expect(answerValue(t, at, { datetime: '2026-11-02T08:00:00+04:00' }, fmt)).toBe('@2026-11-02T08:00:00+04:00');
    expect(answerValue(t, newItem('photo'), { photos: ['m1'] }, fmt)).toBeNull();
    expect(answerValue(t, num, undefined, fmt)).toBeNull();
  });

  it('checks the problems range like the API does', () => {
    expect(problemRangeError('2026-11-01', '2027-01-31')).toBeNull();
    expect(problemRangeError('2026-11-01', '2027-02-01')).toBe('executions.issues.rangeTooLong');
    expect(problemRangeError('2026-11-02', '2026-11-01')).toBe('executions.problemsPage.rangeInverted');
    expect(problemRangeError('', '2026-11-01')).toBe('errors.validation.required');
    expect(defaultProblemRange('2026-11-03')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/executions/labels`
Expected: FAIL: `Failed to resolve import "./labels"`.

- [ ] **Step 3: Implement the helpers**

`apps/web/src/features/executions/labels.ts`:

```ts
import { addDays, type Answer, dayNumber, EXECUTION_LIMITS, type ExecutionState, type Item, type ProblemSeverity } from '@taskop/contracts';
import { intlLocale } from '@taskop/i18n';
import type { TFunction } from 'i18next';
import { optionLabel } from '@/features/checklists/labels';
import { formatLocalDate } from '@/features/scheduling/labels';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Spec §8: the server receipt is shown under a device time only when they differ by more than a minute. */
export const RECEIPT_TOLERANCE_MS = 60_000;

export const receiptDiffers = (deviceAt: string, receivedAt: string | null): boolean =>
  receivedAt !== null && Math.abs(Date.parse(receivedAt) - Date.parse(deviceAt)) > RECEIPT_TOLERANCE_MS;

export const formatPercent = (value: number, locale = 'az'): string =>
  new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(value);

export const executionStateVariant = (s: ExecutionState): Variant =>
  s === 'completed' ? 'default' : s === 'active' ? 'secondary' : s === 'partial' ? 'destructive' : 'outline';

export const severityVariant = (s: ProblemSeverity): Variant => (s === 'critical' ? 'destructive' : 'secondary');

/**
 * The value of one answer as text. Media, notes and problems are shown beside it, so photo and video
 * items have no text value. Null = nothing answered.
 */
export function answerValue(t: TFunction, item: Item, a: Answer | undefined, formatDateTime: (iso: string) => string): string | null {
  if (!a) return null;
  if ('options' in item) {
    const picked = item.options
      .map((o, i) => (a.optionIds?.includes(o.id) ? optionLabel(t, item, o, i) : null))
      .filter((s): s is string => s !== null);
    return picked.length ? picked.join(', ') : null;
  }
  switch (item.type) {
    case 'number':
      return typeof a.number === 'number' ? (item.unit ? `${a.number} ${item.unit}` : String(a.number)) : null;
    case 'text':
    case 'comment':
      return a.text?.trim() || null;
    case 'datetime':
      if (!a.datetime) return null;
      return item.mode === 'date' ? formatLocalDate(a.datetime) : item.mode === 'time' ? a.datetime : formatDateTime(a.datetime);
    default:
      return null;
  }
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mirrors the API's range check (≤ 92 days, spec §6.8) so an impossible range is never sent. Null = valid. */
export function problemRangeError(from: string, to: string): string | null {
  if (!LOCAL_DATE.test(from) || !LOCAL_DATE.test(to)) return 'errors.validation.required';
  const days = dayNumber(to) - dayNumber(from) + 1;
  if (days < 1) return 'executions.problemsPage.rangeInverted';
  if (days > EXECUTION_LIMITS.problemsMaxDays) return 'executions.issues.rangeTooLong';
  return null;
}

/** The last 7 days of the tenant's calendar, today included. `today` must be the tenant-local date. */
export const defaultProblemRange = (today: string): { from: string; to: string } => ({ from: addDays(today, -6), to: today });
```

- [ ] **Step 4: Implement the queries**

`apps/web/src/features/executions/queries.ts`:

```ts
import { MEDIA_LIMITS, type ProblemListQuery } from '@taskop/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/session';

/** Presigned GETs live 5 minutes (spec §6.7). Reuse one for 4, so a cached URL always has a minute left. */
export const MEDIA_URL_FRESH_MS = (MEDIA_LIMITS.downloadUrlTtlSeconds - 60) * 1000;

export const useExecution = (id: string | null) =>
  useQuery({ queryKey: ['executions', 'detail', id], queryFn: () => api.executions.get(id!), enabled: Boolean(id) });

/** Only for uploaded media: the API refuses a URL for pending ones (MEDIA_NOT_FOUND_IN_STORAGE). */
export const useMediaUrl = (id: string, enabled = true) =>
  useQuery({
    queryKey: ['media', 'url', id],
    queryFn: () => api.media.url(id),
    enabled,
    staleTime: MEDIA_URL_FRESH_MS,
    gcTime: MEDIA_URL_FRESH_MS,
  });

export type ProblemFilters = Omit<ProblemListQuery, 'cursor' | 'limit'>;

/** Newest first, 50 per page; the page asks for more with "Daha çox göstər". */
export const useProblems = (filters: ProblemFilters, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ['problems', filters],
    queryFn: ({ pageParam }) => api.problems.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

/** Every checklist of the tenant, archived ones included, for the problems filter. */
export const useChecklistOptions = () =>
  useQuery({ queryKey: ['checklists', 'options'], queryFn: async () => (await api.checklists.list({ limit: 200 })).items });
```

The hooks are covered by the component tests of Tasks 3–7, which mock `api`.

- [ ] **Step 5: Add the shared test fixtures**

`apps/web/src/features/executions/fixtures.ts`:

```ts
import {
  blankContent,
  type ChecklistContent,
  type ExecutionDetail,
  type ExecutionMediaDto,
  type ExecutionProblem,
  type ExecutionSummary,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  type OccurrenceDetail,
  type OccurrenceDto,
  type YesNoItem,
} from '@taskop/contracts';

/** Test data shared by the execution tests. Not imported by application code. */
export const U1 = { id: 'u1', fullName: 'Aysel Məmmədova' };
export const U2 = { id: 'u2', fullName: 'Murad Əliyev' };
const CREATED = '2026-11-02T04:20:00.000Z';

export const occurrenceDto = (over: Partial<OccurrenceDto> = {}): OccurrenceDto => ({
  id: 'o1', assignmentId: 'a1', assignmentName: 'Səhər', checklistId: 'c1', checklistName: 'Açılış', siteId: 'site1', siteName: 'Anbar',
  shiftId: null, shiftName: null, localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z',
  closesAt: '2026-11-02T07:00:00.000Z', status: 'completed', statusChangedAt: '2026-11-02T05:00:00.000Z', cancelReason: null,
  assigneeIds: ['u1', 'u2'], unassigned: false, executionBrief: null, ...over,
});

export const occurrenceDetail = (over: Partial<OccurrenceDetail> = {}): OccurrenceDetail => ({
  ...occurrenceDto(),
  assignees: [U1, U2],
  history: [],
  execution: null,
  rejectedExecutions: [],
  ...over,
});

/** Started 08:10 Baku (received a minute later: not shown); completed 09:00 (received 13:00: shown). */
export const summary = (over: Partial<ExecutionSummary> = {}): ExecutionSummary => ({
  id: 'x1', executor: U1, state: 'completed', rejectedReason: null,
  startedAt: '2026-11-02T04:10:00.000Z', startedReceivedAt: '2026-11-02T04:11:00.000Z',
  completedAt: '2026-11-02T05:00:00.000Z', completedReceivedAt: '2026-11-02T09:00:00.000Z',
  late: false, clockSuspect: false, progress: { answered: 5, total: 6, requiredMissing: 0 }, scorePercent: 50, problemCount: 3, mediaPending: 1,
  ...over,
});

export const mediaDto = (over: Partial<ExecutionMediaDto> & { id: string }): ExecutionMediaDto => ({
  itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 1000, width: 1600, height: 1200, durationMs: null,
  capturedAt: CREATED, capturedBy: U1, status: 'uploaded', uploadedAt: '2026-11-02T04:21:00.000Z',
  ...over,
});

/**
 * Zal: "Problem varmı?" (yes → critical, follow-up "Təsvir edin"), "Temperatur" (outside 2–8 → normal + note),
 * "Ümumi görünüş" (photo). Son: "Video", "Qeyd" (optional text).
 * Answers: yes + "Su axır"; 10 °C with note "isti" and a manual critical problem with photo pm1;
 * photos m1 (uploaded) and m2 (pending); video v1 (uploaded); "Qeyd" unanswered.
 */
export function executionFixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical' };
  const comment = newItem('comment');
  comment.label = 'Təsvir edin';
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
  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  const video = newItem('video');
  video.label = 'Video';
  const note = newItem('text');
  note.label = 'Qeyd';
  note.required = false;
  const content: ChecklistContent = {
    ...blankContent(),
    sections: [
      { ...newSection('Zal'), items: [problem, temp, photo] },
      { ...newSection('Son'), items: [video, note] },
    ],
  };
  const media: ExecutionMediaDto[] = [
    mediaDto({ id: 'm1', itemId: photo.id }),
    mediaDto({ id: 'm2', itemId: photo.id, status: 'pending', uploadedAt: null }),
    mediaDto({ id: 'v1', itemId: video.id, kind: 'video', mime: 'video/mp4', width: 1280, height: 720, durationMs: 12_000 }),
    mediaDto({ id: 'pm1' }),
  ];
  const answers: ExecutionDetail['answers'] = {
    [problem.id]: { optionIds: [yes.id] },
    [comment.id]: { text: 'Su axır' },
    [temp.id]: { number: 10, note: 'isti', problem: { severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: ['pm1'] } },
    [photo.id]: { photos: ['m1', 'm2'] },
    [video.id]: { videos: ['v1'] },
  };
  const problems: ExecutionProblem[] = [
    { id: 'pr1', itemId: problem.id, source: 'rule', severity: 'critical', note: null, mediaIds: [], createdAt: CREATED },
    { id: 'pr2', itemId: temp.id, source: 'rule', severity: 'normal', note: 'isti', mediaIds: [], createdAt: CREATED },
    { id: 'pr3', itemId: temp.id, source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: ['pm1'], createdAt: CREATED },
  ];
  const detail = (over: Partial<ExecutionDetail> = {}): ExecutionDetail => ({
    ...summary(),
    occurrence: occurrenceDto(),
    checklistVersionId: 'ver1',
    versionNumber: 3,
    content,
    answers,
    answersRev: 4,
    score: { earned: 0, possible: 2, percent: 0, problems: [] },
    clockOffsetMs: 400_000,
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    lastSyncedAt: '2026-11-02T09:00:00.000Z',
    media,
    problems,
    ...over,
  });
  return { content, problem, yes, no, comment, temp, photo, video, note, answers, media, problems, detail };
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/executions/labels && pnpm --filter @taskop/web typecheck`
Expected: PASS (4 tests). The typecheck covers `queries.ts` and `fixtures.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/executions/labels.ts apps/web/src/features/executions/labels.test.ts apps/web/src/features/executions/queries.ts apps/web/src/features/executions/fixtures.ts
git commit -m "feat(web): add execution labels, queries and test fixtures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Media thumbnails and the lightbox with short-lived URLs

**Files:**
- Create: `apps/web/src/features/executions/media.tsx`
- Test: `apps/web/src/features/executions/media.test.tsx`

**Interfaces:**
- Consumes: `useMediaUrl` (Task 2), `ExecutionMediaDto`, `useFormatDateTime`, `Dialog`.
- Produces:
  - `useViewableUrl(id): { url: string | null; failed: boolean; onError(): void; onLoad(): void }`
  - `MediaThumb({ media, onOpen })`
    - Pending → a placeholder with `role="img"` and the name "<Foto|Video> hələ yüklənməyib". No URL request.
    - Uploaded photo → a button "Bax: Foto" with the image.
    - Uploaded video → a button "Bax: Video" with a play icon and the duration. No URL until opened.
  - `MediaStrip({ ids, media, onOpen })`: thumbnails for the IDs that exist in `media`, in order.
  - `MediaLightbox({ media, onClose })`: a dialog titled by the media kind, with `<img alt=kind>` or `<video aria-label=kind controls>`. On a load error it fetches a new URL once and, for a video, resumes at the same time.

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/executions/media.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { mediaDto } from './fixtures';
import { MediaLightbox, MediaThumb } from './media';

const mocks = vi.hoisted(() => ({ api: { media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

const signed = (id: string, n: number) => ({ url: `http://files.test/${id}?sig=${n}`, expiresAt: '2026-11-02T04:25:00.000Z' });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
});

describe('media', () => {
  it('shows pending media as not uploaded and never asks for its URL', async () => {
    renderWithProviders(<MediaThumb media={mediaDto({ id: 'm2', status: 'pending', uploadedAt: null })} onOpen={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Foto hələ yüklənməyib' })).toHaveTextContent('Yüklənməyib');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.api.media.url).not.toHaveBeenCalled();
  });

  it('opens an uploaded photo from its thumbnail, and a video without loading it first', async () => {
    mocks.api.media.url.mockResolvedValue(signed('m1', 1));
    const onOpen = vi.fn();
    const photo = mediaDto({ id: 'm1' });
    const video = mediaDto({ id: 'v1', kind: 'video', mime: 'video/mp4', durationMs: 12_000 });
    renderWithProviders(
      <>
        <MediaThumb media={photo} onOpen={onOpen} />
        <MediaThumb media={video} onOpen={onOpen} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Foto' }));
    expect(onOpen).toHaveBeenCalledWith(photo);
    expect(screen.getByRole('button', { name: 'Bax: Video' })).toHaveTextContent('12 san');
    await waitFor(() => expect(mocks.api.media.url).toHaveBeenCalledTimes(1));
    expect(mocks.api.media.url).toHaveBeenCalledWith('m1');
  });

  it('fetches a fresh URL once when the photo fails after its URL expired', async () => {
    mocks.api.media.url.mockResolvedValueOnce(signed('m1', 1)).mockResolvedValueOnce(signed('m1', 2));
    renderWithProviders(<MediaLightbox media={mediaDto({ id: 'm1' })} onClose={vi.fn()} />);
    const lightbox = await screen.findByRole('dialog', { name: 'Foto' });
    expect(await within(lightbox).findByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/m1?sig=1');
    // The browser reloads the image after the 5-minute URL expired: storage answers 403.
    fireEvent.error(within(lightbox).getByRole('img', { name: 'Foto' }));
    await waitFor(() => expect(within(lightbox).getByRole('img', { name: 'Foto' })).toHaveAttribute('src', 'http://files.test/m1?sig=2'));
    expect(mocks.api.media.url).toHaveBeenCalledTimes(2);
    // A second failure in a row is shown instead of looping.
    fireEvent.error(within(lightbox).getByRole('img', { name: 'Foto' }));
    expect(await within(lightbox).findByText('Fayl açılmadı')).toBeInTheDocument();
    expect(mocks.api.media.url).toHaveBeenCalledTimes(2);
  });

  it('fetches a fresh URL for a video that fails mid-play', async () => {
    mocks.api.media.url.mockResolvedValueOnce(signed('v1', 1)).mockResolvedValueOnce(signed('v1', 2));
    renderWithProviders(<MediaLightbox media={mediaDto({ id: 'v1', kind: 'video', mime: 'video/mp4', durationMs: 12_000 })} onClose={vi.fn()} />);
    const lightbox = await screen.findByRole('dialog', { name: 'Video' });
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1?sig=1'));
    fireEvent.error(within(lightbox).getByLabelText('Video'));
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1?sig=2'));
    expect(within(lightbox).getByText(/Aysel Məmmədova/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/executions/media`
Expected: FAIL: `Failed to resolve import "./media"`.

- [ ] **Step 3: Implement**

`apps/web/src/features/executions/media.tsx`:

```tsx
import type { ExecutionMediaDto } from '@taskop/contracts';
import { Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFormatDateTime } from '@/lib/format';
import { useMediaUrl } from './queries';

/**
 * A presigned URL for an uploaded medium. It lives 5 minutes, so when the element fails to load it (the URL
 * expired while the page stayed open) a new one is fetched once. A second failure in a row is reported.
 */
export function useViewableUrl(id: string) {
  const query = useMediaUrl(id);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);
  return {
    url: failed ? null : (query.data?.url ?? null),
    failed: failed || query.isError,
    onError: () => {
      if (retried) {
        setFailed(true);
        return;
      }
      setRetried(true);
      void query.refetch();
    },
    /** Loaded: a later expiry may refresh again. */
    onLoad: () => setRetried(false),
  };
}

export function MediaThumb({ media, onOpen }: { media: ExecutionMediaDto; onOpen: (m: ExecutionMediaDto) => void }) {
  const { t } = useTranslation();
  const kind = t(`executions.mediaKinds.${media.kind}`);
  if (media.status === 'pending') {
    // Registered by the phone but not uploaded yet: there is nothing to sign (spec §6.7).
    return (
      <span
        role="img"
        aria-label={t('executions.media.pendingLabel', { kind })}
        className="bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-md border border-dashed p-1 text-center text-xs"
      >
        {t('executions.media.pending')}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={t('executions.media.open', { kind })}
      onClick={() => onOpen(media)}
      className="hover:ring-ring size-20 overflow-hidden rounded-md border hover:ring-2"
    >
      {media.kind === 'photo' ? (
        <PhotoPreview id={media.id} />
      ) : (
        <span className="bg-muted flex size-full flex-col items-center justify-center gap-1 text-xs">
          <Play className="size-5" aria-hidden />
          {media.durationMs !== null && t('executions.media.duration', { seconds: Math.round(media.durationMs / 1000) })}
        </span>
      )}
    </button>
  );
}

function PhotoPreview({ id }: { id: string }) {
  const { t } = useTranslation();
  const v = useViewableUrl(id);
  if (v.failed) return <span className="text-destructive text-xs">{t('executions.media.failed')}</span>;
  return v.url ? <img key={v.url} src={v.url} alt="" loading="lazy" className="size-full object-cover" onError={v.onError} onLoad={v.onLoad} /> : null;
}

export function MediaStrip(props: { ids: string[]; media: ReadonlyMap<string, ExecutionMediaDto>; onOpen: (m: ExecutionMediaDto) => void }) {
  const items = props.ids.map((id) => props.media.get(id)).filter((m): m is ExecutionMediaDto => m !== undefined);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((m) => (
        <MediaThumb key={m.id} media={m} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

export function MediaLightbox({ media, onClose }: { media: ExecutionMediaDto; onClose: () => void }) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const v = useViewableUrl(media.id);
  const video = useRef<HTMLVideoElement>(null);
  const resumeAt = useRef(0);
  const kind = t(`executions.mediaKinds.${media.kind}`);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{kind}</DialogTitle>
          <DialogDescription>
            {t('executions.media.captured', { time: formatDateTime(media.capturedAt), name: media.capturedBy.fullName })} ·{' '}
            {t(`executions.mediaSources.${media.source}`)}
          </DialogDescription>
        </DialogHeader>
        {v.failed ? (
          <p className="text-destructive">{t('executions.media.failed')}</p>
        ) : !v.url ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : media.kind === 'photo' ? (
          <img key={v.url} src={v.url} alt={kind} className="max-h-[75vh] w-full object-contain" onError={v.onError} onLoad={v.onLoad} />
        ) : (
          <video
            key={v.url}
            ref={video}
            src={v.url}
            controls
            aria-label={kind}
            className="max-h-[75vh] w-full"
            onError={() => {
              // A range request after the URL expired fails mid-play: continue from here with a new URL.
              resumeAt.current = video.current?.currentTime ?? 0;
              v.onError();
            }}
            onLoadedMetadata={() => {
              if (video.current && resumeAt.current > 0) video.current.currentTime = resumeAt.current;
            }}
            onLoadedData={v.onLoad}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/executions/media && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/executions/media.tsx apps/web/src/features/executions/media.test.tsx
git commit -m "feat(web): show execution photos and videos through short-lived URLs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Answers in the pinned version's layout

**Files:**
- Create: `apps/web/src/features/executions/answers-view.tsx`
- Test: `apps/web/src/features/executions/answers-view.test.tsx`

**Interfaces:**
- Consumes: `visibleItems` (`@taskop/contracts`); `answerValue`, `severityVariant` (Task 2); `MediaStrip`, `MediaLightbox` (Task 3); `useFormatDateTime`.
- Produces: `AnswersView({ content, answers, media, problems })`
  - One `<section aria-label={section.title}>` per section that has visible items, with an `<ol>`.
  - One `<li aria-label={item.label} data-depth={depth} data-problem="critical|normal">` per visible item. Follow-ups are indented by `depth × 16px`.
  - Each item shows its value, its evidence thumbnails, its note, and its problems (severity badge, source; manual problems also show their note and media).
  - Empty answers → "Bu icrada cavab yoxdur."

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/executions/answers-view.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AnswersView } from './answers-view';
import { executionFixture } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('AnswersView', () => {
  it('renders answers in the pinned layout with indented follow-ups and highlighted problems', () => {
    const f = executionFixture();
    renderWithProviders(<AnswersView content={f.content} answers={f.answers} media={f.media} problems={f.problems} />);
    const zal = screen.getByRole('region', { name: 'Zal' });
    expect(within(zal).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual([
      'Problem varmı?',
      'Təsvir edin',
      'Temperatur',
      'Ümumi görünüş',
    ]);
    const question = within(zal).getByRole('listitem', { name: 'Problem varmı?' });
    expect(question).toHaveTextContent('Bəli');
    expect(question).toHaveAttribute('data-problem', 'critical');
    expect(within(question).getByText('Kritik')).toBeInTheDocument();
    const followUp = within(zal).getByRole('listitem', { name: 'Təsvir edin' });
    expect(followUp).toHaveAttribute('data-depth', '1');
    expect(followUp).toHaveTextContent('Su axır');
    expect(followUp).not.toHaveAttribute('data-problem');
    const temp = within(zal).getByRole('listitem', { name: 'Temperatur' });
    expect(temp).toHaveTextContent('10 °C');
    expect(temp).toHaveTextContent('Qeyd: isti');
    expect(temp).toHaveTextContent('Kondisioner xarabdır');
    expect(within(temp).getByText('Qayda üzrə')).toBeInTheDocument();
    expect(within(temp).getByText('Əl ilə qeyd')).toBeInTheDocument();
    expect(within(temp).getByText('Adi')).toBeInTheDocument();
    expect(temp).toHaveAttribute('data-problem', 'critical');
    expect(within(temp).getByRole('button', { name: 'Bax: Foto' })).toBeInTheDocument();
    const son = screen.getByRole('region', { name: 'Son' });
    expect(within(son).getByRole('listitem', { name: 'Qeyd' })).toHaveTextContent('Cavab verilməyib');
  });

  it('does not show answers to follow-ups that the final answers hide', () => {
    const f = executionFixture();
    // The worker answered the follow-up, then changed "yes" to "no": the stored document still holds it.
    const answers = { [f.problem.id]: { optionIds: [f.no.id] }, [f.comment.id]: { text: 'köhnə mətn' } };
    renderWithProviders(<AnswersView content={f.content} answers={answers} media={[]} problems={[]} />);
    expect(screen.getByRole('listitem', { name: 'Problem varmı?' })).toHaveTextContent('Xeyr');
    expect(screen.queryByRole('listitem', { name: 'Təsvir edin' })).not.toBeInTheDocument();
    expect(screen.queryByText('köhnə mətn')).not.toBeInTheDocument();
  });

  it('asks for URLs of uploaded photos only, marks pending ones and plays a video in the lightbox', async () => {
    const f = executionFixture();
    renderWithProviders(<AnswersView content={f.content} answers={f.answers} media={f.media} problems={f.problems} />);
    const photoItem = screen.getByRole('listitem', { name: 'Ümumi görünüş' });
    expect(within(photoItem).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeInTheDocument();
    expect(within(photoItem).getAllByRole('button', { name: 'Bax: Foto' })).toHaveLength(1);
    await waitFor(() => expect(mocks.api.media.url).toHaveBeenCalledTimes(2));
    expect(mocks.api.media.url.mock.calls.map(([id]) => id).sort()).toEqual(['m1', 'pm1']);
    await userEvent.click(screen.getByRole('button', { name: 'Bax: Video' }));
    const lightbox = await screen.findByRole('dialog', { name: 'Video' });
    await waitFor(() => expect(within(lightbox).getByLabelText('Video')).toHaveAttribute('src', 'http://files.test/v1'));
    expect(mocks.api.media.url).not.toHaveBeenCalledWith('m2');
  });

  it('says so when the execution has no answers', () => {
    const f = executionFixture();
    renderWithProviders(<AnswersView content={f.content} answers={{}} media={[]} problems={[]} />);
    expect(screen.getByText('Bu icrada cavab yoxdur.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/executions/answers-view`
Expected: FAIL: `Failed to resolve import "./answers-view"`.

- [ ] **Step 3: Implement**

`apps/web/src/features/executions/answers-view.tsx`:

```tsx
import { type Answer, type Answers, type ChecklistContent, type ExecutionMediaDto, type ExecutionProblem, type Item, visibleItems } from '@taskop/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useFormatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { answerValue, severityVariant } from './labels';
import { MediaLightbox, MediaStrip } from './media';

/**
 * Answers in the pinned version's layout (spec §8): only items visible for these answers, in order, follow-ups
 * indented. An answer to a follow-up that the final answers hide was never part of the result, so it is not shown.
 */
export function AnswersView(props: { content: ChecklistContent; answers: Answers; media: ExecutionMediaDto[]; problems: ExecutionProblem[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ExecutionMediaDto | null>(null);
  const media = useMemo(() => new Map(props.media.map((m) => [m.id, m])), [props.media]);
  const visible = useMemo(() => visibleItems(props.content, props.answers), [props.content, props.answers]);

  if (Object.keys(props.answers).length === 0) return <p className="text-muted-foreground">{t('executions.noAnswers')}</p>;

  return (
    <div className="grid gap-4">
      {props.content.sections.map((s) => {
        const rows = visible.filter((v) => v.sectionId === s.id);
        if (!rows.length) return null;
        return (
          <section key={s.id} aria-label={s.title} className="grid gap-2">
            <h4 className="font-semibold">{s.title}</h4>
            <ol className="grid gap-2">
              {rows.map((v) => (
                <AnswerRow
                  key={v.item.id}
                  item={v.item}
                  depth={v.depth}
                  answer={props.answers[v.item.id]}
                  problems={props.problems.filter((p) => p.itemId === v.item.id)}
                  media={media}
                  onOpen={setOpen}
                />
              ))}
            </ol>
          </section>
        );
      })}
      {open && <MediaLightbox media={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AnswerRow(props: {
  item: Item;
  depth: number;
  answer: Answer | undefined;
  problems: ExecutionProblem[];
  media: ReadonlyMap<string, ExecutionMediaDto>;
  onOpen: (m: ExecutionMediaDto) => void;
}) {
  const { t } = useTranslation();
  const formatDateTime = useFormatDateTime();
  const { item, answer, problems } = props;
  const value = answerValue(t, item, answer, formatDateTime);
  const evidence = [...(answer?.photos ?? []), ...(answer?.videos ?? [])];
  const worst = problems.some((p) => p.severity === 'critical') ? 'critical' : problems.length ? 'normal' : undefined;
  const note = answer?.note?.trim();

  return (
    <li
      aria-label={item.label}
      data-depth={props.depth}
      data-problem={worst}
      style={{ marginLeft: props.depth * 16 }}
      className={cn(
        'grid gap-1.5 rounded-md border p-2',
        worst === 'critical' && 'border-destructive bg-destructive/5',
        worst === 'normal' && 'border-amber-500 bg-amber-50',
      )}
    >
      <span className="font-medium">{item.label}</span>
      {value !== null ? <span>{value}</span> : evidence.length === 0 && <span className="text-muted-foreground">{t('executions.notAnswered')}</span>}
      {/* A rule problem's media are these same photos and videos, so they are shown once, here. */}
      <MediaStrip ids={evidence} media={props.media} onOpen={props.onOpen} />
      {note && <p className="text-muted-foreground">{t('executions.note', { note })}</p>}
      {problems.map((p) => (
        <div key={p.id} className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
            <span className="text-muted-foreground text-xs">{t(`executions.problemSources.${p.source}`)}</span>
          </div>
          {p.source === 'manual' && p.note && <p className="whitespace-pre-line">{p.note}</p>}
          {p.source === 'manual' && <MediaStrip ids={p.mediaIds} media={props.media} onOpen={props.onOpen} />}
        </div>
      ))}
    </li>
  );
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/executions && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (4 new tests; Tasks 2–3 still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/executions/answers-view.tsx apps/web/src/features/executions/answers-view.test.tsx
git commit -m "feat(web): render execution answers in the pinned checklist layout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The "İcra" tab in the schedule drawer

**Files:**
- Create: `apps/web/src/features/executions/execution-tab.tsx`
- Modify: `apps/web/src/features/scheduling/occurrence-dialog.tsx`
- Test: `apps/web/src/features/executions/execution-tab.test.tsx`

**Interfaces:**
- Consumes:
  - `OccurrenceDetail.execution` and `.rejectedExecutions` (Part 1 Task 3, filled by Task 16), `ExecutionSummary`, `ExecutionDetail`
  - `useExecution`, `receiptDiffers`, `formatPercent`, `executionStateVariant` (Task 2); `AnswersView` (Task 4)
  - `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (`@/components/ui/tabs`)
- Produces:
  - `ExecutionTab({ occurrence })`
    - The counted execution's summary: state, late, clock-suspect and media-pending badges; executor; device times with the server receipt beneath when it differs by more than a minute; score; progress; the device line.
    - Then its answers, loaded with `GET /executions/:id`.
    - A collapsed "Rədd edilmiş icralar (n)" section. Each rejected execution shows its summary and reason, and loads its answers on "Cavablara bax".
  - `OccurrenceDialog({ id, onClose, initialTab? })` with tabs "Ümumi" (the SP3 content, unchanged) and "İcra"
  - `type OccurrenceTab = 'overview' | 'execution'`

- [ ] **Step 1: Write the failing test**

`apps/web/src/features/executions/execution-tab.test.tsx`:

```tsx
import { ApiError } from '@taskop/api-client';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ExecutionTab } from './execution-tab';
import { executionFixture, occurrenceDetail, summary, U2 } from './fixtures';

const mocks = vi.hoisted(() => ({ api: { executions: { get: vi.fn() }, media: { url: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api, useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.media.url.mockImplementation(async (id: string) => ({ url: `http://files.test/${id}`, expiresAt: '2026-11-02T04:25:00.000Z' }));
});

describe('ExecutionTab', () => {
  it('shows the executor, device times with the server receipt when it differs by over a minute, flags, score and progress', async () => {
    const f = executionFixture();
    const counted = summary({ late: true, clockSuspect: true, scorePercent: 87.5 });
    mocks.api.executions.get.mockResolvedValue(f.detail(counted));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: counted })} />);
    expect(screen.getByText('Aysel Məmmədova')).toBeInTheDocument();
    expect(screen.getByText('Tamamlanıb')).toBeInTheDocument();
    for (const flag of ['Gecikib', 'Telefon saatı şübhəlidir', '1 fayl hələ yüklənməyib']) expect(screen.getByText(flag)).toBeInTheDocument();
    // Started 08:10 Baku, received 60 s later: no receipt line. Completed 09:00, received 13:00: shown.
    expect(screen.getByText(/08:10/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Serverə çatıb:/)).toHaveLength(1);
    expect(screen.getByText(/^Serverə çatıb:/)).toHaveTextContent('13:00');
    expect(screen.getByText('87,5%')).toBeInTheDocument();
    expect(screen.getByText('5/6 cavab')).toBeInTheDocument();
    expect(await screen.findByText('android 15 · tətbiq 1.0.0 · Telefon saatı serverdən 400 san fərqlənir')).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Zal' })).toBeInTheDocument();
    expect(mocks.api.executions.get).toHaveBeenCalledWith('x1');
  });

  it('says when nothing has been executed yet', () => {
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ status: 'pending' })} />);
    expect(screen.getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
    expect(mocks.api.executions.get).not.toHaveBeenCalled();
  });

  it('keeps rejected executions collapsed, and shows one without answers as having none', async () => {
    const f = executionFixture();
    const lost = summary({
      id: 'x2', executor: U2, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED',
      startedAt: '2026-11-02T04:12:00.000Z', startedReceivedAt: '2026-11-02T09:30:00.000Z', completedAt: null, completedReceivedAt: null,
      progress: { answered: 0, total: 5, requiredMissing: 4 }, scorePercent: null, problemCount: 0, mediaPending: 0,
    });
    mocks.api.executions.get.mockImplementation(async (id: string) =>
      id === 'x2' ? f.detail({ ...lost, answers: {}, answersRev: 0, media: [], problems: [], score: null }) : f.detail(),
    );
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: summary(), rejectedExecutions: [lost] })} />);
    const toggle = screen.getByRole('button', { name: 'Rədd edilmiş icralar (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Murad Əliyev')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    const item = screen.getByRole('listitem', { name: 'Murad Əliyev' });
    expect(within(item).getByText('Rədd edilib')).toBeInTheDocument();
    expect(within(item).getByText('Səbəb: Bu checklist artıq başqa əməkdaş tərəfindən icra olunur.')).toBeInTheDocument();
    expect(within(item).getByText('Tamamlanmayıb')).toBeInTheDocument();
    expect(within(item).getByText('Bal hesablanmır')).toBeInTheDocument();
    expect(within(item).getByText('4 tələb yerinə yetirilməyib')).toBeInTheDocument();
    await userEvent.click(within(item).getByRole('button', { name: 'Cavablara bax' }));
    expect(await within(item).findByText('Bu icrada cavab yoxdur.')).toBeInTheDocument();
    expect(mocks.api.executions.get).toHaveBeenCalledWith('x2');
    await userEvent.click(within(item).getByRole('button', { name: 'Cavabları gizlət' }));
    expect(within(item).queryByText('Bu icrada cavab yoxdur.')).not.toBeInTheDocument();
  });

  it('shows an error instead of loading forever when the execution cannot be read', async () => {
    mocks.api.executions.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    renderWithProviders(<ExecutionTab occurrence={occurrenceDetail({ execution: summary() })} />);
    expect(await screen.findByText('Məlumat tapılmadı.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/web test -- features/executions/execution-tab`
Expected: FAIL: `Failed to resolve import "./execution-tab"`.

- [ ] **Step 3: Implement the tab**

`apps/web/src/features/executions/execution-tab.tsx`:

```tsx
import type { ExecutionDetail, ExecutionSummary, OccurrenceDetail } from '@taskop/contracts';
import type { TFunction } from 'i18next';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { AnswersView } from './answers-view';
import { executionStateVariant, formatPercent, receiptDiffers } from './labels';
import { useExecution } from './queries';

/** The schedule drawer's "İcra" tab (spec §8): the counted execution, then the rejected ones, collapsed. */
export function ExecutionTab({ occurrence }: { occurrence: OccurrenceDetail }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      {occurrence.execution ? (
        <CountedExecution summary={occurrence.execution} />
      ) : (
        <p className="text-muted-foreground">{t('executions.notStarted')}</p>
      )}
      {occurrence.rejectedExecutions.length > 0 && <RejectedExecutions items={occurrence.rejectedExecutions} />}
    </div>
  );
}

function CountedExecution({ summary }: { summary: ExecutionSummary }) {
  const detail = useExecution(summary.id);
  return (
    <div className="grid gap-4">
      <SummaryView summary={summary} detail={detail.data} />
      <ExecutionAnswers id={summary.id} />
    </div>
  );
}

function ExecutionAnswers({ id }: { id: string }) {
  const { t } = useTranslation();
  const detail = useExecution(id);
  if (detail.isError) return <p className="text-destructive">{errorText(t, detail.error)}</p>;
  if (!detail.data) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  const d = detail.data;
  return <AnswersView content={d.content} answers={d.answers} media={d.media} problems={d.problems} />;
}

const deviceLine = (t: TFunction, summary: ExecutionSummary, d: ExecutionDetail): string => {
  const device = t('executions.device', { platform: d.device.platform, osVersion: d.device.osVersion, appVersion: d.device.appVersion });
  return summary.clockSuspect && d.clockOffsetMs !== null
    ? `${device} · ${t('executions.clockOffset', { seconds: Math.round(d.clockOffsetMs / 1000) })}`
    : device;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      {children}
    </div>
  );
}

function SummaryView({ summary, detail }: { summary: ExecutionSummary; detail?: ExecutionDetail }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  const formatDateTime = useFormatDateTime();
  const { answered, total, requiredMissing } = summary.progress;
  // Device time decides the status (BR-11); the server receipt is only shown when it tells a different story.
  const when = (label: string, deviceAt: string | null, receivedAt: string | null) => (
    <Field label={label}>
      <dd>{deviceAt ? formatDateTime(deviceAt) : t('executions.notCompleted')}</dd>
      {deviceAt && receivedAt && receiptDiffers(deviceAt, receivedAt) && (
        <dd className="text-muted-foreground text-xs">{t('executions.receivedAt', { time: formatDateTime(receivedAt) })}</dd>
      )}
    </Field>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={executionStateVariant(summary.state)}>{t(`executions.states.${summary.state}`)}</Badge>
        {summary.late && <Badge variant="destructive">{t('executions.flags.late')}</Badge>}
        {summary.clockSuspect && <Badge variant="outline">{t('executions.flags.clockSuspect')}</Badge>}
        {summary.mediaPending > 0 && <Badge variant="outline">{t('executions.flags.mediaPending', { count: summary.mediaPending })}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label={t('executions.executor')}>
          <dd>{summary.executor.fullName}</dd>
        </Field>
        {when(t('executions.startedAt'), summary.startedAt, summary.startedReceivedAt)}
        {when(t('executions.completedAt'), summary.completedAt, summary.completedReceivedAt)}
        <Field label={t('executions.score')}>
          <dd>
            {summary.scorePercent === null
              ? t('executions.noScore')
              : t('executions.percent', { value: formatPercent(summary.scorePercent, tenant.locale) })}
          </dd>
        </Field>
        <Field label={t('executions.progress')}>
          <dd>{t('executions.progressValue', { answered, total })}</dd>
          {requiredMissing > 0 && <dd className="text-destructive text-xs">{t('executions.requiredMissing', { count: requiredMissing })}</dd>}
        </Field>
      </dl>
      {detail && <p className="text-muted-foreground text-xs">{deviceLine(t, summary, detail)}</p>}
    </div>
  );
}

function RejectedExecutions({ items }: { items: ExecutionSummary[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="grid gap-2 border-t pt-3">
      <Button variant="ghost" className="justify-start px-0" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('executions.rejected.title', { count: items.length })}
      </Button>
      {open && (
        <ul className="grid gap-3">
          {items.map((s) => (
            <RejectedExecution key={s.id} summary={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RejectedExecution({ summary }: { summary: ExecutionSummary }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <li aria-label={summary.executor.fullName} className="grid gap-2 rounded-md border p-3">
      <SummaryView summary={summary} />
      {summary.rejectedReason && (
        <p>{t('executions.rejected.reason', { reason: t(`executions.claimRejections.${summary.rejectedReason}`) })}</p>
      )}
      <Button variant="outline" size="sm" className="w-fit" aria-expanded={show} onClick={() => setShow(!show)}>
        {show ? t('executions.rejected.hideAnswers') : t('executions.rejected.showAnswers')}
      </Button>
      {show && <ExecutionAnswers id={summary.id} />}
    </li>
  );
}
```

- [ ] **Step 4: Run the tab test and check it passes**

Run: `pnpm --filter @taskop/web test -- features/executions/execution-tab`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the tabs to the occurrence drawer**

Replace `apps/web/src/features/scheduling/occurrence-dialog.tsx` with:

```tsx
import type { OccurrenceHistoryEntry } from '@taskop/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FormError } from '@/components/form-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ExecutionTab } from '@/features/executions/execution-tab';
import { errorText } from '@/lib/errors';
import { useFormatDateTime } from '@/lib/format';
import { api, useCan } from '@/lib/session';
import { cancelReasonText, occurrenceVariant } from './labels';
import { useOccurrence } from './queries';

export type OccurrenceTab = 'overview' | 'execution';

export function OccurrenceDialog({ id, onClose, initialTab }: { id: string; onClose: () => void; initialTab?: OccurrenceTab }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canManage = useCan('assignments.manage');
  const formatDateTime = useFormatDateTime();
  const occurrence = useOccurrence(id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = occurrence.data;

  const actor = (h: OccurrenceHistoryEntry) =>
    h.actor.kind === 'user' ? (h.actor.name ?? '—') : h.actor.kind === 'platform' ? t('scheduling.schedule.actorPlatform') : t('scheduling.schedule.actorSystem');

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.occurrences.cancel(id, { reason: reason.trim() });
      await qc.invalidateQueries({ queryKey: ['occurrences'] });
      await qc.invalidateQueries({ queryKey: ['assignments'] });
      toast.success(t('scheduling.schedule.cancelled'));
      onClose();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{o?.checklistName ?? (occurrence.isError ? t('scheduling.schedule.title') : t('common.loading'))}</DialogTitle>
          {o && <DialogDescription>{[o.assignmentName, o.siteName, o.shiftName].filter(Boolean).join(' · ')}</DialogDescription>}
        </DialogHeader>
        {occurrence.isError && <p className="text-destructive text-sm">{errorText(t, occurrence.error)}</p>}
        {o && (
          <Tabs defaultValue={initialTab ?? 'overview'}>
            <TabsList>
              <TabsTrigger value="overview">{t('executions.tabs.overview')}</TabsTrigger>
              <TabsTrigger value="execution">{t('executions.tabs.execution')}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <div className="grid gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
                  {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
                </div>
                <p>{t('scheduling.schedule.window', { start: formatDateTime(o.startsAt), due: formatDateTime(o.dueAt), close: formatDateTime(o.closesAt) })}</p>
                <div>
                  <h3 className="font-medium">{t('scheduling.schedule.assignees')}</h3>
                  {o.assignees.length ? (
                    <ul>
                      {o.assignees.map((u) => (
                        <li key={u.id}>{u.fullName}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">{t('scheduling.schedule.unassigned')}</p>
                  )}
                </div>
                <div>
                  <h3 className="font-medium">{t('scheduling.schedule.history')}</h3>
                  <ol className="grid gap-1">
                    {o.history.map((h, i) => (
                      <li key={i}>
                        {formatDateTime(h.at)} · {h.fromStatus ? `${t(`scheduling.statuses.${h.fromStatus}`)} → ` : ''}
                        {t(`scheduling.statuses.${h.toStatus}`)} · {actor(h)}
                        {h.reason ? ` · ${cancelReasonText(t, h.reason)}` : ''}
                      </li>
                    ))}
                  </ol>
                </div>
                {canManage && (o.status === 'pending' || o.status === 'overdue') && (
                  <div className="grid gap-2">
                    <Label htmlFor="cancel-reason">{t('scheduling.schedule.cancelReason')}</Label>
                    <Textarea id="cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                    <FormError message={error} />
                    <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => void cancel()}>
                      {t('scheduling.schedule.cancel')}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="execution">
              {/* Radix unmounts inactive tabs, so the execution is only fetched when this tab is opened. */}
              <ExecutionTab occurrence={o} />
            </TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

The "Ümumi" tab content is the SP3 dialog body, unchanged.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/executions features/scheduling && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS. The SP3 schedule tests (`opens an occurrence with its history and cancels it with a reason`, `shows an error instead of loading forever…`) still pass: the drawer opens on "Ümumi".

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/executions/execution-tab.tsx apps/web/src/features/executions/execution-tab.test.tsx apps/web/src/features/scheduling/occurrence-dialog.tsx
git commit -m "feat(web): add the execution tab to the occurrence drawer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Execution cells on the schedule list and a deep link to the drawer

**Files:**
- Modify:
  - `apps/web/src/features/scheduling/schedule-page.tsx`, `apps/web/src/features/scheduling/routes.tsx`, `apps/web/src/features/scheduling/labels.ts`
  - `apps/web/src/router.tsx`
- Test: `apps/web/src/features/scheduling/schedule-page.test.tsx`, `apps/web/src/features/scheduling/labels.test.ts`

**Interfaces:**
- Consumes: `OccurrenceDto.executionBrief` (Part 1 Task 3, filled by Task 16), `ExecutionBrief`, `formatPercent` (Task 2), `OccurrenceDialog`'s `initialTab` and `OccurrenceTab` (Task 5).
- Produces:
  - `SchedulePage({ initialDate?, initialOccurrenceId?, initialTab? })`. The occurrence named by `initialOccurrenceId` opens on mount, on `initialTab`.
  - Rows with a counted execution show the executor, progress `answered/total`, the score (when not null), and late and clock-suspect badges.
  - `occurrenceVariant`: `partial` → `destructive`; `started` and `in_progress` → `secondary`.
  - `interface ScheduleSearch { date?: string; occurrence?: string; tab?: OccurrenceTab }`, `scheduleSearch(raw): ScheduleSearch`, `ScheduleRoute`
  - The `/schedule` route validates `date`, `occurrence` and `tab` (used by Task 7's links).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/scheduling/labels.test.ts`, extend the last test (`formats local dates without shifting them and colours statuses`) with:

```ts
    expect(occurrenceVariant('partial')).toBe('destructive');
    expect(occurrenceVariant('in_progress')).toBe('secondary');
    expect(occurrenceVariant('started')).toBe('secondary');
    expect(occurrenceVariant('completed')).toBe('default');
```

In `apps/web/src/features/scheduling/schedule-page.test.tsx`:
- Add `import { scheduleSearch } from './routes';` after the `SchedulePage` import.
- Append inside `describe('SchedulePage', …)`:

```tsx
  it('shows the counted execution on a row: executor, progress, score and flags', async () => {
    const progress = { answered: 9, total: 10, requiredMissing: 0 };
    mocks.api.occurrences.list.mockResolvedValue({
      items: [
        occ({ status: 'completed', executionBrief: { executionId: 'x1', executorName: 'Aysel', state: 'completed', progress, scorePercent: 87.5, late: true, clockSuspect: true } }),
        occ({
          id: 'o2',
          status: 'partial',
          executionBrief: { executionId: 'x2', executorName: 'Murad', state: 'partial', progress: { answered: 2, total: 10, requiredMissing: 6 }, scorePercent: null, late: false, clockSuspect: false },
        }),
      ],
      nextCursor: null,
    });
    renderWithProviders(<SchedulePage initialDate="2026-11-04" />);
    const [day] = await screen.findAllByRole('region');
    const [done, partial] = within(day!).getAllByRole('button');
    for (const text of ['Tamamlanıb', 'Aysel', '9/10', '87,5%', 'Gecikib', 'Telefon saatı şübhəlidir']) expect(done).toHaveTextContent(text);
    for (const text of ['Murad', '2/10']) expect(partial).toHaveTextContent(text);
    expect(partial).not.toHaveTextContent('%');
    expect(within(partial!).getByText('Yarımçıq')).toHaveAttribute('data-variant', 'destructive');
  });

  it('opens the occurrence named in a link on its execution tab', async () => {
    renderWithProviders(<SchedulePage initialDate="2026-11-02" initialOccurrenceId="o1" initialTab="execution" />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText('Bu icra hələ başlanmayıb.')).toBeInTheDocument();
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith('o1');
  });

  it('reads only valid link parameters', () => {
    expect(scheduleSearch({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' })).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
    expect(scheduleSearch({ date: '2.11.2026', occurrence: 5, tab: 'audit' })).toEqual({});
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- features/scheduling/schedule-page features/scheduling/labels`
Expected: FAIL:
- `scheduleSearch` is not exported from `./routes`.
- `occurrenceVariant('partial')` is `'default'`.
- The rows do not show `Aysel`.

- [ ] **Step 3: Update the status colours**

In `apps/web/src/features/scheduling/labels.ts`, replace `occurrenceVariant` with:

```ts
export const occurrenceVariant = (s: OccurrenceStatus): Variant =>
  s === 'overdue' || s === 'missed' || s === 'partial'
    ? 'destructive'
    : s === 'cancelled'
      ? 'outline'
      : s === 'pending' || s === 'started' || s === 'in_progress'
        ? 'secondary'
        : 'default';
```

- [ ] **Step 4: Add the execution cells and the initial drawer to the schedule page**

Replace `apps/web/src/features/scheduling/schedule-page.tsx` with:

```tsx
import { addDays, type ExecutionBrief, OCCURRENCE_STATUSES, type OccurrenceDto } from '@taskop/contracts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPercent } from '@/features/executions/labels';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { useMe } from '@/lib/session';
import { formatLocalDate, occurrenceVariant, useTenantToday, useTimeFormat } from './labels';
import { OccurrenceDialog, type OccurrenceTab } from './occurrence-dialog';
import { useOccurrences } from './queries';
import { weekStartOf } from './roster-grid';

export function SchedulePage(props: { initialDate?: string; initialOccurrenceId?: string; initialTab?: OccurrenceTab }) {
  const { t } = useTranslation();
  const today = useTenantToday();
  const time = useTimeFormat();
  const sites = useSites();
  const [view, setView] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState(props.initialDate ?? today);
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  // A link (e.g. from the problems page) may name an occurrence to open right away.
  const [selected, setSelected] = useState<string | null>(props.initialOccurrenceId ?? null);
  const from = view === 'day' ? anchor : weekStartOf(anchor);
  const to = view === 'day' ? anchor : addDays(from, 6);
  const step = view === 'day' ? 1 : 7;
  const occurrences = useOccurrences({ from, to, siteId: siteId || undefined, status: status || undefined });
  const groups = useMemo(() => {
    const byDay = new Map<string, OccurrenceDto[]>();
    for (const o of occurrences.data ?? []) byDay.set(o.localDate, [...(byDay.get(o.localDate) ?? []), o]);
    return [...byDay.entries()];
  }, [occurrences.data]);

  return (
    <div className="grid gap-4">
      <PageHeader title={t('scheduling.schedule.title')} />
      <div className="flex flex-wrap items-center gap-2">
        {(['day', 'week'] as const).map((v) => (
          <Button key={v} variant={view === v ? 'default' : 'outline'} aria-pressed={view === v} onClick={() => setView(v)}>
            {t(`scheduling.schedule.${v}`)}
          </Button>
        ))}
        <Button variant="outline" onClick={() => setAnchor(addDays(anchor, -step))}>
          {t('scheduling.schedule.prev')}
        </Button>
        <Button variant="outline" onClick={() => setAnchor(today)}>
          {t('scheduling.schedule.today')}
        </Button>
        <Button variant="outline" onClick={() => setAnchor(addDays(anchor, step))}>
          {t('scheduling.schedule.next')}
        </Button>
        <span className="text-sm">{from === to ? formatLocalDate(from) : `${formatLocalDate(from)} – ${formatLocalDate(to)}`}</span>
        <NativeSelect aria-label={t('scheduling.schedule.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-56">
          <option value="">{t('scheduling.schedule.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('scheduling.schedule.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">{t('scheduling.schedule.allStatuses')}</option>
          {OCCURRENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`scheduling.statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {occurrences.error && <p className="text-destructive">{errorText(t, occurrences.error)}</p>}
      {occurrences.isSuccess && groups.length === 0 && <p className="text-muted-foreground">{t('scheduling.schedule.empty')}</p>}
      {groups.map(([date, items]) => (
        <section key={date} aria-label={formatLocalDate(date)} className="grid gap-2">
          <h2 className="font-semibold">{formatLocalDate(date)}</h2>
          <ul className="grid gap-1">
            {items.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setSelected(o.id)}
                  className="hover:bg-muted flex w-full flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-left text-sm"
                >
                  <span className="font-mono">
                    {time(o.startsAt)}–{time(o.dueAt)}
                  </span>
                  <span className="font-medium">{o.checklistName}</span>
                  {o.assignmentName && <span className="text-muted-foreground">{o.assignmentName}</span>}
                  <span className="text-muted-foreground">{o.siteName}</span>
                  <Badge variant={occurrenceVariant(o.status)}>{t(`scheduling.statuses.${o.status}`)}</Badge>
                  {o.unassigned && <Badge variant="destructive">{t('scheduling.schedule.unassigned')}</Badge>}
                  {o.executionBrief && <ExecutionCells brief={o.executionBrief} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {selected && (
        <OccurrenceDialog
          id={selected}
          initialTab={selected === props.initialOccurrenceId ? props.initialTab : undefined}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** The counted execution on a schedule row (spec §8): who, how far, the score, and the flags. */
function ExecutionCells({ brief }: { brief: ExecutionBrief }) {
  const { t } = useTranslation();
  const { tenant } = useMe();
  return (
    <>
      <span>{brief.executorName}</span>
      <span title={t('executions.progress')} className="font-mono">
        {t('executions.progressShort', { answered: brief.progress.answered, total: brief.progress.total })}
      </span>
      {brief.scorePercent !== null && (
        <span title={t('executions.score')}>{t('executions.percent', { value: formatPercent(brief.scorePercent, tenant.locale) })}</span>
      )}
      {brief.late && <Badge variant="destructive">{t('executions.flags.late')}</Badge>}
      {brief.clockSuspect && <Badge variant="outline">{t('executions.flags.clockSuspect')}</Badge>}
    </>
  );
}
```

- [ ] **Step 5: Add the validated search params and the route wrapper**

Replace `apps/web/src/features/scheduling/routes.tsx` with:

```tsx
import { useParams, useSearch } from '@tanstack/react-router';
import { AssignmentDetailPage, NewAssignmentPage } from './assignment-pages';
import type { OccurrenceTab } from './occurrence-dialog';
import { SchedulePage } from './schedule-page';

export function NewAssignmentRoute() {
  const s = useSearch({ strict: false }) as { checklistId?: string; copyFrom?: string };
  return <NewAssignmentPage checklistId={s.checklistId} copyFrom={s.copyFrom} />;
}

export function AssignmentDetailRoute() {
  const p = useParams({ strict: false }) as { assignmentId?: string };
  return <AssignmentDetailPage assignmentId={p.assignmentId!} />;
}

/** `/schedule?date=YYYY-MM-DD&occurrence=<id>&tab=execution`: the week to show and the drawer to open. */
export interface ScheduleSearch {
  date?: string;
  occurrence?: string;
  tab?: OccurrenceTab;
}

export const scheduleSearch = (s: Record<string, unknown>): ScheduleSearch => ({
  ...(typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? { date: s.date } : {}),
  ...(typeof s.occurrence === 'string' && s.occurrence ? { occurrence: s.occurrence } : {}),
  ...(s.tab === 'overview' || s.tab === 'execution' ? { tab: s.tab } : {}),
});

export function ScheduleRoute() {
  const s = useSearch({ strict: false }) as ScheduleSearch;
  // A new link remounts the page, so its week and drawer replace the current ones.
  return <SchedulePage key={`${s.date ?? ''}|${s.occurrence ?? ''}`} initialDate={s.date} initialOccurrenceId={s.occurrence} initialTab={s.tab} />;
}
```

In `apps/web/src/router.tsx`:
- Delete `import { SchedulePage } from '@/features/scheduling/schedule-page';`.
- Change the routes import to `import { AssignmentDetailRoute, NewAssignmentRoute, ScheduleRoute, scheduleSearch } from '@/features/scheduling/routes';`.
- Replace the `scheduleRoute` line with:

```tsx
const scheduleRoute = createRoute({ getParentRoute: () => appLayout, path: '/schedule', component: ScheduleRoute, validateSearch: scheduleSearch });
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test -- features/scheduling router && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS (3 new schedule tests, the extended labels test, all SP3 scheduling tests, `router.test.tsx`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/scheduling/schedule-page.tsx apps/web/src/features/scheduling/schedule-page.test.tsx apps/web/src/features/scheduling/routes.tsx apps/web/src/features/scheduling/labels.ts apps/web/src/features/scheduling/labels.test.ts apps/web/src/router.tsx
git commit -m "feat(web): show executions on schedule rows and open the drawer from a link" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The problems page, its route and the menu entry

**Files:**
- Create: `apps/web/src/features/executions/problems-page.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/layouts/app-shell.tsx`
- Test: `apps/web/src/features/executions/problems-page.test.tsx`, `apps/web/src/layouts/app-shell.test.tsx`

**Interfaces:**
- Consumes:
  - `useProblems`, `useChecklistOptions`, `ProblemFilters`, `problemRangeError`, `defaultProblemRange`, `severityVariant` (Task 2)
  - `useSites`, `useTenantToday`, `formatLocalDate`; `PROBLEM_SEVERITIES`, `PROBLEM_SOURCES`, `ProblemDto`
  - `/schedule` search params (Task 6)
- Produces:
  - `ProblemsPage({ today? })`
    - Filters: from and to dates, site, severity, checklist and source.
    - A table: date, site, checklist, item (a link to `/schedule?date&occurrence&tab=execution`), severity, source, note, executor and file count.
    - "Daha çox göstər" while `nextCursor` is set. A range over 92 days or an inverted range shows the error and sends nothing.
  - Route `/problems`. `NavItem.to` gains `'/problems'`; menu entry "Problemlər" (`TriangleAlert`, `assignments.view`) after "İcra cədvəli".

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/executions/problems-page.test.tsx`:

```tsx
import type { ProblemDto } from '@taskop/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { ProblemsPage } from './problems-page';

const mocks = vi.hoisted(() => ({ api: { problems: { list: vi.fn() }, sites: { list: vi.fn() }, checklists: { list: vi.fn() } } }));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }),
}));

const problem = (over: Partial<ProblemDto> = {}): ProblemDto => ({
  id: 'p1', executionId: 'x1', occurrenceId: 'o1', localDate: '2026-11-02', siteId: 'site1', siteName: 'Anbar', checklistId: 'c1',
  checklistName: 'Açılış', itemId: 'i1', itemLabel: 'Temperatur', source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır',
  mediaIds: ['m1', 'm2'], executorName: 'Aysel', createdAt: '2026-11-02T04:20:00.000Z', ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar' }]);
  mocks.api.checklists.list.mockResolvedValue({ items: [{ id: 'c1', name: 'Açılış' }], nextCursor: null });
  mocks.api.problems.list.mockResolvedValue({
    items: [problem(), problem({ id: 'p2', itemId: 'i2', itemLabel: null, source: 'rule', severity: 'normal', note: null, mediaIds: [] })],
    nextCursor: null,
  });
});
afterEach(() => vi.useRealTimers());

describe('ProblemsPage', () => {
  it('lists problems with place, item, severity and source, and links a row to the occurrence drawer', async () => {
    const router = renderWithRouter(<ProblemsPage today="2026-11-04" />, '/problems');
    await screen.findByText('Kondisioner xarabdır');
    expect(mocks.api.problems.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-29', to: '2026-11-04', limit: 50 }));
    const [, first, second] = screen.getAllByRole('row');
    for (const text of ['Anbar', 'Açılış', 'Temperatur', 'Kritik', 'Əl ilə qeyd', 'Aysel', '2 fayl']) expect(first).toHaveTextContent(text);
    for (const text of ['Silinmiş sual', 'Adi', 'Qayda üzrə']) expect(second).toHaveTextContent(text);
    await userEvent.click(within(first!).getByRole('link', { name: 'Temperatur' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedule'));
    expect(router.state.location.search).toEqual({ date: '2026-11-02', occurrence: 'o1', tab: 'execution' });
  });

  it('loads more pages and sends every filter', async () => {
    mocks.api.problems.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor ? { items: [problem({ id: 'p3', itemLabel: 'Qapı' })], nextCursor: null } : { items: [problem()], nextCursor: 'p1' },
    );
    renderWithRouter(<ProblemsPage today="2026-11-04" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    expect(await screen.findByRole('link', { name: 'Qapı' })).toBeInTheDocument();
    expect(mocks.api.problems.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'p1' }));
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'Anbar' });
    await screen.findByRole('option', { name: 'Açılış' });
    await userEvent.selectOptions(screen.getByLabelText('Ciddilik'), 'critical');
    await userEvent.selectOptions(screen.getByLabelText('Mənbə'), 'manual');
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), 'site1');
    await userEvent.selectOptions(screen.getByLabelText('Yoxlama vərəqəsi'), 'c1');
    await waitFor(() =>
      expect(mocks.api.problems.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ severity: 'critical', source: 'manual', siteId: 'site1', checklistId: 'c1', from: '2026-10-29', to: '2026-11-04' }),
      ),
    );
  });

  it('refuses a range over 92 days or an inverted one without asking the API', async () => {
    renderWithRouter(<ProblemsPage today="2026-11-04" />);
    await waitFor(() => expect(mocks.api.problems.list).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-08-03' } });
    expect(await screen.findByText('Tarix aralığı çox uzundur (ən çox 92 gün).')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Başlanğıc tarixi'), { target: { value: '2026-11-05' } });
    expect(await screen.findByText('Son tarix başlanğıc tarixindən əvvəl ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.problems.list).toHaveBeenCalledTimes(1);
  });

  it("defaults to the last 7 days of the tenant's calendar, not UTC's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 21:30 UTC on 2 November is 01:30 on 3 November in Baku: a problem from this morning's occurrence is dated 3 November.
    vi.setSystemTime(new Date('2026-11-02T21:30:00.000Z'));
    renderWithRouter(<ProblemsPage />);
    await waitFor(() => expect(mocks.api.problems.list).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-28', to: '2026-11-03' })));
    expect(screen.getByLabelText('Son tarix')).toHaveValue('2026-11-03');
  });
});
```

In `apps/web/src/layouts/app-shell.test.tsx`:
- In `shows only the menu items the user may open`, add after the `Audit jurnalı` assertion:

```ts
    expect(screen.queryByRole('link', { name: 'Problemlər' })).not.toBeInTheDocument();
```

- Append a test inside `describe('AppShell', …)`:

```ts
  it('shows the problems page to users who may view assignments', async () => {
    state.current = { status: 'authenticated', me: me(['assignments.view']) };
    renderShell();
    expect(await screen.findByRole('link', { name: 'Problemlər' })).toHaveAttribute('href', '/problems');
    expect(screen.getByRole('link', { name: 'İcra cədvəli' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm --filter @taskop/web test -- problems-page app-shell`
Expected: FAIL:
- `Failed to resolve import "./problems-page"`.
- In the shell test, no link named "Problemlər".

- [ ] **Step 3: Implement the page**

`apps/web/src/features/executions/problems-page.tsx`:

```tsx
import { PROBLEM_SEVERITIES, PROBLEM_SOURCES, type ProblemSeverity, type ProblemSource } from '@taskop/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatLocalDate, useTenantToday } from '@/features/scheduling/labels';
import { useSites } from '@/features/sites/queries';
import { errorText } from '@/lib/errors';
import { defaultProblemRange, problemRangeError, severityVariant } from './labels';
import { type ProblemFilters, useChecklistOptions, useProblems } from './queries';

/** Recorded problems, read-only (spec §8). Each row opens its occurrence in the schedule drawer on the "İcra" tab. */
export function ProblemsPage({ today: fixedToday }: { today?: string }) {
  const { t } = useTranslation();
  const tenantToday = useTenantToday();
  const today = fixedToday ?? tenantToday;
  const sites = useSites();
  const checklists = useChecklistOptions();
  const [range, setRange] = useState(() => defaultProblemRange(today));
  const [siteId, setSiteId] = useState('');
  const [checklistId, setChecklistId] = useState('');
  const [severity, setSeverity] = useState<ProblemSeverity | ''>('');
  const [source, setSource] = useState<ProblemSource | ''>('');
  const rangeError = problemRangeError(range.from, range.to);
  const filters: ProblemFilters = {
    from: range.from,
    to: range.to,
    siteId: siteId || undefined,
    checklistId: checklistId || undefined,
    severity: severity || undefined,
    source: source || undefined,
  };
  const problems = useProblems(filters, rangeError === null);
  const items = problems.data?.pages.flatMap((p) => p.items) ?? [];
  const c = (key: string) => t(`executions.problemsPage.columns.${key}`);

  return (
    <div className="grid gap-4">
      <PageHeader title={t('executions.problemsPage.title')} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="problems-from">{t('executions.problemsPage.from')}</Label>
          <Input id="problems-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-44" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="problems-to">{t('executions.problemsPage.to')}</Label>
          <Input id="problems-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-44" />
        </div>
        <NativeSelect aria-label={t('executions.problemsPage.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)} className="w-52">
          <option value="">{t('executions.problemsPage.allSites')}</option>
          {(sites.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('executions.problemsPage.severity')}
          value={severity}
          onChange={(e) => setSeverity(e.target.value as ProblemSeverity | '')}
          className="w-44"
        >
          <option value="">{t('executions.problemsPage.allSeverities')}</option>
          {PROBLEM_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t(`executions.severities.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('executions.problemsPage.checklist')} value={checklistId} onChange={(e) => setChecklistId(e.target.value)} className="w-56">
          <option value="">{t('executions.problemsPage.allChecklists')}</option>
          {(checklists.data ?? []).map((cl) => (
            <option key={cl.id} value={cl.id}>
              {cl.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('executions.problemsPage.source')}
          value={source}
          onChange={(e) => setSource(e.target.value as ProblemSource | '')}
          className="w-44"
        >
          <option value="">{t('executions.problemsPage.allSources')}</option>
          {PROBLEM_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`executions.problemSources.${s}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {rangeError && <p className="text-destructive text-sm">{t(rangeError)}</p>}
      {!rangeError && problems.error && <p className="text-destructive">{errorText(t, problems.error)}</p>}
      {!rangeError && problems.isSuccess && items.length === 0 && <p className="text-muted-foreground">{t('executions.problemsPage.empty')}</p>}
      {!rangeError && items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {['date', 'site', 'checklist', 'item', 'severity', 'source', 'note', 'executor', 'media'].map((k) => (
                <TableHead key={k}>{c(k)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatLocalDate(p.localDate)}</TableCell>
                <TableCell>{p.siteName}</TableCell>
                <TableCell>{p.checklistName}</TableCell>
                <TableCell>
                  <Link
                    to="/schedule"
                    search={{ date: p.localDate, occurrence: p.occurrenceId, tab: 'execution' }}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.itemLabel ?? t('executions.problemsPage.unknownItem')}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={severityVariant(p.severity)}>{t(`executions.severities.${p.severity}`)}</Badge>
                </TableCell>
                <TableCell>{t(`executions.problemSources.${p.source}`)}</TableCell>
                <TableCell className="max-w-xs whitespace-pre-line">{p.note ?? '—'}</TableCell>
                <TableCell>{p.executorName}</TableCell>
                <TableCell>{p.mediaIds.length ? t('executions.problemsPage.mediaCount', { count: p.mediaIds.length }) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!rangeError && problems.hasNextPage && (
        <Button variant="outline" className="w-fit" disabled={problems.isFetchingNextPage} onClick={() => void problems.fetchNextPage()}>
          {t('executions.problemsPage.more')}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the route and the menu entry**

In `apps/web/src/router.tsx`:
- Add `import { ProblemsPage } from '@/features/executions/problems-page';` after the `AuditPage` import.
- Add after the `scheduleRoute` line:

```tsx
const problemsRoute = createRoute({ getParentRoute: () => appLayout, path: '/problems', component: () => <ProblemsPage /> });
```

- In `appLayout.addChildren([...])`, add `problemsRoute,` after `scheduleRoute,`.

In `apps/web/src/layouts/app-shell.tsx`:
- Add `TriangleAlert` to the `lucide-react` import (alphabetically after `Shield`).
- Add `| '/problems'` to the `NavItem['to']` union, after `'/schedule'`.
- Add after the `/schedule` entry of `NAV_ITEMS`:

```tsx
  { to: '/problems', labelKey: 'nav.problems', icon: TriangleAlert, permission: 'assignments.view' },
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/web test && pnpm --filter @taskop/web typecheck && pnpm --filter @taskop/web lint`
Expected: PASS: the whole web suite, including 4 problems page tests, 2 app-shell tests and `router.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/executions/problems-page.tsx apps/web/src/features/executions/problems-page.test.tsx apps/web/src/router.tsx apps/web/src/layouts/app-shell.tsx apps/web/src/layouts/app-shell.test.tsx
git commit -m "feat(web): add the read-only problems page with filters and drawer links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end execution flow and final checks

**Files:**
- Create: `apps/web/e2e/executions.spec.ts`

**Interfaces:**
- Consumes the whole of this part and Part 1 Tasks 6–18:
  - `POST /auth/login/worker`, `GET /me/sync`
  - `POST /executions`, `POST /executions/:id/media`, `PUT /executions/:id/answers`, `POST /executions/:id/complete`
  - the extended `GET /occurrences` and `GET /occurrences/:id`, `GET /executions/:id`, `GET /problems`
- The API runs on port 3000 with the `S3_*` settings of Part 1 Task 6. No upload happens (CI has no SeaweedFS): the registered photo stays `pending`, which the test checks.
- The global template "Gündəlik təmizlik yoxlaması" must exist (`pnpm db:seed`).

- [ ] **Step 1: Write the end-to-end test**

`apps/web/e2e/executions.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { type APIRequestContext, expect, test } from '@playwright/test';
import type { ChecklistContent, SyncResponse } from '@taskop/contracts';

/** UUIDv7 (RFC 9562): 48-bit Unix ms, version 7, variant 10, random rest. The phone generates IDs like this. */
function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The tenant's local date (new tenants are in Asia/Baku, which has no DST). */
const bakuDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

function apiAs(request: APIRequestContext, accessToken: string) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  return async function call<T = unknown>(method: string, url: string, data?: unknown): Promise<T> {
    const res = await request.fetch(`/api/v1${url}`, { method, headers, data });
    expect(res.ok(), `${method} ${url}: ${await res.text()}`).toBeTruthy();
    return (res.status() === 204 ? null : await res.json()) as T;
  };
}

test('a worker executes an occurrence through the API, then the owner reads it in the drawer and the problems list', async ({ page, request }) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const orgCode = `e2e-exe-${suffix}`;
  const email = `exe-${suffix}@example.az`;
  const password = 'e2e owner password';

  // Tenant, site, worker and a published checklist from a Taskop template.
  const signup = await request.post('/api/v1/auth/signup', {
    data: { orgName: 'E2E İcra MMC', orgCode, fullName: 'Leyla Quliyeva', email, password, client: 'mobile' },
  });
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const owner = apiAs(request, ((await signup.json()) as { accessToken: string }).accessToken);
  const types = await owner<Array<{ id: string; name: string }>>('GET', '/site-types');
  const site = await owner<{ id: string }>('POST', '/sites', { parentId: null, typeId: types.find((x) => x.name === 'Filial')!.id, name: 'Anbar №1' });
  const roles = await owner<Array<{ id: string; systemKey: string | null }>>('GET', '/roles');
  const worker = await owner<{ user: { id: string }; generatedSecret: string }>('POST', '/users/workers', {
    fullName: 'Nigar Səfərli',
    username: 'nigar',
    roleId: roles.find((r) => r.systemKey === 'worker')!.id,
    siteIds: [site.id],
  });
  const templates = await owner<Array<{ id: string; name: string; source: string }>>('GET', '/templates');
  const template = templates.find((x) => x.source === 'global' && x.name === 'Gündəlik təmizlik yoxlaması')!;
  const checklist = await owner<{ id: string }>('POST', '/checklists', { name: 'E2E icra', from: { kind: 'global', templateId: template.id } });
  const draft = await owner<{ revision: number }>('GET', `/checklists/${checklist.id}/draft`);
  await owner('POST', `/checklists/${checklist.id}/publish`, { revision: draft.revision });

  // An occurrence open right now: yesterday 00:00 to tomorrow 00:00 in Baku, so the test never races midnight.
  const yesterday = bakuDate(new Date(Date.now() - 86_400_000));
  await owner('POST', '/assignments', {
    checklistId: checklist.id,
    siteId: site.id,
    assigneeIds: [worker.user.id],
    schedule: { kind: 'once', date: yesterday },
    timing: { mode: 'fixed', startTime: '00:00', dueAfterMinutes: 2880, graceMinutes: 0 },
  });

  // The phone (stood in for by the API): sync, claim, register a photo it never uploads, answer, complete.
  const login = await request.post('/api/v1/auth/login/worker', { data: { orgCode, username: 'nigar', secret: worker.generatedSecret, client: 'mobile' } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const phone = apiAs(request, ((await login.json()) as { accessToken: string }).accessToken);
  const sync = await phone<SyncResponse>('GET', '/me/sync');
  const clientOffsetMs = Math.round(Date.now() - Date.parse(sync.serverTime));
  const stamp = () => ({ deviceTime: new Date().toISOString(), clientOffsetMs });
  expect(sync.occurrences).toHaveLength(1);
  const occurrence = sync.occurrences[0]!;
  const content = sync.checklistVersions.find((v) => v.id === occurrence.checklistVersionId)!.content as ChecklistContent;
  const items = content.sections.flatMap((s) => s.items);
  const item = (label: string) => items.find((i) => i.label === label)!;

  const executionId = uuidv7();
  const claim = await phone('POST', '/executions', {
    id: executionId,
    occurrenceId: occurrence.id,
    startedAt: new Date().toISOString(),
    device: { platform: 'android', osVersion: '15', appVersion: '1.0.0' },
    ...stamp(),
  });
  expect(claim).toMatchObject({ state: 'active', reason: null });

  const photoItem = item('Ümumi görünüşün fotosu');
  const photoId = uuidv7();
  await phone('POST', `/executions/${executionId}/media`, {
    id: photoId,
    itemId: photoItem.id,
    kind: 'photo',
    source: 'camera',
    mime: 'image/jpeg',
    bytes: 1000,
    width: 1600,
    height: 1200,
    capturedAt: new Date().toISOString(),
    ...stamp(),
  });

  const answers: Record<string, Record<string, unknown>> = {};
  for (const i of items) {
    // "Zibil qutuları boşaldılıb?" = Xeyr is a rule problem (normal). "Pis qoxu var?" = Xeyr is the good answer.
    if (i.type === 'yes_no') {
      answers[i.id] = { optionIds: [['Zibil qutuları boşaldılıb?', 'Pis qoxu var?'].includes(i.label) ? i.options[1].id : i.options[0].id] };
    }
    if (i.type === 'single_choice') answers[i.id] = { optionIds: [i.options[0]!.id] };
  }
  answers[photoItem.id] = { photos: [photoId] };
  // A manual critical problem on a good answer.
  const glass = item('Giriş qapısının şüşələri təmizdir?');
  answers[glass.id] = { ...answers[glass.id], problem: { severity: 'critical', note: 'Şüşədə çat var', mediaIds: [] } };
  await phone('PUT', `/executions/${executionId}/answers`, { rev: 1, answers, ...stamp() });
  const completed = await phone('POST', `/executions/${executionId}/complete`, { rev: 2, answers, completedAt: new Date().toISOString(), ...stamp() });
  // 10 visible items, the optional comment unanswered; 8 scored items, one problem: 87.5 %.
  expect(completed).toMatchObject({ state: 'completed', late: false, progress: { answered: 9, total: 10, requiredMissing: 0 }, score: { percent: 87.5 } });

  // The owner on the web.
  await page.goto('/login');
  await page.getByLabel('E-poçt', { exact: true }).fill(email);
  await page.getByLabel('Şifrə', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Daxil ol' }).click();

  // The problems list: both problems, then the severity filter.
  await page.getByRole('link', { name: 'Problemlər' }).click();
  await expect(page.getByRole('heading', { name: 'Problemlər' })).toBeVisible();
  const glassRow = page.getByRole('row').filter({ hasText: 'Şüşədə çat var' });
  const binRow = page.getByRole('row').filter({ hasText: 'Zibil qutuları boşaldılıb?' });
  for (const text of ['Giriş qapısının şüşələri təmizdir?', 'Kritik', 'Əl ilə qeyd', 'Nigar Səfərli', 'Anbar №1', 'E2E icra']) {
    await expect(glassRow).toContainText(text);
  }
  await expect(binRow).toContainText('Adi');
  await expect(binRow).toContainText('Qayda üzrə');
  await page.getByLabel('Ciddilik').selectOption('critical');
  await expect(binRow).toHaveCount(0);
  await expect(glassRow).toBeVisible();

  // A row opens the occurrence drawer on its execution tab.
  await glassRow.getByRole('link', { name: 'Giriş qapısının şüşələri təmizdir?' }).click();
  await expect(page).toHaveURL(/\/schedule\?/);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByText('Nigar Səfərli', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Tamamlanıb', { exact: true })).toBeVisible();
  await expect(drawer.getByText('1 fayl hələ yüklənməyib')).toBeVisible();
  await expect(drawer.getByText('9/10 cavab')).toBeVisible();
  await expect(drawer.getByText(/^87[,.]5%$/)).toBeVisible();
  const glassAnswer = drawer.getByRole('listitem', { name: 'Giriş qapısının şüşələri təmizdir?' });
  await expect(glassAnswer).toContainText('Bəli');
  await expect(glassAnswer).toContainText('Kritik');
  await expect(glassAnswer).toContainText('Şüşədə çat var');
  await expect(drawer.getByRole('listitem', { name: 'Zibil qutuları boşaldılıb?' })).toContainText('Xeyr');
  await expect(drawer.getByRole('listitem', { name: 'Ümumi görünüşün fotosu' }).getByRole('img', { name: 'Foto hələ yüklənməyib' })).toBeVisible();

  // The schedule row shows the counted execution.
  await drawer.getByRole('button', { name: 'Bağla', exact: true }).click();
  const row = page.getByRole('button', { name: /E2E icra/ });
  for (const text of ['Tamamlanıb', 'Nigar Səfərli', '9/10']) await expect(row).toContainText(text);
});
```

- [ ] **Step 2: Run the end-to-end test**

Prerequisites: Part 1 Tasks 6–18 merged; `docker compose up -d` (Postgres and SeaweedFS); `apps/api/.env` filled in, including the `S3_*` keys from `apps/api/.env.example`; `pnpm db:setup && pnpm db:seed` done.

```bash
pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n build && pnpm --filter @taskop/api-client build
pnpm --filter @taskop/api build
pnpm --filter @taskop/web e2e -- executions
```

Expected: PASS. The Playwright config starts the API and the web dev server when they are not already running.

- [ ] **Step 3: Check the seeded demo by hand**

With the dev servers running (`pnpm --filter @taskop/api start`, `pnpm --filter @taskop/web dev`), sign in at `http://localhost:5173` as the demo owner that `pnpm db:seed` prints. Then:
- Open "Problemlər". Yesterday's "Səhər təmizliyi" occurrence at "Anbar №1" (Part 1 Task 18) shows two problems: "Pis qoxu var?" (Qayda üzrə) and "Zibil qutuları boşaldılıb?" (Əl ilə qeyd).
- Click one. The drawer opens on "İcra": elvin, "Yarımçıq", "Tamamlanmayıb", the follow-up "Kanalizasiya borusundan" indented under "Pis qoxu var?".

Expected: as described. Nothing to commit for this step.

- [ ] **Step 4: Run every check in the monorepo**

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @taskop/web e2e
```

Expected: all green. The `foundation`, `checklists` and `scheduling` end-to-end tests still pass. In `scheduling.spec.ts` the assignment's occurrences have no execution, so the schedule rows render as before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/executions.spec.ts
git commit -m "test(web): add the execution end-to-end flow through the drawer and the problems list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec §8 coverage:**

| Spec §8 / §10 requirement | Where |
|---|---|
| Drawer "İcra" tab | Task 5 (`OccurrenceDialog` tabs, `ExecutionTab`) |
| Executor | Task 5 `SummaryView` |
| Started and completed device times; server receipt beneath when they differ by > 1 min | Task 2 `receiptDiffers` (boundary test at exactly 60 s and 60.001 s); Task 5 test |
| Late, partial and clock-suspect badges | Task 5: state badge "Yarımçıq" for partial (decision 2), `flags.late`, `flags.clockSuspect` |
| Score and progress | Task 5 (`scorePercent`, `progress`, `requiredMissing`) |
| `mediaPending` | Task 5 (`flags.mediaPending` badge) |
| Answers in the pinned layout: visible items, follow-ups indented | Task 4 (`visibleItems`, `data-depth`, `marginLeft`) |
| Problems highlighted | Task 4 (`data-problem`, severity badge, source, manual note and media) |
| Media thumbnails, lightbox, video player; `GET /media/:id/url` 5-min URLs | Task 3 (`MediaThumb`, `MediaLightbox`, `useViewableUrl`, 4-min cache, refresh once) |
| Collapsed "Rədd edilmiş icralar" section | Task 5 (`RejectedExecutions`, `aria-expanded`, lazy answers) |
| `/problems` page with `assignments.view` | Task 7 (route, nav entry gated by `assignments.view`) |
| Filters: site, severity, date range (≤ 92 days), checklist, source | Task 7; Task 2 `problemRangeError` |
| Rows link to the occurrence drawer; read-only | Task 6 (search params), Task 7 (`Link`) |
| Schedule list badges for the new statuses; score and progress columns | Task 6 (`occurrenceVariant`, `ExecutionCells`) |
| §10 Web tests: execution tab with rejected executions and media; problems filters | Tasks 3, 4, 5, 7 |
| §10 Playwright: seed, claim, answer with a problem, complete through the API; check the drawer and the problems list | Task 8 |

**Placeholder scan:** every step has complete code or an exact command with its expected result. There is no "TBD", "similar to" or "add error handling". The only prose edits (router imports, nav entry, `labels.test.ts` assertions) name the exact line and the exact text.

**Name consistency with Part 1's "Interfaces for Parts 2 and 3":**
- Contracts:
  - Types: `ExecutionSummary`, `ExecutionDetail`, `ExecutionBrief`, `ExecutionMediaDto`, `ExecutionProblem`, `ProblemDto`, `ProblemListQuery`, `OccurrenceDetail.execution`, `OccurrenceDetail.rejectedExecutions`, `OccurrenceDto.executionBrief`, `SyncResponse`
  - Constants: `MEDIA_LIMITS.downloadUrlTtlSeconds`, `EXECUTION_LIMITS.problemsMaxDays`, `PROBLEM_SEVERITIES`, `PROBLEM_SOURCES`, `ExecutionState`
  - Field names: `scorePercent`, `mediaPending`, `rejectedReason`, `startedReceivedAt`, `completedReceivedAt`, `clockSuspect`, `clockOffsetMs`, `device`, `content`, `answers`, `media`, `problems`, `itemLabel`, `executorName`, `localDate`, `occurrenceId`
- API client: `api.executions.get`, `api.media.url`, `api.problems.list`; e2e: `POST /executions`, `POST /executions/:id/media`, `PUT /executions/:id/answers`, `POST /executions/:id/complete`, `GET /me/sync`.
- i18n:
  - Part 1 keys reused unchanged: `executions.states.*`, `claimRejections.*`, `severities.*`, `problemSources.*`, `flags.{late, clockSuspect, mediaPending}`, `mediaKinds.*`, `mediaSources.*`, `issues.rangeTooLong`, `errors.NOT_FOUND`
  - New keys only: `executions.tabs`, `media`, `rejected`, `problemsPage` and the summary keys; `nav.problems`.
- Behaviour relied on: `GET /media/:id/url` refuses pending media (Part 1 Task 15), so the web never asks for it. `GET /problems` filters by the occurrence's local date (Part 1 Task 16), so the default range uses the tenant's date. The CI e2e job has no uploads (Part 1 Task 6 note), so Task 8 checks the pending placeholder instead of a loaded image.

**Contradictions with Part 1:** none found. One deviation: the nav label goes into `az.nav.problems`, not `az.executions`, because every menu label lives in `nav.ts`. Part 1's "Part 3 adds web UI strings to `az.executions`" still holds for all other strings.
