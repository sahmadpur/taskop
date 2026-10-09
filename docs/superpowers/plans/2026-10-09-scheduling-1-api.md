# Taskop Scheduling & Assignment — Part 1: Contracts & API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shift templates, dated rosters, assignments (checklist + site + named users + recurrence) and automatically generated occurrences with `pending → overdue → missed` status changes to `@taskop/contracts` and the API, with pg-boss running the two background jobs.

**Architecture:**
- **Recurrence and timezone maths** are pure functions in `@taskop/contracts`, shared with the web: `scheduleDates`, `slotFor`, `expandSchedule` and `describeSchedule`, built on small `Intl`-based zone helpers.
- **The API** gets one new NestJS module, `scheduling`:
  - Services: shifts, roster, assignments and occurrences.
  - `OccurrenceWriter` is the only code that creates, cancels or changes the status of occurrences, and it writes the status history.
  - `SchedulingScope` turns the caller's data scope into SQL.
  - `OccurrenceJobs` holds the two cron bodies; `JobsService` wires them to pg-boss.
- **Other modules talk to scheduling through a tiny in-process `DomainEvents` bus**, so neither the users module nor the checklists module imports scheduling.
- **Time comes from an injectable `Clock`**, so tests never sleep.

**Tech Stack:** Node 24, TypeScript 7, NestJS 12, nestjs-zod 5, Zod 4, Drizzle ORM 0.45 + drizzle-kit, PostgreSQL 18, **pg-boss 12** (new), Vitest 5, Testcontainers, supertest.

**Spec:** `docs/superpowers/specs/2026-10-09-scheduling-assignment-design.md`

**This plan is Part 1 of 2:**
- Part 1 (this file): contracts, i18n strings for errors, permissions, issues, statuses and summaries, API, seed.
- Part 2: `docs/superpowers/plans/2026-10-09-scheduling-2-web.md`, covering the API client and the web app. It can start once Tasks 1–5 of this plan are merged into the feature branch, because it needs only contracts and i18n.

## Global Constraints

- The product name is **Taskop**. Packages are `@taskop/*`. Azerbaijani (`az`) is the only locale.
- Install new packages with `pnpm add <pkg>@latest`. This part adds exactly one: `pg-boss` in `apps/api`.
- IDs are UUIDv7 for table rows. Every tenant-owned table has `tenant_id uuid not null`, has RLS `FORCE`d with the policy on `nullif(current_setting('app.tenant_id', true), '')::uuid`, and uses composite `(tenant_id, x_id)` foreign keys.
- All local times are in the **tenant timezone** (`tenants.timezone`). The API sends instants as ISO-8601 UTC and local dates as `YYYY-MM-DD`.
- Limits (spec §3, §4, §7), exactly:
  - A window (start → close) is ≤ 24h (1,440 min). With `assignments.extended_window` it is ≤ 7 days (10,080 min).
  - Generation horizon: 14 days. A schedule with no slot in the next 366 days is `SCHEDULE_EMPTY`.
  - Assignees per assignment: 1–50.
  - Roster and occurrence list ranges: ≤ 62 days. Roster copy: ≤ 12 target weeks.
  - Preview: 20 slots.
  - Lengths: shift name ≤ 100, assignment name ≤ 200, cancel reason ≤ 500.
  - Recurrence fields: `every` 1–365 (daily), 1–52 (weekly), 1–12 (monthly); explicit `dates` 1–366; `skipDates` ≤ 366.
- Permission keys: `assignments.view`, `assignments.manage`, `assignments.extended_window`, `shifts.view`, `shifts.manage`.
  - Manager defaults: all of them except `assignments.extended_window`.
  - Auditor: `assignments.view` and `shifts.view`.
  - Admin: all. Owner: all, at runtime. Worker: none.
  - The migration backfills existing **Admin** roles only, as the sub-project 2 migration did.
- Every error body is `{ error: { code, messageKey, fields, retryAfterSeconds, requestId, issues?, currentRevision?, userIds? } }`.
- Occurrence statuses are the full FR-11.01 list (`pending`, `started`, `in_progress`, `completed`, `partial`, `overdue`, `missed`, `cancelled`, `audit_pending`, `audited`). This sub-project only ever writes `pending`, `overdue`, `missed` and `cancelled`.
- Every status change writes one `occurrence_status_history` row in the same transaction and emits `occurrence.status_changed`.
- Every user-initiated change to shifts, roster, assignments or occurrences writes exactly one `audit_log` row. Automatic status changes are recorded only in history. Two automatic actions do write audit rows: the auto-pause on checklist deactivation, and the regeneration on a shift-hours change.
- No test may sleep to wait for wall-clock time. Use `FakeClock`. The single pg-boss wiring test polls with a timeout.

## Review Focus

These are the five input classes most likely to bite users that no spec test names. Each line gives the task whose tests pin it.

1. **An edit made while today's occurrence is already open.** At 08:30 a manager moves the start from 08:00 to 09:00. The open 08:00 occurrence must stay, there must be no second occurrence for today, and tomorrow onward moves to 09:00. Pinned in Task 11 (`edit keeps the open occurrence and does not duplicate today`).
2. **A manager cancels one occurrence, then the 15-minute cron runs.** The cancelled slot must never come back. Pinned in Task 12 (`a cancelled slot is never recreated by the cron`).
3. **The server was down across a whole window.** The sweep must take the occurrence straight to `missed` and record both steps at their real times (due, then close). It must not record "now". Pinned in Task 12 (`jumps straight to missed with two history rows`).
4. **A timezone with DST.** A daily 08:00 slot must stay at 08:00 local across the change, and 02:30 on spring-forward day must land at 03:30. Pinned in Task 1 and Task 2 (`keeps the wall-clock start across a DST change`).
5. **A user removed from a site or deactivated while rostered next week.** Their future snapshots and roster rows must go away, occurrences left with nobody must show `unassigned: true`, and reactivating the user restores the snapshots. Pinned in Task 11 (`user access changes refresh snapshots`) and Task 13 (`flags unassigned occurrences`).

---

## File Structure

```
packages/contracts/src/
  scheduling-time.ts            LocalDate/LocalTime, day maths, tz offset, zonedTimeToUtc, localDateOf
  scheduling-time.test.ts
  scheduling.ts                 SCHEDULING_LIMITS, recurrence/timing schemas, scheduleDates, slotFor, expandSchedule,
                                windowMinutes, validateSchedule, scheduleWarnings, issue codes, localRangeCheck
  scheduling.test.ts
  scheduling-describe.ts        describeSchedule(recurrence, timing, shiftName, t)
  scheduling-describe.test.ts
  shifts.ts                     shift + roster DTOs and inputs
  occurrences.ts                statuses, cancel reasons, occurrence DTOs and queries
  assignments.ts                assignment DTOs, inputs, preview
  scheduling-resources.test.ts
  errors.ts                     + 15 codes, + userIds on the error body
  permissions.ts                + assignments/shifts groups and role defaults
  index.ts                      + exports
packages/i18n/src/az/
  scheduling.ts                 issues, summary, weekdays, nth, statuses, cancel reasons, warnings (UI strings in Part 2)
  errors.ts, roles.ts, index.ts
apps/api/
  package.json                  + pg-boss
  drizzle/0005_scheduling.sql            (generated)
  drizzle/0006_scheduling_security.sql   (custom: RLS, grants, pgboss schema, permission backfill)
  src/config/config.ts                   + JOBS_ENABLED
  src/db/schema.ts                       + 2 enums, 7 tables
  src/common/clock.ts                    Clock, SystemClock
  src/common/domain-events.ts            DomainEvents (typed, awaited, in-transaction)
  src/common/common.module.ts            + Clock, DomainEvents
  src/common/app-error.ts                + details.userIds
  src/checklists/checklists.service.ts   emits checklist.deactivated
  src/users/users.service.ts             emits user.access_changed
  src/scheduling/
    actor.ts                    Actor, CurrentActor
    scheduling-scope.ts         SQL filters per data scope, assertSiteWritable
    mappers.ts                  row → DTO, hhmm, sameJson
    dto.ts
    shifts.service.ts, shifts.controller.ts
    roster.service.ts, roster.controller.ts
    occurrence-writer.ts        materialize, insert/refresh snapshots, cancelFuturePending, regenerate, restart, recordTransitions
    occurrence-queries.ts       shared occurrence SELECT + mapper
    assignment-rules.ts         validation shared by create/update/resume/preview
    assignments.service.ts, assignments.controller.ts
    occurrences.service.ts, occurrences.controller.ts (+ MeOccurrencesController)
    eligibility.service.ts      canStart (for sub-project 4)
    scheduling-listeners.ts     roster.changed, user.access_changed, checklist.deactivated
    occurrence-jobs.ts          materializeAll, sweepAll, sweepTenant
    jobs.service.ts             pg-boss lifecycle, queues, schedules, workers
    scheduling.module.ts
  src/app.module.ts             + SchedulingModule
  src/db/scripts/seed.ts        + demo shift, roster, assignment
  test/fake-clock.ts, test/app.ts (clock option, JOBS_ENABLED=false)
  test/scheduling-fixtures.ts
  test/domain-events.test.ts, test/scheduling-db.test.ts, test/shifts.test.ts, test/roster.test.ts,
  test/assignments.test.ts, test/assignment-changes.test.ts, test/occurrence-jobs.test.ts,
  test/occurrences.test.ts, test/scheduling-scope.test.ts, test/isolation.test.ts (extended),
  test/openapi.test.ts (extended), test/roles.test.ts (updated)
```

---

### Task 1: Local dates, times and timezone conversion

**Files:**
- Create: `packages/contracts/src/scheduling-time.ts`
- Test: `packages/contracts/src/scheduling-time.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces (used by Tasks 2–3, the API and Part 2):
  - Types: `LocalDate` (`'YYYY-MM-DD'`), `LocalTime` (`'HH:mm'`)
  - Schemas: `localDateSchema`, `localTimeSchema`
  - Functions:
    - `dayNumber(d: LocalDate): number`, `fromDayNumber(n: number): LocalDate`
    - `addDays(d: LocalDate, days: number): LocalDate`
    - `isoWeekday(d: LocalDate): number` (1 = Monday … 7 = Sunday)
    - `daysInMonth(year: number, month: number): number` (month is 1–12)
    - `timeToMinutes(t: LocalTime): number`, `minutesToTime(min: number): LocalTime` (wraps at 24h)
    - `tzOffsetMinutes(tz: string, instant: Date | number): number`
    - `localDateOf(instant: Date, tz: string): LocalDate`
    - `zonedTimeToUtc(date: LocalDate, minutes: number, tz: string): Date`

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/scheduling-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayNumber,
  daysInMonth,
  fromDayNumber,
  isoWeekday,
  localDateOf,
  localDateSchema,
  localTimeSchema,
  minutesToTime,
  timeToMinutes,
  tzOffsetMinutes,
  zonedTimeToUtc,
} from './scheduling-time.js';

describe('local dates', () => {
  it('converts between dates and day numbers', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(dayNumber('2026-11-02'))).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('knows ISO weekdays and month lengths', () => {
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-01')).toBe(7);
    expect(isoWeekday('1970-01-01')).toBe(4);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('validates date and time strings', () => {
    expect(localDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(localDateSchema.safeParse('2028-02-29').success).toBe(true);
    expect(localDateSchema.safeParse('2026-11-2').success).toBe(false);
    expect(localTimeSchema.safeParse('24:00').success).toBe(false);
    expect(localTimeSchema.safeParse('07:5').success).toBe(false);
    expect(localTimeSchema.safeParse('23:59').success).toBe(true);
  });

  it('converts clock times', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1500)).toBe('01:00');
  });
});

describe('time zones', () => {
  it('reads UTC offsets', () => {
    expect(tzOffsetMinutes('Asia/Baku', new Date('2026-07-01T00:00:00Z'))).toBe(240);
    expect(tzOffsetMinutes('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(120);
  });

  it('finds the local date of an instant', () => {
    expect(localDateOf(new Date('2026-11-01T20:30:00Z'), 'Asia/Baku')).toBe('2026-11-02');
    expect(localDateOf(new Date('2026-11-01T19:59:59.999Z'), 'Asia/Baku')).toBe('2026-11-01');
  });

  it('converts a plain local time', () => {
    expect(zonedTimeToUtc('2026-11-02', 8 * 60, 'Asia/Baku').toISOString()).toBe('2026-11-02T04:00:00.000Z');
  });

  it.each([
    // Spring forward: 02:30 does not exist and is read with the offset before the gap (→ 03:30 local).
    ['Europe/Berlin', '2026-03-29', '02:30', '2026-03-29T01:30:00.000Z'],
    ['America/New_York', '2026-03-08', '02:30', '2026-03-08T07:30:00.000Z'],
    // Fall back: 02:30 / 01:30 happen twice; the earlier instant wins.
    ['Europe/Berlin', '2026-10-25', '02:30', '2026-10-25T00:30:00.000Z'],
    ['America/New_York', '2026-11-01', '01:30', '2026-11-01T05:30:00.000Z'],
    // Just around the gap.
    ['Europe/Berlin', '2026-03-29', '01:59', '2026-03-29T00:59:00.000Z'],
    ['Europe/Berlin', '2026-03-29', '03:00', '2026-03-29T01:00:00.000Z'],
  ])('handles DST in %s on %s at %s', (tz, date, time, iso) => {
    expect(zonedTimeToUtc(date, timeToMinutes(time), tz).toISOString()).toBe(iso);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- scheduling-time`
Expected: FAIL, because `./scheduling-time.js` does not exist.

- [ ] **Step 3: Implement**

`packages/contracts/src/scheduling-time.ts`:

```ts
import { z } from 'zod';

/** A calendar date in the tenant's timezone, 'YYYY-MM-DD'. */
export type LocalDate = string;
/** A wall-clock time, 'HH:mm' (24h). */
export type LocalTime = string;

const DAY_MS = 86_400_000;

export function dayNumber(d: LocalDate): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / DAY_MS);
}

export function fromDayNumber(n: number): LocalDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (d: LocalDate, days: number): LocalDate => fromDayNumber(dayNumber(d) + days);

/** ISO weekday: 1 = Monday … 7 = Sunday. Day 0 (1970-01-01) was a Thursday. */
export const isoWeekday = (d: LocalDate): number => ((((dayNumber(d) + 3) % 7) + 7) % 7) + 1;

/** `month` is 1–12. */
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function timeToMinutes(t: LocalTime): number {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Wraps at midnight: 1500 → '01:00'. */
export function minutesToTime(min: number): LocalTime {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const localDateSchema = z.iso.date().refine((d) => fromDayNumber(dayNumber(d)) === d, { error: 'errors.validation.invalid' });
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'errors.validation.invalid' });

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall-clock reading in `tz` at instant `ms`, written as if it were a UTC timestamp. */
function wallMs(tz: string, ms: number): number {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
}

/** UTC offset of `tz` at `instant`, in minutes (Asia/Baku → 240). */
export function tzOffsetMinutes(tz: string, instant: Date | number): number {
  const ms = Math.floor(+instant / 1000) * 1000;
  return Math.round((wallMs(tz, ms) - ms) / 60_000);
}

export function localDateOf(instant: Date, tz: string): LocalDate {
  return new Date(wallMs(tz, Math.floor(+instant / 1000) * 1000)).toISOString().slice(0, 10);
}

/**
 * The instant at which the wall clock in `tz` shows `date` + `minutes`.
 * Ambiguous times (fall back) take the earlier instant. Times inside a spring-forward gap are read
 * with the offset in force before the gap, so 02:30 becomes 03:30 (as RFC 5545 does).
 */
export function zonedTimeToUtc(date: LocalDate, minutes: number, tz: string): Date {
  const wall = dayNumber(date) * DAY_MS + minutes * 60_000;
  const before = tzOffsetMinutes(tz, wall - DAY_MS);
  const after = tzOffsetMinutes(tz, wall + DAY_MS);
  const valid = [wall - before * 60_000, wall - after * 60_000]
    .filter((c) => wallMs(tz, c) === wall)
    .sort((a, b) => a - b);
  return new Date(valid[0] ?? wall - before * 60_000);
}
```

Add to `packages/contracts/src/index.ts`, after the `checklists.js` export:

```ts
export * from './scheduling-time.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test -- scheduling-time`
Expected: PASS (all cases, including the 6 DST cases).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/scheduling-time.ts packages/contracts/src/scheduling-time.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add local date and timezone helpers for scheduling"
```

---

### Task 2: Recurrence, timing and slot expansion

**Files:**
- Create: `packages/contracts/src/scheduling.ts`
- Test: `packages/contracts/src/scheduling.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `ContentIssue` (`{ path: (string|number)[]; code: string }`) from `checklist-content.ts`; `idSchema` from `common.ts`.
- Produces:
  - `SCHEDULING_LIMITS` (`maxWindowMinutes: 1440`, `maxExtendedWindowMinutes: 10080`, `horizonDays: 14`, `maxAssignees: 50`, `rosterMaxDays: 62`, `copyMaxWeeks: 12`, `previewSlots: 20`, `emptyCheckDays: 366`, `maxListDays: 62`)
  - `isoWeekdaySchema`, `recurrenceSchema`, `type Recurrence`, `type RecurrenceKind`, `RECURRENCE_KINDS`
  - `timingSchema`, `type Timing`
  - `interface ShiftHours { startTime: LocalTime; endTime: LocalTime }`
  - `interface Slot { localDate: LocalDate; startsAt: Date; dueAt: Date; closesAt: Date }`
  - `shiftDurationMinutes(shift)`, `windowMinutes(timing, shift | null)`
  - `scheduleDates(r, from, to): LocalDate[]`
  - `slotFor(date, timing, shift | null, tz): Slot`
  - `expandSchedule(r, timing, shift | null, tz, from, to): Slot[]`
  - `SCHEDULING_ISSUE_CODES`, `type SchedulingIssueCode`
  - `validateSchedule(r): ContentIssue[]` (paths relative to the schedule)
  - `PREVIEW_WARNINGS`, `type PreviewWarning`, `scheduleWarnings(r): PreviewWarning[]`
  - `localRangeCheck(maxDays)`: a `superRefine` callback for `{ from, to }` objects

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/scheduling.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  expandSchedule,
  type Recurrence,
  recurrenceSchema,
  scheduleDates,
  scheduleWarnings,
  slotFor,
  timingSchema,
  validateSchedule,
  windowMinutes,
} from './scheduling.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const range = (startDate: string, extra: Partial<{ endDate: string | null; skipDates: string[] }> = {}) => ({
  startDate,
  endDate: null,
  skipDates: [],
  ...extra,
});

describe('recurrence schema', () => {
  it('accepts each kind', () => {
    const ok: Recurrence[] = [
      { kind: 'once', date: '2026-11-05' },
      { kind: 'daily', every: 1, ...range('2026-11-02') },
      { kind: 'weekly', every: 1, weekdays: [1, 3], ...range('2026-11-02') },
      { kind: 'monthly', every: 1, by: { dayOfMonth: 31 }, ...range('2026-11-02') },
      { kind: 'monthly', every: 1, by: { nth: -1, weekday: 5 }, ...range('2026-11-02') },
      { kind: 'dates', dates: ['2026-11-05'] },
    ];
    for (const r of ok) expect(recurrenceSchema.safeParse(r).success, r.kind).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(recurrenceSchema.safeParse({ kind: 'daily', every: 0, ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'weekly', every: 1, weekdays: [], ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'weekly', every: 1, weekdays: [8], ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'monthly', every: 1, by: { nth: 5, weekday: 1 }, ...range('2026-11-02') }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ kind: 'dates', dates: [] }).success).toBe(false);
    expect(timingSchema.safeParse({ mode: 'fixed', startTime: '8:00', dueAfterMinutes: 60, graceMinutes: 0 }).success).toBe(false);
    expect(timingSchema.safeParse({ mode: 'fixed', startTime: '08:00', dueAfterMinutes: 0, graceMinutes: 0 }).success).toBe(false);
  });
});

