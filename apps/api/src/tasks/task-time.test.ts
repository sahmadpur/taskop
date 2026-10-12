import { describe, expect, it } from 'vitest';
import { assertNotFuture, boundTaskTime } from './task-time';

const at = (iso: string) => new Date(iso);

describe('task device times (spec §6.3, SP4 rule)', () => {
  const rx = at('2026-11-02T04:20:00Z');
  const floor = at('2026-11-02T04:00:00Z');

  it('accepts device times up to 2 minutes ahead of the server and refuses later ones', () => {
    expect(() => assertNotFuture(at('2026-11-02T04:22:00Z'), rx)).not.toThrow();
    expect(() => assertNotFuture(at('2026-11-02T04:22:00.001Z'), rx)).toThrow('CLOCK_INVALID');
  });

  it('raises a time before the previous step to it', () => {
    expect(boundTaskTime(at('2026-11-02T04:10:00Z'), floor, rx)).toEqual(at('2026-11-02T04:10:00Z'));
    expect(boundTaskTime(at('2026-11-02T03:00:00Z'), floor, rx)).toEqual(floor);
    expect(() => boundTaskTime(at('2026-11-02T05:00:00Z'), floor, rx)).toThrow('CLOCK_INVALID');
  });
});
