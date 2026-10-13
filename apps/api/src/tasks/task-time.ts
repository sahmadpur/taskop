import { assertDeviceTimes } from '../executions/device-time';

/**
 * Spec §6.3 with SP4's rule (spec Decision 1): later than server receipt + 2 min is CLOCK_INVALID. Task commands carry
 * no clientOffsetMs: clients send device time minus their last measured offset, so `at` is compared as received.
 * Delegates to the executions tolerance check (the clock-suspect flag it returns does not apply to tasks).
 */
export function assertNotFuture(at: Date, receivedAt: Date): void {
  assertDeviceTimes([at], receivedAt, 0);
}

/** A worker's device time: refused when in the future, raised to `floor` (the previous step) when earlier. */
export function boundTaskTime(at: Date, floor: Date, receivedAt: Date): Date {
  assertNotFuture(at, receivedAt);
  return at < floor ? floor : at;
}
