import { EXECUTION_LIMITS } from '@taskop/contracts';
import { AppError } from '../common/app-error';

/**
 * Device times are trusted within bounds (BR-11, spec §6.6): none may be later than server receipt + 2 min, and a
 * clock offset over 5 min (measured by the phone at its last sync) marks the execution clock_suspect.
 */
export function assertDeviceTimes(times: Date[], receivedAt: Date, clientOffsetMs: number): { clockSuspect: boolean } {
  const limit = +receivedAt + EXECUTION_LIMITS.clockFutureToleranceMs;
  if (times.some((t) => +t > limit)) throw new AppError('CLOCK_INVALID');
  return { clockSuspect: Math.abs(clientOffsetMs) > EXECUTION_LIMITS.clockSkewMs };
}

/**
 * A start before the window opens is clamped to starts_at when the server has seen the window open (a slow device
 * clock); more than 5 min early is also clock_suspect. Before the window opens on the server, nothing is clamped
 * and canStart answers NOT_YET_OPEN.
 */
export function clampStart(startedAt: Date, startsAt: Date, receivedAt: Date): { startedAt: Date; clockSuspect: boolean } {
  if (startedAt >= startsAt || receivedAt < startsAt) return { startedAt, clockSuspect: false };
  return { startedAt: startsAt, clockSuspect: +startedAt < +startsAt - EXECUTION_LIMITS.earlyStartToleranceMs };
}
