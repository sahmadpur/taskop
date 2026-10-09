import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  CANCEL_REASON_CODES,
  describeSchedule,
  ErrorCode,
  ISSUE_CODES,
  ITEM_TYPES,
  OCCURRENCE_STATUSES,
  PERMISSION_GROUPS,
  PREVIEW_WARNINGS,
  SCHEDULING_ISSUE_CODES,
  TEMPLATE_CATEGORIES,
} from '@taskop/contracts';
import { az, formatDate, formatDateTime } from './index.js';

describe('az translations', () => {
  it('has a message for every API error code', () => {
    for (const code of Object.values(ErrorCode)) expect(az.errors[code], code).toBeTypeOf('string');
  });
  it('has every validation key used by contracts', () => {
    for (const k of ['required', 'invalid', 'tooShort', 'tooLong', 'email', 'username', 'orgCode', 'pinFormat', 'pinWeak', 'passwordLength', 'timezone'] as const) {
      expect(az.errors.validation[k], k).toBeTypeOf('string');
    }
  });
});

describe('checklist translations', () => {
  it('translates every content issue code', () => {
    for (const code of ISSUE_CODES) expect(az.checklists.issues[code], code).toBeTypeOf('string');
  });
  it('translates categories and item types', () => {
    for (const c of TEMPLATE_CATEGORIES) expect(az.checklists.categories[c], c).toBeTypeOf('string');
    for (const t of ITEM_TYPES) expect(az.checklists.itemTypes[t], t).toBeTypeOf('string');
  });
  it('labels every permission group and key', () => {
    for (const g of PERMISSION_GROUPS) expect(az.roles.groups[g.group as keyof typeof az.roles.groups], g.group).toBeTypeOf('string');
    for (const k of ALL_PERMISSIONS) expect(az.roles.keys[k.replace('.', '_') as keyof typeof az.roles.keys], k).toBeTypeOf('string');
  });
});

describe('formatting', () => {
  it('formats in the tenant timezone', () => {
    expect(formatDateTime('2026-10-07T10:00:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('14:00');
  });
  it('formats dates', () => {
    expect(formatDate('2026-10-07T22:30:00Z', { locale: 'az', timeZone: 'Asia/Baku' })).toContain('2026');
  });
});

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