describe('scheduleDates', () => {
  it('handles once and explicit dates', () => {
    expect(scheduleDates({ kind: 'once', date: '2026-11-05' }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-05']);
    expect(scheduleDates({ kind: 'once', date: '2026-10-05' }, '2026-11-01', '2026-11-30')).toEqual([]);
    expect(scheduleDates({ kind: 'dates', dates: ['2026-11-09', '2026-11-03', '2026-12-01'] }, '2026-11-01', '2026-11-30')).toEqual(['2026-11-03', '2026-11-09']);
  });

  it('counts daily intervals from startDate', () => {
    expect(scheduleDates({ kind: 'daily', every: 3, ...range('2026-11-02') }, '2026-11-01', '2026-11-12')).toEqual(['2026-11-02', '2026-11-05', '2026-11-08', '2026-11-11']);
  });

  it('honours skip dates and the end date', () => {
    const r: Recurrence = { kind: 'daily', every: 1, ...range('2026-11-02', { endDate: '2026-11-05', skipDates: ['2026-11-03'] }) };
    expect(scheduleDates(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-02', '2026-11-04', '2026-11-05']);
  });

  it('runs weekly on chosen weekdays every N weeks from the start week', () => {
    // 2026-11-04 is a Wednesday; its ISO week starts on Monday 2026-11-02.
    const r: Recurrence = { kind: 'weekly', every: 2, weekdays: [1, 5], ...range('2026-11-04') };
    expect(scheduleDates(r, '2026-11-01', '2026-11-30')).toEqual(['2026-11-06', '2026-11-16', '2026-11-20', '2026-11-30']);
  });

  it('clamps a monthly day of month to short months', () => {
    const r: Recurrence = { kind: 'monthly', every: 1, by: { dayOfMonth: 31 }, ...range('2026-01-01') };
    expect(scheduleDates(r, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('runs monthly every N months from the start month', () => {
    const r: Recurrence = { kind: 'monthly', every: 2, by: { dayOfMonth: 15 }, ...range('2026-01-10') };
    expect(scheduleDates(r, '2026-01-01', '2026-06-30')).toEqual(['2026-01-15', '2026-03-15', '2026-05-15']);
  });

  it('finds the nth and the last weekday of a month', () => {
    const second: Recurrence = { kind: 'monthly', every: 1, by: { nth: 2, weekday: 2 }, ...range('2026-11-01') };
    expect(scheduleDates(second, '2026-11-01', '2026-12-31')).toEqual(['2026-11-10', '2026-12-08']);
    const last: Recurrence = { kind: 'monthly', every: 1, by: { nth: -1, weekday: 5 }, ...range('2026-11-01') };
    expect(scheduleDates(last, '2026-11-01', '2026-12-31')).toEqual(['2026-11-27', '2026-12-25']);
  });
});

describe('slots', () => {
  it('builds fixed slots in the tenant timezone', () => {
    const s = slotFor('2026-11-02', { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 }, null, 'Asia/Baku');
    expect([s.startsAt, s.dueAt, s.closesAt].map((x) => x.toISOString())).toEqual([
      '2026-11-02T04:00:00.000Z',
      '2026-11-02T06:00:00.000Z',
      '2026-11-02T07:00:00.000Z',
    ]);
  });

  it('lets a shift cross midnight', () => {
    const s = slotFor('2026-11-02', { mode: 'shift', shiftId: ID, graceMinutes: 30 }, { startTime: '22:00', endTime: '06:00' }, 'Asia/Baku');
    expect(s.localDate).toBe('2026-11-02');
    expect(s.startsAt.toISOString()).toBe('2026-11-02T18:00:00.000Z');
    expect(s.dueAt.toISOString()).toBe('2026-11-03T02:00:00.000Z');
    expect(s.closesAt.toISOString()).toBe('2026-11-03T02:30:00.000Z');
  });

  it('keeps the wall-clock start across a DST change', () => {
    const timing = { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 60, graceMinutes: 0 } as const;
    const slots = expandSchedule({ kind: 'daily', every: 1, ...range('2026-10-24') }, timing, null, 'Europe/Berlin', '2026-10-24', '2026-10-26');
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(['2026-10-24T06:00:00.000Z', '2026-10-25T07:00:00.000Z', '2026-10-26T07:00:00.000Z']);
  });

  it('measures windows', () => {
    expect(windowMinutes({ mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 }, null)).toBe(180);
    expect(windowMinutes({ mode: 'shift', shiftId: ID, graceMinutes: 30 }, { startTime: '22:00', endTime: '06:00' })).toBe(510);
  });
});

describe('validateSchedule and warnings', () => {
  it('reports cross-field issues with paths relative to the schedule', () => {
    expect(validateSchedule({ kind: 'daily', every: 1, ...range('2026-11-10', { endDate: '2026-11-01' }) })).toEqual([
      { path: ['endDate'], code: 'scheduling.issues.endBeforeStart' },
    ]);
    expect(validateSchedule({ kind: 'weekly', every: 1, weekdays: [1, 1], ...range('2026-11-02') })).toEqual([
      { path: ['weekdays'], code: 'scheduling.issues.duplicateWeekday' },
    ]);
    expect(validateSchedule({ kind: 'dates', dates: ['2026-11-05', '2026-11-06', '2026-11-05'] })).toEqual([
      { path: ['dates', 2], code: 'scheduling.issues.duplicateDate' },
    ]);
    expect(validateSchedule({ kind: 'once', date: '2026-11-05' })).toEqual([]);
  });

  it('warns about skip dates outside the range', () => {
    expect(scheduleWarnings({ kind: 'daily', every: 1, ...range('2026-11-02', { skipDates: ['2026-10-01'] }) })).toEqual(['SKIP_DATE_OUT_OF_RANGE']);
    expect(scheduleWarnings({ kind: 'daily', every: 1, ...range('2026-11-02', { skipDates: ['2026-11-03'] }) })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- scheduling.test`
Expected: FAIL, because `./scheduling.js` does not exist.

- [ ] **Step 3: Implement**

`packages/contracts/src/scheduling.ts`:

```ts
import { z } from 'zod';
import type { ContentIssue } from './checklist-content.js';
import { idSchema } from './common.js';
import {
  addDays,
  dayNumber,
  daysInMonth,
  fromDayNumber,
  isoWeekday,
  type LocalDate,
  localDateSchema,
  type LocalTime,
  localTimeSchema,
  timeToMinutes,
  zonedTimeToUtc,
} from './scheduling-time.js';

export const SCHEDULING_LIMITS = {
  /** FR-09.05: start → close without `assignments.extended_window`. */
  maxWindowMinutes: 24 * 60,
  /** Hard cap, even with `assignments.extended_window` (FR-09.06). */
  maxExtendedWindowMinutes: 7 * 24 * 60,
  horizonDays: 14,
  maxAssignees: 50,
  rosterMaxDays: 62,
  copyMaxWeeks: 12,
  previewSlots: 20,
  /** A schedule with no slot this many days ahead is rejected as empty. */
  emptyCheckDays: 366,
  maxListDays: 62,
} as const;

export const isoWeekdaySchema = z.number().int().min(1).max(7);

const range = {
  startDate: localDateSchema,
  endDate: localDateSchema.nullable(),
  skipDates: z.array(localDateSchema).max(366),
};

export const recurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date: localDateSchema }),
  z.object({ kind: z.literal('daily'), every: z.number().int().min(1).max(365), ...range }),
  z.object({ kind: z.literal('weekly'), every: z.number().int().min(1).max(52), weekdays: z.array(isoWeekdaySchema).min(1).max(7), ...range }),
  z.object({
    kind: z.literal('monthly'),
    every: z.number().int().min(1).max(12),
    by: z.union([
      z.object({ dayOfMonth: z.number().int().min(1).max(31) }),
      z.object({ nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]), weekday: isoWeekdaySchema }),
    ]),
    ...range,
  }),
  z.object({ kind: z.literal('dates'), dates: z.array(localDateSchema).min(1).max(366) }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type RecurrenceKind = Recurrence['kind'];
export const RECURRENCE_KINDS = ['once', 'daily', 'weekly', 'monthly', 'dates'] as const satisfies readonly RecurrenceKind[];

const graceMinutes = z.number().int().min(0).max(SCHEDULING_LIMITS.maxExtendedWindowMinutes);
export const timingSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fixed'),
    startTime: localTimeSchema,
    dueAfterMinutes: z.number().int().min(1).max(SCHEDULING_LIMITS.maxExtendedWindowMinutes),
    graceMinutes,
  }),
  z.object({ mode: z.literal('shift'), shiftId: idSchema, graceMinutes }),
]);
export type Timing = z.infer<typeof timingSchema>;

export interface ShiftHours {
  startTime: LocalTime;
  endTime: LocalTime;
}

export interface Slot {
  localDate: LocalDate;
  startsAt: Date;
  dueAt: Date;
  closesAt: Date;
}

/** An end time at or before the start time means the shift ends the next day. */
export function shiftDurationMinutes(s: ShiftHours): number {
  const d = timeToMinutes(s.endTime) - timeToMinutes(s.startTime);
  return d > 0 ? d : d + 1440;
}

/** Start → close length of every slot (FR-09.05). */
export function windowMinutes(timing: Timing, shift: ShiftHours | null): number {
  if (timing.mode === 'fixed') return timing.dueAfterMinutes + timing.graceMinutes;
  if (!shift) throw new Error('shift timing needs the shift hours');
  return shiftDurationMinutes(shift) + timing.graceMinutes;
}

type RangeRecurrence = Exclude<Recurrence, { kind: 'once' | 'dates' }>;

function matches(r: RangeRecurrence, d: LocalDate): boolean {
  const dn = dayNumber(d);
  const start = dayNumber(r.startDate);
  switch (r.kind) {
    case 'daily':
      return (dn - start) % r.every === 0;
    case 'weekly': {
      const weekStart = start - (isoWeekday(r.startDate) - 1);
      return r.weekdays.includes(isoWeekday(d)) && Math.floor((dn - weekStart) / 7) % r.every === 0;
    }
    case 'monthly': {
      const [y, m, day] = d.split('-').map(Number) as [number, number, number];
      const [sy, sm] = r.startDate.split('-').map(Number) as [number, number];
      if (((y - sy) * 12 + (m - sm)) % r.every !== 0) return false;
      const len = daysInMonth(y, m);
      if ('dayOfMonth' in r.by) return day === Math.min(r.by.dayOfMonth, len);
      if (isoWeekday(d) !== r.by.weekday) return false;
      return r.by.nth === -1 ? day + 7 > len : Math.ceil(day / 7) === r.by.nth;
    }
  }
}

/** Local dates the rule fires on within [from, to] (inclusive), in order. */
export function scheduleDates(r: Recurrence, from: LocalDate, to: LocalDate): LocalDate[] {
  if (r.kind === 'once' || r.kind === 'dates') {
    const list = r.kind === 'once' ? [r.date] : r.dates;
    return [...new Set(list)].filter((d) => d >= from && d <= to).sort();
  }
  const skip = new Set(r.skipDates);
  const first = Math.max(dayNumber(from), dayNumber(r.startDate));
  const last = Math.min(dayNumber(to), r.endDate ? dayNumber(r.endDate) : Number.POSITIVE_INFINITY);
  const out: LocalDate[] = [];
  for (let n = first; n <= last; n++) {
    const d = fromDayNumber(n);
    if (!skip.has(d) && matches(r, d)) out.push(d);
  }
  return out;
}

export function slotFor(date: LocalDate, timing: Timing, shift: ShiftHours | null, tz: string): Slot {
  if (timing.mode === 'fixed') {
    const startsAt = zonedTimeToUtc(date, timeToMinutes(timing.startTime), tz);
    const dueAt = new Date(+startsAt + timing.dueAfterMinutes * 60_000);
    return { localDate: date, startsAt, dueAt, closesAt: new Date(+dueAt + timing.graceMinutes * 60_000) };
  }
  if (!shift) throw new Error('shift timing needs the shift hours');
  const startsAt = zonedTimeToUtc(date, timeToMinutes(shift.startTime), tz);
  const overnight = timeToMinutes(shift.endTime) <= timeToMinutes(shift.startTime);
  const dueAt = zonedTimeToUtc(overnight ? addDays(date, 1) : date, timeToMinutes(shift.endTime), tz);
  return { localDate: date, startsAt, dueAt, closesAt: new Date(+dueAt + timing.graceMinutes * 60_000) };
}

export function expandSchedule(r: Recurrence, timing: Timing, shift: ShiftHours | null, tz: string, from: LocalDate, to: LocalDate): Slot[] {
  return scheduleDates(r, from, to).map((d) => slotFor(d, timing, shift, tz));
}

export const SCHEDULING_ISSUE_CODES = [
  'scheduling.issues.endBeforeStart',
  'scheduling.issues.duplicateDate',
  'scheduling.issues.duplicateWeekday',
  'scheduling.issues.shiftZeroLength',
  'scheduling.issues.rangeTooLong',
  'scheduling.issues.dateOutOfRange',
] as const;
export type SchedulingIssueCode = (typeof SCHEDULING_ISSUE_CODES)[number];

/** Cross-field checks the Zod schema cannot express. Paths are relative to the schedule. */
export function validateSchedule(r: Recurrence): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (r.kind === 'once') return issues;
  if (r.kind === 'dates') {
    const seen = new Set<string>();
    r.dates.forEach((d, i) => {
      if (seen.has(d)) issues.push({ path: ['dates', i], code: 'scheduling.issues.duplicateDate' });
      seen.add(d);
    });
    return issues;
  }
  if (r.endDate && r.endDate < r.startDate) issues.push({ path: ['endDate'], code: 'scheduling.issues.endBeforeStart' });
  if (r.kind === 'weekly' && new Set(r.weekdays).size !== r.weekdays.length) {
    issues.push({ path: ['weekdays'], code: 'scheduling.issues.duplicateWeekday' });
  }
  return issues;
}

export const PREVIEW_WARNINGS = ['NO_ROSTERED_ASSIGNEES', 'SKIP_DATE_OUT_OF_RANGE'] as const;
export type PreviewWarning = (typeof PREVIEW_WARNINGS)[number];

/** Warnings that depend only on the rule; the API adds the roster-based one. */
export function scheduleWarnings(r: Recurrence): PreviewWarning[] {
  if (r.kind === 'once' || r.kind === 'dates') return [];
  const outside = r.skipDates.some((d) => d < r.startDate || (r.endDate !== null && d > r.endDate));
  return outside ? ['SKIP_DATE_OUT_OF_RANGE'] : [];
}

/** `superRefine` for `{ from, to }` queries: 1 ≤ days ≤ maxDays, reported on `to`. */
export const localRangeCheck =
  (maxDays: number) =>
  (v: { from: LocalDate; to: LocalDate }, ctx: z.RefinementCtx): void => {
    const days = dayNumber(v.to) - dayNumber(v.from) + 1;
    if (days < 1 || days > maxDays) ctx.addIssue({ code: 'custom', path: ['to'], message: 'scheduling.issues.rangeTooLong' });
  };
```

Add to `packages/contracts/src/index.ts`, after `scheduling-time.js`:

```ts
export * from './scheduling.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test -- scheduling`
Expected: PASS (both `scheduling-time` and `scheduling` suites).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/scheduling.ts packages/contracts/src/scheduling.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add recurrence rules, timing and slot expansion"
```

---

### Task 3: Schedule summary (`describeSchedule`)

**Files:**
- Create: `packages/contracts/src/scheduling-describe.ts`
- Test: `packages/contracts/src/scheduling-describe.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `Recurrence`, `Timing` (Task 2), `timeToMinutes` and `minutesToTime` (Task 1).
- Produces:
  - `type Translate = (key: string, vars?: Record<string, string | number>) => string`
  - `describeSchedule(r: Recurrence, timing: Timing, shiftName: string | null, t: Translate): string`
  - i18n keys it uses, all added in Task 5:
    - `scheduling.summary.{once,dates,daily,everyNDays,weekly,everyNWeeks,monthly,everyNMonths,dayOfMonth,nthWeekday,shift,plusDays}`
    - `scheduling.weekdays.{1..7}`, `scheduling.weekdaysShort.{1..7}`
    - `scheduling.nth.{1,2,3,4,last}`

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/scheduling-describe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeSchedule, type Translate } from './scheduling-describe.js';

/** Echoes the key and its variables, so the test pins exactly which strings are asked for. */
const t: Translate = (key, vars) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(';')})` : key);
const fixed = (startTime: string, dueAfterMinutes: number) => ({ mode: 'fixed' as const, startTime, dueAfterMinutes, graceMinutes: 0 });
const r0 = { startDate: '2026-11-02', endDate: null, skipDates: [] };

describe('describeSchedule', () => {
  it('describes daily and weekly rules with a time range', () => {
    expect(describeSchedule({ kind: 'daily', every: 1, ...r0 }, fixed('08:00', 120), null, t)).toBe('scheduling.summary.daily, 08:00–10:00');
    expect(describeSchedule({ kind: 'daily', every: 2, ...r0 }, fixed('08:00', 60), null, t)).toBe('scheduling.summary.everyNDays(n=2), 08:00–09:00');
    expect(describeSchedule({ kind: 'weekly', every: 1, weekdays: [3, 1], ...r0 }, fixed('08:00', 120), null, t)).toBe(
      'scheduling.summary.weekly(days=scheduling.weekdaysShort.1, scheduling.weekdaysShort.3), 08:00–10:00',
    );
    expect(describeSchedule({ kind: 'weekly', every: 2, weekdays: [5], ...r0 }, fixed('08:00', 60), null, t)).toBe(
      'scheduling.summary.everyNWeeks(n=2;days=scheduling.weekdaysShort.5), 08:00–09:00',
    );
  });

  it('describes monthly rules', () => {
    expect(describeSchedule({ kind: 'monthly', every: 1, by: { dayOfMonth: 15 }, ...r0 }, fixed('09:00', 60), null, t)).toBe(
      'scheduling.summary.monthly(day=scheduling.summary.dayOfMonth(day=15)), 09:00–10:00',
    );
    expect(describeSchedule({ kind: 'monthly', every: 3, by: { nth: -1, weekday: 5 }, ...r0 }, fixed('09:00', 60), null, t)).toBe(
      'scheduling.summary.everyNMonths(n=3;day=scheduling.summary.nthWeekday(nth=scheduling.nth.last;weekday=scheduling.weekdays.5)), 09:00–10:00',
    );
  });

  it('describes one-off dates, overnight windows and shifts', () => {
    expect(describeSchedule({ kind: 'once', date: '2026-11-05' }, fixed('22:00', 240), null, t)).toBe(
      'scheduling.summary.once(date=2026-11-05), scheduling.summary.plusDays(range=22:00–02:00;days=1)',
    );
    expect(describeSchedule({ kind: 'dates', dates: ['2026-11-05', '2026-11-06'] }, { mode: 'shift', shiftId: 'x', graceMinutes: 0 }, 'Səhər', t)).toBe(
      'scheduling.summary.dates(count=2), scheduling.summary.shift(shift=Səhər)',
    );
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- scheduling-describe`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement**

`packages/contracts/src/scheduling-describe.ts`:

```ts
import type { Recurrence, Timing } from './scheduling.js';
import { minutesToTime, timeToMinutes } from './scheduling-time.js';

/** The caller's translate function, so contracts stays free of UI strings. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

const weekdayList = (days: number[], t: Translate): string =>
  [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) => t(`scheduling.weekdaysShort.${d}`))
    .join(', ');

function describeDays(r: Recurrence, t: Translate): string {
  switch (r.kind) {
    case 'once':
      return t('scheduling.summary.once', { date: r.date });
    case 'dates':
      return t('scheduling.summary.dates', { count: r.dates.length });
    case 'daily':
      return r.every === 1 ? t('scheduling.summary.daily') : t('scheduling.summary.everyNDays', { n: r.every });
    case 'weekly':
      return r.every === 1
        ? t('scheduling.summary.weekly', { days: weekdayList(r.weekdays, t) })
        : t('scheduling.summary.everyNWeeks', { n: r.every, days: weekdayList(r.weekdays, t) });
    case 'monthly': {
      const day =
        'dayOfMonth' in r.by
          ? t('scheduling.summary.dayOfMonth', { day: r.by.dayOfMonth })
          : t('scheduling.summary.nthWeekday', {
              nth: t(`scheduling.nth.${r.by.nth === -1 ? 'last' : r.by.nth}`),
              weekday: t(`scheduling.weekdays.${r.by.weekday}`),
            });
      return r.every === 1 ? t('scheduling.summary.monthly', { day }) : t('scheduling.summary.everyNMonths', { n: r.every, day });
    }
  }
}

function describeTime(timing: Timing, shiftName: string | null, t: Translate): string {
  if (timing.mode === 'shift') return t('scheduling.summary.shift', { shift: shiftName ?? '—' });
  const end = timeToMinutes(timing.startTime) + timing.dueAfterMinutes;
  const range = `${timing.startTime}–${minutesToTime(end)}`;
  const days = Math.floor(end / 1440);
  return days === 0 ? range : t('scheduling.summary.plusDays', { range, days });
}

/** A one-line human summary, e.g. "Hər həftə: B.e., Ç., 08:00–10:00". */
export function describeSchedule(r: Recurrence, timing: Timing, shiftName: string | null, t: Translate): string {
  return `${describeDays(r, t)}, ${describeTime(timing, shiftName, t)}`;
}
```

Add to `packages/contracts/src/index.ts`, after `scheduling.js`:

```ts
export * from './scheduling-describe.js';
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test -- scheduling-describe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/scheduling-describe.ts packages/contracts/src/scheduling-describe.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add describeSchedule summary"
```

---

### Task 4: Scheduling DTOs, error codes and permissions

**Files:**
- Create: `packages/contracts/src/shifts.ts`, `packages/contracts/src/occurrences.ts`, `packages/contracts/src/assignments.ts`
- Test: `packages/contracts/src/scheduling-resources.test.ts`
- Modify: `packages/contracts/src/errors.ts`, `packages/contracts/src/permissions.ts`, `packages/contracts/src/index.ts`, `apps/api/test/roles.test.ts:17`

**Interfaces:**
- Consumes: Tasks 1–2; `idSchema`, `isoDateTimeSchema`, `cursorQuerySchema` from `common.ts`.
- Produces (exact names, used by the API and Part 2):
  - `shifts.ts`:
    - `shiftDtoSchema`, `ShiftDto`, `createShiftInputSchema`, `CreateShiftInput`, `updateShiftInputSchema`, `UpdateShiftInput`, `shiftListQuerySchema`, `ShiftListQuery`
    - `rosterRowSchema`, `RosterRow`, `rosterQuerySchema`, `RosterQuery`, `rosterDtoSchema`, `RosterDto`, `putRosterInputSchema`, `PutRosterInput`
    - `copyRosterInputSchema`, `CopyRosterInput`, `rosterCopyResultSchema`, `RosterCopyResult`
  - `occurrences.ts`:
    - `OCCURRENCE_STATUSES`, `occurrenceStatusSchema`, `OccurrenceStatus`, `CANCEL_REASON_CODES`, `CancelReasonCode`, `userRefSchema`, `UserRef`
    - `occurrenceDtoSchema`, `OccurrenceDto`, `occurrenceHistoryEntrySchema`, `OccurrenceHistoryEntry`, `occurrenceDetailSchema`, `OccurrenceDetail`
    - `occurrenceListQuerySchema`, `OccurrenceListQuery`, `myOccurrenceQuerySchema`, `MyOccurrenceQuery`
    - `cancelOccurrenceInputSchema`, `CancelOccurrenceInput`
  - `assignments.ts`:
    - `ASSIGNMENT_STATUSES`, `assignmentStatusSchema`, `AssignmentStatus`, `assignmentDtoSchema`, `AssignmentDto`, `assignmentDetailSchema`, `AssignmentDetail`
    - `createAssignmentInputSchema`, `CreateAssignmentInput`, `updateAssignmentInputSchema`, `UpdateAssignmentInput`
    - `previewAssignmentInputSchema`, `PreviewAssignmentInput`, `previewSlotSchema`, `PreviewSlot`, `assignmentPreviewSchema`, `AssignmentPreview`
    - `assignmentListQuerySchema`, `AssignmentListQuery`
  - New `ErrorCode`s: `CHECKLIST_NOT_PUBLISHED`, `SITE_INACTIVE`, `SITE_OUT_OF_SCOPE`, `ASSIGNEE_INACTIVE`, `ASSIGNEE_NOT_AT_SITE`, `SHIFT_INACTIVE`, `SHIFT_NOT_AT_SITE`, `WINDOW_TOO_LONG`, `WINDOW_INVALID`, `SCHEDULE_INVALID`, `SCHEDULE_EMPTY`, `REVISION_CONFLICT`, `ASSIGNMENT_ENDED`, `OCCURRENCE_NOT_CANCELLABLE`, `ROSTER_USER_NOT_AT_SITE`
  - `errorBodySchema.error.userIds?: string[]`

> Range errors use `VALIDATION_FAILED` with `fields.to = 'scheduling.issues.rangeTooLong'` for the roster and the occurrence lists alike, so the spec's separate `ROSTER_RANGE_TOO_LONG` code is not needed. Update the spec's error list in Step 6.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/scheduling-resources.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  copyRosterInputSchema,
  createAssignmentInputSchema,
  createShiftInputSchema,
  ERROR_HTTP_STATUS,
  errorBodySchema,
  OCCURRENCE_STATUSES,
  occurrenceListQuerySchema,
  putRosterInputSchema,
  SYSTEM_ROLE_DEFAULTS,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const schedule = { kind: 'daily', every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] };
const timing = { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 60 };

describe('scheduling resources', () => {
  it('rejects a zero-length shift on endTime', () => {
    const r = createShiftInputSchema.safeParse({ name: 'Səhər', startTime: '08:00', endTime: '08:00' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['endTime'], message: 'scheduling.issues.shiftZeroLength' });
    expect(createShiftInputSchema.safeParse({ name: 'Gecə', startTime: '22:00', endTime: '06:00' }).success).toBe(true);
  });

  it('parses comma-separated statuses and limits the date range', () => {
    const ok = occurrenceListQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', status: 'pending,overdue' });
    expect(ok.status).toEqual(['pending', 'overdue']);
    expect(ok.limit).toBe(50);
    expect(occurrenceListQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-30', status: 'pending,bogus' }).success).toBe(false);
    const long = occurrenceListQuerySchema.safeParse({ from: '2026-11-01', to: '2027-01-02' });
    expect(long.success).toBe(false);
    expect(long.error!.issues[0]).toMatchObject({ path: ['to'], message: 'scheduling.issues.rangeTooLong' });
  });

  it('keeps roster rows inside the range and copies whole weeks', () => {
    const r = putRosterInputSchema.safeParse({ siteId: ID, from: '2026-11-02', to: '2026-11-08', rows: [{ userId: ID, shiftId: ID, date: '2026-11-09' }] });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['rows', 0, 'date'], message: 'scheduling.issues.dateOutOfRange' });
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-09'] }).success).toBe(true);
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-05'] }).success).toBe(false);
    expect(copyRosterInputSchema.safeParse({ siteId: ID, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-02'] }).success).toBe(false);
  });

  it('requires 1–50 assignees', () => {
    const base = { checklistId: ID, siteId: ID, schedule, timing };
    expect(createAssignmentInputSchema.safeParse({ ...base, assigneeIds: [] }).success).toBe(false);
    expect(createAssignmentInputSchema.safeParse({ ...base, assigneeIds: Array(51).fill(ID) }).success).toBe(false);
    expect(createAssignmentInputSchema.safeParse({ ...base, assigneeIds: [ID] }).success).toBe(true);
  });

  it('defines the full FR-11.01 status list', () => {
    expect(OCCURRENCE_STATUSES).toEqual(['pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited']);
  });

  it('registers error codes, the userIds detail and permissions', () => {
    expect(ERROR_HTTP_STATUS.SITE_OUT_OF_SCOPE).toBe(403);
    expect(ERROR_HTTP_STATUS.REVISION_CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.ASSIGNEE_NOT_AT_SITE).toBe(422);
    const body = { error: { code: 'ASSIGNEE_NOT_AT_SITE', messageKey: 'errors.ASSIGNEE_NOT_AT_SITE', fields: null, retryAfterSeconds: null, requestId: null, userIds: [ID] } };
    expect(errorBodySchema.parse(body).error.userIds).toEqual([ID]);
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['assignments.view', 'assignments.manage', 'assignments.extended_window', 'shifts.view', 'shifts.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toEqual(expect.arrayContaining(['assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage']));
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('assignments.extended_window');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toEqual(expect.arrayContaining(['assignments.view', 'shifts.view']));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts test -- scheduling-resources`
Expected: FAIL, because the imports are undefined.

- [ ] **Step 3: Implement the DTO modules**

`packages/contracts/src/shifts.ts`:

```ts
import { z } from 'zod';
import { idSchema } from './common.js';
import { dayNumber, localDateSchema, localTimeSchema } from './scheduling-time.js';
import { localRangeCheck, SCHEDULING_LIMITS } from './scheduling.js';

export const shiftDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  /** null = usable at every site. */
  siteId: idSchema.nullable(),
  siteName: z.string().nullable(),
  active: z.boolean(),
});
export type ShiftDto = z.infer<typeof shiftDtoSchema>;

const shiftName = z.string().trim().min(1).max(100);

export const createShiftInputSchema = z
  .object({ name: shiftName, startTime: localTimeSchema, endTime: localTimeSchema, siteId: idSchema.nullable().optional() })
  .superRefine((v, ctx) => {
    if (v.startTime === v.endTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'scheduling.issues.shiftZeroLength' });
  });
export type CreateShiftInput = z.input<typeof createShiftInputSchema>;

/** The zero-length check needs the stored values, so the API does it on the merged result. */
export const updateShiftInputSchema = z.object({
  name: shiftName.optional(),
  startTime: localTimeSchema.optional(),
  endTime: localTimeSchema.optional(),
  siteId: idSchema.nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateShiftInput = z.input<typeof updateShiftInputSchema>;

export const shiftListQuerySchema = z.object({ active: z.stringbool().optional(), siteId: idSchema.optional() });
export type ShiftListQuery = z.input<typeof shiftListQuerySchema>;

export const rosterRowSchema = z.object({ userId: idSchema, shiftId: idSchema, date: localDateSchema });
export type RosterRow = z.infer<typeof rosterRowSchema>;

export const rosterQuerySchema = z
  .object({ siteId: idSchema, from: localDateSchema, to: localDateSchema })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.rosterMaxDays));
export type RosterQuery = z.input<typeof rosterQuerySchema>;

export const rosterDtoSchema = z.object({
  siteId: idSchema,
  from: localDateSchema,
  to: localDateSchema,
  /** Active users linked to the site (filtered by the caller's data scope). */
  users: z.array(z.object({ id: idSchema, fullName: z.string() })),
  /** Shifts usable at the site, including inactive ones that old rows may still reference. */
  shifts: z.array(shiftDtoSchema),
  rows: z.array(rosterRowSchema),
});
export type RosterDto = z.infer<typeof rosterDtoSchema>;

export const putRosterInputSchema = z
  .object({ siteId: idSchema, from: localDateSchema, to: localDateSchema, rows: z.array(rosterRowSchema).max(5000) })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.rosterMaxDays))
  .superRefine((v, ctx) => {
    v.rows.forEach((r, i) => {
      if (r.date < v.from || r.date > v.to) ctx.addIssue({ code: 'custom', path: ['rows', i, 'date'], message: 'scheduling.issues.dateOutOfRange' });
    });
  });
export type PutRosterInput = z.input<typeof putRosterInputSchema>;

export const copyRosterInputSchema = z
  .object({
    siteId: idSchema,
    sourceWeekStart: localDateSchema,
    targetWeekStarts: z.array(localDateSchema).min(1).max(SCHEDULING_LIMITS.copyMaxWeeks),
  })
  .superRefine((v, ctx) => {
    v.targetWeekStarts.forEach((d, i) => {
      const offset = dayNumber(d) - dayNumber(v.sourceWeekStart);
      if (offset === 0 || offset % 7 !== 0) ctx.addIssue({ code: 'custom', path: ['targetWeekStarts', i], message: 'errors.validation.invalid' });
    });
  });
export type CopyRosterInput = z.input<typeof copyRosterInputSchema>;

export const rosterCopyResultSchema = z.object({ rowCount: z.number().int() });
export type RosterCopyResult = z.infer<typeof rosterCopyResultSchema>;
```

`packages/contracts/src/occurrences.ts`:

```ts
import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { localDateSchema } from './scheduling-time.js';
import { localRangeCheck, SCHEDULING_LIMITS } from './scheduling.js';

/** FR-11.01. Sub-project 3 writes pending, overdue, missed and cancelled; the rest belong to sub-project 4. */
export const OCCURRENCE_STATUSES = ['pending', 'started', 'in_progress', 'completed', 'partial', 'overdue', 'missed', 'cancelled', 'audit_pending', 'audited'] as const;
export const occurrenceStatusSchema = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatus = z.infer<typeof occurrenceStatusSchema>;

/** Reasons the system records when it cancels occurrences; a manager's own reason is free text. */
export const CANCEL_REASON_CODES = ['assignment_edited', 'assignment_paused', 'assignment_ended', 'checklist_deactivated', 'shift_changed'] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export const userRefSchema = z.object({ id: idSchema, fullName: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

export const occurrenceDtoSchema = z.object({
  id: idSchema,
  assignmentId: idSchema,
  assignmentName: z.string().nullable(),
  checklistId: idSchema,
  checklistName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  shiftId: idSchema.nullable(),
  shiftName: z.string().nullable(),
  localDate: localDateSchema,
  startsAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
  closesAt: isoDateTimeSchema,
  status: occurrenceStatusSchema,
  statusChangedAt: isoDateTimeSchema,
  cancelReason: z.string().nullable(),
  assigneeIds: z.array(idSchema),
  /** Pending or overdue with nobody eligible (spec §5.3). */
  unassigned: z.boolean(),
});
export type OccurrenceDto = z.infer<typeof occurrenceDtoSchema>;

export const occurrenceHistoryEntrySchema = z.object({
  fromStatus: occurrenceStatusSchema.nullable(),
  toStatus: occurrenceStatusSchema,
  at: isoDateTimeSchema,
  actor: z.object({ kind: z.enum(['user', 'platform', 'system']), name: z.string().nullable() }),
  reason: z.string().nullable(),
});
export type OccurrenceHistoryEntry = z.infer<typeof occurrenceHistoryEntrySchema>;

export const occurrenceDetailSchema = occurrenceDtoSchema.extend({
  assignees: z.array(userRefSchema),
  history: z.array(occurrenceHistoryEntrySchema),
});
export type OccurrenceDetail = z.infer<typeof occurrenceDetailSchema>;

/** `status=pending,overdue` in the query string. */
const statusList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(occurrenceStatusSchema).min(1));

export const occurrenceListQuerySchema = cursorQuerySchema
  .extend({
    from: localDateSchema,
    to: localDateSchema,
    siteId: idSchema.optional(),
    status: statusList.optional(),
    assigneeId: idSchema.optional(),
    checklistId: idSchema.optional(),
    assignmentId: idSchema.optional(),
  })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.maxListDays));
export type OccurrenceListQuery = z.input<typeof occurrenceListQuerySchema>;

export const myOccurrenceQuerySchema = cursorQuerySchema
  .extend({ from: localDateSchema, to: localDateSchema, status: statusList.optional() })
  .superRefine(localRangeCheck(SCHEDULING_LIMITS.maxListDays));
export type MyOccurrenceQuery = z.input<typeof myOccurrenceQuerySchema>;

export const cancelOccurrenceInputSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type CancelOccurrenceInput = z.input<typeof cancelOccurrenceInputSchema>;
```

`packages/contracts/src/assignments.ts`:

```ts
import { z } from 'zod';
import { cursorQuerySchema, idSchema, isoDateTimeSchema } from './common.js';
import { occurrenceDtoSchema, userRefSchema } from './occurrences.js';
import { localDateSchema } from './scheduling-time.js';
import { PREVIEW_WARNINGS, recurrenceSchema, SCHEDULING_LIMITS, timingSchema } from './scheduling.js';

export const ASSIGNMENT_STATUSES = ['active', 'paused', 'ended'] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const assignmentDtoSchema = z.object({
  id: idSchema,
  name: z.string().nullable(),
  checklistId: idSchema,
  checklistName: z.string(),
  siteId: idSchema,
  siteName: z.string(),
  schedule: recurrenceSchema,
  timing: timingSchema,
  shiftName: z.string().nullable(),
  status: assignmentStatusSchema,
  revision: z.number().int(),
  assignees: z.array(userRefSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AssignmentDto = z.infer<typeof assignmentDtoSchema>;

export const assignmentDetailSchema = assignmentDtoSchema.extend({
  /** The next 5 pending or overdue occurrences that have not closed yet. */
  upcoming: z.array(occurrenceDtoSchema),
});
export type AssignmentDetail = z.infer<typeof assignmentDetailSchema>;

const assignmentName = z.string().trim().max(200).nullable();
const assigneeIds = z.array(idSchema).min(1).max(SCHEDULING_LIMITS.maxAssignees);

export const createAssignmentInputSchema = z.object({
  name: assignmentName.optional(),
  checklistId: idSchema,
  siteId: idSchema,
  assigneeIds,
  schedule: recurrenceSchema,
  timing: timingSchema,
});
export type CreateAssignmentInput = z.input<typeof createAssignmentInputSchema>;

/** Checklist and site are fixed after creation; "Copy to other sites" makes a new assignment. */
export const updateAssignmentInputSchema = z.object({
  revision: z.number().int().min(1),
  name: assignmentName.optional(),
  assigneeIds: assigneeIds.optional(),
  schedule: recurrenceSchema.optional(),
  timing: timingSchema.optional(),
});
export type UpdateAssignmentInput = z.input<typeof updateAssignmentInputSchema>;

export const previewAssignmentInputSchema = z.object({
  siteId: idSchema,
  schedule: recurrenceSchema,
  timing: timingSchema,
  assigneeIds: z.array(idSchema).max(SCHEDULING_LIMITS.maxAssignees).optional(),
});
export type PreviewAssignmentInput = z.input<typeof previewAssignmentInputSchema>;

export const previewSlotSchema = z.object({ localDate: localDateSchema, startsAt: isoDateTimeSchema, dueAt: isoDateTimeSchema, closesAt: isoDateTimeSchema });
export type PreviewSlot = z.infer<typeof previewSlotSchema>;

export const assignmentPreviewSchema = z.object({ slots: z.array(previewSlotSchema), warnings: z.array(z.enum(PREVIEW_WARNINGS)) });
export type AssignmentPreview = z.infer<typeof assignmentPreviewSchema>;

export const assignmentListQuerySchema = cursorQuerySchema.extend({
  siteId: idSchema.optional(),
  checklistId: idSchema.optional(),
  status: assignmentStatusSchema.optional(),
  assigneeId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type AssignmentListQuery = z.input<typeof assignmentListQuerySchema>;
```

Add to `packages/contracts/src/index.ts`, after `scheduling-describe.js`:

```ts
export * from './shifts.js';
export * from './occurrences.js';
export * from './assignments.js';
```

- [ ] **Step 4: Add error codes and permissions**

In `packages/contracts/src/errors.ts`, add these entries to `ErrorCode` just before `INTERNAL`:

```ts
  CHECKLIST_NOT_PUBLISHED: 'CHECKLIST_NOT_PUBLISHED',
  SITE_INACTIVE: 'SITE_INACTIVE',
  SITE_OUT_OF_SCOPE: 'SITE_OUT_OF_SCOPE',
  ASSIGNEE_INACTIVE: 'ASSIGNEE_INACTIVE',
  ASSIGNEE_NOT_AT_SITE: 'ASSIGNEE_NOT_AT_SITE',
  SHIFT_INACTIVE: 'SHIFT_INACTIVE',
  SHIFT_NOT_AT_SITE: 'SHIFT_NOT_AT_SITE',
  WINDOW_TOO_LONG: 'WINDOW_TOO_LONG',
  WINDOW_INVALID: 'WINDOW_INVALID',
  SCHEDULE_INVALID: 'SCHEDULE_INVALID',
  SCHEDULE_EMPTY: 'SCHEDULE_EMPTY',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  ASSIGNMENT_ENDED: 'ASSIGNMENT_ENDED',
  OCCURRENCE_NOT_CANCELLABLE: 'OCCURRENCE_NOT_CANCELLABLE',
  ROSTER_USER_NOT_AT_SITE: 'ROSTER_USER_NOT_AT_SITE',
```

and add these to `ERROR_HTTP_STATUS` just before `INTERNAL: 500`:

```ts
  CHECKLIST_NOT_PUBLISHED: 409,
  SITE_INACTIVE: 409,
  SITE_OUT_OF_SCOPE: 403,
  ASSIGNEE_INACTIVE: 422,
  ASSIGNEE_NOT_AT_SITE: 422,
  SHIFT_INACTIVE: 409,
  SHIFT_NOT_AT_SITE: 422,
  WINDOW_TOO_LONG: 422,
  WINDOW_INVALID: 422,
  SCHEDULE_INVALID: 422,
  SCHEDULE_EMPTY: 422,
  REVISION_CONFLICT: 409,
  ASSIGNMENT_ENDED: 409,
  OCCURRENCE_NOT_CANCELLABLE: 409,
  ROSTER_USER_NOT_AT_SITE: 422,
```

In `errorBodySchema`, after `currentRevision`, add:

```ts
    userIds: z.array(z.string()).optional(),
```

In `packages/contracts/src/permissions.ts`, append two groups to `PERMISSION_GROUPS` (after `templates`):

```ts
  { group: 'assignments', keys: ['assignments.view', 'assignments.manage', 'assignments.extended_window'] },
  { group: 'shifts', keys: ['shifts.view', 'shifts.manage'] },
```

and update the manager and auditor defaults:

```ts
  manager: {
    name: 'Manager',
    dataScope: 'site_subtree',
    permissions: ['sites.view', 'teams.view', 'users.view', 'checklists.view', 'checklists.manage', 'assignments.view', 'assignments.manage', 'shifts.view', 'shifts.manage'],
    editable: true,
  },
  worker: { name: 'Worker', dataScope: 'own', permissions: [], editable: true },
  auditor: {
    name: 'Auditor',
    dataScope: 'all',
    permissions: ['sites.view', 'users.view', 'audit.view', 'checklists.view', 'assignments.view', 'shifts.view'],
    editable: true,
  },
```

In `apps/api/test/roles.test.ts` line 17, update the expected manager permissions (sorted):

```ts
    expect(roles.find((r) => r.systemKey === 'manager')!.permissions.sort()).toEqual([
      'assignments.manage', 'assignments.view', 'checklists.manage', 'checklists.view', 'shifts.manage', 'shifts.view', 'sites.view', 'teams.view', 'users.view',
    ]);
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/contracts test && pnpm --filter @taskop/contracts typecheck && pnpm --filter @taskop/contracts build`
Expected: PASS. The existing `resources.test.ts` and `errors.test.ts` still pass.

- [ ] **Step 6: Record the error-list change in the spec and commit**

In `docs/superpowers/specs/2026-10-09-scheduling-assignment-design.md` §7.1, replace the `Roster:` bullet group with:

```markdown
- Roster:
  - `ROSTER_USER_NOT_AT_SITE`
  - A range longer than 62 days is a `VALIDATION_FAILED` with `fields.to = scheduling.issues.rangeTooLong`, the same as for the occurrence lists.
```

```bash
git add packages/contracts/src apps/api/test/roles.test.ts docs/superpowers/specs/2026-10-09-scheduling-assignment-design.md
git commit -m "feat(contracts): add shift, roster, assignment and occurrence DTOs, errors and permissions"
```

---

### Task 5: Azerbaijani strings for scheduling errors, permissions, issues, statuses and summaries

**Files:**
- Create: `packages/i18n/src/az/scheduling.ts`
- Modify: `packages/i18n/src/az/errors.ts`, `packages/i18n/src/az/roles.ts`, `packages/i18n/src/az/index.ts`, `packages/i18n/src/i18n.test.ts`

**Interfaces:**
- Consumes: `SCHEDULING_ISSUE_CODES`, `OCCURRENCE_STATUSES`, `CANCEL_REASON_CODES`, `PREVIEW_WARNINGS`, `describeSchedule` and the new error codes and permission keys (Tasks 2–4).
- Produces: the `az.scheduling` namespace with `issues`, `summary`, `weekdays`, `weekdaysShort`, `nth`, `statuses`, `cancelReasons` and `warnings`. Part 2 adds UI keys to the same file.

- [ ] **Step 1: Write the failing test**

Append to `packages/i18n/src/i18n.test.ts`. Extend the `@taskop/contracts` import with `CANCEL_REASON_CODES`, `describeSchedule`, `OCCURRENCE_STATUSES`, `PREVIEW_WARNINGS` and `SCHEDULING_ISSUE_CODES`:

```ts
describe('scheduling translations', () => {
  const lookup = (key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], az);
  const t = (key: string, vars: Record<string, string | number> = {}) =>
    String(lookup(key)).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name]));

  it('translates issue codes, statuses, cancel reasons and warnings', () => {
    for (const code of SCHEDULING_ISSUE_CODES) expect(lookup(code), code).toBeTypeOf('string');
    for (const s of OCCURRENCE_STATUSES) expect(az.scheduling.statuses[s], s).toBeTypeOf('string');
    for (const r of CANCEL_REASON_CODES) expect(az.scheduling.cancelReasons[r], r).toBeTypeOf('string');
    for (const w of PREVIEW_WARNINGS) expect(az.scheduling.warnings[w], w).toBeTypeOf('string');
  });

  it('renders schedule summaries in Azerbaijani', () => {
    const r0 = { startDate: '2026-11-02', endDate: null, skipDates: [] };
    const fixed = { mode: 'fixed' as const, startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 0 };
    expect(describeSchedule({ kind: 'weekly', every: 1, weekdays: [1, 3], ...r0 }, fixed, null, t)).toBe('Hər həftə: B.e., Ç., 08:00–10:00');
    expect(describeSchedule({ kind: 'monthly', every: 1, by: { nth: -1, weekday: 5 }, ...r0 }, fixed, null, t)).toBe('Hər ay, sonuncu Cümə, 08:00–10:00');
    expect(describeSchedule({ kind: 'daily', every: 1, ...r0 }, { mode: 'shift', shiftId: 'x', graceMinutes: 0 }, 'Səhər', t)).toBe('Hər gün, Səhər növbəsi');
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/contracts build && pnpm --filter @taskop/i18n test`
Expected: FAIL: `az.scheduling` is undefined, and the error-code test fails for the 15 new codes.

- [ ] **Step 3: Implement**

`packages/i18n/src/az/scheduling.ts`:

```ts
export default {
  issues: {
    endBeforeStart: 'Bitmə tarixi başlama tarixindən əvvəl ola bilməz.',
    duplicateDate: 'Bu tarix artıq əlavə olunub.',
    duplicateWeekday: 'Həftə günü təkrarlanır.',
    shiftZeroLength: 'Növbənin başlama və bitmə vaxtı eyni ola bilməz.',
    rangeTooLong: 'Tarix aralığı çox uzundur (ən çox 62 gün).',
    dateOutOfRange: 'Tarix seçilmiş aralıqdan kənardadır.',
  },
  summary: {
    once: '{{date}} tarixində',
    dates: '{{count}} seçilmiş tarixdə',
    daily: 'Hər gün',
    everyNDays: 'Hər {{n}} gündən bir',
    weekly: 'Hər həftə: {{days}}',
    everyNWeeks: 'Hər {{n}} həftədən bir: {{days}}',
    monthly: 'Hər ay, {{day}}',
    everyNMonths: 'Hər {{n}} aydan bir, {{day}}',
    dayOfMonth: '{{day}}. gün',
    nthWeekday: '{{nth}} {{weekday}}',
    shift: '{{shift}} növbəsi',
    plusDays: '{{range}} (+{{days}} gün)',
  },
  weekdays: { 1: 'Bazar ertəsi', 2: 'Çərşənbə axşamı', 3: 'Çərşənbə', 4: 'Cümə axşamı', 5: 'Cümə', 6: 'Şənbə', 7: 'Bazar' },
  weekdaysShort: { 1: 'B.e.', 2: 'Ç.a.', 3: 'Ç.', 4: 'C.a.', 5: 'C.', 6: 'Ş.', 7: 'B.' },
  nth: { 1: 'birinci', 2: 'ikinci', 3: 'üçüncü', 4: 'dördüncü', last: 'sonuncu' },
  statuses: {
    pending: 'Gözləyir',
    started: 'Başlanıb',
    in_progress: 'Davam edir',
    completed: 'Tamamlanıb',
    partial: 'Yarımçıq',
    overdue: 'Gecikib',
    missed: 'Buraxılıb',
    cancelled: 'Ləğv edilib',
    audit_pending: 'Audit gözləyir',
    audited: 'Audit olunub',
  },
  cancelReasons: {
    assignment_edited: 'Təyinat dəyişdirildi',
    assignment_paused: 'Təyinat dayandırıldı',
    assignment_ended: 'Təyinat bitirildi',
    checklist_deactivated: 'Yoxlama vərəqəsi deaktiv edildi',
    shift_changed: 'Növbənin saatları dəyişdirildi',
  },
  warnings: {
    NO_ROSTERED_ASSIGNEES: 'Növbəti 14 gündə seçilmiş icraçılardan heç biri bu növbəyə yazılmayıb.',
    SKIP_DATE_OUT_OF_RANGE: 'Bəzi istisna tarixləri cədvəlin aralığından kənardadır.',
  },
} as const;
```

In `packages/i18n/src/az/errors.ts`, add before `INTERNAL`:

```ts
  CHECKLIST_NOT_PUBLISHED: 'Yoxlama vərəqəsinin dərc edilmiş versiyası yoxdur.',
  SITE_INACTIVE: 'Obyekt aktiv deyil.',
  SITE_OUT_OF_SCOPE: 'Bu obyekt üzrə dəyişiklik etmək icazəniz yoxdur.',
  ASSIGNEE_INACTIVE: 'Seçilmiş icraçılardan biri aktiv deyil.',
  ASSIGNEE_NOT_AT_SITE: 'Seçilmiş icraçılardan biri bu obyektə aid deyil.',
  SHIFT_INACTIVE: 'Növbə aktiv deyil.',
  SHIFT_NOT_AT_SITE: 'Bu növbə seçilmiş obyektdə istifadə oluna bilməz.',
  WINDOW_TOO_LONG: 'İcra müddəti 24 saatdan uzundur. Bunun üçün xüsusi icazə lazımdır.',
  WINDOW_INVALID: 'İcra müddəti 7 gündən uzun ola bilməz.',
  SCHEDULE_INVALID: 'Cədvəldə düzəldilməli xətalar var.',
  SCHEDULE_EMPTY: 'Bu cədvəl üzrə növbəti il ərzində heç bir icra yoxdur.',
  REVISION_CONFLICT: 'Məlumat başqa yerdə dəyişdirilib. Səhifəni yeniləyin.',
  ASSIGNMENT_ENDED: 'Bitmiş təyinat dəyişdirilə bilməz.',
  OCCURRENCE_NOT_CANCELLABLE: 'Bu icra artıq ləğv edilə bilməz.',
  ROSTER_USER_NOT_AT_SITE: 'Növbə cədvəlindəki əməkdaşlardan biri bu obyektə aid deyil.',
```

In `packages/i18n/src/az/roles.ts`, add to `groups`:

```ts
    assignments: 'Təyinatlar',
    shifts: 'Növbələr',
```

and to `keys`:

```ts
    assignments_view: 'Təyinatlara və icralara baxmaq',
    assignments_manage: 'Təyinatları idarə etmək',
    assignments_extended_window: '24 saatdan uzun icra müddəti təyin etmək',
    shifts_view: 'Növbələrə baxmaq',
    shifts_manage: 'Növbələri və növbə cədvəlini idarə etmək',
```

In `packages/i18n/src/az/index.ts`, import `scheduling from './scheduling.js'` and add `scheduling` to the `az` object (keep the keys alphabetical after `roles`).

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/i18n test && pnpm --filter @taskop/i18n build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src
git commit -m "feat(i18n): add Azerbaijani strings for scheduling errors, permissions, statuses and summaries"
```

---
### Task 6: Tables, migrations and the pg-boss schema

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0005_scheduling.sql` (generated), `apps/api/drizzle/0006_scheduling_security.sql` (custom)
- Test: `apps/api/test/scheduling-db.test.ts`

**Interfaces:**
- Produces Drizzle tables and enums (used by every later API task):
  - Enums: `assignmentStatus`, `occurrenceStatus`
  - Tables: `shifts`, `shiftRoster`, `assignments`, `assignmentAssignees`, `occurrences`, `occurrenceAssignees`, `occurrenceStatusHistory`
- Column types: `time` columns read back as `'HH:MM:SS'` strings. `date` columns use `mode: 'string'` (`'YYYY-MM-DD'`). `timestamptz` columns are `Date`.
- Partial unique index `occurrences_live_day_uq` on `(assignment_id, local_date) where status <> 'cancelled'`. Task 10 targets it with `ON CONFLICT DO NOTHING`.
- Schema `pgboss`, owned by `taskop_app`, so pg-boss can install and upgrade its own tables (Task 12).

- [ ] **Step 1: Write the failing test**

`apps/api/test/scheduling-db.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

const TABLES = ['shifts', 'shift_roster', 'assignments', 'assignment_assignees', 'occurrences', 'occurrence_assignees', 'occurrence_status_history'];
const NEW_ADMIN_KEYS = ['assignments.view', 'assignments.manage', 'assignments.extended_window', 'shifts.view', 'shifts.manage'];

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

/** A raw assignment with one occurrence, inserted as the owner (no API yet). */
async function seedOccurrence(tenantId: string, ownerId: string) {
  const typeId = await siteTypeIdOf(tenantId);
  const site = await ownerQuery<{ id: string }>(
    "insert into sites (id, tenant_id, type_id, name, path) values (gen_random_uuid(), $1, $2, 'S', 'x') returning id",
    [tenantId, typeId],
  );
  const checklist = await ownerQuery<{ id: string }>(
    "insert into checklists (id, tenant_id, name, created_by_user_id) values (gen_random_uuid(), $1, 'C', $2) returning id",
    [tenantId, ownerId],
  );
  const assignment = await ownerQuery<{ id: string }>(
    `insert into assignments (id, tenant_id, checklist_id, site_id, schedule, timing, created_by_user_id)
     values (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, '{}'::jsonb, $4) returning id`,
    [tenantId, checklist.rows[0]!.id, site.rows[0]!.id, ownerId],
  );
  const occ = (status: string) =>
    ownerQuery<{ id: string }>(
      `insert into occurrences (id, tenant_id, assignment_id, checklist_id, site_id, local_date, starts_at, due_at, closes_at, status)
       values (gen_random_uuid(), $1, $2, $3, $4, '2026-11-02', '2026-11-02T04:00Z', '2026-11-02T06:00Z', '2026-11-02T07:00Z', $5) returning id`,
      [tenantId, assignment.rows[0]!.id, checklist.rows[0]!.id, site.rows[0]!.id, status],
    );
  return { assignmentId: assignment.rows[0]!.id, occ };
}

describe('scheduling tables', () => {
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

  it('hides another tenant’s occurrences from the app account', async () => {
    const a = await signupTenant(t);
    const b = await signupTenant(t);
    const { occ } = await seedOccurrence(a.tenantId, a.ownerId);
    await occ('pending');
    expect((await asApp(b.tenantId, (c) => c.query('select id from occurrences'))).rowCount).toBe(0);
    expect((await asApp(a.tenantId, (c) => c.query('select id from occurrences'))).rowCount).toBe(1);
  });

  it('allows one live occurrence per assignment and day, ignoring cancelled ones', async () => {
    const s = await signupTenant(t);
    const { occ } = await seedOccurrence(s.tenantId, s.ownerId);
    await occ('cancelled');
    await occ('pending');
    await expect(occ('pending')).rejects.toThrow(/occurrences_live_day_uq/);
  });

  it('keeps the status history append-only for the app account', async () => {
    const s = await signupTenant(t);
    const { occ } = await seedOccurrence(s.tenantId, s.ownerId);
    const id = (await occ('pending')).rows[0]!.id;
    await asApp(s.tenantId, async (c) => {
      await c.query("insert into occurrence_status_history (id, tenant_id, occurrence_id, to_status, at) values (gen_random_uuid(), $1, $2, 'pending', now())", [s.tenantId, id]);
      await c.query('savepoint sp');
      await expect(c.query("update occurrence_status_history set reason = 'x'")).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint sp');
      await expect(c.query('delete from occurrence_status_history')).rejects.toThrow(/permission denied/);
    });
  });

  it('gives the app account its own pgboss schema', async () => {
    const r = await ownerQuery<{ owner: string }>("select nspowner::regrole::text as owner from pg_namespace where nspname = 'pgboss'");
    expect(r.rows[0]?.owner).toBe('taskop_app');
  });

  it('backfills the new keys for existing Admin roles', async () => {
    const s = await signupTenant(t);
    const adminRole = (await ownerQuery<{ id: string }>("select id from roles where tenant_id = $1 and system_key = 'admin'", [s.tenantId])).rows[0]!.id;
    await ownerQuery('delete from role_permissions where role_id = $1 and permission_key = any($2)', [adminRole, NEW_ADMIN_KEYS]);
    const file = readFileSync(path.resolve(__dirname, '../drizzle/0006_scheduling_security.sql'), 'utf8');
    const stmts = file.split('--> statement-breakpoint').map((x) => x.trim());
    const start = stmts.findIndex((x) => /row_security\s*=\s*off/i.test(x));
    const client = new pg.Client({ connectionString: inject('db').ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      for (const stmt of stmts.slice(start)) await client.query(stmt);
      await client.query('commit');
    } finally {
      await client.end();
    }
    const keys = await ownerQuery<{ permission_key: string }>('select permission_key from role_permissions where role_id = $1', [adminRole]);
    expect(keys.rows.map((r) => r.permission_key)).toEqual(expect.arrayContaining(NEW_ADMIN_KEYS));
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- scheduling-db`
Expected: FAIL: relation `assignments` does not exist.

- [ ] **Step 3: Add the tables to the Drizzle schema**

In `apps/api/src/db/schema.ts`, add `date` and `time` to the `drizzle-orm/pg-core` import. Then append:

```ts
export const assignmentStatus = pgEnum('assignment_status', ['active', 'paused', 'ended']);
// Must match OCCURRENCE_STATUSES in @taskop/contracts (FR-11.01).
export const occurrenceStatus = pgEnum('occurrence_status', [
  'pending',
  'started',
  'in_progress',
  'completed',
  'partial',
  'overdue',
  'missed',
  'cancelled',
  'audit_pending',
  'audited',
]);

const localDate = (name: string) => date(name, { mode: 'string' });

export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    // null = usable at every site.
    siteId: uuid('site_id'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('shifts_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'shifts_site_fk' }),
    check('shifts_nonzero_ck', sql`${t.startTime} <> ${t.endTime}`),
    index('shifts_tenant_idx').on(t.tenantId),
  ],
);

export const shiftRoster = pgTable(
  'shift_roster',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    siteId: uuid('site_id').notNull(),
    // Local date the shift starts.
    date: localDate('date').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.shiftId, t.siteId, t.date] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'shift_roster_user_fk' }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [shifts.tenantId, shifts.id], name: 'shift_roster_shift_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'shift_roster_site_fk' }),
    index('shift_roster_site_date_idx').on(t.tenantId, t.siteId, t.date),
  ],
);

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    tenantId: tenantId(),
    checklistId: uuid('checklist_id').notNull(),
    siteId: uuid('site_id').notNull(),
    name: text('name'),
    schedule: jsonb('schedule').notNull(),
    timing: jsonb('timing').notNull(),
    // Copied from timing.shiftId for FKs and queries.
    shiftId: uuid('shift_id'),
    status: assignmentStatus('status').notNull().default('active'),
    revision: integer('revision').notNull().default(1),
    // Every slot starting at or before this instant has been considered (spec §5.1).
    materializedUntil: ts('materialized_until'),
    createdByUserId: createdByUser(),
    createdByPlatformAdminId: createdByPlatform(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('assignments_tenant_id_uq').on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'assignments_checklist_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'assignments_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [shifts.tenantId, shifts.id], name: 'assignments_shift_fk' }),
    foreignKey({ columns: [t.tenantId, t.createdByUserId], foreignColumns: [users.tenantId, users.id], name: 'assignments_created_by_fk' }),
    oneCreator('assignments_creator_ck', t),
    index('assignments_site_idx').on(t.tenantId, t.siteId),
    index('assignments_checklist_idx').on(t.tenantId, t.checklistId),
  ],
);

export const assignmentAssignees = pgTable(
  'assignment_assignees',
  {
    tenantId: tenantId(),
    assignmentId: uuid('assignment_id').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.assignmentId], foreignColumns: [assignments.tenantId, assignments.id], name: 'assignment_assignees_assignment_fk' }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'assignment_assignees_user_fk' }),
    index('assignment_assignees_user_idx').on(t.tenantId, t.userId),
  ],
);

export const occurrences = pgTable(
  'occurrences',
  {
    id: id(),
    tenantId: tenantId(),
    assignmentId: uuid('assignment_id').notNull(),
    checklistId: uuid('checklist_id').notNull(),
    siteId: uuid('site_id').notNull(),
    shiftId: uuid('shift_id'),
    localDate: localDate('local_date').notNull(),
    startsAt: ts('starts_at').notNull(),
    dueAt: ts('due_at').notNull(),
    closesAt: ts('closes_at').notNull(),
    status: occurrenceStatus('status').notNull().default('pending'),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('occurrences_tenant_id_uq').on(t.tenantId, t.id),
    // One live occurrence per assignment and day; cancelled ones never block a regenerated slot.
    uniqueIndex('occurrences_live_day_uq').on(t.assignmentId, t.localDate).where(sql`status <> 'cancelled'`),
    foreignKey({ columns: [t.tenantId, t.assignmentId], foreignColumns: [assignments.tenantId, assignments.id], name: 'occurrences_assignment_fk' }),
    foreignKey({ columns: [t.tenantId, t.checklistId], foreignColumns: [checklists.tenantId, checklists.id], name: 'occurrences_checklist_fk' }),
    foreignKey({ columns: [t.tenantId, t.siteId], foreignColumns: [sites.tenantId, sites.id], name: 'occurrences_site_fk' }),
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [shifts.tenantId, shifts.id], name: 'occurrences_shift_fk' }),
    check('occurrences_window_ck', sql`${t.startsAt} <= ${t.dueAt} and ${t.dueAt} <= ${t.closesAt}`),
    index('occurrences_site_start_idx').on(t.tenantId, t.siteId, t.startsAt),
    index('occurrences_status_due_idx').on(t.tenantId, t.status, t.dueAt),
    index('occurrences_status_close_idx').on(t.tenantId, t.status, t.closesAt),
    index('occurrences_assignment_start_idx').on(t.tenantId, t.assignmentId, t.startsAt),
  ],
);

