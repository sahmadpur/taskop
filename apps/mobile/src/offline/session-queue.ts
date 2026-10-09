/** What a session's `create` returns: the value to hand out and how to tear it down. */
export interface Opened<T> {
  value: T;
  dispose(): Promise<void>;
}

export interface Session<T> {
  /** Resolves once this session's creation ran, after every earlier session finished closing. */
  readonly ready: Promise<T>;
  /** Idempotent. Queued at once, so a session opened after this call starts only once this one is torn down. */
  close(): Promise<void>;
}

export interface SessionQueue {
  open<T>(create: () => Promise<Opened<T>>): Session<T>;
}

/**
 * Serialises the creation and the disposal of sessions that share one resource (the database file): every open and
 * every close runs alone, in call order. A close called while its creation is still pending waits for that creation
 * and then disposes it, before any session opened later is created.
 */
export function createSessionQueue(): SessionQueue {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job, job);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    open<T>(create: () => Promise<Opened<T>>): Session<T> {
      const created = enqueue(create);
      let closing: Promise<void> | null = null;
      return {
        ready: created.then((o) => o.value),
        close() {
          closing ??= enqueue(async () => {
            let opened: Opened<T>;
            try {
              opened = await created;
            } catch {
              return; // Never opened: nothing to tear down.
            }
            await opened.dispose();
          });
          return closing;
        },
      };
    },
  };
}
