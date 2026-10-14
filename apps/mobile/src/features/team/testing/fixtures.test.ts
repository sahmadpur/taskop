import { employeeReportRowSchema, executionDetailSchema, meSchema, occurrenceDetailSchema, reportRunPageSchema, reportSummarySchema } from '@taskop/contracts';
import { checklist } from '@/offline/testing/fixtures';
import { employeeRow, executionDetail, missedOccurrence, occurrenceDetail, reportRun, reportSummary, RUN_CURSOR, runPage, teamMe, unassignedRow } from './fixtures';

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
});
