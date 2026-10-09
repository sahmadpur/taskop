import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ErrorCode, ISSUE_CODES, ITEM_TYPES, PERMISSION_GROUPS, TEMPLATE_CATEGORIES } from '@taskop/contracts';
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
