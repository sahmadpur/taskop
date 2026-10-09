import { iso, normIso, toExecution, toOccurrence } from './local-model';

describe('local rows', () => {
  it('normalises server instants so SQLite can compare them as text', () => {
    expect(normIso('2026-11-02T04:10:00Z')).toBe('2026-11-02T04:10:00.000Z');
    expect(iso(Date.parse('2026-11-02T04:10:00.5Z'))).toBe('2026-11-02T04:10:00.500Z');
  });

  it('maps occurrence and execution rows', () => {
    const occ = toOccurrence({
      id: 'o', checklist_id: 'c', checklist_name: 'Açılış', site_id: 's', site_name: 'Filial', shift_name: null, local_date: '2026-11-02',
      starts_at: 'a', due_at: 'b', closes_at: 'c', status: 'started', checklist_version_id: 'v',
      claim_execution_id: 'e', claim_user_id: 'u', claim_name: 'Murad',
    });
    expect(occ.claim).toEqual({ executionId: 'e', executorUserId: 'u', executorName: 'Murad' });
    const e = toExecution({
      id: 'e', occurrence_id: 'o', checklist_version_id: 'v', state: 'active', claim: 'pending', rejected_reason: null, rejected_by: null,
      started_at: 's', completed_at: null, locked_at: null, answers: '{"i":{"number":5}}', rev: 2, synced_rev: 1, finished_synced_at: null, updated_at: 'u',
    });
    expect(e).toMatchObject({ occurrenceId: 'o', answers: { i: { number: 5 } }, rev: 2, syncedRev: 1, claim: 'pending' });
  });
});
