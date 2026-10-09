import { describe, expect, it } from 'vitest';
import {
  ERROR_HTTP_STATUS,
  errorBodySchema,
  occurrenceDetailSchema,
  occurrenceDtoSchema,
  problemListQuerySchema,
  syncQuerySchema,
  syncResponseSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const ID2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e50';
const occurrence = {
  id: ID, assignmentId: ID, assignmentName: null, checklistId: ID, checklistName: 'Açılış', siteId: ID, siteName: 'Filial', shiftId: null, shiftName: null,
  localDate: '2026-11-02', startsAt: '2026-11-02T04:00:00.000Z', dueAt: '2026-11-02T06:00:00.000Z', closesAt: '2026-11-02T07:00:00.000Z',
  status: 'completed', statusChangedAt: '2026-11-02T05:00:00.000Z', cancelReason: null, assigneeIds: [ID], unassigned: false,
};
const progress = { answered: 3, total: 4, requiredMissing: 0 };

describe('execution read models', () => {
  it('splits known version ids and caps the problems range at 92 days', () => {
    expect(syncQuerySchema.parse({ knownVersionIds: `${ID},${ID2}` }).knownVersionIds).toEqual([ID, ID2]);
    expect(syncQuerySchema.parse({}).knownVersionIds).toEqual([]);
    expect(syncQuerySchema.safeParse({ knownVersionIds: 'x' }).success).toBe(false);
    expect(problemListQuerySchema.safeParse({ from: '2026-11-01', to: '2027-01-31' }).success).toBe(true);
    const long = problemListQuerySchema.safeParse({ from: '2026-11-01', to: '2027-02-01' });
    expect(long.success).toBe(false);
    expect(long.error!.issues[0]).toMatchObject({ path: ['to'], message: 'executions.issues.rangeTooLong' });
  });

  it('adds the counted execution to occurrences and the summaries to the detail', () => {
    expect(occurrenceDtoSchema.safeParse(occurrence).success).toBe(false);
    const brief = { executionId: ID, executorName: 'Aysel', state: 'completed', progress, scorePercent: 87.5, late: false, clockSuspect: false };
    expect(occurrenceDtoSchema.parse({ ...occurrence, executionBrief: brief }).executionBrief).toEqual(brief);
    const summary = {
      id: ID, executor: { id: ID, fullName: 'Aysel' }, state: 'rejected', rejectedReason: 'ALREADY_CLAIMED',
      startedAt: '2026-11-02T04:10:00.000Z', startedReceivedAt: '2026-11-02T09:00:00.000Z', completedAt: null, completedReceivedAt: null,
      late: false, clockSuspect: false, progress, scorePercent: null, problemCount: 0, mediaPending: 2,
    };
    const detail = occurrenceDetailSchema.parse({ ...occurrence, executionBrief: null, assignees: [], history: [], execution: null, rejectedExecutions: [summary] });
    expect(detail.rejectedExecutions[0]!.rejectedReason).toBe('ALREADY_CLAIMED');
  });

  it('keeps checklist content opaque in a sync response, so a newer schemaVersion still parses', () => {
    const r = syncResponseSchema.parse({
      serverTime: '2026-11-02T04:00:00.000Z',
      occurrences: [],
      checklistVersions: [{ id: ID, checklistId: ID, number: 3, schemaVersion: 2, content: { schemaVersion: 2, anything: true } }],
      executions: [],
    });
    expect(r.checklistVersions[0]!.content).toEqual({ schemaVersion: 2, anything: true });
  });

  it('registers the execution error codes and the missing detail', () => {
    expect(ERROR_HTTP_STATUS.REQUIREMENTS_UNMET).toBe(422);
    expect(ERROR_HTTP_STATUS.EXECUTION_NOT_ACTIVE).toBe(409);
    expect(ERROR_HTTP_STATUS.NOT_EXECUTOR).toBe(403);
    expect(ERROR_HTTP_STATUS.CLOCK_INVALID).toBe(422);
    expect(ERROR_HTTP_STATUS.MEDIA_NOT_FOUND_IN_STORAGE).toBe(422);
    const body = { error: { code: 'REQUIREMENTS_UNMET', messageKey: 'errors.REQUIREMENTS_UNMET', fields: null, retryAfterSeconds: null, requestId: null, missing: [{ itemId: ID, kind: 'photo' }] } };
    expect(errorBodySchema.parse(body).error.missing).toEqual([{ itemId: ID, kind: 'photo' }]);
  });
});
