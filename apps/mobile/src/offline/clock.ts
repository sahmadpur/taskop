import { EXECUTION_LIMITS } from '@taskop/contracts';
import { type Db, getMeta } from './db';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Device clock minus server clock (spec §6.6), taking the request's midpoint as the moment the server stamped. */
export function measureOffset(serverTime: string, sentAt: number, receivedAt: number): number {
  return Math.round((sentAt + receivedAt) / 2 - Date.parse(serverTime));
}

const OFFSET_LIMIT = 2_000_000_000;

/** Commands accept an integer within ±2e9 (Part 1 `commandTiming`). */
export const clampOffset = (ms: number): number => Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, Math.round(ms)));

/** The offset measured at the last successful /me/sync, or 0 before the first one. */
export async function readOffset(db: Db): Promise<number> {
  const value = Number(await getMeta(db, 'clockOffsetMs'));
  return Number.isFinite(value) ? value : 0;
}

export const isClockSkewed = (offsetMs: number): boolean => Math.abs(offsetMs) > EXECUTION_LIMITS.clockSkewMs;

/** The phone runs ahead of the server by more than the server tolerates in a start time (offset = device − server). */
export const isClockTooFarAhead = (offsetMs: number): boolean => offsetMs > EXECUTION_LIMITS.clockFutureToleranceMs;