export const occurrenceAssignees = pgTable(
  'occurrence_assignees',
  {
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.occurrenceId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'occurrence_assignees_occurrence_fk' }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id], name: 'occurrence_assignees_user_fk' }),
    index('occurrence_assignees_user_idx').on(t.tenantId, t.userId),
  ],
);

/** Append-only (FR-11.02): the app account may only INSERT and SELECT. */
export const occurrenceStatusHistory = pgTable(
  'occurrence_status_history',
  {
    id: id(),
    tenantId: tenantId(),
    occurrenceId: uuid('occurrence_id').notNull(),
    fromStatus: occurrenceStatus('from_status'),
    toStatus: occurrenceStatus('to_status').notNull(),
    at: ts('at').notNull(),
    // Both null = the system (jobs).
    actorUserId: uuid('actor_user_id'),
    actorPlatformAdminId: uuid('actor_platform_admin_id'),
    reason: text('reason'),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.occurrenceId], foreignColumns: [occurrences.tenantId, occurrences.id], name: 'occurrence_status_history_occurrence_fk' }),
    index('occurrence_status_history_occurrence_idx').on(t.tenantId, t.occurrenceId, t.at),
  ],
);
```

- [ ] **Step 4: Generate the migrations**

```bash
pnpm --filter @taskop/api exec drizzle-kit generate --name scheduling
pnpm --filter @taskop/api exec drizzle-kit generate --custom --name scheduling_security
```

Check the output:
- `apps/api/drizzle/0005_scheduling.sql` contains the 2 `CREATE TYPE`s, the 7 `CREATE TABLE`s, the FKs and checks, and the indexes.
- The partial index ends in `WHERE status <> 'cancelled'`.
- `0006_scheduling_security.sql` is created empty.

Write `apps/api/drizzle/0006_scheduling_security.sql`:

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts','shift_roster','assignments','assignment_assignees','occurrences','occurrence_assignees','occurrence_status_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Shifts, assignments and occurrences are never deleted; roster and snapshot rows are replaced.
GRANT SELECT, INSERT, UPDATE ON shifts, assignments, occurrences TO taskop_app, taskop_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_roster, assignment_assignees, occurrence_assignees TO taskop_app, taskop_platform;
--> statement-breakpoint
-- FR-11.02: status history is append-only.
GRANT SELECT, INSERT ON occurrence_status_history TO taskop_app, taskop_platform;
--> statement-breakpoint
-- pg-boss keeps its job tables in their own schema, owned by the app account so it can install and upgrade them itself.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION taskop_app;
--> statement-breakpoint
-- The backfill below must see every tenant's rows (see 0004 for why row_security is switched off).
SET LOCAL row_security = off;
--> statement-breakpoint
-- Existing tenants: Admin gets the new keys (new tenants get them from SYSTEM_ROLE_DEFAULTS).
INSERT INTO role_permissions (tenant_id, role_id, permission_key)
  SELECT r.tenant_id, r.id, k
  FROM roles r CROSS JOIN unnest(ARRAY['assignments.view','assignments.manage','assignments.extended_window','shifts.view','shifts.manage']) AS k
  WHERE r.system_key = 'admin'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Bump the version so cached (roleId, version) permission sets reload.
UPDATE roles SET version = version + 1 WHERE system_key = 'admin';
--> statement-breakpoint
SET LOCAL row_security = on;
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- scheduling-db checklists-db`
Expected: PASS. The global test setup applies the new migrations to a fresh container.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/scheduling-db.test.ts
git commit -m "feat(api): add scheduling tables, RLS, append-only history and the pgboss schema"
```

---

### Task 7: Clock, domain events and the userIds error detail

**Files:**
- Create: `apps/api/src/common/clock.ts`, `apps/api/src/common/domain-events.ts`, `apps/api/test/fake-clock.ts`
- Modify: `apps/api/src/common/common.module.ts`, `apps/api/src/common/app-error.ts`, `apps/api/src/checklists/checklists.service.ts`, `apps/api/src/users/users.service.ts`, `apps/api/test/app.ts`
- Test: `apps/api/test/domain-events.test.ts`

**Interfaces:**
- Produces:
  - `abstract class Clock { abstract now(): Date }`, provided globally as `SystemClock`
  - `FakeClock extends Clock` (test only), with `set(iso)` and `advanceMinutes(n)`
  - `DomainEvents`:
    - `on<K extends keyof DomainEventMap>(name: K, handler: (e: DomainEventMap[K]) => void | Promise<void>): () => void`
    - `emit<K>(name: K, e: DomainEventMap[K]): Promise<void>`
    - Handlers run in registration order, awaited, inside the caller's transaction.
  - `DomainEventMap`:
    - `'user.access_changed': { tenantId; userId }`
    - `'checklist.deactivated': { tenantId; checklistId }`
    - `'roster.changed': { tenantId; siteId; from; to }`
    - `'occurrence.status_changed': { tenantId; occurrenceId; from: OccurrenceStatus | null; to: OccurrenceStatus; at: Date }`
  - `AppErrorDetails.userIds?: string[]`
  - `createTestApp(overrides?, opts?: { clock?: Clock })`. The test env sets `JOBS_ENABLED=false` (that config key arrives in Task 12; unknown env keys are ignored until then).
  - Emitters:
    - `UsersService.deactivate`, `reactivate` and `setSites` emit `user.access_changed`.
    - `ChecklistsService.setStatus('deactivated')` emits `checklist.deactivated`.

- [ ] **Step 1: Write the failing test**

`apps/api/test/domain-events.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, signupTenant, siteTypeIdOf } from './fixtures';
import { ownerQuery } from './owner-db';

describe('DomainEvents', () => {
  it('runs handlers in order, awaits them and propagates errors', async () => {
    const events = new DomainEvents();
    const seen: string[] = [];
    events.on('roster.changed', async (e) => {
      await Promise.resolve();
      seen.push(`a:${e.siteId}`);
    });
    const off = events.on('roster.changed', (e) => {
      seen.push(`b:${e.siteId}`);
    });
    await events.emit('roster.changed', { tenantId: 't', siteId: 's1', from: '2026-11-02', to: '2026-11-08' });
    off();
    await events.emit('roster.changed', { tenantId: 't', siteId: 's2', from: '2026-11-02', to: '2026-11-08' });
    expect(seen).toEqual(['a:s1', 'b:s1', 'a:s2']);
    events.on('checklist.deactivated', () => {
      throw new Error('boom');
    });
    await expect(events.emit('checklist.deactivated', { tenantId: 't', checklistId: 'c' })).rejects.toThrow('boom');
  });
});

