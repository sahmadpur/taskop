import type { Correction, ExecutionCorrections, ReworkRequest } from '@taskop/contracts';

/** Test data shared by the correction tests. Not imported by application code. */
export const MANAGER = { id: 'mgr', fullName: 'Leyla Quliyeva' };

/** Round 1, sent back at 14:00 Baku by Leyla, still open, no due date. `requestedBy: null` = a platform admin. */
export const reworkRequest = (over: Partial<ReworkRequest> = {}): ReworkRequest => ({
  id: 'rw1',
  round: 1,
  items: [],
  dueAt: null,
  requestedBy: MANAGER,
  requestedAt: '2026-11-02T10:00:00.000Z',
  resubmittedAt: null,
  withdrawnAt: null,
  withdrawnBy: null,
  answersBefore: {},
  ...over,
});

/** A manager's correction at 13:00 Baku. */
export const correction = (over: Partial<Correction> & Pick<Correction, 'itemId'>): Correction => ({
  id: 'c1',
  kind: 'manual',
  round: 0,
  before: null,
  after: null,
  reason: 'Səhv daxil edilib',
  actor: { kind: 'user', name: MANAGER.fullName },
  at: '2026-11-02T09:00:00.000Z',
  ...over,
});

export const noCorrections = (): ExecutionCorrections => ({ original: null, corrections: [], reworkRequests: [], diff: [] });
