import { EXECUTION_LIMITS } from '@taskop/contracts';
import { clampOffset, isClockSkewed, isClockTooFarAhead, measureOffset, readOffset } from './clock';
import { setMeta } from './db';
import { openTestDb } from './testing/node-db';

describe('clock offset', () => {
  it('is device minus server at the midpoint of the request', () => {
    const sent = Date.parse('2026-11-02T04:10:00.000Z');
    // The server stamped 04:08:00.200; the request took 400 ms on a phone that runs 2 min fast.
    expect(measureOffset('2026-11-02T04:08:00.200Z', sent, sent + 400)).toBe(120_000);
  });

  it('is clamped to the range commands accept and read back from meta', async () => {
    expect(clampOffset(3_000_000_000.4)).toBe(2_000_000_000);
    expect(clampOffset(-12.6)).toBe(-13);
    const db = await openTestDb();
    expect(await readOffset(db)).toBe(0);
    await setMeta(db, 'clockOffsetMs', '-4500');
    expect(await readOffset(db)).toBe(-4500);
  });

  it('flags more than 5 minutes of skew', () => {
    expect(isClockSkewed(300_000)).toBe(false);
    expect(isClockSkewed(-300_001)).toBe(true);
  });

  it('flags a phone clock ahead of the server by more than the future tolerance, but not one that is behind', () => {
    const tolerance = EXECUTION_LIMITS.clockFutureToleranceMs;
    expect(isClockTooFarAhead(tolerance)).toBe(false);
    expect(isClockTooFarAhead(tolerance + 1)).toBe(true);
    expect(isClockTooFarAhead(-10 * tolerance)).toBe(false);
  });
});
