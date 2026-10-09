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
    expect(localDateSchema.safeParse('abc').success).toBe(false);
    expect(localDateSchema.safeParse('').success).toBe(false);
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
