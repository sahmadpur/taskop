import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  AUDIT_FLOW_AUDIT_ACTIONS,
  AUDIT_ISSUE_CODES,
  AUDIT_REPORT_CONTENT_TYPE,
  auditDetailSchema,
  auditDtoSchema,
  auditQueueQuerySchema,
  auditQueueRowSchema,
  auditReportFileName,
  auditVerdictInputSchema,
  cancelAuditInputSchema,
  checklistDetailSchema,
  COMPLETED_STATUSES,
  correctAnswersInputSchema,
  CORRECTION_ISSUE_CODES,
  correctionResultSchema,
  DEFAULT_RULES,
  ERROR_HTTP_STATUS,
  errorBodySchema,
  EXECUTION_STATES,
  executionCorrectionsSchema,
  executionDetailSchema,
  executionProblemSchema,
  finishAuditInputSchema,
  isAuditType,
  myExecutionSchema,
  NOTIFICATION_GROUPS,
  NOTIFICATION_ISSUE_CODES,
  NOTIFICATION_TYPE_META,
  NOTIFICATION_TYPES,
  notificationRuleDtoSchema,
  OCCURRENCE_STATUSES,
  PERMISSION_GROUPS,
  problemDtoSchema,
  problemListQuerySchema,
  reportExportQuerySchema,
  reportRunSchema,
  reportRunsQuerySchema,
  resubmitCommandSchema,
  resubmitResultSchema,
  reworkRequestSchema,
  sendAuditReportInputSchema,
  sendBackInputSchema,
  SYSTEM_ROLE_DEFAULTS,
  updateChecklistInputSchema,
  updateNotificationRuleSchema,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const ID2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e60';
const AT = '2026-11-02T04:20:00.000Z';
const user = { id: ID, fullName: 'Leyla' };

describe('new statuses (spec §3.1, §3.2)', () => {
  it('adds correction_required and rework last, and counts correction_required as completed', () => {
    expect(OCCURRENCE_STATUSES.at(-1)).toBe('correction_required');
    expect(EXECUTION_STATES.at(-1)).toBe('rework');
    expect(COMPLETED_STATUSES).toEqual(['completed', 'audit_pending', 'audited', 'correction_required']);
  });
});

describe('correction inputs', () => {
  const change = { itemId: ID, answer: { number: 5 } };

  it('accepts a correction and trims the reason', () => {
    expect(correctAnswersInputSchema.parse({ answersRev: 3, changes: [change, { itemId: ID2, answer: null }], reason: '  Səhv yazılıb ' })).toEqual({
      answersRev: 3,
      changes: [change, { itemId: ID2, answer: null }],
      reason: 'Səhv yazılıb',
    });
  });

  it('refuses a manual problem, a duplicate item, an empty reason and too many changes', () => {
    const bad = (v: object) => correctAnswersInputSchema.safeParse({ answersRev: 3, changes: [change], reason: 'x', ...v });
    expect(bad({ changes: [{ itemId: ID, answer: { problem: { severity: 'normal', note: 'x', mediaIds: [] } } }] }).success).toBe(false);
    expect(bad({ changes: [change, change] }).error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['changes.1.itemId', 'corrections.issues.duplicateItem']]);
    expect(bad({ reason: '   ' }).success).toBe(false);
    expect(bad({ changes: [] }).success).toBe(false);
    expect(bad({ changes: Array.from({ length: 201 }, () => change) }).success).toBe(false);
    expect(bad({ answersRev: 0 }).success).toBe(false);
  });

  it('accepts a send-back with an optional due date and refuses duplicates and blank comments', () => {
    expect(sendBackInputSchema.parse({ items: [{ itemId: ID, comment: ' Fotonu yenidən çəkin ' }] })).toEqual({ items: [{ itemId: ID, comment: 'Fotonu yenidən çəkin' }] });
    expect(sendBackInputSchema.safeParse({ items: [{ itemId: ID, comment: 'x' }], dueAt: AT }).success).toBe(true);
    expect(sendBackInputSchema.safeParse({ items: [{ itemId: ID, comment: 'x' }, { itemId: ID, comment: 'y' }] }).success).toBe(false);
    expect(sendBackInputSchema.safeParse({ items: [{ itemId: ID, comment: '' }] }).success).toBe(false);
    expect(sendBackInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(CORRECTION_ISSUE_CODES).toEqual(['corrections.issues.dueInPast', 'corrections.issues.duplicateItem']);
  });

  it('takes the resubmit timing like the other phone commands', () => {
    expect(resubmitCommandSchema.parse({ resubmittedAt: AT, deviceTime: AT, clientOffsetMs: 0 })).toEqual({ resubmittedAt: AT, deviceTime: AT, clientOffsetMs: 0 });
    expect(resubmitCommandSchema.safeParse({ resubmittedAt: AT }).success).toBe(false);
  });
});