describe('emitters', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('emits user.access_changed and checklist.deactivated inside the request transaction', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const events = t.app.get(DomainEvents);
    const seen: string[] = [];
    const offs = [
      events.on('user.access_changed', (e) => {
        if (e.tenantId === s.tenantId) seen.push(`user:${e.userId}`);
      }),
      events.on('checklist.deactivated', (e) => {
        if (e.tenantId === s.tenantId) seen.push(`checklist:${e.checklistId}`);
      }),
    ];
    try {
      const typeId = await siteTypeIdOf(s.tenantId);
      const siteId = (await api.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial' })).body.id;
      const w = await createUserDirect(t, s.tenantId);
      await api.put(`/api/v1/users/${w.id}/sites`, { siteIds: [siteId] });
      await api.post(`/api/v1/users/${w.id}/deactivate`);
      await api.post(`/api/v1/users/${w.id}/reactivate`);
      const c = (await api.post('/api/v1/checklists', { name: 'X' })).body.id;
      await api.post(`/api/v1/checklists/${c}/deactivate`);
      expect(seen).toEqual([`user:${w.id}`, `user:${w.id}`, `user:${w.id}`, `checklist:${c}`]);
    } finally {
      offs.forEach((off) => off());
    }
  });

  it('rolls the change back when a handler fails', async () => {
    const s = await signupTenant(t);
    const api = as(t, s.accessToken);
    const off = t.app.get(DomainEvents).on('checklist.deactivated', (e) => {
      if (e.tenantId === s.tenantId) throw new Error('listener failed');
    });
    try {
      const c = (await api.post('/api/v1/checklists', { name: 'X' })).body.id;
      expect((await api.post(`/api/v1/checklists/${c}/deactivate`)).status).toBe(500);
      const row = await ownerQuery<{ status: string }>('select status from checklists where id = $1', [c]);
      expect(row.rows[0]!.status).toBe('active');
    } finally {
      off();
    }
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- domain-events`
Expected: FAIL: `../src/common/domain-events` does not exist.

- [ ] **Step 3: Implement the clock and the event bus**

`apps/api/src/common/clock.ts`:

```ts
import { Injectable } from '@nestjs/common';

/** The source of "now" for scheduling, so tests can move time without sleeping. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
```

`apps/api/src/common/domain-events.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OccurrenceStatus } from '@taskop/contracts';

export interface DomainEventMap {
  'user.access_changed': { tenantId: string; userId: string };
  'checklist.deactivated': { tenantId: string; checklistId: string };
  'roster.changed': { tenantId: string; siteId: string; from: string; to: string };
  'occurrence.status_changed': { tenantId: string; occurrenceId: string; from: OccurrenceStatus | null; to: OccurrenceStatus; at: Date };
}

type Handler<K extends keyof DomainEventMap> = (e: DomainEventMap[K]) => void | Promise<void>;

/**
 * In-process events between modules. `emit` awaits every handler in registration order inside the
 * caller's tenant transaction, so a failing handler rolls the whole change back.
 */
@Injectable()
export class DomainEvents {
  private readonly handlers = new Map<keyof DomainEventMap, Handler<never>[]>();

  on<K extends keyof DomainEventMap>(name: K, handler: Handler<K>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as Handler<never>);
    this.handlers.set(name, list);
    return () => {
      const current = this.handlers.get(name) ?? [];
      this.handlers.set(name, current.filter((h) => h !== (handler as Handler<never>)));
    };
  }

  async emit<K extends keyof DomainEventMap>(name: K, e: DomainEventMap[K]): Promise<void> {
    for (const handler of [...(this.handlers.get(name) ?? [])]) await (handler as Handler<K>)(e);
  }
}
```

`apps/api/src/common/common.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { DomainEvents } from './domain-events';
import { ScopeService } from './scope.service';

@Global()
@Module({
  providers: [ScopeService, DomainEvents, { provide: Clock, useClass: SystemClock }],
  exports: [ScopeService, DomainEvents, Clock],
})
export class CommonModule {}
```

In `apps/api/src/common/app-error.ts`, extend `AppErrorDetails`:

```ts
export interface AppErrorDetails {
  issues?: ContentIssue[];
  currentRevision?: number;
  /** Users that caused the error (e.g. ASSIGNEE_NOT_AT_SITE). */
  userIds?: string[];
}
```

- [ ] **Step 4: Emit the events**

In `apps/api/src/checklists/checklists.service.ts`:
- Import `DomainEvents` from `'../common/domain-events'`.
- Add it to the constructor before the optional source: `private readonly events: DomainEvents,` (placed after `audit`, before `@Optional() private readonly templates?`).
- In `setStatus`, inside the `if (c.status !== status)` block after the audit record, add:

```ts
      if (status === 'deactivated') await this.events.emit('checklist.deactivated', { tenantId: c.tenantId, checklistId: id });
```

In `apps/api/src/users/users.service.ts`:
- Import `DomainEvents` and add `private readonly events: DomainEvents` as the last constructor parameter.
- In `deactivate`, `reactivate` and `setSites`, right before `return after;`, add:

```ts
    await this.events.emit('user.access_changed', { tenantId: p.tenantId, userId: id });
```

- [ ] **Step 5: Add the fake clock and the test-app option**

`apps/api/test/fake-clock.ts`:

```ts
import { Clock } from '../src/common/clock';

export class FakeClock extends Clock {
  private current: Date;

  constructor(iso: string) {
    super();
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(+this.current + minutes * 60_000);
  }
}
```

In `apps/api/test/app.ts`:
- Import `Clock` from `'../src/common/clock'`.
- Add `JOBS_ENABLED: 'false',` to `testEnv` (before `...overrides`).
- Change `createTestApp` to:

```ts
export async function createTestApp(overrides: Record<string, string> = {}, opts: { clock?: Clock } = {}): Promise<TestApp> {
  const config = loadConfig(testEnv(overrides));
  const mailer = new MemoryMailer();
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(MAILER)
    .useValue(mailer);
  if (opts.clock) builder = builder.overrideProvider(Clock).useValue(opts.clock);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, config);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    config,
    mailer,
    close: () => app.close(),
  };
}
```

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- domain-events users checklists`
Expected: PASS. The existing users and checklists suites are unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common apps/api/src/checklists/checklists.service.ts apps/api/src/users/users.service.ts apps/api/test/app.ts apps/api/test/fake-clock.ts apps/api/test/domain-events.test.ts
git commit -m "feat(api): add Clock and in-transaction DomainEvents; emit user and checklist events"
```

---

### Task 8: Scheduling module, data-scope filters and shift templates

**Files:**
- Create: `apps/api/src/scheduling/actor.ts`, `scheduling-scope.ts`, `mappers.ts`, `dto.ts`, `shifts.service.ts`, `shifts.controller.ts`, `scheduling.module.ts`
- Create: `apps/api/test/scheduling-fixtures.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/common/error.filter.ts`
- Test: `apps/api/test/shifts.test.ts`

**Interfaces:**
- Consumes: `controllerDecorators`, `perm`, `named` and `RouteMode` from `../checklists/route-mode`; `PlatformTenantInterceptor`; `assertIdsExist`; `AuditService`; `DbService`.
- Produces:
  - `type Actor = Principal | null` (null = a platform admin working in the tenant) and the `@CurrentActor()` param decorator
  - `SchedulingScope`:
    - `assignments(a)`, `occurrences(a)`, `roster(a)`, `rosterUsers(a)`, each returning `SQL | undefined`
    - `assertSiteReadable(a, siteId): Promise<void>`, `assertSiteWritable(a, siteId): Promise<void>`
  - Mappers: `hhmm(t)`, `toShiftDto(row)`, `sameJson(a, b)`
  - `ShiftsService`: `list(q)`, `get(id)`, `create(input)`, `update(id, input)` (Task 11 adds regeneration on an hours change)
  - Routes: `GET/POST /shifts`, `PATCH /shifts/:id`, plus the same under `/platform/tenants/:tenantId/`
  - Test fixtures: `MONDAY_0800`, `TODAY`, `schedulingWorld(t, workerCount?)`, `publishedChecklist(api)`, `daily(...)`, `fixed(...)`, `createAssignment(w, body?)`, `occurrenceRows(assignmentId)`, `staffWithRole(t, w, roleKey, siteIds)`

- [ ] **Step 1: Write the fixtures and the failing test**

`apps/api/test/scheduling-fixtures.ts`:

```ts
import type { AssignmentDetail, SystemRoleKey } from '@taskop/contracts';
import { expect } from 'vitest';
import type { TestApp } from './app';
import { sampleContent } from './checklist-fixtures';
import { as, createUserDirect, loginStaff, signupTenant, siteTypeIdOf, type SignedUpTenant } from './fixtures';
import { ownerQuery } from './owner-db';

/** Monday 2026-11-02 08:00 in Asia/Baku (UTC+4, no DST), the default tenant timezone. */
export const MONDAY_0800 = '2026-11-02T04:00:00Z';
export const TODAY = '2026-11-02';

export type Api = ReturnType<typeof as>;

export interface SchedulingWorld {
  s: SignedUpTenant;
  api: Api;
  siteId: string;
  otherSiteId: string;
  workers: string[];
  checklistId: string;
}

