import { describe, expect, it } from 'vitest';
import {
  type Answers,
  answersEqual,
  AUDIT_LIMITS,
  AUDIT_QUEUES,
  AUDIT_REPORT_STATUSES,
  AUDIT_RESULTS,
  AUDIT_STATUSES,
  AUDIT_VERDICTS,
  auditableItemIds,
  auditBriefSchema,
  auditReportEmailsSchema,
  auditScore,
  auditScoreSchema,
  type AuditVerdict,
  blankContent,
  canCorrect,
  canSendBack,
  canStartAudit,
  canWithdrawSendBack,
  changedItemIds,
  type ChecklistContent,
  CORRECTABLE_STATUSES,
  CORRECTION_KINDS,
  isAuditPaused,
  missingVerdicts,
  newItem,
  newRule,
  newSection,
  nextStatusAfterResubmit,
  type OccurrenceStatus,
  reportRecipients,
  reworkViolations,
  RUN_AUDIT_STATES,
  runAuditState,
  statusAfterAuditCancel,
  type YesNoItem,
} from './index.js';

const CORRECTION_REQUIRED = 'correction_required' as const;
const REWORK = 'rework' as const;

/** A yes/no item with a follow-up on "yes", a number and a text: four items, three visible until "yes". */
function content() {
  const q = newItem('yes_no') as YesNoItem;
  const [yes, no] = q.options;
  const rule = newRule(q);
  rule.when = { kind: 'options', optionIds: [yes.id] };
  const followUp = newItem('text');
  rule.then.followUps.push(followUp);
  q.rules.push(rule);
  const temp = newItem('number');
  const note = newItem('text');
  const c: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [q, temp, note] }] };
  return { c, q, yes, no, followUp, temp, note };
}

describe('audit enums and limits', () => {
  it('lists every value in the agreed order', () => {
    expect(AUDIT_STATUSES).toEqual(['in_progress', 'finished', 'cancelled']);
    expect(AUDIT_RESULTS).toEqual(['passed', 'failed']);
    expect(AUDIT_VERDICTS).toEqual(['approved', 'rejected']);
    expect(AUDIT_REPORT_STATUSES).toEqual(['none', 'pending', 'ready', 'failed']);
    expect(AUDIT_QUEUES).toEqual(['waiting', 'in_progress', 'finished']);
    expect(RUN_AUDIT_STATES).toEqual(['waiting', 'in_progress', 'passed', 'failed']);
    expect(CORRECTION_KINDS).toEqual(['manual', 'rework']);
    expect(CORRECTABLE_STATUSES).toEqual(['completed', 'audit_pending']);
  });

  it('keeps the limits of the spec', () => {
    expect(AUDIT_LIMITS).toEqual({
      reportEmails: 10, recipients: 20, verdictComment: 1000, finalComment: 4000, reason: 1000, cancelReason: 500,
      reworkItems: 200, changes: 200, photosPerItem: 3, photosPerReport: 40, queuePageSize: 50, queueMaxDays: 366,
    });
  });
});