describe('correction outputs', () => {
  const request = {
    id: ID, round: 1, items: [{ itemId: ID, comment: 'Foto' }], dueAt: null, requestedBy: user, requestedAt: AT, resubmittedAt: null, withdrawnAt: null, withdrawnBy: null,
    answersBefore: { [ID]: { number: 10 } },
  };

  it('parses a request, a result, the history and a resubmit result', () => {
    expect(reworkRequestSchema.parse(request)).toEqual(request);
    expect(reworkRequestSchema.parse({ ...request, requestedBy: null }).requestedBy).toBeNull();
    expect(correctionResultSchema.parse({ executionId: ID, answersRev: 4, changedItemIds: [ID], score: null }).answersRev).toBe(4);
    const history = {
      original: { answers: { [ID]: { number: 10 } }, score: { earned: 1, possible: 2, percent: 50, problems: [] }, capturedAt: AT },
      corrections: [{ id: ID, itemId: ID, kind: 'manual', round: 0, before: { number: 10 }, after: { number: 5 }, reason: 'Səhv', actor: { kind: 'user', name: 'Leyla' }, at: AT }],
      reworkRequests: [request],
      diff: [{ itemId: ID, original: { number: 10 }, current: { number: 5 } }],
    };
    expect(executionCorrectionsSchema.parse(history)).toEqual(history);
    expect(executionCorrectionsSchema.parse({ original: null, corrections: [], reworkRequests: [], diff: [] }).original).toBeNull();
    const progress = { answered: 3, total: 4, requiredMissing: 0 };
    expect(resubmitResultSchema.parse({ executionId: ID, state: 'completed', status: 'audit_pending', progress, score: null }).status).toBe('audit_pending');
  });
});

