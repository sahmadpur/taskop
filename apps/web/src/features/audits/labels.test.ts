import { describe, expect, it } from 'vitest';
import { executionFixture } from '@/features/executions/fixtures';
import { IDS } from '@/features/reports/fixtures';
import i18n from '@/lib/i18n';
import { verdict } from './fixtures';
import {
  actorName,
  auditItems,
  auditsSearch,
  queueFilters,
  queueRangeIssue,
  resultVariant,
  runAuditStateVariant,
  stepItem,
  upsertVerdict,
  verdictMap,
  verdictVariant,
} from './labels';

const t = i18n.t.bind(i18n);

describe('audit badges', () => {
  it('colours results, run audit states and verdicts', () => {
    expect(resultVariant('passed')).toBe('default');
    expect(resultVariant('failed')).toBe('destructive');
    expect(runAuditStateVariant('waiting')).toBe('outline');
    expect(runAuditStateVariant('in_progress')).toBe('secondary');
    expect(runAuditStateVariant('passed')).toBe('default');
    expect(runAuditStateVariant('failed')).toBe('destructive');
    expect(verdictVariant('approved')).toBe('default');
    expect(verdictVariant('rejected')).toBe('destructive');
    expect(verdictVariant(null)).toBe('outline');
  });
});

describe('auditsSearch', () => {
  it('keeps every valid parameter of a shared /audits URL', () => {
    const s = { queue: 'finished', siteId: IDS.zoneA, checklistId: IDS.checklist, auditorId: IDS.aynur, result: 'failed', from: '2026-10-01', to: '2026-10-31' };
    expect(auditsSearch(s)).toEqual(s);
  });

  it('drops what a hand-edited link gets wrong', () => {
    expect(auditsSearch({ queue: 'done', siteId: 'site-1', checklistId: 7, auditorId: '', result: 'ok', from: '2026-02-30', to: 'tomorrow' })).toEqual({});
  });
});

describe('queueRangeIssue', () => {
  it('needs both dates, in order, at most 366 days apart counting both ends', () => {
    expect(queueRangeIssue()).toBeNull();
    expect(queueRangeIssue('2026-10-01')).toBe('incomplete');
    expect(queueRangeIssue(undefined, '2026-10-01')).toBe('incomplete');
    expect(queueRangeIssue('2026-10-31', '2026-10-01')).toBe('inverted');
    expect(queueRangeIssue('2026-10-01', '2026-10-01')).toBeNull();
    expect(queueRangeIssue('2025-11-01', '2026-11-01')).toBeNull();
    expect(queueRangeIssue('2025-10-31', '2026-11-01')).toBe('tooLong');
  });
});

describe('queueFilters', () => {
  it('asks only for what the open queue has: no auditor while waiting, a result only when finished', () => {
    const s = { siteId: IDS.zoneA, checklistId: IDS.checklist, auditorId: IDS.aynur, result: 'failed' as const, from: '2026-10-01', to: '2026-10-31' };
    expect(queueFilters(s)).toEqual({ queue: 'waiting', siteId: IDS.zoneA, checklistId: IDS.checklist, from: '2026-10-01', to: '2026-10-31' });
    expect(queueFilters({ ...s, queue: 'in_progress' })).toEqual({
      queue: 'in_progress',
      siteId: IDS.zoneA,
      checklistId: IDS.checklist,
      auditorId: IDS.aynur,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(queueFilters({ ...s, queue: 'finished' })).toEqual({
      queue: 'finished',
      siteId: IDS.zoneA,
      checklistId: IDS.checklist,
      auditorId: IDS.aynur,
      result: 'failed',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    // Half a range is never sent.
    expect(queueFilters({ queue: 'finished', from: '2026-10-01' })).toEqual({ queue: 'finished' });
  });
});

describe('audit items', () => {
  it('lists the auditable items in checklist order and steps through them without leaving the list', () => {
    const f = executionFixture();
    const ids = auditItems(f.content, f.answers, [f.note.id, f.problem.id, f.temp.id]).map((v) => v.item.id);
    expect(ids).toEqual([f.problem.id, f.temp.id, f.note.id]);
    expect(stepItem(ids, null, 1)).toBe(f.problem.id);
    expect(stepItem(ids, f.problem.id, 1)).toBe(f.temp.id);
    expect(stepItem(ids, f.note.id, 1)).toBe(f.note.id);
    expect(stepItem(ids, f.problem.id, -1)).toBe(f.problem.id);
    expect(stepItem(ids, 'gone', -1)).toBe(f.problem.id);
    expect(stepItem([], null, 1)).toBeNull();
  });

  it('maps and replaces verdicts by item', () => {
    const list = [verdict('i1', 'approved'), verdict('i2', 'rejected', 'Qırıq')];
    expect([...verdictMap(list)]).toEqual([
      ['i1', 'approved'],
      ['i2', 'rejected'],
    ]);
    expect(upsertVerdict(list, verdict('i1', 'rejected', 'Çirkli'))).toEqual([list[1], verdict('i1', 'rejected', 'Çirkli')]);
  });

  it('names people, and Taskop support for a platform admin', () => {
    expect(actorName(t, { kind: 'user', name: 'Rəşad Kazımov' })).toBe('Rəşad Kazımov');
    expect(actorName(t, { kind: 'platform', name: null })).toBe('Taskop dəstəyi');
    expect(actorName(t, null)).toBe('—');
  });
});
