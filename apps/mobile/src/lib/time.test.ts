import { formatTime, localDate } from './time';

describe('tenant-time formatting', () => {
  it('shows times and dates in the tenant time zone', () => {
    expect(formatTime('2026-11-02T04:00:00.000Z', 'Asia/Baku')).toBe('08:00');
    expect(formatTime('2026-11-02T19:05:00.000Z', 'Asia/Baku')).toBe('23:05');
    expect(localDate(Date.parse('2026-11-02T20:30:00.000Z'), 'Asia/Baku')).toBe('2026-11-03');
  });
});