describe('what a run allows (spec §3.1)', () => {
  it('corrects and sends back completed and audit-pending runs whose execution is completed', () => {
    for (const status of ['completed', 'audit_pending'] as const) {
      expect(canCorrect({ status, executionState: 'completed' }), status).toBe(true);
      expect(canSendBack({ status, executionState: 'completed' }), status).toBe(true);
    }
    for (const status of ['partial', 'missed', 'cancelled', 'audited', 'in_progress', CORRECTION_REQUIRED] as OccurrenceStatus[]) {
      expect(canCorrect({ status, executionState: 'completed' }), status).toBe(false);
      expect(canSendBack({ status, executionState: 'completed' }), status).toBe(false);
    }
    expect(canCorrect({ status: 'completed', executionState: 'partial' })).toBe(false);
    expect(canCorrect({ status: 'completed', executionState: REWORK })).toBe(false);
  });

  it('withdraws only an open send-back', () => {
    expect(canWithdrawSendBack({ status: CORRECTION_REQUIRED, executionState: REWORK })).toBe(true);
    expect(canWithdrawSendBack({ status: CORRECTION_REQUIRED, executionState: 'completed' })).toBe(false);
    expect(canWithdrawSendBack({ status: 'completed', executionState: 'completed' })).toBe(false);
  });

  it('starts an audit only on a correctable run without an open audit', () => {
    expect(canStartAudit({ status: 'completed', executionState: 'completed' }, false)).toBe(true);
    expect(canStartAudit({ status: 'audit_pending', executionState: 'completed' }, false)).toBe(true);
    expect(canStartAudit({ status: 'audit_pending', executionState: 'completed' }, true)).toBe(false);
    expect(canStartAudit({ status: 'audited', executionState: 'completed' }, false)).toBe(false);
    expect(canStartAudit({ status: 'partial', executionState: 'partial' }, false)).toBe(false);
  });

  it('pauses an audit while the run is sent back', () => {
    expect(isAuditPaused(CORRECTION_REQUIRED)).toBe(true);
    expect(isAuditPaused('audit_pending')).toBe(false);
  });

  it('picks the status after a resubmit and after a cancelled audit', () => {
    expect(nextStatusAfterResubmit(false, false)).toBe('completed');
    expect(nextStatusAfterResubmit(true, false)).toBe('audit_pending');
    expect(nextStatusAfterResubmit(false, true)).toBe('audit_pending');
    expect(statusAfterAuditCancel(false, 'audit_pending')).toBe('completed');
    expect(statusAfterAuditCancel(true, 'audit_pending')).toBe('audit_pending');
    expect(statusAfterAuditCancel(false, CORRECTION_REQUIRED)).toBe(CORRECTION_REQUIRED);
  });
});

describe('auditable items and the audit score', () => {
  it('lists the items the current answers show, in checklist order', () => {
    const { c, q, yes, no, followUp, temp, note } = content();
    expect(auditableItemIds(c, {})).toEqual([q.id, temp.id, note.id]);
    expect(auditableItemIds(c, { [q.id]: { optionIds: [yes.id] } })).toEqual([q.id, followUp.id, temp.id, note.id]);
    expect(auditableItemIds(c, { [q.id]: { optionIds: [no.id] } })).toEqual([q.id, temp.id, note.id]);
  });

  it('scores approved over reviewed, counting only auditable items', () => {
    const verdicts = new Map<string, AuditVerdict>([['a', 'approved'], ['b', 'rejected'], ['c', 'approved'], ['hidden', 'rejected']]);
    expect(auditScore(verdicts, ['a', 'b', 'c', 'd'])).toEqual({ approved: 2, rejected: 1, reviewed: 3, percent: 66.7 });
    expect(auditScore(new Map(), ['a'])).toEqual({ approved: 0, rejected: 0, reviewed: 0, percent: null });
    expect(missingVerdicts(verdicts, ['a', 'b', 'c', 'd'])).toEqual(['d']);
    expect(missingVerdicts(verdicts, ['a', 'b'])).toEqual([]);
  });

  it('parses the score and the brief', () => {
    expect(auditScoreSchema.parse({ approved: 1, rejected: 0, reviewed: 1, percent: 100 })).toEqual({ approved: 1, rejected: 0, reviewed: 1, percent: 100 });
    const brief = { id: '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f', status: 'finished', result: 'failed', percent: 50, paused: false };
    expect(auditBriefSchema.parse(brief)).toEqual(brief);
  });
});

