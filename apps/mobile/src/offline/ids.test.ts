import { idSchema } from '@taskop/contracts';
import { uuidv7 } from './ids';

const filled = (byte: number) => (n: number) => new Uint8Array(n).fill(byte);
const AT = Date.parse('2026-11-02T04:10:00.000Z');

describe('uuidv7', () => {
  it('is a version 7, RFC 4122 variant UUID with the millisecond time in the first 48 bits', () => {
    const id = uuidv7(AT, filled(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(AT);
    expect(idSchema.safeParse(id).success).toBe(true);
  });

  it('sorts by creation time and differs with the random part', () => {
    expect(uuidv7(AT, filled(0)) < uuidv7(AT + 1, filled(0))).toBe(true);
    expect(uuidv7(AT, filled(1))).not.toBe(uuidv7(AT, filled(2)));
  });
});
