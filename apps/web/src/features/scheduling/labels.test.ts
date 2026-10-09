import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { cancelReasonText, formatLocalDate, occurrenceVariant, scheduleSummary } from './labels';

const t = i18n.t.bind(i18n);

describe('scheduling labels', () => {
  it('summarises a schedule in Azerbaijani', () => {
    const daily = { kind: 'daily' as const, every: 1, startDate: '2026-11-02', endDate: null, skipDates: [] };
    expect(scheduleSummary(t, daily, { mode: 'fixed', startTime: '08:00', dueAfterMinutes: 120, graceMinutes: 0 }, null)).toBe('Hər gün, 08:00–10:00');
  });

  it('translates system cancel reasons and keeps free text', () => {
    expect(cancelReasonText(t, 'assignment_paused')).toBe('Təyinat dayandırıldı');
    expect(cancelReasonText(t, 'Bayram günü')).toBe('Bayram günü');
    expect(cancelReasonText(t, null)).toBeNull();
  });

  it('formats local dates without shifting them and colours statuses', () => {
    expect(formatLocalDate('2026-11-02')).toContain('2026');
    expect(formatLocalDate('2026-11-02')).toContain('2');
    expect(occurrenceVariant('missed')).toBe('destructive');
    expect(occurrenceVariant('pending')).toBe('secondary');
  });
});