export async function publishedChecklist(api: Api, name = 'Açılış yoxlaması'): Promise<string> {
  const id = (await api.post('/api/v1/checklists', { name })).body.id as string;
  await api.put(`/api/v1/checklists/${id}/draft`, { content: sampleContent(), revision: 1 });
  const res = await api.post(`/api/v1/checklists/${id}/publish`, { revision: 2 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return id;
}

/** An owner, two top-level sites, `workerCount` workers linked to the first site, and a published checklist. */
export async function schedulingWorld(t: TestApp, workerCount = 2): Promise<SchedulingWorld> {
  const s = await signupTenant(t);
  const api = as(t, s.accessToken);
  const typeId = await siteTypeIdOf(s.tenantId);
  const siteId = (await api.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 1' })).body.id as string;
  const otherSiteId = (await api.post('/api/v1/sites', { parentId: null, typeId, name: 'Filial 2' })).body.id as string;
  const workers: string[] = [];
  for (let i = 0; i < workerCount; i++) {
    const w = await createUserDirect(t, s.tenantId, { fullName: `İşçi ${i + 1}` });
    const res = await api.put(`/api/v1/users/${w.id}/sites`, { siteIds: [siteId] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    workers.push(w.id);
  }
  return { s, api, siteId, otherSiteId, workers, checklistId: await publishedChecklist(api) };
}

/** A staff user with a built-in role, linked to `siteIds`, logged in. */
export async function staffWithRole(t: TestApp, w: SchedulingWorld, roleKey: SystemRoleKey, siteIds: string[]) {
  const u = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleKey, fullName: `Staff ${roleKey}`, emailVerified: true });
  if (siteIds.length) await w.api.put(`/api/v1/users/${u.id}/sites`, { siteIds });
  const login = await loginStaff(t, u.email!, u.secret);
  return { id: u.id, api: as(t, login.accessToken) };
}

export const daily = (startDate = TODAY, extra: Record<string, unknown> = {}) => ({ kind: 'daily', every: 1, startDate, endDate: null, skipDates: [], ...extra });
export const fixed = (startTime = '08:00', dueAfterMinutes = 120, graceMinutes = 60) => ({ mode: 'fixed', startTime, dueAfterMinutes, graceMinutes });

export async function createAssignment(w: SchedulingWorld, body: Record<string, unknown> = {}): Promise<AssignmentDetail> {
  const res = await w.api.post('/api/v1/assignments', {
    checklistId: w.checklistId,
    siteId: w.siteId,
    assigneeIds: w.workers,
    schedule: daily(),
    timing: fixed(),
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as AssignmentDetail;
}

export interface OccurrenceRow {
  id: string;
  local_date: string;
  starts_at: Date;
  status: string;
  cancel_reason: string | null;
  assignees: string[];
}

/** Every occurrence of an assignment (any status), read as the owner. */
export async function occurrenceRows(assignmentId: string): Promise<OccurrenceRow[]> {
  const r = await ownerQuery<OccurrenceRow>(
    `select o.id, to_char(o.local_date, 'YYYY-MM-DD') as local_date, o.starts_at, o.status, o.cancel_reason,
            array(select oa.user_id::text from occurrence_assignees oa where oa.occurrence_id = o.id order by oa.user_id) as assignees
       from occurrences o where o.assignment_id = $1 order by o.local_date, o.starts_at`,
    [assignmentId],
  );
  return r.rows;
}

export const live = (rows: OccurrenceRow[]) => rows.filter((r) => r.status !== 'cancelled');
```

`apps/api/test/shifts.test.ts`:

```ts
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { as, createUserDirect, loginWorker, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { schedulingWorld } from './scheduling-fixtures';

describe('shifts', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('creates, lists, edits and deactivates shift templates with an audit trail', async () => {
    const w = await schedulingWorld(t, 0);
    const created = await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: 'Səhər', startTime: '08:00', endTime: '16:00', siteId: null, siteName: null, active: true });
    const night = (await w.api.post('/api/v1/shifts', { name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: w.otherSiteId })).body;
    expect(night).toMatchObject({ siteId: w.otherSiteId, siteName: 'Filial 2' });

    // siteId filter includes tenant-wide shifts.
    expect((await w.api.get(`/api/v1/shifts?siteId=${w.siteId}`)).body.map((s: { name: string }) => s.name)).toEqual(['Səhər']);
    expect((await w.api.get(`/api/v1/shifts?siteId=${w.otherSiteId}`)).body.map((s: { name: string }) => s.name)).toEqual(['Səhər', 'Gecə']);

    const edited = await w.api.patch(`/api/v1/shifts/${created.body.id}`, { endTime: '15:00', active: false });
    expect(edited.body).toMatchObject({ endTime: '15:00', active: false });
    expect((await w.api.get('/api/v1/shifts?active=true')).body.map((s: { name: string }) => s.name)).toEqual(['Gecə']);

    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1 order by occurred_at, id', [created.body.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['shift.created', 'shift.updated']);
  });

  it('rejects zero-length shifts and unknown sites', async () => {
    const w = await schedulingWorld(t, 0);
    const zero = await w.api.post('/api/v1/shifts', { name: 'X', startTime: '08:00', endTime: '08:00' });
    expect(zero.status).toBe(400);
    expect(zero.body.error.fields).toEqual({ endTime: 'scheduling.issues.shiftZeroLength' });
    const id = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const merged = await w.api.patch(`/api/v1/shifts/${id}`, { startTime: '16:00' });
    expect(merged.body.error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { endTime: 'scheduling.issues.shiftZeroLength' } });
    const other = await schedulingWorld(t, 0);
    expect((await w.api.post('/api/v1/shifts', { name: 'X', startTime: '08:00', endTime: '16:00', siteId: other.siteId })).status).toBe(422);
  });

  it('requires shifts permissions', async () => {
    const w = await schedulingWorld(t, 0);
    const worker = await createUserDirect(t, w.s.tenantId);
    const api = as(t, (await loginWorker(t, w.s.orgCode, worker.username!, worker.secret)).accessToken);
    expect((await api.get('/api/v1/shifts')).status).toBe(403);
    expect((await api.post('/api/v1/shifts', { name: 'X', startTime: '08:00', endTime: '16:00' })).status).toBe(403);
  });

  it('lets a platform admin manage shifts inside a tenant', async () => {
    const w = await schedulingWorld(t, 0);
    const email = `${uniq('admin')}@taskop.az`;
    const admin = await ownerQuery<{ id: string }>(
      "insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support') returning id",
      [email, await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 })],
    );
    const token = (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken;
    const p = as(t, token);
    const res = await p.post(`/api/v1/platform/tenants/${w.s.tenantId}/shifts`, { name: 'Səhər', startTime: '08:00', endTime: '16:00' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await w.api.get('/api/v1/shifts')).body.map((s: { id: string }) => s.id)).toEqual([res.body.id]);
    const audit = await ownerQuery<{ actor_platform_admin_id: string }>('select actor_platform_admin_id from audit_log where entity_id = $1', [res.body.id]);
    expect(audit.rows[0]!.actor_platform_admin_id).toBe(admin.rows[0]!.id);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- shifts`
Expected: FAIL: `/api/v1/shifts` returns 404.

- [ ] **Step 3: Implement actor, scope and mappers**

`apps/api/src/scheduling/actor.ts`:

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AppRequest, Principal } from '../common/request';

/** The caller: a tenant user, or null for a platform admin working inside the tenant (all scope, all permissions). */
export type Actor = Principal | null;

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest<AppRequest>().principal ?? null);
```

`apps/api/src/scheduling/scheduling-scope.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../common/app-error';
import { DbService } from '../db/db.service';
import { assignments, occurrences, shiftRoster, sites, users } from '../db/schema';
import type { Actor } from './actor';

const chain = (userId: string) => sql`(with recursive chain as (
    select u.id from users u where u.id = ${userId}
    union
    select u.id from users u join chain c on u.manager_id = c.id
  ) select id from chain)`;

/** The site in `siteCol` lies under one of the user's own sites (Foundation §4.4). */
const inSubtree = (userId: string, siteCol: AnyPgColumn) => sql`exists (
    select 1 from user_sites mine
    join sites ms on ms.id = mine.site_id
    join sites target on target.id = ${siteCol}
    where mine.user_id = ${userId} and target.path <@ ms.path)`;

const failClosed = (scope: never): never => {
  throw new Error(`Unhandled data scope: ${String(scope)}`);
};

/** Data scope for scheduling rows (spec §6). A null actor is a platform admin: no filter. */
@Injectable()
export class SchedulingScope {
  constructor(private readonly db: DbService) {}

  assignments(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all') return undefined;
    switch (a.dataScope) {
      case 'site_subtree':
        return inSubtree(a.userId, assignments.siteId);
      case 'subordinates':
        return sql`exists (select 1 from assignment_assignees aa where aa.assignment_id = ${assignments.id} and aa.user_id in ${chain(a.userId)})`;
      case 'own':
        return sql`exists (select 1 from assignment_assignees aa where aa.assignment_id = ${assignments.id} and aa.user_id = ${a.userId})`;
      default:
        return failClosed(a.dataScope);
    }
  }

  occurrences(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all') return undefined;
    switch (a.dataScope) {
      case 'site_subtree':
        return inSubtree(a.userId, occurrences.siteId);
      case 'subordinates':
        return sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id in ${chain(a.userId)})`;
      case 'own':
        return sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${a.userId})`;
      default:
        return failClosed(a.dataScope);
    }
  }

  /** Roster rows; the site itself is checked with assertSiteReadable. */
  roster(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all' || a.dataScope === 'site_subtree') return undefined;
    return a.dataScope === 'own' ? eq(shiftRoster.userId, a.userId) : sql`${shiftRoster.userId} in ${chain(a.userId)}`;
  }

  /** The people listed on a roster. */
  rosterUsers(a: Actor): SQL | undefined {
    if (!a || a.dataScope === 'all' || a.dataScope === 'site_subtree') return undefined;
    return a.dataScope === 'own' ? eq(users.id, a.userId) : sql`${users.id} in ${chain(a.userId)}`;
  }

  /** Reading a site's roster: site_subtree managers only for their sites; narrower scopes see their own rows. */
  async assertSiteReadable(a: Actor, siteId: string): Promise<void> {
    if (a?.dataScope === 'site_subtree') await this.assertSiteWritable(a, siteId);
  }

  /** Writes need the site inside the actor's scope: all, or site_subtree containing it (spec §6). */
  async assertSiteWritable(a: Actor, siteId: string): Promise<void> {
    if (!a || a.dataScope === 'all') return;
    if (a.dataScope === 'site_subtree') {
      const [row] = await this.db
        .tx()
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, siteId), inSubtree(a.userId, sites.id)));
      if (row) return;
    }
    throw new AppError('SITE_OUT_OF_SCOPE');
  }
}
```

`apps/api/src/scheduling/mappers.ts`:

```ts
import type { ShiftDto } from '@taskop/contracts';

/** Postgres `time` reads back as 'HH:MM:SS'. */
export const hhmm = (t: string): string => t.slice(0, 5);

export interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  siteId: string | null;
  siteName: string | null;
  active: boolean;
}

export const toShiftDto = (r: ShiftRow): ShiftDto => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) });

const canonical = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
};

/** Deep equality for JSON values; jsonb does not keep key order. */
export const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
```

- [ ] **Step 4: Let scheduling message keys through the error filter**

Zod issue messages become `fields` only when they start with `errors.`. Scheduling field errors use `scheduling.issues.*`. In `apps/api/src/common/error.filter.ts`, inside `toAppError`, change the `fields[key] ??=` line to:

```ts
      fields[key] ??= /^(errors|scheduling)\./.test(issue.message) ? issue.message : 'errors.validation.invalid';
```

- [ ] **Step 5: Implement the shifts service, controller and module**

`apps/api/src/scheduling/dto.ts`:

```ts
import { createShiftInputSchema, shiftDtoSchema, shiftListQuerySchema, updateShiftInputSchema } from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class ShiftListQueryDto extends createZodDto(shiftListQuerySchema) {}
export class CreateShiftDto extends createZodDto(createShiftInputSchema) {}
export class UpdateShiftDto extends createZodDto(updateShiftInputSchema) {}
export class ShiftResponse extends createZodDto(shiftDtoSchema) {}
```

`apps/api/src/scheduling/shifts.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { ShiftDto } from '@taskop/contracts';
import { and, asc, eq, isNull, or, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { assertIdsExist } from '../common/ids-exist';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { shifts, sites } from '../db/schema';
import type { CreateShiftDto, ShiftListQueryDto, UpdateShiftDto } from './dto';
import { toShiftDto } from './mappers';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ShiftListQueryDto): Promise<ShiftDto[]> {
    const conds: (SQL | undefined)[] = [];
    if (q.active !== undefined) conds.push(eq(shifts.active, q.active));
    if (q.siteId) conds.push(or(isNull(shifts.siteId), eq(shifts.siteId, q.siteId)));
    const rows = await this.select().where(and(...conds)).orderBy(asc(shifts.startTime), asc(shifts.name));
    return rows.map(toShiftDto);
  }

  async get(id: string): Promise<ShiftDto> {
    const [row] = await this.select().where(eq(shifts.id, id));
    if (!row) throw new AppError('NOT_FOUND');
    return toShiftDto(row);
  }

  async create(input: CreateShiftDto): Promise<ShiftDto> {
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    if (input.siteId) await assertIdsExist(tx, sites, sites.id, [input.siteId]);
    const [row] = await tx
      .insert(shifts)
      .values({ tenantId, name: input.name, startTime: input.startTime, endTime: input.endTime, siteId: input.siteId ?? null })
      .returning({ id: shifts.id });
    const dto = await this.get(row!.id);
    await this.audit.record({ action: 'shift.created', entityType: 'shift', entityId: dto.id, after: dto });
    return dto;
  }

  async update(id: string, input: UpdateShiftDto): Promise<ShiftDto> {
    const before = await this.get(id);
    const startTime = input.startTime ?? before.startTime;
    const endTime = input.endTime ?? before.endTime;
    if (startTime === endTime) throw new AppError('VALIDATION_FAILED', { fields: { endTime: 'scheduling.issues.shiftZeroLength' } });
    const tx = this.db.tx();
    if (input.siteId) await assertIdsExist(tx, sites, sites.id, [input.siteId]);
    await tx
      .update(shifts)
      .set({ name: input.name, startTime: input.startTime, endTime: input.endTime, siteId: input.siteId, active: input.active, updatedAt: new Date() })
      .where(eq(shifts.id, id));
    const after = await this.get(id);
    await this.audit.record({ action: 'shift.updated', entityType: 'shift', entityId: id, before, after });
    return after;
  }

  private select() {
    return this.db
      .tx()
      .select({
        id: shifts.id,
        name: shifts.name,
        startTime: shifts.startTime,
        endTime: shifts.endTime,
        siteId: shifts.siteId,
        siteName: sites.name,
        active: shifts.active,
      })
      .from(shifts)
      .leftJoin(sites, eq(sites.id, shifts.siteId))
      .$dynamic();
  }
}
```

`apps/api/src/scheduling/shifts.controller.ts`:

```ts
import { Body, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { ShiftDto } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { CreateShiftDto, ShiftListQueryDto, ShiftResponse, UpdateShiftDto } from './dto';
import { ShiftsService } from './shifts.service';

export function shiftsControllerFor(mode: RouteMode) {
  const view = perm(mode, 'shifts.view');
  const manage = perm(mode, 'shifts.view', 'shifts.manage');

  @controllerDecorators(mode, 'shifts', 'scheduling')
  class ShiftsController {
    constructor(@Inject(ShiftsService) private readonly shifts: ShiftsService) {}

    @Get()
    @view
    @ApiOkResponse({ type: [ShiftResponse] })
    list(@Query() q: ShiftListQueryDto): Promise<ShiftDto[]> {
      return this.shifts.list(q);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: ShiftResponse })
    create(@Body() body: CreateShiftDto): Promise<ShiftDto> {
      return this.shifts.create(body);
    }

    @Patch(':id')
    @manage
    @ApiOkResponse({ type: ShiftResponse })
    update(@Param('id', ParseIdPipe) id: string, @Body() body: UpdateShiftDto): Promise<ShiftDto> {
      return this.shifts.update(id, body);
    }
  }
  return named(ShiftsController, mode === 'tenant' ? 'ShiftsController' : 'PlatformTenantShiftsController');
}

export const TenantShiftsController = shiftsControllerFor('tenant');
export const PlatformTenantShiftsController = shiftsControllerFor('platform');
```

`apps/api/src/scheduling/scheduling.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PlatformTenantInterceptor } from '../checklists/platform-tenant.interceptor';
import { PlatformModule } from '../platform/platform.module';
import { SchedulingScope } from './scheduling-scope';
import { PlatformTenantShiftsController, TenantShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [PlatformModule],
  controllers: [TenantShiftsController, PlatformTenantShiftsController],
  providers: [SchedulingScope, ShiftsService, PlatformTenantInterceptor],
})
export class SchedulingModule {}
```

In `apps/api/src/app.module.ts`, import `SchedulingModule` from `'./scheduling/scheduling.module'` and add it to `imports` after `ChecklistsModule`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- shifts error.filter`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/scheduling apps/api/src/app.module.ts apps/api/src/common/error.filter.ts apps/api/test/scheduling-fixtures.ts apps/api/test/shifts.test.ts
git commit -m "feat(api): add scheduling module, data-scope filters and shift templates"
```

---

### Task 9: Roster (read, replace, copy weeks)

**Files:**
- Create: `apps/api/src/scheduling/roster.service.ts`, `apps/api/src/scheduling/roster.controller.ts`
- Modify: `apps/api/src/scheduling/dto.ts`, `apps/api/src/scheduling/scheduling.module.ts`
- Test: `apps/api/test/roster.test.ts`

**Interfaces:**
- Consumes: `SchedulingScope`, `ShiftsService.list`, `DomainEvents`, `addDays`, `dayNumber`.
- Produces:
  - `RosterService.get(a, q): Promise<RosterDto>`
  - `RosterService.put(a, input): Promise<RosterDto>`
  - `RosterService.copy(a, input): Promise<RosterCopyResult>`
  - Both writes emit `roster.changed`. Task 11 subscribes to it to refresh snapshots.
  - Routes: `GET /roster?siteId&from&to`, `PUT /roster`, `POST /roster/copy` (tenant and platform)

- [ ] **Step 1: Write the failing test**

`apps/api/test/roster.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { createTestApp, type TestApp } from './app';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import { schedulingWorld } from './scheduling-fixtures';

describe('roster', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function world() {
    const w = await schedulingWorld(t, 2);
    const morning = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id as string;
    const night = (await w.api.post('/api/v1/shifts', { name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: w.otherSiteId })).body.id as string;
    return { w, morning, night };
  }

  it('replaces a site’s rows for a range and reads them back', async () => {
    const { w, morning } = await world();
    const [w0, w1] = w.workers as [string, string];
    const body = {
      siteId: w.siteId,
      from: '2026-11-02',
      to: '2026-11-08',
      rows: [
        { userId: w0, shiftId: morning, date: '2026-11-02' },
        { userId: w1, shiftId: morning, date: '2026-11-02' },
        { userId: w0, shiftId: morning, date: '2026-11-03' },
      ],
    };
    const put = await w.api.put('/api/v1/roster', body);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.rows).toHaveLength(3);
    expect(put.body.users.map((u: { fullName: string }) => u.fullName)).toEqual(['İşçi 1', 'İşçi 2']);
    expect(put.body.shifts.map((s: { name: string }) => s.name)).toEqual(['Səhər']);

    const again = await w.api.put('/api/v1/roster', { ...body, rows: [{ userId: w1, shiftId: morning, date: '2026-11-04' }] });
    expect(again.body.rows).toEqual([{ userId: w1, shiftId: morning, date: '2026-11-04' }]);
    const audit = await ownerQuery<{ action: string; after: { rowCount: number } }>(
      "select action, after from audit_log where entity_id = $1 and action like 'roster.%' order by occurred_at, id",
      [w.siteId],
    );
    expect(audit.rows.map((r) => [r.action, r.after.rowCount])).toEqual([['roster.replaced', 3], ['roster.replaced', 1]]);
  });

  it('rejects users not at the site, inactive or foreign shifts, and long ranges', async () => {
    const { w, morning, night } = await world();
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const base = { siteId: w.siteId, from: '2026-11-02', to: '2026-11-08' };
    const notAtSite = await w.api.put('/api/v1/roster', { ...base, rows: [{ userId: outsider.id, shiftId: morning, date: '2026-11-02' }] });
    expect(notAtSite.body.error).toMatchObject({ code: 'ROSTER_USER_NOT_AT_SITE', userIds: [outsider.id] });
    const foreignShift = await w.api.put('/api/v1/roster', { ...base, rows: [{ userId: w.workers[0], shiftId: night, date: '2026-11-02' }] });
    expect(foreignShift.body.error.code).toBe('SHIFT_NOT_AT_SITE');
    await w.api.patch(`/api/v1/shifts/${morning}`, { active: false });
    const inactive = await w.api.put('/api/v1/roster', { ...base, rows: [{ userId: w.workers[0], shiftId: morning, date: '2026-11-02' }] });
    expect(inactive.body.error.code).toBe('SHIFT_INACTIVE');
    const long = await w.api.get(`/api/v1/roster?siteId=${w.siteId}&from=2026-11-01&to=2027-01-02`);
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toEqual({ to: 'scheduling.issues.rangeTooLong' });
  });

  it('copies a week into later weeks and emits roster.changed per target', async () => {
    const { w, morning } = await world();
    const [w0, w1] = w.workers as [string, string];
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: '2026-11-02',
      to: '2026-11-08',
      rows: [
        { userId: w0, shiftId: morning, date: '2026-11-02' },
        { userId: w1, shiftId: morning, date: '2026-11-06' },
      ],
    });
    // A stale row in a target week is replaced.
    await w.api.put('/api/v1/roster', { siteId: w.siteId, from: '2026-11-16', to: '2026-11-22', rows: [{ userId: w1, shiftId: morning, date: '2026-11-17' }] });
    const changed: string[] = [];
    const off = t.app.get(DomainEvents).on('roster.changed', (e) => {
      if (e.siteId === w.siteId) changed.push(`${e.from}..${e.to}`);
    });
    try {
      const res = await w.api.post('/api/v1/roster/copy', { siteId: w.siteId, sourceWeekStart: '2026-11-02', targetWeekStarts: ['2026-11-09', '2026-11-16'] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toEqual({ rowCount: 4 });
    } finally {
      off();
    }
    expect(changed).toEqual(['2026-11-09..2026-11-15', '2026-11-16..2026-11-22']);
    const rows = (await w.api.get(`/api/v1/roster?siteId=${w.siteId}&from=2026-11-09&to=2026-11-22`)).body.rows;
    expect(rows).toEqual([
      { userId: w0, shiftId: morning, date: '2026-11-09' },
      { userId: w1, shiftId: morning, date: '2026-11-13' },
      { userId: w0, shiftId: morning, date: '2026-11-16' },
      { userId: w1, shiftId: morning, date: '2026-11-20' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- roster`
Expected: FAIL: `/api/v1/roster` returns 404.

- [ ] **Step 3: Implement**

Add to `apps/api/src/scheduling/dto.ts` (and to the contracts import):

```ts
export class RosterQueryDto extends createZodDto(rosterQuerySchema) {}
export class PutRosterDto extends createZodDto(putRosterInputSchema) {}
export class CopyRosterDto extends createZodDto(copyRosterInputSchema) {}
export class RosterResponse extends createZodDto(rosterDtoSchema) {}
export class RosterCopyResultResponse extends createZodDto(rosterCopyResultSchema) {}
```

`apps/api/src/scheduling/roster.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { addDays, dayNumber, type RosterCopyResult, type RosterDto, type RosterRow } from '@taskop/contracts';
import { and, asc, between, eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DomainEvents } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { shiftRoster, shifts, sites, userSites, users } from '../db/schema';
import type { Actor } from './actor';
import type { CopyRosterDto, PutRosterDto, RosterQueryDto } from './dto';
import { SchedulingScope } from './scheduling-scope';
import { ShiftsService } from './shifts.service';

const rowKey = (r: RosterRow) => `${r.userId}|${r.shiftId}|${r.date}`;

@Injectable()
export class RosterService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: SchedulingScope,
    private readonly shifts: ShiftsService,
    private readonly events: DomainEvents,
  ) {}

  async get(a: Actor, q: RosterQueryDto): Promise<RosterDto> {
    await this.scope.assertSiteReadable(a, q.siteId);
    const tx = this.db.tx();
    const people = await tx
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .innerJoin(userSites, and(eq(userSites.userId, users.id), eq(userSites.siteId, q.siteId)))
      .where(and(eq(users.status, 'active'), this.scope.rosterUsers(a)))
      .orderBy(asc(users.fullName), asc(users.id));
    const rows = await tx
      .select({ userId: shiftRoster.userId, shiftId: shiftRoster.shiftId, date: shiftRoster.date })
      .from(shiftRoster)
      .where(and(eq(shiftRoster.siteId, q.siteId), between(shiftRoster.date, q.from, q.to), this.scope.roster(a)))
      .orderBy(asc(shiftRoster.date), asc(shiftRoster.userId), asc(shiftRoster.shiftId));
    return { siteId: q.siteId, from: q.from, to: q.to, users: people, shifts: await this.shifts.list({ siteId: q.siteId }), rows };
  }

  async put(a: Actor, input: PutRosterDto): Promise<RosterDto> {
    await this.assertSite(a, input.siteId);
    const rows = [...new Map(input.rows.map((r) => [rowKey(r), r])).values()];
    await this.validateRows(input.siteId, rows);
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    const removed = await tx
      .delete(shiftRoster)
      .where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, input.from, input.to)))
      .returning({ userId: shiftRoster.userId });
    if (rows.length) await tx.insert(shiftRoster).values(rows.map((r) => ({ tenantId, siteId: input.siteId, ...r })));
    await this.audit.record({
      action: 'roster.replaced',
      entityType: 'site',
      entityId: input.siteId,
      before: { from: input.from, to: input.to, rowCount: removed.length },
      after: { from: input.from, to: input.to, rowCount: rows.length },
    });
    await this.events.emit('roster.changed', { tenantId, siteId: input.siteId, from: input.from, to: input.to });
    return this.get(a, { siteId: input.siteId, from: input.from, to: input.to });
  }

  /** Replaces each target week with the source week. Rows of users or shifts no longer valid are skipped. */
  async copy(a: Actor, input: CopyRosterDto): Promise<RosterCopyResult> {
    await this.assertSite(a, input.siteId);
    const { tenantId } = this.db.context();
    const tx = this.db.tx();
    const source = await tx
      .select({ userId: shiftRoster.userId, shiftId: shiftRoster.shiftId, date: shiftRoster.date })
      .from(shiftRoster)
      .innerJoin(users, and(eq(users.id, shiftRoster.userId), eq(users.status, 'active')))
      .innerJoin(userSites, and(eq(userSites.userId, shiftRoster.userId), eq(userSites.siteId, input.siteId)))
      .innerJoin(shifts, and(eq(shifts.id, shiftRoster.shiftId), eq(shifts.active, true)))
      .where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, input.sourceWeekStart, addDays(input.sourceWeekStart, 6))));
    const targets = [...new Set(input.targetWeekStarts)].sort();
    let rowCount = 0;
    for (const target of targets) {
      const to = addDays(target, 6);
      const offset = dayNumber(target) - dayNumber(input.sourceWeekStart);
      await tx.delete(shiftRoster).where(and(eq(shiftRoster.siteId, input.siteId), between(shiftRoster.date, target, to)));
      if (source.length) {
        await tx.insert(shiftRoster).values(source.map((r) => ({ tenantId, siteId: input.siteId, userId: r.userId, shiftId: r.shiftId, date: addDays(r.date, offset) })));
      }
      rowCount += source.length;
      await this.events.emit('roster.changed', { tenantId, siteId: input.siteId, from: target, to });
    }
    await this.audit.record({
      action: 'roster.copied',
      entityType: 'site',
      entityId: input.siteId,
      after: { sourceWeekStart: input.sourceWeekStart, targetWeekStarts: targets, rowCount },
    });
    return { rowCount };
  }

  private async assertSite(a: Actor, siteId: string): Promise<void> {
    const [site] = await this.db.tx().select({ active: sites.active }).from(sites).where(eq(sites.id, siteId));
    if (!site) throw new AppError('REFERENCE_NOT_FOUND');
    await this.scope.assertSiteWritable(a, siteId);
    if (!site.active) throw new AppError('SITE_INACTIVE');
  }

  private async validateRows(siteId: string, rows: RosterRow[]): Promise<void> {
    const tx = this.db.tx();
    const userIds = [...new Set(rows.map((r) => r.userId))];
    if (userIds.length) {
      const ok = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(userSites, and(eq(userSites.userId, users.id), eq(userSites.siteId, siteId)))
        .where(and(inArray(users.id, userIds), eq(users.status, 'active')));
      const okIds = new Set(ok.map((r) => r.id));
      const bad = userIds.filter((id) => !okIds.has(id));
      if (bad.length) throw new AppError('ROSTER_USER_NOT_AT_SITE', { details: { userIds: bad } });
    }
    const shiftIds = [...new Set(rows.map((r) => r.shiftId))];
    if (shiftIds.length) {
      const found = await tx.select({ active: shifts.active, siteId: shifts.siteId }).from(shifts).where(inArray(shifts.id, shiftIds));
      if (found.length !== shiftIds.length) throw new AppError('REFERENCE_NOT_FOUND');
      if (found.some((s) => !s.active)) throw new AppError('SHIFT_INACTIVE');
      if (found.some((s) => s.siteId !== null && s.siteId !== siteId)) throw new AppError('SHIFT_NOT_AT_SITE');
    }
  }
}
```

`apps/api/src/scheduling/roster.controller.ts`:

```ts
import { Body, Get, Inject, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { RosterCopyResult, RosterDto } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { type Actor, CurrentActor } from './actor';
import { CopyRosterDto, PutRosterDto, RosterCopyResultResponse, RosterQueryDto, RosterResponse } from './dto';
import { RosterService } from './roster.service';

export function rosterControllerFor(mode: RouteMode) {
  const view = perm(mode, 'shifts.view');
  const manage = perm(mode, 'shifts.view', 'shifts.manage');

  @controllerDecorators(mode, 'roster', 'scheduling')
  class RosterController {
    constructor(@Inject(RosterService) private readonly roster: RosterService) {}

    @Get()
    @view
    @ApiOkResponse({ type: RosterResponse })
    get(@CurrentActor() a: Actor, @Query() q: RosterQueryDto): Promise<RosterDto> {
      return this.roster.get(a, q);
    }

    @Put()
    @manage
    @ApiOkResponse({ type: RosterResponse })
    put(@CurrentActor() a: Actor, @Body() body: PutRosterDto): Promise<RosterDto> {
      return this.roster.put(a, body);
    }

    @Post('copy')
    @manage
    @ApiOkResponse({ type: RosterCopyResultResponse })
    copy(@CurrentActor() a: Actor, @Body() body: CopyRosterDto): Promise<RosterCopyResult> {
      return this.roster.copy(a, body);
    }
  }
  return named(RosterController, mode === 'tenant' ? 'RosterController' : 'PlatformTenantRosterController');
}

export const TenantRosterController = rosterControllerFor('tenant');
export const PlatformTenantRosterController = rosterControllerFor('platform');
```

In `scheduling.module.ts`, add `TenantRosterController` and `PlatformTenantRosterController` to `controllers`, and `RosterService` to `providers`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- roster`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduling apps/api/test/roster.test.ts
git commit -m "feat(api): add roster read, replace and week copy"
```

---
### Task 10: Assignments: create, read, list, preview and inline materialisation

**Files:**
- Create: `apps/api/src/scheduling/occurrence-writer.ts`, `occurrence-queries.ts`, `assignment-rules.ts`, `assignments.service.ts`, `assignments.controller.ts`
- Modify: `apps/api/src/scheduling/mappers.ts`, `dto.ts`, `scheduling.module.ts`
- Test: `apps/api/test/assignments.test.ts`

**Interfaces:**
- Consumes: `actorColumns` from `../checklists/actor`; `Clock`, `DomainEvents`, `SchedulingScope` and contracts helpers (`expandSchedule`, `localDateOf`, `zonedTimeToUtc`, `addDays`, `validateSchedule`, `windowMinutes`, `scheduleWarnings`, `SCHEDULING_LIMITS`).
- Produces:
  - `OccurrenceWriter` (the only writer of occurrences):
    - `tenantTimezone(): Promise<string>`
    - `shiftHours(shiftId): Promise<ShiftHours | null>`
    - `materialize(assignmentId): Promise<number>`, which returns how many occurrences it created
    - `refreshSnapshots(scope: SnapshotScope): Promise<void>`, where `SnapshotScope = { assignmentId } | { siteId; from; to } | { userId }`
    - `cancelFuturePending(assignmentId, reason: CancelReasonCode): Promise<number>`
    - `restart(assignmentId): Promise<void>`: sets `materialized_until = now`, then materialises
    - `regenerate(assignmentId, reason): Promise<void>`: cancels future pending occurrences, then restarts
    - `recordTransitions(rows: Transition[]): Promise<void>`, where `Transition = { occurrenceId; from: OccurrenceStatus | null; to: OccurrenceStatus; at: Date; reason?: string | null }`. It writes history rows with the current actor and emits `occurrence.status_changed`.
  - `OccurrenceQueries`: `select()` (a joined row builder), `toDto(row)`, `upcoming(assignmentId, limit)`
  - `AssignmentRules`:
    - `checklist(id)`, `site(a, id)`, `assignees(siteId, userIds)`, `shift(timing, siteId): Promise<(ShiftHours & { name: string }) | null>`
    - `schedule(r)`, `window(a, timing, shift)`, `nextSlots(r, timing, shift, tz, limit): Slot[]`, `nonEmpty(r, timing, shift, tz)`
  - `AssignmentsService`: `list(a, q)`, `get(a, id)`, `create(a, input)`, `preview(a, input)`
  - Routes: `GET/POST /assignments`, `POST /assignments/preview`, `GET /assignments/:id` (tenant and platform)

- [ ] **Step 1: Write the failing test**

`apps/api/test/assignments.test.ts`:

```ts
import { addDays } from '@taskop/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createUserDirect } from './fixtures';
import { ownerQuery } from './owner-db';
import {
  createAssignment,
  daily,
  fixed,
  MONDAY_0800,
  occurrenceRows,
  type SchedulingWorld,
  schedulingWorld,
  staffWithRole,
  TODAY,
} from './scheduling-fixtures';

const sorted = (ids: string[]) => [...ids].sort();

describe('assignments', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  const post = (w: SchedulingWorld, body: Record<string, unknown> = {}) =>
    w.api.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.siteId, assigneeIds: w.workers, schedule: daily(), timing: fixed(), ...body });

  it('creates an assignment and materialises 14 days ahead with snapshots and history', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { name: 'Səhər açılışı' });
    expect(a).toMatchObject({ name: 'Səhər açılışı', status: 'active', revision: 1, checklistId: w.checklistId, siteName: 'Filial 1', shiftName: null });
    expect(a.assignees.map((u) => u.fullName)).toEqual(['İşçi 1', 'İşçi 2']);
    expect(a.upcoming.map((o) => o.localDate)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(a.upcoming[0]).toMatchObject({
      status: 'pending',
      startsAt: '2026-11-02T04:00:00.000Z',
      dueAt: '2026-11-02T06:00:00.000Z',
      closesAt: '2026-11-02T07:00:00.000Z',
      unassigned: false,
      checklistName: 'Açılış yoxlaması',
    });

    const rows = await occurrenceRows(a.id);
    expect(rows.map((r) => r.local_date)).toEqual(Array.from({ length: 15 }, (_, i) => addDays(TODAY, i)));
    for (const r of rows) expect(r).toMatchObject({ status: 'pending', assignees: sorted(w.workers) });
    const meta = await ownerQuery<{ materialized_until: Date }>('select materialized_until from assignments where id = $1', [a.id]);
    expect(meta.rows[0]!.materialized_until.toISOString()).toBe('2026-11-16T20:00:00.000Z');
    const history = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from occurrence_status_history h join occurrences o on o.id = h.occurrence_id
        where o.assignment_id = $1 and h.from_status is null and h.to_status = 'pending' and h.actor_user_id = $2`,
      [a.id, w.s.ownerId],
    );
    expect(history.rows[0]!.n).toBe(15);
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1', [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['assignment.created']);
  });

  it('includes today’s slot while its window is open and skips it once closed', async () => {
    const w = await schedulingWorld(t);
    clock.set('2026-11-02T05:30:00Z'); // 09:30, after the start, before the 11:00 close
    expect((await occurrenceRows((await createAssignment(w)).id))[0]!.local_date).toBe(TODAY);
    clock.set('2026-11-02T07:30:00Z'); // 11:30, closed
    const rows = await occurrenceRows((await createAssignment(w)).id);
    expect(rows[0]!.local_date).toBe('2026-11-03');
    expect(rows).toHaveLength(14);
  });

  it('snapshots only rostered assignees for shift timing', async () => {
    const w = await schedulingWorld(t);
    const [w0, w1] = w.workers as [string, string];
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: TODAY,
      to: '2026-11-08',
      rows: [
        { userId: w0, shiftId: shift, date: '2026-11-02' },
        { userId: w0, shiftId: shift, date: '2026-11-03' },
        { userId: w1, shiftId: shift, date: '2026-11-03' },
      ],
    });
    const a = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 30 } });
    expect(a.shiftName).toBe('Səhər');
    const rows = await occurrenceRows(a.id);
    expect(rows.slice(0, 3).map((r) => r.assignees)).toEqual([[w0], sorted([w0, w1]), []]);
    expect(a.upcoming[0]).toMatchObject({ startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T12:00:00.000Z', closesAt: '2026-11-02T12:30:00.000Z' });
    expect(a.upcoming.map((o) => o.unassigned)).toEqual([false, false, true, true, true]);
  });

  it('lists and reads assignments with filters', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { name: 'Səhər açılışı' });
    expect((await w.api.get(`/api/v1/assignments?siteId=${w.siteId}`)).body.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect((await w.api.get('/api/v1/assignments?q=açılış')).body.items).toHaveLength(1);
    expect((await w.api.get('/api/v1/assignments?status=paused')).body.items).toHaveLength(0);
    expect((await w.api.get(`/api/v1/assignments?assigneeId=${w.workers[0]}`)).body.items).toHaveLength(1);
    expect((await w.api.get(`/api/v1/assignments/${a.id}`)).body.id).toBe(a.id);
    expect((await w.api.get('/api/v1/assignments/0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f')).status).toBe(404);
  });

  it('validates checklist, site, assignees, shift, schedule and window', async () => {
    const w = await schedulingWorld(t);
    const outsider = await createUserDirect(t, w.s.tenantId, { fullName: 'Kənar' });
    const notAtSite = await post(w, { assigneeIds: [w.workers[0], outsider.id] });
    expect(notAtSite.body.error).toMatchObject({ code: 'ASSIGNEE_NOT_AT_SITE', userIds: [outsider.id] });

    const draftOnly = (await w.api.post('/api/v1/checklists', { name: 'Qaralama' })).body.id;
    expect((await post(w, { checklistId: draftOnly })).body.error.code).toBe('CHECKLIST_NOT_PUBLISHED');

    const invalid = await post(w, { schedule: daily('2026-11-10', { endDate: '2026-11-01' }) });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error).toMatchObject({ code: 'SCHEDULE_INVALID', issues: [{ path: ['schedule', 'endDate'], code: 'scheduling.issues.endBeforeStart' }] });
    expect((await post(w, { schedule: { kind: 'once', date: '2026-10-01' } })).body.error.code).toBe('SCHEDULE_EMPTY');
    expect((await post(w, { assigneeIds: [] })).status).toBe(400);

    const otherShift = (await w.api.post('/api/v1/shifts', { name: 'Gecə', startTime: '22:00', endTime: '06:00', siteId: w.otherSiteId })).body.id;
    expect((await post(w, { timing: { mode: 'shift', shiftId: otherShift, graceMinutes: 0 } })).body.error.code).toBe('SHIFT_NOT_AT_SITE');
    const off = (await w.api.post('/api/v1/shifts', { name: 'Off', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.patch(`/api/v1/shifts/${off}`, { active: false });
    expect((await post(w, { timing: { mode: 'shift', shiftId: off, graceMinutes: 0 } })).body.error.code).toBe('SHIFT_INACTIVE');

    // 25h windows need assignments.extended_window; nobody gets more than 7 days.
    const manager = await staffWithRole(t, w, 'manager', [w.siteId]);
    const long = { checklistId: w.checklistId, siteId: w.siteId, assigneeIds: w.workers, schedule: daily(), timing: fixed('08:00', 1440, 60) };
    expect((await manager.api.post('/api/v1/assignments', long)).body.error.code).toBe('WINDOW_TOO_LONG');
    expect((await w.api.post('/api/v1/assignments', long)).status).toBe(201);
    expect((await post(w, { timing: fixed('08:00', 10080, 1) })).body.error.code).toBe('WINDOW_INVALID');

    await w.api.post(`/api/v1/users/${w.workers[1]}/deactivate`);
    expect((await post(w)).body.error).toMatchObject({ code: 'ASSIGNEE_INACTIVE', userIds: [w.workers[1]] });
    await w.api.post(`/api/v1/checklists/${w.checklistId}/deactivate`);
    expect((await post(w, { assigneeIds: [w.workers[0]] })).body.error.code).toBe('CHECKLIST_DEACTIVATED');
  });

  it('refuses inactive sites', async () => {
    const w = await schedulingWorld(t);
    await w.api.patch(`/api/v1/sites/${w.siteId}`, { active: false });
    expect((await post(w)).body.error.code).toBe('SITE_INACTIVE');
  });

  it('previews slots and warnings without saving anything', async () => {
    const w = await schedulingWorld(t);
    const res = await w.api.post('/api/v1/assignments/preview', { siteId: w.siteId, schedule: daily(TODAY, { skipDates: ['2026-10-01'] }), timing: fixed() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.slots).toHaveLength(20);
    expect(res.body.slots[0]).toEqual({ localDate: TODAY, startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z' });
    expect(res.body.warnings).toEqual(['SKIP_DATE_OUT_OF_RANGE']);

    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const noRoster = await w.api.post('/api/v1/assignments/preview', { siteId: w.siteId, schedule: daily(), timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 }, assigneeIds: w.workers });
    expect(noRoster.body.warnings).toEqual(['NO_ROSTERED_ASSIGNEES']);
    const past = await w.api.post('/api/v1/assignments/preview', { siteId: w.siteId, schedule: { kind: 'once', date: '2026-10-01' }, timing: fixed() });
    expect(past.body).toEqual({ slots: [], warnings: [] });

    const count = await ownerQuery<{ n: number }>('select count(*)::int as n from assignments where tenant_id = $1', [w.s.tenantId]);
    expect(count.rows[0]!.n).toBe(0);
  });

  it('needs checklists.view and assignments.manage to create', async () => {
    const w = await schedulingWorld(t);
    const auditor = await staffWithRole(t, w, 'auditor', []);
    expect((await auditor.api.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.siteId, assigneeIds: w.workers, schedule: daily(), timing: fixed() })).status).toBe(403);
    expect((await auditor.api.get('/api/v1/assignments')).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- test/assignments.test.ts`
Expected: FAIL: `/api/v1/assignments` returns 404.

- [ ] **Step 3: Add the mappers and DTOs**

Append to `apps/api/src/scheduling/mappers.ts` (extend the contracts import with `AssignmentDto`, `OccurrenceDto`, `recurrenceSchema`, `timingSchema` and `UserRef`, and import `assignments` and `occurrences` from `'../db/schema'`):

```ts
export interface OccurrenceJoinedRow {
  o: typeof occurrences.$inferSelect;
  assignmentName: string | null;
  checklistName: string;
  siteName: string;
  shiftName: string | null;
  assigneeIds: string[];
}

export const toOccurrenceDto = (r: OccurrenceJoinedRow): OccurrenceDto => ({
  id: r.o.id,
  assignmentId: r.o.assignmentId,
  assignmentName: r.assignmentName,
  checklistId: r.o.checklistId,
  checklistName: r.checklistName,
  siteId: r.o.siteId,
  siteName: r.siteName,
  shiftId: r.o.shiftId,
  shiftName: r.shiftName,
  localDate: r.o.localDate,
  startsAt: r.o.startsAt.toISOString(),
  dueAt: r.o.dueAt.toISOString(),
  closesAt: r.o.closesAt.toISOString(),
  status: r.o.status,
  statusChangedAt: r.o.statusChangedAt.toISOString(),
  cancelReason: r.o.cancelReason,
  assigneeIds: r.assigneeIds,
  unassigned: (r.o.status === 'pending' || r.o.status === 'overdue') && r.assigneeIds.length === 0,
});

export interface AssignmentJoinedRow {
  a: typeof assignments.$inferSelect;
  checklistName: string;
  siteName: string;
  shiftName: string | null;
  assignees: UserRef[];
}

export const toAssignmentDto = (r: AssignmentJoinedRow): AssignmentDto => ({
  id: r.a.id,
  name: r.a.name,
  checklistId: r.a.checklistId,
  checklistName: r.checklistName,
  siteId: r.a.siteId,
  siteName: r.siteName,
  schedule: recurrenceSchema.parse(r.a.schedule),
  timing: timingSchema.parse(r.a.timing),
  shiftName: r.shiftName,
  status: r.a.status,
  revision: r.a.revision,
  assignees: r.assignees,
  createdAt: r.a.createdAt.toISOString(),
  updatedAt: r.a.updatedAt.toISOString(),
});
```

Add to `apps/api/src/scheduling/dto.ts` (and to the contracts import):

```ts
export class AssignmentListQueryDto extends createZodDto(assignmentListQuerySchema) {}
export class CreateAssignmentDto extends createZodDto(createAssignmentInputSchema) {}
export class UpdateAssignmentDto extends createZodDto(updateAssignmentInputSchema) {}
export class PreviewAssignmentDto extends createZodDto(previewAssignmentInputSchema) {}
export class AssignmentPageResponse extends createZodDto(pageOf(assignmentDtoSchema)) {}
export class AssignmentDetailResponse extends createZodDto(assignmentDetailSchema) {}
export class AssignmentPreviewResponse extends createZodDto(assignmentPreviewSchema) {}
```

- [ ] **Step 4: Implement the occurrence writer and queries**

`apps/api/src/scheduling/occurrence-writer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  addDays,
  type CancelReasonCode,
  expandSchedule,
  localDateOf,
  type OccurrenceStatus,
  recurrenceSchema,
  SCHEDULING_LIMITS,
  type ShiftHours,
  timingSchema,
  zonedTimeToUtc,
} from '@taskop/contracts';
import { and, between, eq, gt, inArray, type SQL, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { DbService } from '../db/db.service';
import { assignments, occurrenceAssignees, occurrences, occurrenceStatusHistory, shifts, tenants } from '../db/schema';
import { hhmm } from './mappers';

export type SnapshotScope = { assignmentId: string } | { siteId: string; from: string; to: string } | { userId: string };

export interface Transition {
  occurrenceId: string;
  from: OccurrenceStatus | null;
  to: OccurrenceStatus;
  at: Date;
  reason?: string | null;
}

/** The only code that creates occurrences or changes their status (spec §5). Runs inside a tenant transaction. */
@Injectable()
export class OccurrenceWriter {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly events: DomainEvents,
  ) {}

  async tenantTimezone(): Promise<string> {
    const [t] = await this.db.tx().select({ timezone: tenants.timezone }).from(tenants);
    return t!.timezone;
  }

  async shiftHours(shiftId: string): Promise<ShiftHours | null> {
    const [s] = await this.db.tx().select({ startTime: shifts.startTime, endTime: shifts.endTime }).from(shifts).where(eq(shifts.id, shiftId));
    return s ? { startTime: hhmm(s.startTime), endTime: hhmm(s.endTime) } : null;
  }

  /**
   * Creates the occurrences an active assignment still lacks, up to today + 14 days (spec §5.1).
   * Slots start after `materialized_until` and close after now; on the first run (null) a window that is
   * already open is included. Afterwards `materialized_until` is the start of day today + 15, so every slot
   * is considered once and a cancelled occurrence is never recreated.
   */
  async materialize(assignmentId: string): Promise<number> {
    const tx = this.db.tx();
    const now = this.clock.now();
    const [a] = await tx.select().from(assignments).where(eq(assignments.id, assignmentId)).for('update');
    if (!a || a.status !== 'active') return 0;
    const tz = await this.tenantTimezone();
    const timing = timingSchema.parse(a.timing);
    const shift = timing.mode === 'shift' ? await this.shiftHours(timing.shiftId) : null;
    const today = localDateOf(now, tz);
    const until = a.materializedUntil;
    // First run: look back far enough for a window of up to 7 days that is still open.
    const from = until ? localDateOf(until, tz) : addDays(today, -8);
    const slots = expandSchedule(recurrenceSchema.parse(a.schedule), timing, shift, tz, from, addDays(today, SCHEDULING_LIMITS.horizonDays)).filter(
      (s) => (!until || s.startsAt > until) && s.closesAt > now,
    );
    let created: { id: string }[] = [];
    if (slots.length) {
      created = await tx
        .insert(occurrences)
        .values(
          slots.map((s) => ({
            tenantId: a.tenantId,
            assignmentId: a.id,
            checklistId: a.checklistId,
            siteId: a.siteId,
            shiftId: a.shiftId,
            localDate: s.localDate,
            startsAt: s.startsAt,
            dueAt: s.dueAt,
            closesAt: s.closesAt,
            statusChangedAt: now,
          })),
        )
        // Targets the partial unique index occurrences_live_day_uq.
        .onConflictDoNothing({ target: [occurrences.assignmentId, occurrences.localDate], where: sql`status <> 'cancelled'` })
        .returning({ id: occurrences.id });
    }
    await tx
      .update(assignments)
      .set({ materializedUntil: zonedTimeToUtc(addDays(today, SCHEDULING_LIMITS.horizonDays + 1), 0, tz) })
      .where(eq(assignments.id, a.id));
    if (created.length) {
      const ids = created.map((c) => c.id);
      await this.insertSnapshots(ids);
      await this.recordTransitions(ids.map((occurrenceId) => ({ occurrenceId, from: null, to: 'pending', at: now })));
    }
    return created.length;
  }

  /** Recomputes who may do pending occurrences that have not started yet (spec §5.1 snapshot refresh). */
  async refreshSnapshots(scope: SnapshotScope): Promise<void> {
    const tx = this.db.tx();
    const conds: (SQL | undefined)[] = [eq(occurrences.status, 'pending'), gt(occurrences.startsAt, this.clock.now())];
    if ('assignmentId' in scope) conds.push(eq(occurrences.assignmentId, scope.assignmentId));
    else if ('siteId' in scope) conds.push(eq(occurrences.siteId, scope.siteId), between(occurrences.localDate, scope.from, scope.to));
    else {
      conds.push(sql`(exists (select 1 from assignment_assignees aa where aa.assignment_id = ${occurrences.assignmentId} and aa.user_id = ${scope.userId})
        or exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${scope.userId}))`);
    }
    const ids = (await tx.select({ id: occurrences.id }).from(occurrences).where(and(...conds))).map((r) => r.id);
    if (!ids.length) return;
    await tx.delete(occurrenceAssignees).where(inArray(occurrenceAssignees.occurrenceId, ids));
    await this.insertSnapshots(ids);
  }

  /** Cancels pending occurrences that start after now; open and overdue ones are kept. */
  async cancelFuturePending(assignmentId: string, reason: CancelReasonCode): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .tx()
      .update(occurrences)
      .set({ status: 'cancelled', cancelReason: reason, statusChangedAt: now, updatedAt: now })
      .where(and(eq(occurrences.assignmentId, assignmentId), eq(occurrences.status, 'pending'), gt(occurrences.startsAt, now)))
      .returning({ id: occurrences.id });
    await this.recordTransitions(rows.map((r) => ({ occurrenceId: r.id, from: 'pending', to: 'cancelled', at: now, reason })));
    return rows.length;
  }

  /** Generates from now on only (after a resume or an edit). */
  async restart(assignmentId: string): Promise<void> {
    await this.db.tx().update(assignments).set({ materializedUntil: this.clock.now() }).where(eq(assignments.id, assignmentId));
    await this.materialize(assignmentId);
  }

  /** After a schedule, timing or shift-hours change: future slots are rebuilt; open ones stay (spec §5.3). */
  async regenerate(assignmentId: string, reason: CancelReasonCode): Promise<void> {
    await this.cancelFuturePending(assignmentId, reason);
    await this.restart(assignmentId);
  }

  async recordTransitions(rows: Transition[]): Promise<void> {
    if (!rows.length) return;
    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    await this.db
      .tx()
      .insert(occurrenceStatusHistory)
      .values(
        rows.map((r) => ({
          tenantId,
          occurrenceId: r.occurrenceId,
          fromStatus: r.from,
          toStatus: r.to,
          at: r.at,
          actorUserId: actor.userId,
          actorPlatformAdminId: actor.platformAdminId,
          reason: r.reason ?? null,
        })),
      );
    for (const r of rows) {
      await this.events.emit('occurrence.status_changed', { tenantId, occurrenceId: r.occurrenceId, from: r.from, to: r.to, at: r.at });
    }
  }

  /** Eligible users: active assignees linked to the site, and for shift timing also rostered that day (FR-09.09). */
  private async insertSnapshots(occurrenceIds: string[]): Promise<void> {
    await this.db.tx().execute(sql`
      insert into occurrence_assignees (tenant_id, occurrence_id, user_id)
      select occurrences.tenant_id, occurrences.id, aa.user_id
      from occurrences
      join assignment_assignees aa on aa.assignment_id = occurrences.assignment_id
      join users u on u.id = aa.user_id and u.status = 'active'
      join user_sites us on us.user_id = aa.user_id and us.site_id = occurrences.site_id
      where ${inArray(occurrences.id, occurrenceIds)}
        and (occurrences.shift_id is null or exists (
          select 1 from shift_roster r
          where r.user_id = aa.user_id and r.shift_id = occurrences.shift_id
            and r.site_id = occurrences.site_id and r.date = occurrences.local_date))
      on conflict do nothing`);
  }
}
```

> If `onConflictDoNothing({ target, where })` does not render `ON CONFLICT (...) WHERE status <> 'cancelled' DO NOTHING` in the installed Drizzle (check with `.toSQL()`), replace that insert with `tx.execute(sql\`insert ... on conflict (assignment_id, local_date) where status <> 'cancelled' do nothing returning id\`)` and read `result.rows`.

`apps/api/src/scheduling/occurrence-queries.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OccurrenceDto } from '@taskop/contracts';
import { and, asc, eq, getTableColumns, gt, inArray, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { assignments, checklists, occurrences, shifts, sites } from '../db/schema';
import { toOccurrenceDto } from './mappers';

@Injectable()
export class OccurrenceQueries {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
  ) {}

  select() {
    return this.db
      .tx()
      .select({
        o: getTableColumns(occurrences),
        assignmentName: assignments.name,
        checklistName: checklists.name,
        siteName: sites.name,
        shiftName: shifts.name,
        // Qualified explicitly: in a select list Drizzle renders a column as its bare name.
        assigneeIds: sql<string[]>`array(select oa.user_id::text from occurrence_assignees oa where oa.occurrence_id = "occurrences"."id" order by oa.user_id)`,
      })
      .from(occurrences)
      .innerJoin(assignments, eq(assignments.id, occurrences.assignmentId))
      .innerJoin(checklists, eq(checklists.id, occurrences.checklistId))
      .innerJoin(sites, eq(sites.id, occurrences.siteId))
      .leftJoin(shifts, eq(shifts.id, occurrences.shiftId))
      .$dynamic();
  }

  async upcoming(assignmentId: string, limit = 5): Promise<OccurrenceDto[]> {
    const rows = await this.select()
      .where(and(eq(occurrences.assignmentId, assignmentId), inArray(occurrences.status, ['pending', 'overdue']), gt(occurrences.closesAt, this.clock.now())))
      .orderBy(asc(occurrences.startsAt))
      .limit(limit);
    return rows.map(toOccurrenceDto);
  }
}
```

- [ ] **Step 5: Implement the rules, the service and the controller**

`apps/api/src/scheduling/assignment-rules.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  addDays,
  expandSchedule,
  localDateOf,
  type Recurrence,
  SCHEDULING_LIMITS,
  type ShiftHours,
  type Slot,
  type Timing,
  validateSchedule,
  windowMinutes,
} from '@taskop/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { DbService } from '../db/db.service';
import { checklists, shifts, sites, users } from '../db/schema';
import type { Actor } from './actor';
import { hhmm } from './mappers';
import { SchedulingScope } from './scheduling-scope';

/** Checks shared by create, update, resume and preview (spec §4.2). */
@Injectable()
export class AssignmentRules {
  constructor(
    private readonly db: DbService,
    private readonly scope: SchedulingScope,
    private readonly clock: Clock,
  ) {}

  async checklist(checklistId: string): Promise<void> {
    const [c] = await this.db
      .tx()
      .select({ status: checklists.status, currentVersionId: checklists.currentVersionId })
      .from(checklists)
      .where(eq(checklists.id, checklistId));
    if (!c) throw new AppError('REFERENCE_NOT_FOUND');
    if (c.status !== 'active') throw new AppError('CHECKLIST_DEACTIVATED');
    if (!c.currentVersionId) throw new AppError('CHECKLIST_NOT_PUBLISHED');
  }

  async site(a: Actor, siteId: string): Promise<void> {
    const [s] = await this.db.tx().select({ active: sites.active }).from(sites).where(eq(sites.id, siteId));
    if (!s) throw new AppError('REFERENCE_NOT_FOUND');
    await this.scope.assertSiteWritable(a, siteId);
    if (!s.active) throw new AppError('SITE_INACTIVE');
  }

  async assignees(siteId: string, userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const rows = await this.db
      .tx()
      .select({
        id: users.id,
        status: users.status,
        atSite: sql<boolean>`exists (select 1 from user_sites us where us.user_id = "users"."id" and us.site_id = ${siteId})`,
      })
      .from(users)
      .where(inArray(users.id, unique));
    if (rows.length !== unique.length) throw new AppError('REFERENCE_NOT_FOUND');
    const inactive = rows.filter((r) => r.status !== 'active').map((r) => r.id);
    if (inactive.length) throw new AppError('ASSIGNEE_INACTIVE', { details: { userIds: inactive } });
    const away = rows.filter((r) => !r.atSite).map((r) => r.id);
    if (away.length) throw new AppError('ASSIGNEE_NOT_AT_SITE', { details: { userIds: away } });
  }

  async shift(timing: Timing, siteId: string): Promise<(ShiftHours & { name: string }) | null> {
    if (timing.mode !== 'shift') return null;
    const [s] = await this.db.tx().select().from(shifts).where(eq(shifts.id, timing.shiftId));
    if (!s) throw new AppError('REFERENCE_NOT_FOUND');
    if (!s.active) throw new AppError('SHIFT_INACTIVE');
    if (s.siteId && s.siteId !== siteId) throw new AppError('SHIFT_NOT_AT_SITE');
    return { name: s.name, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime) };
  }

  schedule(r: Recurrence): void {
    const issues = validateSchedule(r);
    if (issues.length) throw new AppError('SCHEDULE_INVALID', { details: { issues: issues.map((i) => ({ ...i, path: ['schedule', ...i.path] })) } });
  }

  /** FR-09.05/06: ≤ 24h, or ≤ 7 days with assignments.extended_window (platform admins hold every permission). */
  window(a: Actor, timing: Timing, shift: ShiftHours | null): void {
    const minutes = windowMinutes(timing, shift);
    if (minutes > SCHEDULING_LIMITS.maxExtendedWindowMinutes) throw new AppError('WINDOW_INVALID');
    const extended = !a || a.permissions.has('assignments.extended_window');
    if (minutes > SCHEDULING_LIMITS.maxWindowMinutes && !extended) throw new AppError('WINDOW_TOO_LONG');
  }

  /** Slots that have not closed yet, from today on, in order. */
  nextSlots(r: Recurrence, timing: Timing, shift: ShiftHours | null, tz: string, limit: number): Slot[] {
    const now = this.clock.now();
    const today = localDateOf(now, tz);
    return expandSchedule(r, timing, shift, tz, addDays(today, -8), addDays(today, SCHEDULING_LIMITS.emptyCheckDays))
      .filter((s) => s.closesAt > now)
      .slice(0, limit);
  }

  nonEmpty(r: Recurrence, timing: Timing, shift: ShiftHours | null, tz: string): void {
    if (!this.nextSlots(r, timing, shift, tz, 1).length) throw new AppError('SCHEDULE_EMPTY');
  }
}
```

`apps/api/src/scheduling/assignments.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  addDays,
  type AssignmentDetail,
  type AssignmentDto,
  type AssignmentPreview,
  localDateOf,
  type Page,
  type PreviewWarning,
  SCHEDULING_LIMITS,
  scheduleWarnings,
} from '@taskop/contracts';
import { and, between, desc, eq, getTableColumns, ilike, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { actorColumns } from '../checklists/actor';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { escapeLike } from '../common/sql';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { assignmentAssignees, assignments, checklists, shiftRoster, shifts, sites } from '../db/schema';
import type { Actor } from './actor';
import { AssignmentRules } from './assignment-rules';
import type { AssignmentListQueryDto, CreateAssignmentDto, PreviewAssignmentDto } from './dto';
import { toAssignmentDto } from './mappers';
import { OccurrenceQueries } from './occurrence-queries';
import { OccurrenceWriter } from './occurrence-writer';
import { SchedulingScope } from './scheduling-scope';

/** What the audit log keeps for an assignment. */
export const auditView = (d: AssignmentDto) => ({
  name: d.name,
  checklistId: d.checklistId,
  siteId: d.siteId,
  schedule: d.schedule,
  timing: d.timing,
  assigneeIds: d.assignees.map((u) => u.id),
  status: d.status,
});

@Injectable()
export class AssignmentsService {
  constructor(
    protected readonly db: DbService,
    protected readonly audit: AuditService,
    protected readonly clock: Clock,
    protected readonly scope: SchedulingScope,
    protected readonly rules: AssignmentRules,
    protected readonly writer: OccurrenceWriter,
    protected readonly queries: OccurrenceQueries,
  ) {}

  async list(a: Actor, q: AssignmentListQueryDto): Promise<Page<AssignmentDto>> {
    const conds: (SQL | undefined)[] = [this.scope.assignments(a)];
    if (q.siteId) conds.push(eq(assignments.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(assignments.checklistId, q.checklistId));
    if (q.status) conds.push(eq(assignments.status, q.status));
    if (q.assigneeId) conds.push(sql`exists (select 1 from assignment_assignees aa where aa.assignment_id = ${assignments.id} and aa.user_id = ${q.assigneeId})`);
    if (q.q) {
      const pattern = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(assignments.name, pattern), ilike(checklists.name, pattern)));
    }
    if (q.cursor) conds.push(lt(assignments.id, q.cursor));
    const rows = await this.select().where(and(...conds)).orderBy(desc(assignments.id)).limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toAssignmentDto);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }

  async get(a: Actor, id: string): Promise<AssignmentDetail> {
    const [row] = await this.select().where(and(eq(assignments.id, id), this.scope.assignments(a)));
    if (!row) throw new AppError('NOT_FOUND');
    return { ...toAssignmentDto(row), upcoming: await this.queries.upcoming(id) };
  }

  async create(a: Actor, input: CreateAssignmentDto): Promise<AssignmentDetail> {
    await this.rules.site(a, input.siteId);
    await this.rules.checklist(input.checklistId);
    this.rules.schedule(input.schedule);
    const shift = await this.rules.shift(input.timing, input.siteId);
    this.rules.window(a, input.timing, shift);
    const assigneeIds = [...new Set(input.assigneeIds)];
    await this.rules.assignees(input.siteId, assigneeIds);
    this.rules.nonEmpty(input.schedule, input.timing, shift, await this.writer.tenantTimezone());

    const { tenantId } = this.db.context();
    const actor = actorColumns(this.db);
    const tx = this.db.tx();
    const [row] = await tx
      .insert(assignments)
      .values({
        tenantId,
        checklistId: input.checklistId,
        siteId: input.siteId,
        name: input.name || null,
        schedule: input.schedule,
        timing: input.timing,
        shiftId: input.timing.mode === 'shift' ? input.timing.shiftId : null,
        createdByUserId: actor.userId,
        createdByPlatformAdminId: actor.platformAdminId,
      })
      .returning({ id: assignments.id });
    const id = row!.id;
    await tx.insert(assignmentAssignees).values(assigneeIds.map((userId) => ({ tenantId, assignmentId: id, userId })));
    await this.writer.materialize(id);
    const dto = await this.get(a, id);
    await this.audit.record({ action: 'assignment.created', entityType: 'assignment', entityId: id, after: auditView(dto) });
    return dto;
  }

  async preview(a: Actor, input: PreviewAssignmentDto): Promise<AssignmentPreview> {
    await this.rules.site(a, input.siteId);
    this.rules.schedule(input.schedule);
    const shift = await this.rules.shift(input.timing, input.siteId);
    this.rules.window(a, input.timing, shift);
    const tz = await this.writer.tenantTimezone();
    const slots = this.rules.nextSlots(input.schedule, input.timing, shift, tz, SCHEDULING_LIMITS.previewSlots);
    const warnings: PreviewWarning[] = scheduleWarnings(input.schedule);
    if (input.timing.mode === 'shift' && input.assigneeIds?.length) {
      const today = localDateOf(this.clock.now(), tz);
      const [hit] = await this.db
        .tx()
        .select({ userId: shiftRoster.userId })
        .from(shiftRoster)
        .where(
          and(
            eq(shiftRoster.siteId, input.siteId),
            eq(shiftRoster.shiftId, input.timing.shiftId),
            inArray(shiftRoster.userId, input.assigneeIds),
            between(shiftRoster.date, today, addDays(today, SCHEDULING_LIMITS.horizonDays)),
          ),
        )
        .limit(1);
      if (!hit) warnings.push('NO_ROSTERED_ASSIGNEES');
    }
    return {
      slots: slots.map((s) => ({ localDate: s.localDate, startsAt: s.startsAt.toISOString(), dueAt: s.dueAt.toISOString(), closesAt: s.closesAt.toISOString() })),
      warnings,
    };
  }

  protected select() {
    return this.db
      .tx()
      .select({
        a: getTableColumns(assignments),
        checklistName: checklists.name,
        siteName: sites.name,
        shiftName: shifts.name,
        assignees: sql<{ id: string; fullName: string }[]>`coalesce((
          select json_agg(json_build_object('id', u.id, 'fullName', u.full_name) order by u.full_name, u.id)
          from assignment_assignees aa join users u on u.id = aa.user_id
          where aa.assignment_id = "assignments"."id"), '[]'::json)`,
      })
      .from(assignments)
      .innerJoin(checklists, eq(checklists.id, assignments.checklistId))
      .innerJoin(sites, eq(sites.id, assignments.siteId))
      .leftJoin(shifts, eq(shifts.id, assignments.shiftId))
      .$dynamic();
  }
}
```

`apps/api/src/scheduling/assignments.controller.ts`:

```ts
import { Body, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { AssignmentDetail, AssignmentDto, AssignmentPreview, Page } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { ParseIdPipe } from '../common/parse-id.pipe';
import { type Actor, CurrentActor } from './actor';
import { AssignmentsService } from './assignments.service';
import {
  AssignmentDetailResponse,
  AssignmentListQueryDto,
  AssignmentPageResponse,
  AssignmentPreviewResponse,
  CreateAssignmentDto,
  PreviewAssignmentDto,
} from './dto';

export function assignmentsControllerFor(mode: RouteMode) {
  const view = perm(mode, 'assignments.view');
  const manage = perm(mode, 'assignments.view', 'assignments.manage', 'checklists.view');

  @controllerDecorators(mode, 'assignments', 'scheduling')
  class AssignmentsController {
    constructor(@Inject(AssignmentsService) private readonly assignments: AssignmentsService) {}

    @Get()
    @view
    @ApiOkResponse({ type: AssignmentPageResponse })
    list(@CurrentActor() a: Actor, @Query() q: AssignmentListQueryDto): Promise<Page<AssignmentDto>> {
      return this.assignments.list(a, q);
    }

    @Post()
    @manage
    @ApiOkResponse({ type: AssignmentDetailResponse })
    create(@CurrentActor() a: Actor, @Body() body: CreateAssignmentDto): Promise<AssignmentDetail> {
      return this.assignments.create(a, body);
    }

    @Post('preview')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: AssignmentPreviewResponse })
    preview(@CurrentActor() a: Actor, @Body() body: PreviewAssignmentDto): Promise<AssignmentPreview> {
      return this.assignments.preview(a, body);
    }

    @Get(':id')
    @view
    @ApiOkResponse({ type: AssignmentDetailResponse })
    get(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AssignmentDetail> {
      return this.assignments.get(a, id);
    }
  }
  return named(AssignmentsController, mode === 'tenant' ? 'AssignmentsController' : 'PlatformTenantAssignmentsController');
}

export const TenantAssignmentsController = assignmentsControllerFor('tenant');
export const PlatformTenantAssignmentsController = assignmentsControllerFor('platform');
```

In `scheduling.module.ts`:
- Add `TenantAssignmentsController` and `PlatformTenantAssignmentsController` to `controllers`.
- Add `OccurrenceWriter`, `OccurrenceQueries`, `AssignmentRules` and `AssignmentsService` to `providers`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- test/assignments.test.ts roster shifts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/scheduling apps/api/test/assignments.test.ts
git commit -m "feat(api): create assignments and materialise occurrences with snapshots"
```

---

### Task 11: Changing assignments, and keeping snapshots in step with rosters, users and checklists

**Files:**
- Create: `apps/api/src/scheduling/scheduling-listeners.ts`
- Modify: `apps/api/src/scheduling/assignments.service.ts`, `assignments.controller.ts`, `shifts.service.ts`, `scheduling.module.ts`
- Test: `apps/api/test/assignment-changes.test.ts`

**Interfaces:**
- Consumes: `OccurrenceWriter` (Task 10); the events `roster.changed`, `user.access_changed` and `checklist.deactivated` (Tasks 7 and 9).
- Produces:
  - `AssignmentsService`: `update(a, id, input)`, `pause(a, id)`, `resume(a, id)`, `end(a, id)`
  - Routes: `PUT /assignments/:id`, `POST /assignments/:id/{pause,resume,end}`
  - `SchedulingListeners`, registered in `onModuleInit`
  - `ShiftsService.update` regenerates the active assignments that use a shift when its hours change

- [ ] **Step 1: Write the failing test**

`apps/api/test/assignment-changes.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, fixed, live, MONDAY_0800, occurrenceRows, schedulingWorld, TODAY } from './scheduling-fixtures';

const sorted = (ids: string[]) => [...ids].sort();

describe('changing assignments', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('edit keeps the open occurrence and does not duplicate today', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    clock.set('2026-11-02T04:30:00Z'); // 08:30: today's 08:00 occurrence is open
    const res = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, timing: fixed('09:00') });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.revision).toBe(2);
    const rows = await occurrenceRows(a.id);
    const today = rows.filter((r) => r.local_date === TODAY);
    expect(today.map((r) => [r.status, r.starts_at.toISOString()])).toEqual([['pending', '2026-11-02T04:00:00.000Z']]);
    const cancelled = rows.filter((r) => r.status === 'cancelled');
    expect(cancelled).toHaveLength(14);
    expect(cancelled.every((r) => r.cancel_reason === 'assignment_edited')).toBe(true);
    const future = live(rows).filter((r) => r.local_date > TODAY);
    expect(future).toHaveLength(14);
    expect(future[0]!.starts_at.toISOString()).toBe('2026-11-03T05:00:00.000Z');

    const stale = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, name: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2 });
  });

  it('a name-only edit regenerates nothing; an assignee-only edit refreshes future snapshots', async () => {
    const w = await schedulingWorld(t);
    const [w0] = w.workers as [string, string];
    const a = await createAssignment(w);
    await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 1, name: 'Yeni ad' });
    expect((await occurrenceRows(a.id)).filter((r) => r.status === 'cancelled')).toHaveLength(0);
    clock.set('2026-11-02T04:30:00Z');
    const res = await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 2, assigneeIds: [w0] });
    expect(res.body.assignees.map((u: { id: string }) => u.id)).toEqual([w0]);
    const rows = await occurrenceRows(a.id);
    expect(rows[0]!.assignees).toEqual(sorted(w.workers)); // open: snapshot frozen
    expect(rows.slice(1).every((r) => r.assignees.length === 1 && r.assignees[0] === w0)).toBe(true);
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1 order by occurred_at, id', [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['assignment.created', 'assignment.updated', 'assignment.updated']);
  });

  it('pauses, resumes from now on, and ends for good', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    clock.set('2026-11-02T04:30:00Z');
    expect((await w.api.post(`/api/v1/assignments/${a.id}/pause`)).body.status).toBe('paused');
    let rows = await occurrenceRows(a.id);
    expect(live(rows).map((r) => r.local_date)).toEqual([TODAY]);
    expect(rows.filter((r) => r.cancel_reason === 'assignment_paused')).toHaveLength(14);

    clock.set('2026-11-03T04:30:00Z'); // Tuesday 08:30: today's slot already started, so it is not recreated
    const resumed = await w.api.post(`/api/v1/assignments/${a.id}/resume`);
    expect(resumed.body).toMatchObject({ status: 'active', revision: 3 });
    rows = await occurrenceRows(a.id);
    expect(live(rows).map((r) => r.local_date)).toEqual([TODAY, ...Array.from({ length: 14 }, (_, i) => `2026-11-${String(4 + i).padStart(2, '0')}`)]);

    expect((await w.api.post(`/api/v1/assignments/${a.id}/end`)).body.status).toBe('ended');
    expect((await w.api.post(`/api/v1/assignments/${a.id}/resume`)).body.error.code).toBe('ASSIGNMENT_ENDED');
    expect((await w.api.put(`/api/v1/assignments/${a.id}`, { revision: 4, name: 'x' })).body.error.code).toBe('ASSIGNMENT_ENDED');
    const audit = await ownerQuery<{ action: string }>("select action from audit_log where entity_id = $1 and action <> 'assignment.created' order by occurred_at, id", [a.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['assignment.paused', 'assignment.resumed', 'assignment.ended']);
  });

  it('auto-pauses when the checklist is deactivated and does not resume on reactivation', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    await w.api.post(`/api/v1/checklists/${w.checklistId}/deactivate`);
    expect((await w.api.get(`/api/v1/assignments/${a.id}`)).body.status).toBe('paused');
    const rows = await occurrenceRows(a.id);
    expect(rows.filter((r) => r.cancel_reason === 'checklist_deactivated')).toHaveLength(14);
    await w.api.post(`/api/v1/checklists/${w.checklistId}/reactivate`);
    expect((await w.api.get(`/api/v1/assignments/${a.id}`)).body.status).toBe('paused');
    const audit = await ownerQuery<{ action: string }>("select action from audit_log where entity_id = $1 and action = 'assignment.auto_paused'", [a.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('user access changes refresh snapshots and future roster rows', async () => {
    const w = await schedulingWorld(t);
    const [w0, w1] = w.workers as [string, string];
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: TODAY,
      to: '2026-11-08',
      rows: ['2026-11-02', '2026-11-03', '2026-11-04'].flatMap((date) => [
        { userId: w0, shiftId: shift, date },
        { userId: w1, shiftId: shift, date },
      ]),
    });
    const fixedA = await createAssignment(w);
    const shiftA = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } });

    clock.set('2026-11-02T04:30:00Z');
    await w.api.post(`/api/v1/users/${w1}/deactivate`);
    let rows = await occurrenceRows(fixedA.id);
    expect(rows[0]!.assignees).toEqual(sorted([w0, w1])); // open: unchanged
    expect(rows[1]!.assignees).toEqual([w0]);
    // Deactivation also dropped w1's roster rows from today on.
    const deactivatedRoster = await ownerQuery<{ n: number }>('select count(*)::int as n from shift_roster where user_id = $1', [w1]);
    expect(deactivatedRoster.rows[0]!.n).toBe(0);
    await w.api.post(`/api/v1/users/${w1}/reactivate`);
    expect((await occurrenceRows(fixedA.id))[1]!.assignees).toEqual(sorted([w0, w1]));

    // Re-roster w1, then move them to the other site: their roster rows and future snapshots go.
    await w.api.put('/api/v1/roster', {
      siteId: w.siteId,
      from: '2026-11-03',
      to: '2026-11-04',
      rows: ['2026-11-03', '2026-11-04'].flatMap((date) => [
        { userId: w0, shiftId: shift, date },
        { userId: w1, shiftId: shift, date },
      ]),
    });
    expect((await occurrenceRows(shiftA.id))[1]!.assignees).toEqual(sorted([w0, w1]));
    await w.api.put(`/api/v1/users/${w1}/sites`, { siteIds: [w.otherSiteId] });
    const roster = await ownerQuery<{ n: number }>('select count(*)::int as n from shift_roster where user_id = $1', [w1]);
    expect(roster.rows[0]!.n).toBe(0);
    rows = await occurrenceRows(shiftA.id);
    expect(rows[1]!.assignees).toEqual([w0]);
    expect(rows[3]!.assignees).toEqual([]);
    expect((await occurrenceRows(fixedA.id))[1]!.assignees).toEqual([w0]);
  });

  it('a roster change refreshes shift-based snapshots for that site and range', async () => {
    const w = await schedulingWorld(t);
    const [, w1] = w.workers as [string, string];
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const a = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } });
    expect((await occurrenceRows(a.id))[3]!.assignees).toEqual([]);
    await w.api.put('/api/v1/roster', { siteId: w.siteId, from: '2026-11-05', to: '2026-11-05', rows: [{ userId: w1, shiftId: shift, date: '2026-11-05' }] });
    expect((await occurrenceRows(a.id))[3]!.assignees).toEqual([w1]);
  });

  it('regenerates future occurrences when a shift’s hours change', async () => {
    const w = await schedulingWorld(t);
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    const a = await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } });
    clock.set('2026-11-02T04:30:00Z');
    await w.api.patch(`/api/v1/shifts/${shift}`, { startTime: '09:00', endTime: '17:00' });
    const rows = await occurrenceRows(a.id);
    expect(rows.filter((r) => r.cancel_reason === 'shift_changed')).toHaveLength(14);
    expect(live(rows).find((r) => r.local_date === '2026-11-03')!.starts_at.toISOString()).toBe('2026-11-03T05:00:00.000Z');
    // A rename alone regenerates nothing.
    await w.api.patch(`/api/v1/shifts/${shift}`, { name: 'Səhər növbəsi' });
    expect((await occurrenceRows(a.id)).filter((r) => r.status === 'cancelled')).toHaveLength(14);
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- assignment-changes`
Expected: FAIL: `PUT /api/v1/assignments/:id` returns 404.

- [ ] **Step 3: Add update, pause, resume and end**

Add to `AssignmentsService` (extend the imports with `timingSchema` and `type CancelReasonCode` from contracts, `sameJson` from `./mappers`, and `UpdateAssignmentDto` from `./dto`):

```ts
  async update(a: Actor, id: string, input: UpdateAssignmentDto): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status === 'ended') throw new AppError('ASSIGNMENT_ENDED');
    if (row.revision !== input.revision) throw new AppError('REVISION_CONFLICT', { details: { currentRevision: row.revision } });
    const before = await this.get(a, id);
    const schedule = input.schedule ?? before.schedule;
    const timing = input.timing ?? before.timing;
    const scheduleChanged = !sameJson(schedule, before.schedule);
    const timingChanged = !sameJson(timing, before.timing);
    const currentIds = before.assignees.map((u) => u.id).sort();
    const assigneeIds = input.assigneeIds ? [...new Set(input.assigneeIds)].sort() : currentIds;
    const assigneesChanged = !sameJson(assigneeIds, currentIds);
    if (scheduleChanged || timingChanged) {
      this.rules.schedule(schedule);
      const shift = await this.rules.shift(timing, row.siteId);
      this.rules.window(a, timing, shift);
      this.rules.nonEmpty(schedule, timing, shift, await this.writer.tenantTimezone());
    }
    if (assigneesChanged) await this.rules.assignees(row.siteId, assigneeIds);

    const tx = this.db.tx();
    await tx
      .update(assignments)
      .set({
        name: input.name === undefined ? undefined : input.name || null,
        schedule,
        timing,
        shiftId: timing.mode === 'shift' ? timing.shiftId : null,
        revision: row.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(assignments.id, id));
    if (assigneesChanged) {
      await tx.delete(assignmentAssignees).where(eq(assignmentAssignees.assignmentId, id));
      await tx.insert(assignmentAssignees).values(assigneeIds.map((userId) => ({ tenantId: row.tenantId, assignmentId: id, userId })));
    }
    if (row.status === 'active') {
      if (scheduleChanged || timingChanged) await this.writer.regenerate(id, 'assignment_edited');
      else if (assigneesChanged) await this.writer.refreshSnapshots({ assignmentId: id });
    }
    const after = await this.get(a, id);
    await this.audit.record({ action: 'assignment.updated', entityType: 'assignment', entityId: id, before: auditView(before), after: auditView(after) });
    return after;
  }

  async pause(a: Actor, id: string): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status === 'ended') throw new AppError('ASSIGNMENT_ENDED');
    if (row.status === 'active') {
      await this.writer.cancelFuturePending(id, 'assignment_paused');
      await this.setStatus(row, 'paused', 'assignment.paused');
    }
    return this.get(a, id);
  }

  /** Re-checks spec §4.2, then generates from now on. */
  async resume(a: Actor, id: string): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status === 'ended') throw new AppError('ASSIGNMENT_ENDED');
    if (row.status === 'paused') {
      await this.rules.checklist(row.checklistId);
      await this.rules.site(a, row.siteId);
      await this.rules.shift(timingSchema.parse(row.timing), row.siteId);
      const ids = await this.db.tx().select({ userId: assignmentAssignees.userId }).from(assignmentAssignees).where(eq(assignmentAssignees.assignmentId, id));
      await this.rules.assignees(row.siteId, ids.map((r) => r.userId));
      await this.setStatus(row, 'active', 'assignment.resumed');
      await this.writer.restart(id);
    }
    return this.get(a, id);
  }

  async end(a: Actor, id: string): Promise<AssignmentDetail> {
    const row = await this.lockWritable(a, id);
    if (row.status !== 'ended') {
      await this.writer.cancelFuturePending(id, 'assignment_ended');
      await this.setStatus(row, 'ended', 'assignment.ended');
    }
    return this.get(a, id);
  }

  private async lockWritable(a: Actor, id: string): Promise<typeof assignments.$inferSelect> {
    const [row] = await this.db.tx().select().from(assignments).where(and(eq(assignments.id, id), this.scope.assignments(a))).for('update');
    if (!row) throw new AppError('NOT_FOUND');
    await this.scope.assertSiteWritable(a, row.siteId);
    return row;
  }

  private async setStatus(row: typeof assignments.$inferSelect, status: 'active' | 'paused' | 'ended', action: string): Promise<void> {
    await this.db.tx().update(assignments).set({ status, revision: row.revision + 1, updatedAt: new Date() }).where(eq(assignments.id, row.id));
    await this.audit.record({ action, entityType: 'assignment', entityId: row.id, before: { status: row.status }, after: { status } });
  }
