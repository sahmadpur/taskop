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
    expect(problemRangeError('2026-13-45', '2026-11-01')).toBe('errors.validation.required');
    expect(problemRangeError('2026-11-01', '2026-13-45')).toBe('errors.validation.required');
    expect(defaultProblemRange('2026-11-03')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
  });
});
