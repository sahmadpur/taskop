import { Clock } from '../src/common/clock';

export class FakeClock extends Clock {
  private current: Date;

  constructor(iso: string) {
    super();
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(+this.current + minutes * 60_000);
  }
}
