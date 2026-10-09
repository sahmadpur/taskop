import { Injectable } from '@nestjs/common';

/** The source of "now" for scheduling, so tests can move time without sleeping. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
