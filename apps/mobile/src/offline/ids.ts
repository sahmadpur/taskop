/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 10, 74 random bits.
 * Executions and media are created offline, so the phone generates their IDs (spec §1).
 * `random` is expo-crypto's getRandomBytes on the phone; tests pass their own.
 */
export function uuidv7(now: number, random: (byteCount: number) => Uint8Array): string {
  const b = new Uint8Array(16);
  let t = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  const r = random(10);
  b[6] = 0x70 | (r[0]! & 0x0f);
  b[7] = r[1]!;
  b[8] = 0x80 | (r[2]! & 0x3f);
  for (let i = 3; i < 10; i++) b[i + 6] = r[i]!;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
