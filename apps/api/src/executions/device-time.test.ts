import { describe, expect, it } from 'vitest';
import { assertDeviceTimes, clampStart } from './device-time';

const at = (iso: string) => new Date(iso);

describe('device time bounds (spec §6.6)', () => {
  it('accepts device times up to 2 minutes ahead and flags offsets over 5 minutes', () => {
    const rx = at('2026-11-02T04:10:00Z');
    expect(assertDeviceTimes([at('2026-11-02T04:12:00Z')], rx, 300_000)).toEqual({ clockSuspect: false });
    expect(assertDeviceTimes([at('2026-11-01T04:12:00Z')], rx, -300_001)).toEqual({ clockSuspect: true });
    expect(() => assertDeviceTimes([at('2026-11-02T04:00:00Z'), at('2026-11-02T04:12:00.001Z')], rx, 0)).toThrow('CLOCK_INVALID');
  });

  it('clamps an early start only once the window is open on the server', () => {
    const starts = at('2026-11-02T04:00:00Z');
    expect(clampStart(at('2026-11-02T03:56:00Z'), starts, at('2026-11-02T04:01:00Z'))).toEqual({ startedAt: starts, clockSuspect: false });
    expect(clampStart(at('2026-11-02T03:54:59Z'), starts, at('2026-11-02T04:01:00Z'))).toEqual({ startedAt: starts, clockSuspect: true });
    expect(clampStart(at('2026-11-02T03:50:00Z'), starts, at('2026-11-02T03:55:00Z'))).toEqual({ startedAt: at('2026-11-02T03:50:00Z'), clockSuspect: false });
    expect(clampStart(at('2026-11-02T04:05:00Z'), starts, at('2026-11-02T04:06:00Z'))).toEqual({ startedAt: at('2026-11-02T04:05:00Z'), clockSuspect: false });
  });
});
