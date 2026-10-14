export type Settled = 'done' | 'failed' | 'timeout';

/** Waits for `p` at most `ms`, never rejecting: a logout or a tap must not hang on a request that does not end. */
export function settleWithin(p: Promise<unknown>, ms: number): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Settled>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  const settled = p.then(
    (): Settled => 'done',
    (): Settled => 'failed',
  );
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}
