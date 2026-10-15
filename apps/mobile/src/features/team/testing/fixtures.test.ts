import {
  auditDetailSchema,
  employeeReportRowSchema,
  executionCorrectionsSchema,
  executionDetailSchema,
  meSchema,
  occurrenceDetailSchema,
  reportRunPageSchema,
  reportSummarySchema,
  syncResponseSchema,
} from '@taskop/contracts';
import { checklist, reworkSync } from '@/offline/testing/fixtures';
import {
  auditBrief,
  auditDetail,
  auditVerdict,
  correction,
  employeeRow,
  executionCorrections,
  executionDetail,
  missedOccurrence,
  occurrenceDetail,
  reportRun,
  reportSummary,
  RUN_CURSOR,
  runPage,
  teamMe,
  teamRework,
  unassignedRow,
} from './fixtures';

/** The issues a schema finds; [] when it accepts the value. */
const issues = (schema: { safeParse(v: unknown): { error?: { issues: unknown[] } } }, value: unknown) => schema.safeParse(value).error?.issues ?? [];

describe('team fixtures', () => {
  it('match Part 1’s report schemas', () => {
    expect(issues(reportSummarySchema, reportSummary())).toEqual([]);
    expect(issues(employeeReportRowSchema, employeeRow())).toEqual([]);
    expect(issues(employeeReportRowSchema, unassignedRow())).toEqual([]);
    expect(issues(reportRunPageSchema, runPage([reportRun()], RUN_CURSOR))).toEqual([]);
  });

  it('match the profile and run-detail schemas', () => {
    expect(issues(meSchema, teamMe())).toEqual([]);
    expect(issues(occurrenceDetailSchema, occurrenceDetail())).toEqual([]);
    expect(issues(occurrenceDetailSchema, missedOccurrence())).toEqual([]);
    expect(issues(executionDetailSchema, executionDetail(checklist()))).toEqual([]);
  });

  it('match Part 1’s audit, correction and rework schemas', () => {
    const c = checklist();
    expect(issues(auditDetailSchema, auditDetail(c, { verdicts: [auditVerdict(c.problem.id)] }))).toEqual([]);
    expect(issues(executionCorrectionsSchema, executionCorrections({ corrections: [correction()], reworkRequests: [teamRework()] }))).toEqual([]);
    expect(issues(executionDetailSchema, executionDetail(c, { reworkRound: 1, rework: teamRework(), corrected: true, audit: auditBrief() }))).toEqual([]);
    expect(issues(syncResponseSchema, reworkSync(c, [{ itemId: c.temp.id, comment: 'Temperaturu yenidən ölçün' }]))).toEqual([]);
  });
});
