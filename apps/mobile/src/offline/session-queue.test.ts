import { createSessionQueue, type Opened } from './session-queue';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function recorder() {
  const events: string[] = [];
  const open = (name: string, o: { fail?: boolean } = {}) => async (): Promise<Opened<string>> => {
    events.push(`create ${name} start`);
    await tick();
    if (o.fail) {
      events.push(`create ${name} failed`);
      throw new Error(`cannot open ${name}`);
    }
    events.push(`create ${name} end`);
    return {
      value: name,
      dispose: async () => {
        events.push(`dispose ${name} start`);
        await tick();
        events.push(`dispose ${name} end`);
      },
    };
  };
  return { events, open };
}

describe('session queue', () => {
  it('disposes the previous session completely before creating the next', async () => {
    const q = createSessionQueue();
    const r = recorder();
    const a = q.open(r.open('A'));
    expect(await a.ready).toBe('A');
    void a.close();
    const b = q.open(r.open('B'));
    expect(await b.ready).toBe('B');
    expect(r.events).toEqual(['create A start', 'create A end', 'dispose A start', 'dispose A end', 'create B start', 'create B end']);
  });

  it('a close called while the creation is pending disposes it before a later session is created', async () => {
    const q = createSessionQueue();
    const r = recorder();
    const a = q.open(r.open('A'));
    void a.close(); // unmounted before A was ready
    const b = q.open(r.open('B'));
    await b.ready;
    expect(r.events).toEqual(['create A start', 'create A end', 'dispose A start', 'dispose A end', 'create B start', 'create B end']);
  });

  it('never overlaps two creations, and close is idempotent', async () => {
    const q = createSessionQueue();
    const r = recorder();
    const a = q.open(r.open('A'));
    const b = q.open(r.open('B'));
    await Promise.all([a.ready, b.ready]);
    await Promise.all([a.close(), a.close(), b.close()]);
    expect(r.events).toEqual([
      'create A start',
      'create A end',
      'create B start',
      'create B end',
      'dispose A start',
      'dispose A end',
      'dispose B start',
      'dispose B end',
    ]);
  });

  it('a failed creation rejects ready, closes as a no-op and does not block the next session', async () => {
    const q = createSessionQueue();
    const r = recorder();
    const a = q.open(r.open('A', { fail: true }));
    await expect(a.ready).rejects.toThrow('cannot open A');
    await a.close();
    expect(await q.open(r.open('B')).ready).toBe('B');
    expect(r.events).toEqual(['create A start', 'create A failed', 'create B start', 'create B end']);
  });
});
