import { describe, expect, it } from 'vitest';
import { cellText, formatDate, formatInstant, wallClock } from './report-table';

describe('export cell formatting', () => {
  it('writes dates as DD.MM.YYYY and instants on the tenant’s wall clock', () => {
    expect(formatDate('2026-11-02')).toBe('02.11.2026');
    expect(formatInstant('2026-11-02T07:00:00.000Z', 'Asia/Baku')).toBe('02.11.2026 11:00');
    expect(formatInstant('2026-11-01T21:30:00.000Z', 'Asia/Baku')).toBe('02.11.2026 01:30');
    expect(formatInstant(new Date('2026-11-04T08:00:00Z'), 'Asia/Baku')).toBe('04.11.2026 12:00');
  });

  it('reads both sides of a DST change correctly (Europe/Berlin, 25 October 2026)', () => {
    expect(formatInstant('2026-10-25T00:30:00.000Z', 'Europe/Berlin')).toBe('25.10.2026 02:30');
    expect(formatInstant('2026-10-25T01:30:00.000Z', 'Europe/Berlin')).toBe('25.10.2026 02:30');
    expect(formatInstant('2026-10-25T02:30:00.000Z', 'Europe/Berlin')).toBe('25.10.2026 03:30');
    expect(wallClock('2026-10-24T22:30:00.000Z', 'Europe/Berlin').toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('writes each column type', () => {
    const tz = 'Asia/Baku';
    expect(cellText({ label: 'a', type: 'text' }, 'Zona A1', tz, 'az')).toBe('Zona A1');
    expect(cellText({ label: 'a', type: 'int' }, 7, tz, 'az')).toBe('7');
    expect(cellText({ label: 'a', type: 'decimal' }, 50, tz, 'az')).toBe('50.0');
    expect(cellText({ label: 'a', type: 'decimal' }, 57.1, tz, 'az')).toBe('57.1');
    expect(cellText({ label: 'a', type: 'number' }, 53.8, tz, 'az')).toBe('53.8');
    expect(cellText({ label: 'a', type: 'date' }, '2026-11-02', tz, 'az')).toBe('02.11.2026');
    expect(cellText({ label: 'a', type: 'datetime' }, '2026-11-02T06:00:00.000Z', tz, 'az')).toBe('02.11.2026 10:00');
    expect(cellText({ label: 'a', type: 'bool' }, true, tz, 'az')).toBe('Bəli');
    expect(cellText({ label: 'a', type: 'bool' }, false, tz, 'az')).toBe('Xeyr');
    expect(cellText({ label: 'a', type: 'decimal' }, null, tz, 'az')).toBe('');
  });

  it('writes booleans in the export language', () => {
    expect(cellText({ label: 'a', type: 'bool' }, true, 'Asia/Baku', 'en')).toBe('Yes');
    expect(cellText({ label: 'a', type: 'bool' }, false, 'Asia/Baku', 'ru')).toBe('Нет');
  });
});
