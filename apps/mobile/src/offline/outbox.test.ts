import type { Db } from './db';
import { ackCommand, appendCommand, type CommandKind, failCommand, listCommands, nextCommand, outboxCounts, retryFailedCommands } from './outbox';
import { openTestDb } from './testing/node-db';

const AT = '2026-11-02T04:10:00.000Z';
const add = (db: Db, executionId: string, kind: CommandKind, extra: { refId?: string; rev?: number } = {}) =>
  appendCommand(db, { executionId, kind, payload: { kind }, createdAt: AT, ...extra });

describe('outbox', () => {
  it('hands out the oldest pending command first and forgets acknowledged ones', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'claim');
    await add(db, 'e1', 'media', { refId: 'm1' });
    const first = await nextCommand(db);
    expect(first).toMatchObject({ executionId: 'e1', kind: 'claim', payload: { kind: 'claim' }, status: 'pending' });
    await ackCommand(db, first!.seq);
    expect(await nextCommand(db)).toMatchObject({ kind: 'media', refId: 'm1' });
  });

  it('keeps only the newest answers revision of an execution, whether the older one was pending or failed', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'claim');
    await add(db, 'e1', 'answers', { rev: 1 });
    await add(db, 'e2', 'answers', { rev: 1 });
    const failed = (await listCommands(db)).find((c) => c.executionId === 'e1' && c.kind === 'answers')!;
    await failCommand(db, failed.seq, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED');
    await add(db, 'e1', 'answers', { rev: 2 });
    expect((await listCommands(db)).map((c) => [c.executionId, c.kind, c.rev, c.status])).toEqual([
      ['e1', 'claim', null, 'pending'],
      ['e2', 'answers', 1, 'pending'],
      ['e1', 'answers', 2, 'pending'],
    ]);
  });

  it('parks a failed command and holds back the rest of an execution whose claim failed', async () => {
    const db = await openTestDb();
    await add(db, 'e1', 'claim');
    await add(db, 'e1', 'answers', { rev: 1 });
    await add(db, 'e2', 'claim');
    const claim = (await nextCommand(db))!;
    await failCommand(db, claim.seq, 'CLOCK_INVALID', 'errors.CLOCK_INVALID');
    expect(await nextCommand(db)).toMatchObject({ executionId: 'e2', kind: 'claim' });
    expect(await outboxCounts(db)).toEqual({ pending: 2, failed: 1 });
    expect((await listCommands(db))[0]).toMatchObject({ status: 'failed', attempts: 1, errorCode: 'CLOCK_INVALID', errorKey: 'errors.CLOCK_INVALID' });
    await retryFailedCommands(db);
    expect(await nextCommand(db)).toMatchObject({ executionId: 'e1', kind: 'claim', status: 'pending', errorCode: null });
  });
});

describe('outbox action time', () => {
  it('keeps the action time of each command, and the newest answers revision carries the newest time', async () => {
    const db = await openTestDb();
    await appendCommand(db, { executionId: 'e1', kind: 'answers', rev: 1, payload: {}, createdAt: '2026-11-02T04:10:00.000Z' });
    await appendCommand(db, { executionId: 'e1', kind: 'answers', rev: 2, payload: {}, createdAt: '2026-11-02T04:20:00.000Z' });
    expect(await nextCommand(db)).toMatchObject({ rev: 2, createdAt: '2026-11-02T04:20:00.000Z' });
  });
});
