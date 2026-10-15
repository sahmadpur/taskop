import { describe, expect, it } from 'vitest';
import { executionFixture } from '@/features/executions/fixtures';
import i18n from '@/lib/i18n';
import { correction, noCorrections, reworkRequest } from './fixtures';
import { answerSummary, correctionAnswer, correctionChanges, correctionTimeline, isoToLocalInput, localInputToIso, pruneAnswer, scoreText } from './labels';

const t = i18n.t.bind(i18n);
const fmt = (iso: string) => `@${iso}`;

describe('answerSummary', () => {
  it('writes the value, else the media counts, else "Cavab yoxdur", then the note', () => {
    const f = executionFixture();
    expect(answerSummary(t, f.temp, { number: 10, note: 'isti' }, fmt)).toBe('10 °C · Qeyd: isti');
    expect(answerSummary(t, f.problem, { optionIds: [f.no.id] }, fmt)).toBe('Xeyr');
    expect(answerSummary(t, f.photo, { photos: ['m1', 'm2'] }, fmt)).toBe('2 foto, 0 video');
    expect(answerSummary(t, f.note, null, fmt)).toBe('Cavab yoxdur');
    expect(answerSummary(t, f.note, { note: 'Sonra baxılacaq' }, fmt)).toBe('Cavab yoxdur · Qeyd: Sonra baxılacaq');
  });
});

describe('scoreText', () => {
  it('shows a percentage or says there is no score', () => {
    expect(scoreText(t, { earned: 7, possible: 8, percent: 87.5, problems: [] }, 'az')).toBe('87,5%');
    expect(scoreText(t, null, 'az')).toBe('Bal hesablanmır');
  });
});

describe('correctionTimeline', () => {
  it('puts send-backs, resubmits, withdrawals and corrections in time order, a resubmit before its changes', () => {
    const sent = reworkRequest({ requestedAt: '2026-11-02T10:00:00.000Z', resubmittedAt: '2026-11-02T12:00:00.000Z' });
    const withdrawn = reworkRequest({ id: 'rw2', round: 2, requestedAt: '2026-11-02T13:00:00.000Z', withdrawnAt: '2026-11-02T14:00:00.000Z', withdrawnBy: { id: 'mgr', fullName: 'Leyla Quliyeva' } });
    const manual = correction({ id: 'c1', itemId: 'i1', at: '2026-11-02T09:00:00.000Z' });
    const rework = correction({ id: 'c2', itemId: 'i2', kind: 'rework', round: 1, at: '2026-11-02T12:00:00.000Z' });
    const timeline = correctionTimeline({ ...noCorrections(), corrections: [manual, rework], reworkRequests: [sent, withdrawn] });
    expect(timeline.map((e) => `${e.kind}@${e.at.slice(11, 16)}`)).toEqual([
      'correction@09:00',
      'sentBack@10:00',
      'resubmitted@12:00',
      'correction@12:00',
      'sentBack@13:00',
      'withdrawn@14:00',
    ]);
    expect(correctionTimeline(noCorrections())).toEqual([]);
  });
});
describe('tenant clock for date-time answers', () => {
  it('shows an instant on the tenant clock and reads a typed one back', () => {
    expect(isoToLocalInput('2026-11-02T05:30:00.000Z', 'Asia/Baku')).toBe('2026-11-02T09:30');
    expect(isoToLocalInput('2026-11-02T22:15:00.000Z', 'Asia/Baku')).toBe('2026-11-03T02:15');
    expect(isoToLocalInput('not a date', 'Asia/Baku')).toBe('');
    expect(localInputToIso('2026-11-02T09:30', 'Asia/Baku')).toBe('2026-11-02T05:30:00.000Z');
    expect(localInputToIso('2026-11-02', 'Asia/Baku')).toBeNull();
    expect(localInputToIso('', 'Asia/Baku')).toBeNull();
  });
});

describe('the correction payload', () => {
  it('drops empty fields and an empty answer', () => {
    expect(pruneAnswer({ optionIds: [], text: '', number: 4, note: undefined })).toEqual({ number: 4 });
    expect(pruneAnswer({ optionIds: [], text: '' })).toBeUndefined();
  });

  it('sends each changed item once, without the manual problem, and null for a cleared answer', () => {
    const problem = { severity: 'critical' as const, note: 'Kondisioner xarabdır', mediaIds: [] };
    const before = { a: { number: 10, note: 'isti', problem }, b: { text: 'Su axır' }, c: { optionIds: ['o1'] } };
    const after = { a: { number: 5, note: 'isti', problem }, b: undefined, c: { optionIds: ['o1'] } };
    expect(correctionAnswer(after.a)).toEqual({ number: 5, note: 'isti' });
    expect(correctionAnswer({ problem })).toBeNull();
    expect(correctionAnswer(undefined)).toBeNull();
    expect(correctionChanges(before, after)).toEqual([
      { itemId: 'a', answer: { number: 5, note: 'isti' } },
      { itemId: 'b', answer: null },
    ]);
  });
});
