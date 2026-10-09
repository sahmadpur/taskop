import { fromAnswerDatetime, nowInputFor, toAnswerDatetime } from './datetime-format';

describe('date and time answers', () => {
  it('accepts dates and times in the stored formats and refuses impossible ones', () => {
    expect(toAnswerDatetime('date', ' 2026-11-02 ')).toBe('2026-11-02');
    expect(toAnswerDatetime('date', '2026-02-30')).toBeNull();
    expect(toAnswerDatetime('time', '08:05')).toBe('08:05');
    expect(toAnswerDatetime('time', '24:00')).toBeNull();
    expect(toAnswerDatetime('datetime', '2026-11-02T08:00')).toBeNull();
  });

  it('stores a local date-time as a UTC instant and shows it back unchanged', () => {
    const stored = toAnswerDatetime('datetime', '2026-11-02 08:30')!;
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fromAnswerDatetime('datetime', stored)).toBe('2026-11-02 08:30');
    expect(fromAnswerDatetime('date', undefined)).toBe('');
  });

  it('fills "İndi" in the field format', () => {
    const ms = new Date(2026, 10, 2, 8, 5).getTime();
    expect(nowInputFor('date', ms)).toBe('2026-11-02');
    expect(nowInputFor('time', ms)).toBe('08:05');
    expect(nowInputFor('datetime', ms)).toBe('2026-11-02 08:05');
  });
});