describe('audit inputs', () => {
  it('requires a comment to reject', () => {
    expect(auditVerdictInputSchema.parse({ verdict: 'approved' })).toEqual({ verdict: 'approved' });
    expect(auditVerdictInputSchema.safeParse({ verdict: 'rejected', comment: '  ' }).error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['comment', 'audits.issues.commentRequired'],
    ]);
    expect(auditVerdictInputSchema.parse({ verdict: 'rejected', comment: ' Pis ' })).toEqual({ verdict: 'rejected', comment: 'Pis' });
    expect(auditVerdictInputSchema.safeParse({ verdict: 'approved', comment: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('lower-cases and de-duplicates the extra report addresses, at most 20', () => {
    expect(finishAuditInputSchema.parse({ result: 'failed', extraEmails: ['A@x.az', 'a@x.az'] })).toEqual({ result: 'failed', extraEmails: ['a@x.az'] });
    expect(finishAuditInputSchema.safeParse({ result: 'passed', extraEmails: Array.from({ length: 21 }, (_, i) => `u${i}@x.az`) }).success).toBe(false);
    expect(finishAuditInputSchema.safeParse({ result: 'passed', comment: 'x'.repeat(4001) }).success).toBe(false);
    expect(sendAuditReportInputSchema.safeParse({ emails: [] }).success).toBe(false);
    expect(sendAuditReportInputSchema.parse({})).toEqual({});
    expect(cancelAuditInputSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('validates the queue query: a queue, both dates or none, at most 366 days', () => {
    expect(auditQueueQuerySchema.parse({ queue: 'waiting' })).toEqual({ queue: 'waiting', limit: 50 });
    expect(auditQueueQuerySchema.safeParse({ queue: 'waiting', from: '2026-11-01' }).error?.issues[0]?.path).toEqual(['to']);
    expect(auditQueueQuerySchema.safeParse({ queue: 'finished', from: '2026-01-01', to: '2027-01-02' }).error?.issues[0]?.message).toBe('audits.issues.rangeTooLong');
    expect(auditQueueQuerySchema.safeParse({ queue: 'finished', from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    expect(auditQueueQuerySchema.safeParse({ queue: 'done' }).success).toBe(false);
    expect(AUDIT_ISSUE_CODES).toEqual(['audits.issues.commentRequired', 'audits.issues.rangeTooLong', 'audits.issues.tooManyEmails', 'audits.issues.notAuditable']);
  });
});

describe('audit outputs', () => {
  const dto = {
    id: ID, executionId: ID, occurrenceId: ID, status: 'in_progress', paused: false,
    auditor: { kind: 'user', id: ID, name: 'Auditor' }, startedAt: AT, finishedAt: null, cancelledAt: null, cancelReason: null,
    result: null, score: null, comment: null, reportStatus: 'none', reportRecipients: [], reportSentAt: null,
    verdicts: [{ itemId: ID, verdict: 'rejected', comment: 'Pis', updatedBy: user, updatedAt: AT }],
  };

  it('parses an audit and a queue row', () => {
    expect(auditDtoSchema.parse(dto)).toEqual(dto);
    const row = {
      occurrenceId: ID, executionId: ID, auditId: null, checklist: { id: ID, name: 'Açılış' }, site: { id: ID, name: 'Filial 1' }, executor: user,
      localDate: '2026-11-02', completedAt: AT, status: 'audit_pending', auditState: 'waiting', auditor: null, result: null, percent: null, startedAt: null, finishedAt: null,
    };
    expect(auditQueueRowSchema.parse(row)).toEqual(row);
  });

  it('names the report file in ASCII with the run date', () => {
    expect(auditReportFileName('Açılış yoxlaması', '2026-11-02')).toBe('taskop-audit-acilis-yoxlamasi-2026-11-02.pdf');
    expect(auditReportFileName('Gündəlik İŞ / Ğ-Ö-Ü', '2026-11-02')).toBe('taskop-audit-gundelik-is-g-o-u-2026-11-02.pdf');
    expect(auditReportFileName('???', '2026-11-02')).toBe('taskop-audit-checklist-2026-11-02.pdf');
    expect(AUDIT_REPORT_CONTENT_TYPE).toBe('application/pdf');
  });

  it('extends the audit with the run detail and its history', () => {
    expect(Object.keys(auditDetailSchema.shape)).toEqual(expect.arrayContaining(['execution', 'corrections', 'auditableItemIds', 'checklistReportEmails', 'requiresAudit']));
  });
});

describe('defaults on the existing views', () => {
  it('fills the new fields of older payloads', () => {
    const problem = { id: ID, itemId: ID, source: 'rule', severity: 'normal', note: null, mediaIds: [], createdAt: AT, resolution: 'none', taskId: null };
    expect(executionProblemSchema.parse(problem).clearedAt).toBeNull();
    expect(Object.keys(executionDetailSchema.shape)).toEqual(expect.arrayContaining(['reworkRound', 'rework', 'corrected', 'audit']));
    expect(Object.keys(myExecutionSchema.shape)).toEqual(expect.arrayContaining(['reworkRound', 'rework']));
    expect(Object.keys(problemDtoSchema.shape)).toContain('clearedAt');
    expect(problemListQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', includeCleared: 'true' }).includeCleared).toBe(true);
    expect(Object.keys(checklistDetailSchema.shape)).toEqual(expect.arrayContaining(['requiresAudit', 'auditReportEmails']));
    expect(updateChecklistInputSchema.parse({ requiresAudit: true, auditReportEmails: ['QA@x.az'] })).toEqual({ requiresAudit: true, auditReportEmails: ['qa@x.az'] });
    expect(Object.keys(reportRunSchema.shape)).toEqual(expect.arrayContaining(['auditState', 'corrected']));
    expect(reportRunsQuerySchema.parse({ from: '2026-11-01', to: '2026-11-02', auditState: 'failed' }).auditState).toBe('failed');
    expect(reportExportQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-02', format: 'csv', auditState: 'nope' }).success).toBe(false);
  });
});

describe('permissions, errors, audit actions and notifications', () => {
  it('adds the executions and audits groups after reports, with the role defaults', () => {
    expect(PERMISSION_GROUPS.slice(-3)).toEqual([
      { group: 'reports', keys: ['reports.view', 'reports.export'] },
      { group: 'executions', keys: ['executions.correct'] },
      { group: 'audits', keys: ['audits.perform'] },
    ]);
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).toContain('executions.correct');
    expect(SYSTEM_ROLE_DEFAULTS.manager.permissions).not.toContain('audits.perform');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).toContain('audits.perform');
    expect(SYSTEM_ROLE_DEFAULTS.auditor.permissions).not.toContain('executions.correct');
    expect(SYSTEM_ROLE_DEFAULTS.admin.permissions).toEqual(ALL_PERMISSIONS);
    expect(SYSTEM_ROLE_DEFAULTS.worker.permissions).toEqual([]);
  });

  it('adds ten error codes with their statuses and the audit id and item ids details', () => {
    expect({
      EXECUTION_LOCKED: ERROR_HTTP_STATUS.EXECUTION_LOCKED,
      EXECUTION_NOT_CORRECTABLE: ERROR_HTTP_STATUS.EXECUTION_NOT_CORRECTABLE,
      ANSWERS_CONFLICT: ERROR_HTTP_STATUS.ANSWERS_CONFLICT,
      ITEM_NOT_IN_REWORK: ERROR_HTTP_STATUS.ITEM_NOT_IN_REWORK,
      MEDIA_NOT_CORRECTABLE: ERROR_HTTP_STATUS.MEDIA_NOT_CORRECTABLE,
      AUDIT_EXISTS: ERROR_HTTP_STATUS.AUDIT_EXISTS,
      AUDIT_PAUSED: ERROR_HTTP_STATUS.AUDIT_PAUSED,
      AUDIT_INCOMPLETE: ERROR_HTTP_STATUS.AUDIT_INCOMPLETE,
      AUDIT_NOT_IN_PROGRESS: ERROR_HTTP_STATUS.AUDIT_NOT_IN_PROGRESS,
      REPORT_NOT_READY: ERROR_HTTP_STATUS.REPORT_NOT_READY,
    }).toEqual({
      EXECUTION_LOCKED: 409, EXECUTION_NOT_CORRECTABLE: 409, ANSWERS_CONFLICT: 409, ITEM_NOT_IN_REWORK: 422, MEDIA_NOT_CORRECTABLE: 422,
      AUDIT_EXISTS: 409, AUDIT_PAUSED: 409, AUDIT_INCOMPLETE: 422, AUDIT_NOT_IN_PROGRESS: 409, REPORT_NOT_READY: 409,
    });
    const body = errorBodySchema.parse({
      error: { code: 'AUDIT_INCOMPLETE', messageKey: 'errors.AUDIT_INCOMPLETE', fields: null, retryAfterSeconds: null, requestId: 'r1', itemIds: [ID], auditId: ID2 },
    });
    expect(body.error).toMatchObject({ itemIds: [ID], auditId: ID2 });
  });

  it('lists the audit-flow log actions', () => {
    expect(AUDIT_FLOW_AUDIT_ACTIONS).toEqual([
      'audit.started', 'audit.finished', 'audit.cancelled', 'audit.report_sent',
      'execution.corrected', 'execution.sent_back', 'execution.send_back_withdrawn', 'execution.resubmitted',
    ]);
  });

  it('adds three notification types in the audit group, before manual', () => {
    expect(NOTIFICATION_TYPES.slice(-4)).toEqual(['run.correction_required', 'run.resubmitted', 'audit.finished', 'manual']);
    expect(NOTIFICATION_GROUPS).toEqual(['checklist', 'problem', 'task', 'audit']);
    expect(NOTIFICATION_TYPE_META['run.correction_required']).toEqual({ group: 'audit', audiences: ['assignees'], hasLeadTime: false, hasResultFilter: false });
    expect(NOTIFICATION_TYPE_META['run.resubmitted']).toEqual({ group: 'audit', audiences: ['creator'], hasLeadTime: false, hasResultFilter: false });
    expect(NOTIFICATION_TYPE_META['audit.finished']).toEqual({ group: 'audit', audiences: ['assignees'], hasLeadTime: false, hasResultFilter: true });
    expect(DEFAULT_RULES['audit.finished']).toMatchObject({ push: false, email: false, notifyAssignees: true, systemRoles: ['manager'], resultFilter: 'failed' });
    expect(DEFAULT_RULES['run.correction_required']).toMatchObject({ push: true, notifyAssignees: true, resultFilter: null });
    expect(DEFAULT_RULES['run.resubmitted']).toMatchObject({ push: false, notifyCreator: true, resultFilter: null });
    expect(NOTIFICATION_TYPES.filter(isAuditType)).toEqual(['run.correction_required', 'run.resubmitted', 'audit.finished']);
    expect(NOTIFICATION_ISSUE_CODES).toContain('notifications.issues.resultFilterNotApplicable');
  });

  it('carries the result filter on rules, defaulting to null for old clients', () => {
    const rule = { enabled: true, push: false, email: false, notifyAssignees: true, notifyCreator: false, roleIds: [], leadMinutes: null };
    expect(updateNotificationRuleSchema.parse(rule).resultFilter).toBeNull();
    expect(updateNotificationRuleSchema.parse({ ...rule, resultFilter: 'any' }).resultFilter).toBe('any');
    expect(updateNotificationRuleSchema.safeParse({ ...rule, resultFilter: 'passed' }).success).toBe(false);
    expect(notificationRuleDtoSchema.parse({ type: 'audit.finished', ...rule, resultFilter: 'failed', isDefault: true }).resultFilter).toBe('failed');
  });
});