```

Add to the controller (import `Put` and `UpdateAssignmentDto`):

```ts
    @Put(':id')
    @manage
    @ApiOkResponse({ type: AssignmentDetailResponse })
    update(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: UpdateAssignmentDto): Promise<AssignmentDetail> {
      return this.assignments.update(a, id, body);
    }

    @Post(':id/pause')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: AssignmentDetailResponse })
    pause(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AssignmentDetail> {
      return this.assignments.pause(a, id);
    }

    @Post(':id/resume')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: AssignmentDetailResponse })
    resume(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AssignmentDetail> {
      return this.assignments.resume(a, id);
    }

    @Post(':id/end')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: AssignmentDetailResponse })
    end(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<AssignmentDetail> {
      return this.assignments.end(a, id);
    }
```

- [ ] **Step 4: Add the listeners and the shift-hours regeneration**

`apps/api/src/scheduling/scheduling-listeners.ts`:

```ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { localDateOf } from '@taskop/contracts';
import { and, eq, gte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainEvents } from '../common/domain-events';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { assignments, shiftRoster } from '../db/schema';
import { OccurrenceWriter } from './occurrence-writer';

/** Keeps occurrences in step with changes made elsewhere (spec §5.1, §5.3). Handlers run in the caller's transaction. */
@Injectable()
export class SchedulingListeners implements OnModuleInit {
  constructor(
    private readonly events: DomainEvents,
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: OccurrenceWriter,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.events.on('roster.changed', (e) => this.writer.refreshSnapshots({ siteId: e.siteId, from: e.from, to: e.to }));
    this.events.on('user.access_changed', (e) => this.onUserAccessChanged(e.userId));
    this.events.on('checklist.deactivated', (e) => this.onChecklistDeactivated(e.checklistId));
  }

  /** Deactivated, reactivated or moved between sites: drop roster rows they can no longer work, then refresh. */
  private async onUserAccessChanged(userId: string): Promise<void> {
    const today = localDateOf(this.clock.now(), await this.writer.tenantTimezone());
    await this.db
      .tx()
      .delete(shiftRoster)
      .where(
        and(
          eq(shiftRoster.userId, userId),
          gte(shiftRoster.date, today),
          sql`(not exists (select 1 from users u where u.id = ${userId} and u.status = 'active')
            or not exists (select 1 from user_sites us where us.user_id = ${userId} and us.site_id = ${shiftRoster.siteId}))`,
        ),
      );
    await this.writer.refreshSnapshots({ userId });
  }

  /** Spec §5.3: pause the checklist's active assignments; reactivating the checklist does not resume them. */
  private async onChecklistDeactivated(checklistId: string): Promise<void> {
    const paused = await this.db
      .tx()
      .update(assignments)
      .set({ status: 'paused', revision: sql`${assignments.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(assignments.checklistId, checklistId), eq(assignments.status, 'active')))
      .returning({ id: assignments.id });
    for (const { id } of paused) {
      await this.writer.cancelFuturePending(id, 'checklist_deactivated');
      await this.audit.record({
        action: 'assignment.auto_paused',
        entityType: 'assignment',
        entityId: id,
        before: { status: 'active' },
        after: { status: 'paused', reason: 'checklist_deactivated' },
      });
    }
  }
}
```

In `ShiftsService`:
- Inject `OccurrenceWriter` (constructor parameter `private readonly writer: OccurrenceWriter`).
- Import `assignments` from the schema.
- In `update`, after `const after = await this.get(id);` and before the audit record, add:

```ts
    if (after.startTime !== before.startTime || after.endTime !== before.endTime) {
      const using = await this.db
        .tx()
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.shiftId, id), eq(assignments.status, 'active')));
      for (const a of using) await this.writer.regenerate(a.id, 'shift_changed');
    }
```

In `scheduling.module.ts`, add `SchedulingListeners` to `providers`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- assignment-changes test/assignments.test.ts shifts roster domain-events`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/scheduling apps/api/test/assignment-changes.test.ts
git commit -m "feat(api): edit, pause, resume and end assignments; refresh snapshots on roster, user and checklist changes"
```

---
### Task 12: Background jobs: materialise and sweep, wired to pg-boss

**Files:**
- Create: `apps/api/src/scheduling/occurrence-jobs.ts`, `apps/api/src/scheduling/jobs.service.ts`
- Modify: `apps/api/package.json` (adds `pg-boss`), `apps/api/src/config/config.ts`, `apps/api/.env.example`, `apps/api/src/scheduling/occurrence-writer.ts`, `apps/api/src/scheduling/scheduling.module.ts`
- Test: `apps/api/test/occurrence-jobs.test.ts`

**Interfaces:**
- Consumes: `OccurrenceWriter.materialize` and `recordTransitions`; `DbService.platform`, which bypasses RLS, to find tenants with work.
- Produces:
  - `OccurrenceJobs`:
    - `materializeAll(only?: string[]): Promise<number>`
    - `sweepAll(only?: string[]): Promise<number>`
    - `sweepTenant(now: Date): Promise<number>`
    - `only` limits the run to those tenants (tests, support). The cron passes nothing.
  - `JobsService`:
    - `QUEUES = { materialize: 'occurrences.materialize', sweep: 'occurrences.sweep', dead: 'occurrences.dead' }`
    - `runNow(queue, tenantIds?)`
    - On boot, if `JOBS_ENABLED`, it starts pg-boss on `DATABASE_APP_URL`, schema `pgboss`, and creates the queues (`singleton`, `retryLimit: 3`, `retryBackoff`, dead letter queue). If `JOBS_CRON`, it schedules materialise every 15 minutes and sweep every minute (`missed: 'once'`) and queues one materialise run immediately.
  - Config: `JOBS_ENABLED` (default `true`) and `JOBS_CRON` (default `true`). The test env sets `JOBS_ENABLED=false` (Task 7).

- [ ] **Step 1: Write the failing test**

`apps/api/test/occurrence-jobs.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEvents } from '../src/common/domain-events';
import { JobsService, QUEUES } from '../src/scheduling/jobs.service';
import { OccurrenceJobs } from '../src/scheduling/occurrence-jobs';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { ownerQuery } from './owner-db';
import { createAssignment, fixed, live, MONDAY_0800, occurrenceRows, schedulingWorld } from './scheduling-fixtures';

const historyOf = async (occurrenceId: string) =>
  (
    await ownerQuery<{ from_status: string | null; to_status: string; at: Date; actor_user_id: string | null }>(
      'select from_status, to_status, at, actor_user_id from occurrence_status_history where occurrence_id = $1 order by at, id',
      [occurrenceId],
    )
  ).rows.map((r) => [r.from_status, r.to_status, r.at.toISOString(), r.actor_user_id === null ? 'system' : 'user']);

describe('occurrence jobs', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let jobs: OccurrenceJobs;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    jobs = t.app.get(OccurrenceJobs);
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('extends the horizon by a day when time moves on, and is idempotent', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    clock.set('2026-11-03T04:00:00Z');
    expect(await jobs.materializeAll([w.s.tenantId])).toBe(1);
    expect(await jobs.materializeAll([w.s.tenantId])).toBe(0);
    const rows = await occurrenceRows(a.id);
    expect(rows).toHaveLength(16);
    expect(rows.at(-1)!.local_date).toBe('2026-11-17');
  });

  it('a cancelled slot is never recreated by the cron', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const second = (await occurrenceRows(a.id))[1]!;
    await ownerQuery("update occurrences set status = 'cancelled', cancel_reason = 'Bayram' where id = $1", [second.id]);
    clock.set('2026-11-03T04:00:00Z');
    await jobs.materializeAll([w.s.tenantId]);
    const rows = live(await occurrenceRows(a.id));
    expect(rows.map((r) => r.local_date)).not.toContain('2026-11-03');
    expect(rows).toHaveLength(15);
  });

  it('moves pending → overdue → missed with history at the real due and close times', async () => {
    const w = await schedulingWorld(t);
    const first = (await occurrenceRows((await createAssignment(w)).id))[0]!;
    clock.set('2026-11-02T06:30:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    clock.set('2026-11-02T07:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(1);
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(0);
    expect(await historyOf(first.id)).toEqual([
      [null, 'pending', '2026-11-02T04:00:00.000Z', 'user'],
      ['pending', 'overdue', '2026-11-02T06:00:00.000Z', 'system'],
      ['overdue', 'missed', '2026-11-02T07:00:00.000Z', 'system'],
    ]);
    const row = await ownerQuery<{ status: string; status_changed_at: Date }>('select status, status_changed_at from occurrences where id = $1', [first.id]);
    expect(row.rows[0]).toMatchObject({ status: 'missed', status_changed_at: new Date('2026-11-02T07:00:00Z') });
  });

  it('jumps straight to missed with two history rows after downtime', async () => {
    const w = await schedulingWorld(t);
    const rows = await occurrenceRows((await createAssignment(w)).id);
    clock.set('2026-11-03T12:00:00Z');
    expect(await jobs.sweepAll([w.s.tenantId])).toBe(2);
    expect(await historyOf(rows[0]!.id)).toEqual([
      [null, 'pending', '2026-11-02T04:00:00.000Z', 'user'],
      ['pending', 'overdue', '2026-11-02T06:00:00.000Z', 'system'],
      ['overdue', 'missed', '2026-11-02T07:00:00.000Z', 'system'],
    ]);
    expect((await historyOf(rows[1]!.id)).slice(1).map((h) => h[1])).toEqual(['overdue', 'missed']);
  });

  it('records a single pending → missed when there is no grace period', async () => {
    const w = await schedulingWorld(t);
    const first = (await occurrenceRows((await createAssignment(w, { timing: fixed('08:00', 120, 0) })).id))[0]!;
    clock.set('2026-11-02T06:00:00Z');
    await jobs.sweepAll([w.s.tenantId]);
    expect((await historyOf(first.id)).slice(1)).toEqual([['pending', 'missed', '2026-11-02T06:00:00.000Z', 'system']]);
  });

  it('emits occurrence.status_changed for every transition', async () => {
    const w = await schedulingWorld(t);
    await createAssignment(w);
    const seen: string[] = [];
    const off = t.app.get(DomainEvents).on('occurrence.status_changed', (e) => {
      if (e.tenantId === w.s.tenantId && e.from) seen.push(`${e.from}->${e.to}`);
    });
    try {
      clock.set('2026-11-02T06:30:00Z');
      await jobs.sweepAll([w.s.tenantId]);
    } finally {
      off();
    }
    expect(seen).toEqual(['pending->overdue']);
  });

  it('one tenant failing does not block the others', async () => {
    const bad = await schedulingWorld(t);
    const badA = await createAssignment(bad);
    await ownerQuery(`update assignments set schedule = '{"kind":"bogus"}'::jsonb where id = $1`, [badA.id]);
    const good = await schedulingWorld(t);
    const goodA = await createAssignment(good);
    clock.set('2026-11-03T04:00:00Z');
    await expect(jobs.materializeAll([bad.s.tenantId, good.s.tenantId])).rejects.toThrow(/1 tenant/);
    expect(await occurrenceRows(goodA.id)).toHaveLength(16);
  });
});

describe('pg-boss wiring', () => {
  it('runs a sweep through a real queue', async () => {
    const clock = new FakeClock(MONDAY_0800);
    const t = await createTestApp({ JOBS_ENABLED: 'true', JOBS_CRON: 'false' }, { clock });
    try {
      const w = await schedulingWorld(t);
      const first = (await occurrenceRows((await createAssignment(w)).id))[0]!;
      clock.set('2026-11-02T06:30:00Z');
      await t.app.get(JobsService).runNow(QUEUES.sweep, [w.s.tenantId]);
      await expect
        .poll(async () => (await ownerQuery<{ status: string }>('select status from occurrences where id = $1', [first.id])).rows[0]!.status, {
          timeout: 20_000,
          interval: 250,
        })
        .toBe('overdue');
    } finally {
      await t.close();
    }
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- occurrence-jobs`
Expected: FAIL: `../src/scheduling/jobs.service` does not exist.

- [ ] **Step 3: Install pg-boss and add the config**

```bash
pnpm --filter @taskop/api add pg-boss@latest
```

pg-boss 12 is ESM-only. The API builds to CommonJS, and Node 24 `require()`s ES modules natively, so a normal `import { PgBoss } from 'pg-boss'` works. If `pnpm --filter @taskop/api build && pnpm --filter @taskop/api start` fails with `ERR_REQUIRE_ASYNC_MODULE`, load it with `const { PgBoss } = await import('pg-boss')` inside `onApplicationBootstrap` and keep only `import type` at the top.

In `apps/api/src/config/config.ts`, add to `configSchema`:

```ts
  /** Start pg-boss workers (spec §5). Tests turn it off and call OccurrenceJobs directly. */
  JOBS_ENABLED: z.stringbool().default(true),
  /** Register the cron schedules. Off for tests that start workers but must not touch other tenants. */
  JOBS_CRON: z.stringbool().default(true),
```

Append to `apps/api/.env.example`:

```
# Background jobs (pg-boss in the "pgboss" schema): materialise occurrences every 15 min, sweep statuses every minute.
JOBS_ENABLED=true
JOBS_CRON=true
```

- [ ] **Step 4: Stop `materialized_until` moving backwards**

`restart` sets `materialized_until` deliberately. A cron run with a stale clock must never pull it back. In `OccurrenceWriter.materialize`, replace the `materializedUntil` update with:

```ts
    const horizon = zonedTimeToUtc(addDays(today, SCHEDULING_LIMITS.horizonDays + 1), 0, tz);
    await tx
      .update(assignments)
      .set({ materializedUntil: until && until > horizon ? until : horizon })
      .where(eq(assignments.id, a.id));
```

- [ ] **Step 5: Implement the jobs**

`apps/api/src/scheduling/occurrence-jobs.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { OccurrenceStatus } from '@taskop/contracts';
import { eq, type SQL, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { sanitiseForLog } from '../common/error.filter';
import { DbService } from '../db/db.service';
import { assignments } from '../db/schema';
import { OccurrenceWriter, type Transition } from './occurrence-writer';

interface SweptRow extends Record<string, unknown> {
  id: string;
  from_status: Extract<OccurrenceStatus, 'pending' | 'overdue'>;
  to_status: Extract<OccurrenceStatus, 'overdue' | 'missed'>;
  due_at: Date;
  closes_at: Date;
}

/** The bodies of the two cron jobs (spec §5.1, §5.2). One transaction per tenant, with RLS. */
@Injectable()
export class OccurrenceJobs {
  private readonly logger = new Logger('OccurrenceJobs');

  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly writer: OccurrenceWriter,
  ) {}

  /** Keeps every active assignment materialised 14 days ahead. */
  async materializeAll(only?: string[]): Promise<number> {
    const tenantIds = await this.tenantsWith(sql`select distinct tenant_id from assignments where status = 'active'`, only);
    return this.perTenant(tenantIds, async () => {
      const rows = await this.db.tx().select({ id: assignments.id }).from(assignments).where(eq(assignments.status, 'active'));
      let created = 0;
      for (const r of rows) created += await this.writer.materialize(r.id);
      return created;
    });
  }

  /** pending → overdue after due_at; pending | overdue → missed after closes_at. */
  async sweepAll(only?: string[]): Promise<number> {
    const now = this.clock.now();
    const tenantIds = await this.tenantsWith(
      sql`select distinct tenant_id from occurrences
          where (status = 'pending' and due_at <= ${now}) or (status = 'overdue' and closes_at <= ${now})`,
      only,
    );
    return this.perTenant(tenantIds, () => this.sweepTenant(now));
  }

  /** Guarded by the current status and SKIP LOCKED, so two runs never double-move a row. */
  async sweepTenant(now: Date): Promise<number> {
    const result = await this.db.tx().execute<SweptRow>(sql`
      with due as (
        select id, status, due_at, closes_at from occurrences
        where (status = 'pending' and due_at <= ${now}) or (status = 'overdue' and closes_at <= ${now})
        for update skip locked
      )
      update occurrences o
         set status = (case when due.closes_at <= ${now} then 'missed' else 'overdue' end)::occurrence_status,
             status_changed_at = case when due.closes_at <= ${now} then due.closes_at else due.due_at end,
             updated_at = ${now}
        from due
       where o.id = due.id
      returning o.id, due.status as from_status, o.status as to_status, due.due_at, due.closes_at`);
    const transitions: Transition[] = [];
    for (const r of result.rows) {
      if (r.from_status === 'pending' && r.to_status === 'missed' && r.due_at < r.closes_at) {
        // Down across the whole window: record both steps at their real times.
        transitions.push(
          { occurrenceId: r.id, from: 'pending', to: 'overdue', at: r.due_at },
          { occurrenceId: r.id, from: 'overdue', to: 'missed', at: r.closes_at },
        );
      } else {
        transitions.push({ occurrenceId: r.id, from: r.from_status, to: r.to_status, at: r.to_status === 'missed' ? r.closes_at : r.due_at });
      }
    }
    await this.writer.recordTransitions(transitions);
    return result.rows.length;
  }

  private async tenantsWith(query: SQL, only?: string[]): Promise<string[]> {
    const r = await this.db.platform.execute<{ tenant_id: string }>(query);
    const ids = r.rows.map((x) => x.tenant_id);
    return only ? ids.filter((id) => only.includes(id)) : ids;
  }

  /** One tenant's bad data never blocks the others; the job still fails afterwards so pg-boss retries it. */
  private async perTenant(tenantIds: string[], fn: () => Promise<number>): Promise<number> {
    let total = 0;
    let failed = 0;
    for (const tenantId of tenantIds) {
      try {
        total += await this.db.withTenant(tenantId, null, fn);
      } catch (e) {
        failed++;
        this.logger.error(sanitiseForLog(e, null), `Scheduling job failed for tenant ${tenantId}`);
      }
    }
    if (failed) throw new Error(`Scheduling job failed for ${failed} tenant(s)`);
    return total;
  }
}
```

`apps/api/src/scheduling/jobs.service.ts`:

```ts
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PgBoss, type Queue } from 'pg-boss';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { OccurrenceJobs } from './occurrence-jobs';

export const QUEUES = { materialize: 'occurrences.materialize', sweep: 'occurrences.sweep', dead: 'occurrences.dead' } as const;
type WorkQueue = typeof QUEUES.materialize | typeof QUEUES.sweep;

interface JobData {
  tenantIds?: string[];
}

/** pg-boss lifecycle (spec §5): queues, cron schedules and workers. pg-boss owns the `pgboss` schema. */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('JobsService');
  private boss: PgBoss | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ops: OccurrenceJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.JOBS_ENABLED) return;
    const boss = new PgBoss({ connectionString: this.config.DATABASE_APP_URL, schema: 'pgboss', createSchema: false, application_name: 'taskop-jobs' });
    boss.on('error', (err) => this.logger.error(`pg-boss: ${String(err)}`));
    await boss.start();
    await this.ensureQueue(boss, QUEUES.dead);
    for (const name of [QUEUES.materialize, QUEUES.sweep]) {
      await this.ensureQueue(boss, name, { policy: 'singleton', retryLimit: 3, retryBackoff: true, deadLetter: QUEUES.dead });
    }
    await boss.work<JobData>(QUEUES.materialize, async ([job]) => {
      await this.ops.materializeAll(job?.data?.tenantIds);
    });
    await boss.work<JobData>(QUEUES.sweep, async ([job]) => {
      await this.ops.sweepAll(job?.data?.tenantIds);
    });
    await boss.work(QUEUES.dead, async (jobs) => {
      for (const j of jobs) this.logger.error(`Scheduling job ${j.id} failed after all retries`);
    });
    if (this.config.JOBS_CRON) {
      await boss.schedule(QUEUES.materialize, '*/15 * * * *', null, { tz: 'UTC', missed: 'once' });
      await boss.schedule(QUEUES.sweep, '* * * * *', null, { tz: 'UTC', missed: 'once' });
      // A freshly started API catches up at once instead of waiting for the next quarter hour.
      await boss.send(QUEUES.materialize, {});
    }
    this.boss = boss;
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
    this.boss = null;
  }

  /** Queues a run now; `tenantIds` limits it to those tenants. */
  async runNow(queue: WorkQueue, tenantIds?: string[]): Promise<void> {
    if (!this.boss) throw new Error('Background jobs are disabled');
    await this.boss.send(queue, tenantIds ? { tenantIds } : {});
  }

  private async ensureQueue(boss: PgBoss, name: string, options: Omit<Queue, 'name'> = {}): Promise<void> {
    if (!(await boss.getQueue(name))) await boss.createQueue(name, options);
  }
}
```

In `scheduling.module.ts`, add `OccurrenceJobs` and `JobsService` to `providers`.

- [ ] **Step 6: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- occurrence-jobs config`
Expected: PASS. The pg-boss wiring test takes a few seconds while the worker polls.

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/.env.example apps/api/src/config/config.ts apps/api/src/scheduling apps/api/test/occurrence-jobs.test.ts
git commit -m "feat(api): materialise and sweep occurrences with pg-boss cron jobs"
```

---

### Task 13: Occurrences API, "my occurrences" and `canStart`

**Files:**
- Create: `apps/api/src/scheduling/occurrences.service.ts`, `apps/api/src/scheduling/occurrences.controller.ts`, `apps/api/src/scheduling/eligibility.service.ts`
- Modify: `apps/api/src/scheduling/mappers.ts`, `dto.ts`, `scheduling.module.ts`
- Test: `apps/api/test/occurrences.test.ts`

**Interfaces:**
- Consumes: `OccurrenceQueries`, `OccurrenceWriter.recordTransitions`, `SchedulingScope.occurrences` and `assertSiteWritable`.
- Produces:
  - `OccurrencesService`: `list(a, q)`, `listMine(p, q)`, `get(a, id)`, `cancel(a, id, input)`
  - `EligibilityService.canStart(occurrenceId, userId, at): Promise<CanStartResult>`, where:
    - `CanStartResult = { ok: true; late: boolean } | { ok: false; reason: 'NOT_FOUND' | 'NOT_ASSIGNED' | 'NOT_STARTABLE' | 'NOT_YET_OPEN' | 'CLOSED' | 'NOT_ON_SHIFT' }`
    - It is exported from `SchedulingModule` for sub-project 4.
  - Routes:
    - `GET /occurrences`, `GET /occurrences/:id`, `POST /occurrences/:id/cancel` (tenant and platform)
    - `GET /me/occurrences` (tenant only; any authenticated user)

- [ ] **Step 1: Write the failing test**

`apps/api/test/occurrences.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbService } from '../src/db/db.service';
import { EligibilityService } from '../src/scheduling/eligibility.service';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginWorker } from './fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, MONDAY_0800, occurrenceRows, schedulingWorld, TODAY } from './scheduling-fixtures';

const RANGE = `from=${TODAY}&to=2026-11-30`;

describe('occurrences', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
  });
  beforeEach(() => clock.set(MONDAY_0800));
  afterAll(() => t.close());

  it('lists in start order and pages with a cursor', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await w.api.get(`/api/v1/occurrences?${RANGE}&assignmentId=${a.id}&limit=4${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      seen.push(...res.body.items.map((o: { localDate: string }) => o.localDate));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(15);
    expect([...seen].sort()).toEqual(seen);
    expect(new Set(seen).size).toBe(15);
  });

  it('filters by status, site, checklist and assignee, and limits the range', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w, { assigneeIds: [w.workers[0]] });
    const count = async (q: string) => (await w.api.get(`/api/v1/occurrences?${RANGE}&limit=200&${q}`)).body.items.length;
    expect(await count(`assignmentId=${a.id}&status=pending,overdue`)).toBe(15);
    expect(await count(`assignmentId=${a.id}&status=missed`)).toBe(0);
    expect(await count(`siteId=${w.otherSiteId}`)).toBe(0);
    expect(await count(`checklistId=${w.checklistId}`)).toBe(15);
    expect(await count(`assigneeId=${w.workers[1]}`)).toBe(0);
    const long = await w.api.get(`/api/v1/occurrences?from=${TODAY}&to=2027-02-01`);
    expect(long.status).toBe(400);
    expect(long.body.error.fields).toEqual({ to: 'scheduling.issues.rangeTooLong' });
  });

  it('shows details with history and cancels one occurrence with a reason', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    const id = (await occurrenceRows(a.id))[1]!.id;
    const detail = (await w.api.get(`/api/v1/occurrences/${id}`)).body;
    expect(detail.assignees.map((u: { fullName: string }) => u.fullName)).toEqual(['İşçi 1', 'İşçi 2']);
    expect(detail.history).toEqual([
      { fromStatus: null, toStatus: 'pending', at: '2026-11-02T04:00:00.000Z', actor: { kind: 'user', name: 'Elvin Əhmədov' }, reason: null },
    ]);
    expect((await w.api.post(`/api/v1/occurrences/${id}/cancel`, { reason: '' })).status).toBe(400);
    const cancelled = await w.api.post(`/api/v1/occurrences/${id}/cancel`, { reason: 'Bayram günü' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: 'Bayram günü', unassigned: false });
    expect(cancelled.body.history.at(-1)).toMatchObject({ fromStatus: 'pending', toStatus: 'cancelled', reason: 'Bayram günü', actor: { kind: 'user' } });
    expect((await w.api.post(`/api/v1/occurrences/${id}/cancel`, { reason: 'x' })).body.error.code).toBe('OCCURRENCE_NOT_CANCELLABLE');
    const audit = await ownerQuery<{ action: string }>('select action from audit_log where entity_id = $1', [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['occurrence.cancelled']);
  });

  it('flags unassigned occurrences once nobody is eligible', async () => {
    const w = await schedulingWorld(t);
    const a = await createAssignment(w);
    for (const id of w.workers) await w.api.post(`/api/v1/users/${id}/deactivate`);
    const items = (await w.api.get(`/api/v1/occurrences?${RANGE}&assignmentId=${a.id}&limit=3`)).body.items;
    // Today's window opened at 08:00 = now, so its snapshot is frozen.
    expect(items.map((o: { unassigned: boolean }) => o.unassigned)).toEqual([false, true, true]);
  });

  it('lets a worker list only their own occurrences', async () => {
    const w = await schedulingWorld(t);
    const me = await createUserDirect(t, w.s.tenantId, { fullName: 'Mən' });
    await w.api.put(`/api/v1/users/${me.id}/sites`, { siteIds: [w.siteId] });
    await createAssignment(w, { assigneeIds: [me.id] });
    await createAssignment(w, { assigneeIds: [w.workers[0]] });
    const api = as(t, (await loginWorker(t, w.s.orgCode, me.username!, me.secret)).accessToken);
    const mine = await api.get(`/api/v1/me/occurrences?${RANGE}&limit=200`);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.items).toHaveLength(15);
    expect(mine.body.items.every((o: { assigneeIds: string[] }) => o.assigneeIds.includes(me.id))).toBe(true);
    expect((await api.get(`/api/v1/occurrences?${RANGE}`)).status).toBe(403);
  });

  it('answers canStart for sub-project 4', async () => {
    const w = await schedulingWorld(t);
    const [w0] = w.workers as [string, string];
    const outsider = await createUserDirect(t, w.s.tenantId);
    const [first, second] = await occurrenceRows((await createAssignment(w)).id);
    await w.api.post(`/api/v1/occurrences/${second!.id}/cancel`, { reason: 'x' });
    const shift = (await w.api.post('/api/v1/shifts', { name: 'Səhər', startTime: '08:00', endTime: '16:00' })).body.id;
    await w.api.put('/api/v1/roster', { siteId: w.siteId, from: TODAY, to: TODAY, rows: [{ userId: w0, shiftId: shift, date: TODAY }] });
    const shiftFirst = (await occurrenceRows((await createAssignment(w, { timing: { mode: 'shift', shiftId: shift, graceMinutes: 0 } })).id))[0]!;
    await ownerQuery('delete from shift_roster where user_id = $1', [w0]);

    const db = t.app.get(DbService);
    const elig = t.app.get(EligibilityService);
    const check = (occurrenceId: string, userId: string, iso: string) => db.withTenant(w.s.tenantId, null, () => elig.canStart(occurrenceId, userId, new Date(iso)));
    expect(await check(first!.id, w0, '2026-11-02T04:30:00Z')).toEqual({ ok: true, late: false });
    expect(await check(first!.id, w0, '2026-11-02T06:30:00Z')).toEqual({ ok: true, late: true });
    expect(await check(first!.id, w0, '2026-11-02T07:00:00Z')).toEqual({ ok: false, reason: 'CLOSED' });
    expect(await check(first!.id, w0, '2026-11-02T03:00:00Z')).toEqual({ ok: false, reason: 'NOT_YET_OPEN' });
    expect(await check(first!.id, outsider.id, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_ASSIGNED' });
    expect(await check(second!.id, w0, '2026-11-03T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_STARTABLE' });
    expect(await check(shiftFirst.id, w0, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_ON_SHIFT' });
    expect(await check('0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', w0, '2026-11-02T04:30:00Z')).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm --filter @taskop/api test -- test/occurrences.test.ts`
Expected: FAIL: `/api/v1/occurrences` returns 404.

- [ ] **Step 3: Add the mapper and DTOs**

Append to `mappers.ts` (add `OccurrenceHistoryEntry` to the contracts import and `occurrenceStatusHistory` to the schema import):

```ts
export const toHistoryEntry = (r: { h: typeof occurrenceStatusHistory.$inferSelect; actorName: string | null }): OccurrenceHistoryEntry => ({
  fromStatus: r.h.fromStatus,
  toStatus: r.h.toStatus,
  at: r.h.at.toISOString(),
  actor: r.h.actorUserId
    ? { kind: 'user', name: r.actorName }
    : r.h.actorPlatformAdminId
      ? { kind: 'platform', name: null }
      : { kind: 'system', name: null },
  reason: r.h.reason,
});
```

Add to `dto.ts`:

```ts
export class OccurrenceListQueryDto extends createZodDto(occurrenceListQuerySchema) {}
export class MyOccurrenceQueryDto extends createZodDto(myOccurrenceQuerySchema) {}
export class CancelOccurrenceDto extends createZodDto(cancelOccurrenceInputSchema) {}
export class OccurrencePageResponse extends createZodDto(pageOf(occurrenceDtoSchema)) {}
export class OccurrenceDetailResponse extends createZodDto(occurrenceDetailSchema) {}
```

- [ ] **Step 4: Implement the services and controllers**

`apps/api/src/scheduling/occurrences.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OccurrenceDetail, OccurrenceDto, OccurrenceStatus, Page } from '@taskop/contracts';
import { and, asc, between, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import type { Principal } from '../common/request';
import { AuditService } from '../db/audit.service';
import { DbService } from '../db/db.service';
import { occurrenceAssignees, occurrences, occurrenceStatusHistory, users } from '../db/schema';
import type { Actor } from './actor';
import type { CancelOccurrenceDto, MyOccurrenceQueryDto, OccurrenceListQueryDto } from './dto';
import { toHistoryEntry, toOccurrenceDto } from './mappers';
import { OccurrenceQueries } from './occurrence-queries';
import { OccurrenceWriter } from './occurrence-writer';
import { SchedulingScope } from './scheduling-scope';

interface PageQuery {
  from: string;
  to: string;
  status?: OccurrenceStatus[];
  cursor?: string;
  limit: number;
}

@Injectable()
export class OccurrencesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly scope: SchedulingScope,
    private readonly queries: OccurrenceQueries,
    private readonly writer: OccurrenceWriter,
  ) {}

  list(a: Actor, q: OccurrenceListQueryDto): Promise<Page<OccurrenceDto>> {
    const conds: (SQL | undefined)[] = [this.scope.occurrences(a)];
    if (q.siteId) conds.push(eq(occurrences.siteId, q.siteId));
    if (q.checklistId) conds.push(eq(occurrences.checklistId, q.checklistId));
    if (q.assignmentId) conds.push(eq(occurrences.assignmentId, q.assignmentId));
    if (q.assigneeId) conds.push(this.hasAssignee(q.assigneeId));
    return this.page(q, conds);
  }

  /** FR-10.01 groundwork: the caller's own snapshot, no permission needed. */
  listMine(p: Principal, q: MyOccurrenceQueryDto): Promise<Page<OccurrenceDto>> {
    return this.page(q, [this.hasAssignee(p.userId)]);
  }

  async get(a: Actor, id: string): Promise<OccurrenceDetail> {
    const [row] = await this.queries.select().where(and(eq(occurrences.id, id), this.scope.occurrences(a)));
    if (!row) throw new AppError('NOT_FOUND');
    const tx = this.db.tx();
    const assignees = await tx
      .select({ id: users.id, fullName: users.fullName })
      .from(occurrenceAssignees)
      .innerJoin(users, eq(users.id, occurrenceAssignees.userId))
      .where(eq(occurrenceAssignees.occurrenceId, id))
      .orderBy(asc(users.fullName), asc(users.id));
    const history = await tx
      .select({ h: getTableColumns(occurrenceStatusHistory), actorName: users.fullName })
      .from(occurrenceStatusHistory)
      .leftJoin(users, eq(users.id, occurrenceStatusHistory.actorUserId))
      .where(eq(occurrenceStatusHistory.occurrenceId, id))
      .orderBy(asc(occurrenceStatusHistory.at), asc(occurrenceStatusHistory.id));
    return { ...toOccurrenceDto(row), assignees, history: history.map(toHistoryEntry) };
  }

  async cancel(a: Actor, id: string, input: CancelOccurrenceDto): Promise<OccurrenceDetail> {
    const tx = this.db.tx();
    const [row] = await tx.select().from(occurrences).where(and(eq(occurrences.id, id), this.scope.occurrences(a))).for('update');
    if (!row) throw new AppError('NOT_FOUND');
    await this.scope.assertSiteWritable(a, row.siteId);
    if (row.status !== 'pending' && row.status !== 'overdue') throw new AppError('OCCURRENCE_NOT_CANCELLABLE');
    const now = this.clock.now();
    await tx.update(occurrences).set({ status: 'cancelled', cancelReason: input.reason, statusChangedAt: now, updatedAt: now }).where(eq(occurrences.id, id));
    await this.writer.recordTransitions([{ occurrenceId: id, from: row.status, to: 'cancelled', at: now, reason: input.reason }]);
    await this.audit.record({
      action: 'occurrence.cancelled',
      entityType: 'occurrence',
      entityId: id,
      before: { status: row.status },
      after: { status: 'cancelled', reason: input.reason },
    });
    return this.get(a, id);
  }

  private hasAssignee(userId: string): SQL {
    return sql`exists (select 1 from occurrence_assignees oa where oa.occurrence_id = ${occurrences.id} and oa.user_id = ${userId})`;
  }

  /** Keyset pagination on (starts_at, id). */
  private async page(q: PageQuery, conds: (SQL | undefined)[]): Promise<Page<OccurrenceDto>> {
    const where = [...conds, between(occurrences.localDate, q.from, q.to)];
    if (q.status) where.push(inArray(occurrences.status, q.status));
    if (q.cursor) where.push(sql`(${occurrences.startsAt}, ${occurrences.id}) > (select c.starts_at, c.id from occurrences c where c.id = ${q.cursor})`);
    const rows = await this.queries
      .select()
      .where(and(...where))
      .orderBy(asc(occurrences.startsAt), asc(occurrences.id))
      .limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(toOccurrenceDto);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id : null };
  }
}
```

`apps/api/src/scheduling/eligibility.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { occurrenceAssignees, occurrences, shiftRoster } from '../db/schema';

export type CanStartFailure = 'NOT_FOUND' | 'NOT_ASSIGNED' | 'NOT_STARTABLE' | 'NOT_YET_OPEN' | 'CLOSED' | 'NOT_ON_SHIFT';
export type CanStartResult = { ok: true; late: boolean } | { ok: false; reason: CanStartFailure };

/** FR-09.09/09.10 (spec §5.4). Sub-project 4 calls this when a worker starts an occurrence; runs in a tenant transaction. */
@Injectable()
export class EligibilityService {
  constructor(private readonly db: DbService) {}

  async canStart(occurrenceId: string, userId: string, at: Date): Promise<CanStartResult> {
    const tx = this.db.tx();
    const [o] = await tx.select().from(occurrences).where(eq(occurrences.id, occurrenceId));
    if (!o) return { ok: false, reason: 'NOT_FOUND' };
    const [assigned] = await tx
      .select({ userId: occurrenceAssignees.userId })
      .from(occurrenceAssignees)
      .where(and(eq(occurrenceAssignees.occurrenceId, occurrenceId), eq(occurrenceAssignees.userId, userId)));
    if (!assigned) return { ok: false, reason: 'NOT_ASSIGNED' };
    if (o.status !== 'pending' && o.status !== 'overdue') return { ok: false, reason: 'NOT_STARTABLE' };
    if (at < o.startsAt) return { ok: false, reason: 'NOT_YET_OPEN' };
    if (at >= o.closesAt) return { ok: false, reason: 'CLOSED' };
    if (o.shiftId) {
      const [rostered] = await tx
        .select({ userId: shiftRoster.userId })
        .from(shiftRoster)
        .where(and(eq(shiftRoster.userId, userId), eq(shiftRoster.shiftId, o.shiftId), eq(shiftRoster.siteId, o.siteId), eq(shiftRoster.date, o.localDate)));
      if (!rostered) return { ok: false, reason: 'NOT_ON_SHIFT' };
    }
    return { ok: true, late: at >= o.dueAt };
  }
}
```

`apps/api/src/scheduling/occurrences.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { OccurrenceDetail, OccurrenceDto, Page } from '@taskop/contracts';
import { controllerDecorators, named, perm, type RouteMode } from '../checklists/route-mode';
import { CurrentPrincipal } from '../common/decorators';
import { ParseIdPipe } from '../common/parse-id.pipe';
import type { Principal } from '../common/request';
import { type Actor, CurrentActor } from './actor';
import { CancelOccurrenceDto, MyOccurrenceQueryDto, OccurrenceDetailResponse, OccurrenceListQueryDto, OccurrencePageResponse } from './dto';
import { OccurrencesService } from './occurrences.service';

export function occurrencesControllerFor(mode: RouteMode) {
  const view = perm(mode, 'assignments.view');
  const manage = perm(mode, 'assignments.view', 'assignments.manage');

  @controllerDecorators(mode, 'occurrences', 'scheduling')
  class OccurrencesController {
    constructor(@Inject(OccurrencesService) private readonly occurrences: OccurrencesService) {}

    @Get()
    @view
    @ApiOkResponse({ type: OccurrencePageResponse })
    list(@CurrentActor() a: Actor, @Query() q: OccurrenceListQueryDto): Promise<Page<OccurrenceDto>> {
      return this.occurrences.list(a, q);
    }

    @Get(':id')
    @view
    @ApiOkResponse({ type: OccurrenceDetailResponse })
    get(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string): Promise<OccurrenceDetail> {
      return this.occurrences.get(a, id);
    }

    @Post(':id/cancel')
    @HttpCode(200)
    @manage
    @ApiOkResponse({ type: OccurrenceDetailResponse })
    cancel(@CurrentActor() a: Actor, @Param('id', ParseIdPipe) id: string, @Body() body: CancelOccurrenceDto): Promise<OccurrenceDetail> {
      return this.occurrences.cancel(a, id, body);
    }
  }
  return named(OccurrencesController, mode === 'tenant' ? 'OccurrencesController' : 'PlatformTenantOccurrencesController');
}

export const TenantOccurrencesController = occurrencesControllerFor('tenant');
export const PlatformTenantOccurrencesController = occurrencesControllerFor('platform');

@ApiTags('scheduling')
@ApiBearerAuth()
@Controller('me/occurrences')
export class MeOccurrencesController {
  constructor(private readonly occurrences: OccurrencesService) {}

  @Get()
  @ApiOkResponse({ type: OccurrencePageResponse })
  list(@CurrentPrincipal() p: Principal, @Query() q: MyOccurrenceQueryDto): Promise<Page<OccurrenceDto>> {
    return this.occurrences.listMine(p, q);
  }
}
```

In `scheduling.module.ts`:
- Add `TenantOccurrencesController`, `PlatformTenantOccurrencesController` and `MeOccurrencesController` to `controllers`.
- Add `OccurrencesService` and `EligibilityService` to `providers`.
- Add `exports: [EligibilityService]`.

- [ ] **Step 5: Run the tests and check they pass**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api test -- test/occurrences.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/scheduling apps/api/test/occurrences.test.ts
git commit -m "feat(api): add occurrences list, detail, cancel, my occurrences and canStart"
```

---

### Task 14: Data scope, tenant isolation and OpenAPI for scheduling

**Files:**
- Test: `apps/api/test/scheduling-scope.test.ts`, `apps/api/test/scheduling-isolation.test.ts`
- Modify: `apps/api/test/openapi.test.ts`
- Modify (only if a test exposes a gap): `apps/api/src/scheduling/*`

**Interfaces:**
- Consumes everything from Tasks 8–13. This task adds no new production API. It pins spec §6 (scope) and the Foundation isolation rules for every new endpoint.

- [ ] **Step 1: Write the scope suite**

`apps/api/test/scheduling-scope.test.ts`:

```ts
import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { as, createUserDirect, loginStaff, loginWorker, uniq } from './fixtures';
import { ownerQuery } from './owner-db';
import { createAssignment, daily, fixed, MONDAY_0800, occurrenceRows, type SchedulingWorld, schedulingWorld, staffWithRole, TODAY } from './scheduling-fixtures';

const RANGE = `from=${TODAY}&to=2026-11-30&limit=200`;
const ids = (items: Array<{ id: string }>) => items.map((x) => x.id).sort();

describe('scheduling data scope', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let w: SchedulingWorld;
  let bWorker: string;
  let atA: string;
  let atB: string;
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    w = await schedulingWorld(t);
    bWorker = (await createUserDirect(t, w.s.tenantId, { fullName: 'B işçisi' })).id;
    await w.api.put(`/api/v1/users/${bWorker}/sites`, { siteIds: [w.otherSiteId] });
    atA = (await createAssignment(w)).id;
    atB = (await createAssignment(w, { siteId: w.otherSiteId, assigneeIds: [bWorker] })).id;
  });
  afterAll(() => t.close());

  it('limits a site_subtree manager to their sites for reads and writes', async () => {
    const m = await staffWithRole(t, w, 'manager', [w.siteId]);
    expect(ids((await m.api.get('/api/v1/assignments')).body.items)).toEqual([atA]);
    const occ = (await m.api.get(`/api/v1/occurrences?${RANGE}`)).body.items as Array<{ siteId: string }>;
    expect(occ.length).toBe(15);
    expect(occ.every((o) => o.siteId === w.siteId)).toBe(true);
    expect((await m.api.get(`/api/v1/assignments/${atB}`)).status).toBe(404);
    expect((await m.api.post(`/api/v1/assignments/${atB}/pause`)).status).toBe(404);
    const bOccurrence = (await occurrenceRows(atB))[0]!.id;
    expect((await m.api.post(`/api/v1/occurrences/${bOccurrence}/cancel`, { reason: 'x' })).status).toBe(404);
    const create = await m.api.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.otherSiteId, assigneeIds: [bWorker], schedule: daily(), timing: fixed() });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.post('/api/v1/assignments/preview', { siteId: w.otherSiteId, schedule: daily(), timing: fixed() })).body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.get(`/api/v1/roster?siteId=${w.otherSiteId}&from=${TODAY}&to=2026-11-08`)).body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.put('/api/v1/roster', { siteId: w.otherSiteId, from: TODAY, to: TODAY, rows: [] })).body.error.code).toBe('SITE_OUT_OF_SCOPE');
    expect((await m.api.get(`/api/v1/roster?siteId=${w.siteId}&from=${TODAY}&to=2026-11-08`)).status).toBe(200);
  });

  it('limits own and subordinates scopes to people, and makes them read-only', async () => {
    const roles = w.api;
    const viewer = (await roles.post('/api/v1/roles', { name: uniq('Öz'), dataScope: 'own', permissions: ['assignments.view'] })).body.id;
    const lead = (
      await roles.post('/api/v1/roles', { name: uniq('Rəhbər'), dataScope: 'subordinates', permissions: ['assignments.view', 'assignments.manage', 'checklists.view'] })
    ).body.id;

    const worker = await createUserDirect(t, w.s.tenantId, { roleId: viewer, fullName: 'Öz baxan' });
    await w.api.put(`/api/v1/users/${worker.id}/sites`, { siteIds: [w.siteId] });
    const mine = await createAssignment(w, { assigneeIds: [worker.id] });
    const workerApi = as(t, (await loginWorker(t, w.s.orgCode, worker.username!, worker.secret)).accessToken);
    expect(ids((await workerApi.get('/api/v1/assignments')).body.items)).toEqual([mine.id]);
    expect((await workerApi.get(`/api/v1/occurrences?${RANGE}`)).body.items.every((o: { assignmentId: string }) => o.assignmentId === mine.id)).toBe(true);

    const boss = await createUserDirect(t, w.s.tenantId, { kind: 'staff', roleId: lead, fullName: 'Rəhbər', emailVerified: true });
    await w.api.patch(`/api/v1/users/${bWorker}`, { managerId: boss.id });
    const bossApi = as(t, (await loginStaff(t, boss.email!, boss.secret)).accessToken);
    expect(ids((await bossApi.get('/api/v1/assignments')).body.items)).toEqual([atB]);
    const write = await bossApi.post('/api/v1/assignments', { checklistId: w.checklistId, siteId: w.otherSiteId, assigneeIds: [bWorker], schedule: daily(), timing: fixed() });
    expect(write.body.error.code).toBe('SITE_OUT_OF_SCOPE');
  });

  it('gives platform admins the whole tenant', async () => {
    const email = `${uniq('admin')}@taskop.az`;
    await ownerQuery("insert into platform_admins (id, email, credential_hash, full_name) values (gen_random_uuid(), $1, $2, 'Support')", [
      email,
      await hash('platform password 1', { memoryCost: 1024, timeCost: 1, parallelism: 1 }),
    ]);
    const token = (await t.http().post('/api/v1/platform/auth/login').send({ email, password: 'platform password 1' })).body.accessToken;
    const p = as(t, token);
    const list = await p.get(`/api/v1/platform/tenants/${w.s.tenantId}/assignments?limit=200`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(ids(list.body.items)).toEqual(expect.arrayContaining([atA, atB]));
  });
});
```

- [ ] **Step 2: Write the isolation suite**

`apps/api/test/scheduling-isolation.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { FakeClock } from './fake-clock';
import { createAssignment, daily, fixed, MONDAY_0800, occurrenceRows, type SchedulingWorld, schedulingWorld, TODAY } from './scheduling-fixtures';

describe('scheduling tenant isolation', () => {
  const clock = new FakeClock(MONDAY_0800);
  let t: TestApp;
  let A: SchedulingWorld;
  let B: SchedulingWorld;
  const a: Record<string, string> = {};
  beforeAll(async () => {
    t = await createTestApp({}, { clock });
    A = await schedulingWorld(t);
    B = await schedulingWorld(t);
    a.shift = (await A.api.post('/api/v1/shifts', { name: 'A', startTime: '08:00', endTime: '16:00' })).body.id;
    a.assignment = (await createAssignment(A)).id;
    a.occurrence = (await occurrenceRows(a.assignment))[0]!.id;
  });
  afterAll(() => t.close());

  it.each([
    ['PATCH', () => `/api/v1/shifts/${a.shift}`, { name: 'x' }],
    ['GET', () => `/api/v1/assignments/${a.assignment}`, undefined],
    ['PUT', () => `/api/v1/assignments/${a.assignment}`, { revision: 1, name: 'x' }],
    ['POST', () => `/api/v1/assignments/${a.assignment}/pause`, {}],
    ['POST', () => `/api/v1/assignments/${a.assignment}/resume`, {}],
    ['POST', () => `/api/v1/assignments/${a.assignment}/end`, {}],
    ['GET', () => `/api/v1/occurrences/${a.occurrence}`, undefined],
    ['POST', () => `/api/v1/occurrences/${a.occurrence}/cancel`, { reason: 'x' }],
  ] as const)('%s on a foreign id returns 404', async (method, url, body) => {
    const path = url();
    const res =
      method === 'GET'
        ? await B.api.get(path)
        : method === 'POST'
          ? await B.api.post(path, body)
          : method === 'PUT'
            ? await B.api.put(path, body)
            : await B.api.patch(path, body);
    expect(res.status, `${method} ${path}`).toBe(404);
  });

  it('rejects foreign ids inside request bodies with 422 REFERENCE_NOT_FOUND', async () => {
    const base = { checklistId: B.checklistId, siteId: B.siteId, assigneeIds: B.workers, schedule: daily(), timing: fixed() };
    const cases = [
      await B.api.post('/api/v1/assignments', { ...base, checklistId: A.checklistId }),
      await B.api.post('/api/v1/assignments', { ...base, siteId: A.siteId }),
      await B.api.post('/api/v1/assignments', { ...base, assigneeIds: A.workers }),
      await B.api.post('/api/v1/assignments', { ...base, timing: { mode: 'shift', shiftId: a.shift, graceMinutes: 0 } }),
      await B.api.post('/api/v1/assignments/preview', { siteId: A.siteId, schedule: daily(), timing: fixed() }),
      await B.api.post('/api/v1/shifts', { name: 'x', startTime: '08:00', endTime: '16:00', siteId: A.siteId }),
      await B.api.put('/api/v1/roster', { siteId: A.siteId, from: TODAY, to: TODAY, rows: [] }),
      await B.api.post('/api/v1/roster/copy', { siteId: A.siteId, sourceWeekStart: TODAY, targetWeekStarts: ['2026-11-09'] }),
    ];
    for (const res of cases) {
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe('REFERENCE_NOT_FOUND');
    }
  });

  it('never lists the other tenant', async () => {
    expect((await B.api.get('/api/v1/assignments?limit=200')).body.items.map((x: { id: string }) => x.id)).not.toContain(a.assignment);
    expect((await B.api.get(`/api/v1/occurrences?from=${TODAY}&to=2026-11-30&limit=200`)).body.items.map((x: { id: string }) => x.id)).not.toContain(a.occurrence);
    expect((await B.api.get('/api/v1/shifts')).body.map((x: { id: string }) => x.id)).not.toContain(a.shift);
    const roster = (await B.api.get(`/api/v1/roster?siteId=${A.siteId}&from=${TODAY}&to=2026-11-08`)).body;
    expect(roster).toMatchObject({ users: [], rows: [] });
  });
});
```

- [ ] **Step 3: Extend the OpenAPI check**

In `apps/api/test/openapi.test.ts`, add these paths to the `arrayContaining` list:

```ts
'/api/v1/shifts', '/api/v1/roster', '/api/v1/assignments', '/api/v1/assignments/preview', '/api/v1/occurrences', '/api/v1/me/occurrences', '/api/v1/platform/tenants/{tenantId}/assignments',
```

- [ ] **Step 4: Run the suites and fix gaps**

Run: `pnpm --filter @taskop/api test -- scheduling-scope scheduling-isolation openapi`
Expected: PASS. If a case fails, fix the service, not the test:
- A write that the spec says needs the site in scope must call `assertSiteWritable`.
- A foreign id in a body must resolve through an RLS-filtered lookup that throws `REFERENCE_NOT_FOUND`.

`RosterService.copy` and `put` already go through `assertSite`, which looks the site up under RLS.

- [ ] **Step 5: Run the whole API suite**

Run: `pnpm --filter @taskop/api typecheck && pnpm --filter @taskop/api lint && pnpm --filter @taskop/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test apps/api/src/scheduling
git commit -m "test(api): pin scheduling data scope, tenant isolation and OpenAPI paths"
```

---

### Task 15: Demo seed data and follow-up notes

**Files:**
- Modify: `apps/api/src/db/scripts/seed.ts`
- Create: `docs/superpowers/scheduling-follow-ups.md`

**Interfaces:**
- Consumes: the demo tenant from `seed.ts`: the site `Anbar №1` (`warehouse`), the worker `elvin`, and the checklist `Gündəlik təmizlik yoxlaması`.
- Produces: a demo shift `Səhər` (08:00–16:00), a roster for `elvin` for the next 7 days, and an active daily assignment `Səhər təmizliyi` (09:00, due after 2h, 1h grace). The cron materialises it on the API's first boot.

- [ ] **Step 1: Add the seed function**

In `apps/api/src/db/scripts/seed.ts`:
- Import `addDays` and `localDateOf` from `@taskop/contracts` and `and` from `drizzle-orm`.
- Add:

```ts
/** Idempotent: a shift, this week's roster for elvin and one daily assignment (occurrences come from the cron). */
async function seedDemoScheduling(tx: Tx, tenantId: string, ownerId: string): Promise<void> {
  const existing = await tx.select({ id: schema.shifts.id }).from(schema.shifts).where(eq(schema.shifts.tenantId, tenantId)).limit(1);
  if (existing.length) return;
  const [warehouse] = await tx.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.name, 'Anbar №1')));
  const [elvin] = await tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.username, 'elvin')));
  const [cleaning] = await tx
    .select({ id: schema.checklists.id })
    .from(schema.checklists)
    .where(and(eq(schema.checklists.tenantId, tenantId), eq(schema.checklists.name, 'Gündəlik təmizlik yoxlaması')));
  if (!warehouse || !elvin || !cleaning) return;
  const today = localDateOf(new Date(), 'Asia/Baku');
  const shiftId = uuidv7();
  await tx.insert(schema.shifts).values({ id: shiftId, tenantId, name: 'Səhər', startTime: '08:00', endTime: '16:00' });
  await tx.insert(schema.shiftRoster).values(Array.from({ length: 7 }, (_, i) => ({ tenantId, userId: elvin.id, shiftId, siteId: warehouse.id, date: addDays(today, i) })));
  const assignmentId = uuidv7();
  await tx.insert(schema.assignments).values({
    id: assignmentId,
    tenantId,
    checklistId: cleaning.id,
    siteId: warehouse.id,
    name: 'Səhər təmizliyi',
    schedule: { kind: 'daily', every: 1, startDate: today, endDate: null, skipDates: [] },
    timing: { mode: 'fixed', startTime: '09:00', dueAfterMinutes: 120, graceMinutes: 60 },
    createdByUserId: ownerId,
  });
  await tx.insert(schema.assignmentAssignees).values({ tenantId, assignmentId, userId: elvin.id });
}
```

Call it after `seedDemoChecklists` in both branches of `main`:
- In the existing-tenant branch, add `await db.transaction((tx) => seedDemoScheduling(tx, existing.id, owner.id));` inside `if (owner)`.
- In the new-tenant transaction, add `await seedDemoScheduling(tx, tenantId, ownerId);` after `seedDemoChecklists`.

Add to the final `console.log` block:

```ts
  console.log('  Scheduling: shift "Səhər", daily "Səhər təmizliyi" at Anbar №1 (occurrences appear once the API has started)');
```

- [ ] **Step 2: Check the seed against the local demo database**

Run (with the local DB from `docker compose -p foundation start` and `apps/api/.env` filled in):

```bash
pnpm db:setup && pnpm db:seed && pnpm db:seed
```

Expected: both seed runs succeed; the second is a no-op for scheduling. Then start the API (`pnpm --filter @taskop/api dev`). Within a few seconds, `select count(*) from occurrences` (as the owner) is at least 14.

- [ ] **Step 3: Write the follow-up notes**

`docs/superpowers/scheduling-follow-ups.md`:

```markdown
# Scheduling & assignment — follow-ups

Items found while building sub-project 3 that are out of its scope. ⚑ marks the ones to look at first.

- ⚑ **Tenant timezone change.** Occurrences already generated keep their instants; only new ones use the new zone. Decide whether `PATCH /tenant` with a new timezone should regenerate future pending occurrences (like an assignment edit).
- ⚑ **Sub-project 4 must call `EligibilityService.canStart`** when a worker starts an occurrence, then move it to `started` through `OccurrenceWriter.recordTransitions` so history stays complete.
- **Assignee targeting by team, job title or whole site** (rest of FR-09.07) — not built; specific users only.
- **Per-site timezones** — not built; every site uses the tenant timezone.
- **Notifications** — `occurrence.status_changed` has no listeners yet (sub-project 6: FR-15.02/04/05/06).
- **Shift moved to another site** — `PATCH /shifts/:id` with a new `siteId` does not check existing roster rows or assignments at other sites.
- **Calendar (month grid) view** of occurrences — only a day/week list exists.
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/scripts/seed.ts docs/superpowers/scheduling-follow-ups.md
git commit -m "feat(api): seed demo shift, roster and assignment; record scheduling follow-ups"
```