describe('answer comparison (spec §4.3 diffAnswers)', () => {
  it('ignores option order, empty values and undefined fields', () => {
    expect(answersEqual({ optionIds: ['b', 'a'] }, { optionIds: ['a', 'b'] })).toBe(true);
    expect(answersEqual({ text: '  ' }, undefined)).toBe(true);
    expect(answersEqual({ photos: [] }, {})).toBe(true);
    expect(answersEqual({ number: 5, note: undefined }, { number: 5 })).toBe(true);
    expect(answersEqual({ problem: { severity: 'normal', note: 'x', mediaIds: [] } }, { problem: { note: 'x', severity: 'normal', mediaIds: [] } })).toBe(true);
  });

  it('sees real changes, including photo order and a cleared answer', () => {
    expect(answersEqual({ number: 5 }, { number: 6 })).toBe(false);
    expect(answersEqual({ photos: ['p1', 'p2'] }, { photos: ['p2', 'p1'] })).toBe(false);
    expect(answersEqual({ text: 'a' }, undefined)).toBe(false);
    expect(answersEqual({ text: 'a' }, { text: 'a ' })).toBe(false);
  });

  it('lists changed items in the order of the new answers, then the removed ones', () => {
    const before: Answers = { a: { number: 1 }, b: { text: 'x' }, c: { optionIds: ['o1', 'o2'] } };
    const after: Answers = { c: { optionIds: ['o2', 'o1'] }, b: { text: 'y' }, d: { number: 4 } };
    expect(changedItemIds(before, after)).toEqual(['b', 'd', 'a']);
    expect(changedItemIds(before, before)).toEqual([]);
  });

  it('reports changes outside the flagged items', () => {
    const { c, temp, note } = content();
    const before: Answers = { [temp.id]: { number: 1 }, [note.id]: { text: 'x' } };
    expect(reworkViolations(c, before, { [temp.id]: { number: 9 }, [note.id]: { text: 'x' } }, new Set([temp.id]))).toEqual([]);
    expect(reworkViolations(c, before, { [temp.id]: { number: 9 }, [note.id]: { text: 'y' } }, new Set([temp.id]))).toEqual([note.id]);
    expect(reworkViolations(c, before, { [temp.id]: { number: 1 } }, new Set([temp.id]))).toEqual([note.id]);
  });

  it('lets a flagged change answer the follow-ups it reveals and clear the ones it hides', () => {
    const { c, q, yes, no, followUp, temp } = content();
    const flagged = new Set([q.id]);
    const before: Answers = { [q.id]: { optionIds: [no.id] } };
    // "Yes" reveals the follow-up: answering it is part of the flagged change.
    expect(reworkViolations(c, before, { [q.id]: { optionIds: [yes.id] }, [followUp.id]: { text: 'Su axır' } }, flagged)).toEqual([]);
    // Back to "No" hides it again: clearing its answer is allowed too.
    const shown: Answers = { [q.id]: { optionIds: [yes.id] }, [followUp.id]: { text: 'Su axır' } };
    expect(reworkViolations(c, shown, { [q.id]: { optionIds: [no.id] } }, flagged)).toEqual([]);
    // A follow-up hidden again may keep a leftover answer: hidden before and after, it is never locked.
    expect(reworkViolations(c, before, { [q.id]: { optionIds: [no.id] }, [followUp.id]: { text: 'Su axır' } }, flagged)).toEqual([]);
    // A follow-up visible before and after, and not flagged, stays outside the round.
    expect(reworkViolations(c, shown, { ...shown, [followUp.id]: { text: 'Başqa' } }, new Set([temp.id]))).toEqual([followUp.id]);
  });
});

describe('run audit state (reports runs column)', () => {
  it('derives waiting, in progress, passed and failed', () => {
    expect(runAuditState('audit_pending', null)).toBe('waiting');
    expect(runAuditState('audit_pending', { status: 'cancelled', result: null })).toBe('waiting');
    expect(runAuditState('completed', { status: 'cancelled', result: null })).toBeNull();
    expect(runAuditState('completed', null)).toBeNull();
    expect(runAuditState(CORRECTION_REQUIRED, { status: 'in_progress', result: null })).toBe('in_progress');
    expect(runAuditState('audited', { status: 'finished', result: 'passed' })).toBe('passed');
    expect(runAuditState('audited', { status: 'finished', result: 'failed' })).toBe('failed');
  });
});

describe('report e-mail addresses', () => {
  it('lower-cases, de-duplicates and caps the checklist list at 10', () => {
    expect(auditReportEmailsSchema.parse([' Boss@Acme.az', 'boss@acme.az', 'qa@acme.az'])).toEqual(['boss@acme.az', 'qa@acme.az']);
    expect(auditReportEmailsSchema.safeParse(['not-an-email']).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@acme.az`);
    expect(auditReportEmailsSchema.safeParse(eleven).error?.issues[0]?.message).toBe('audits.issues.tooManyEmails');
  });

  it('merges the checklist list and the extra addresses, checklist first, at most 20', () => {
    expect(reportRecipients(['a@x.az', 'B@x.az'], ['b@x.az', 'C@x.az'])).toEqual(['a@x.az', 'b@x.az', 'c@x.az']);
    const many = Array.from({ length: 30 }, (_, i) => `u${i}@x.az`);
    expect(reportRecipients(many.slice(0, 10), many.slice(10))).toHaveLength(20);
    expect(reportRecipients([], [])).toEqual([]);
  });
});
