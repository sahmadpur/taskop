import type { LocalExecution, LocalOccurrence } from '@/offline/local-model';
import { ME, OCC, reworkRequest, T, VERSION } from '@/offline/testing/fixtures';
import { readOnlyReason } from './use-execution';

const occurrence: LocalOccurrence = {
  id: OCC, checklistId: 'c', checklistName: 'Açılış', siteId: 's', siteName: 'Filial', shiftName: null, localDate: '2026-11-02',
  startsAt: T.starts, dueAt: T.due, closesAt: T.closes, status: 'correction_required', checklistVersionId: VERSION,
  claim: { executionId: 'e', executorUserId: ME, executorName: 'Aysel Əliyeva' },
};
const execution = (over: Partial<LocalExecution>): LocalExecution => ({
  id: 'e', occurrenceId: OCC, checklistVersionId: VERSION, state: 'rework', claim: 'accepted', rejectedReason: null, rejectedBy: null,
  startedAt: T.open, completedAt: T.due, lockedAt: null, answers: {}, rev: 3, syncedRev: 3, finishedSyncedAt: null, updatedAt: T.open,
  syncNote: null, reworkRound: 1, rework: reworkRequest(), ...over,
});

describe('readOnlyReason in rework (spec §8.1)', () => {
  it('lets me edit a run sent back to me, even days after its window closed', () => {
    expect(readOnlyReason(execution({}), occurrence, ME, Date.parse(T.closes) + 3 * 86_400_000)).toBeNull();
  });

  it('is completed once I resubmitted it here', () => {
    expect(readOnlyReason(execution({ state: 'completed' }), occurrence, ME, Date.parse(T.open))).toBe('completed');
  });
});
