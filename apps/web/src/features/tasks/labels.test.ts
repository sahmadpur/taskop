import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { taskSummary, TEAM, WORKER } from './fixtures';
import {
  assigneeText,
  dueAtFromLocal,
  dueRangeInverted,
  EMPTY_TASK_FILTERS,
  historyComment,
  localDueParts,
  resolutionVariant,
  sameChoice,
  taskListQuery,
  taskStatusVariant,
} from './labels';

const t = i18n.t.bind(i18n);

describe('task labels', () => {
  it("builds the due instant in the tenant's zone, not the browser's, across DST", () => {
    expect(dueAtFromLocal('2026-11-02', '09:00', 'Asia/Baku')).toBe('2026-11-02T05:00:00.000Z');
    // Berlin: CEST (+2) in summer, CET (+1) after 25 October.
    expect(dueAtFromLocal('2026-07-01', '09:00', 'Europe/Berlin')).toBe('2026-07-01T07:00:00.000Z');
    expect(dueAtFromLocal('2026-11-02', '09:00', 'Europe/Berlin')).toBe('2026-11-02T08:00:00.000Z');
    // 02:30 does not exist on 29 March 2026 in Berlin: it is read with the offset before the gap (03:30 CEST).
    expect(dueAtFromLocal('2026-03-29', '02:30', 'Europe/Berlin')).toBe('2026-03-29T01:30:00.000Z');
    // No time: the end of that day.
    expect(dueAtFromLocal('2026-11-02', '', 'Asia/Baku')).toBe('2026-11-02T19:59:00.000Z');
    expect(dueAtFromLocal('', '09:00', 'Asia/Baku')).toBeNull();
  });

  it('reads a due instant back as the tenant-local date and time', () => {
    expect(localDueParts('2026-11-02T08:00:00.000Z', 'Europe/Berlin')).toEqual({ date: '2026-11-02', time: '09:00' });
    expect(localDueParts('2026-11-02T21:30:00.000Z', 'Asia/Baku')).toEqual({ date: '2026-11-03', time: '01:30' });
    expect(localDueParts(null, 'Asia/Baku')).toEqual({ date: '', time: '' });
  });

  it('turns a tab and the filters into the list query', () => {
    const ctx = { userId: 'me1', timeZone: 'Asia/Baku' };
    expect(taskListQuery('all', EMPTY_TASK_FILTERS, ctx)).toEqual({});
    expect(taskListQuery('review', EMPTY_TASK_FILTERS, ctx)).toEqual({ awaitingMyReview: 'true' });
    expect(taskListQuery('overdue', EMPTY_TASK_FILTERS, ctx)).toEqual({ overdue: 'true', status: 'new,accepted,in_progress,awaiting_review' });
    expect(taskListQuery('mine', EMPTY_TASK_FILTERS, ctx)).toEqual({ createdBy: 'me1' });
    const filters = {
      status: 'in_progress',
      siteId: 'site1',
      assignee: { type: 'team', id: 'team1', name: 'Texniki xidmət' },
      source: 'problem',
      dueFrom: '2026-11-01',
      dueTo: '2026-11-02',
    } as const;
    // Whole Baku days: 1 November 00:00 (+4) to 2 November 23:59:59.999.
    expect(taskListQuery('overdue', filters, ctx)).toEqual({
      overdue: 'true',
      status: 'in_progress',
      siteId: 'site1',
      teamId: 'team1',
      source: 'problem',
      dueFrom: '2026-10-31T20:00:00.000Z',
      dueTo: '2026-11-02T19:59:59.999Z',
    });
    expect(taskListQuery('all', { ...EMPTY_TASK_FILTERS, assignee: { type: 'user', id: 'w1', name: 'Nigar' } }, ctx)).toEqual({ assigneeUserId: 'w1' });
    expect(dueRangeInverted({ ...EMPTY_TASK_FILTERS, dueFrom: '2026-11-02', dueTo: '2026-11-01' })).toBe(true);
    expect(dueRangeInverted({ ...EMPTY_TASK_FILTERS, dueFrom: '2026-11-02' })).toBe(false);
  });

  it('names the assignee and the history comment, and colours statuses and resolutions', () => {
    expect(assigneeText(t, taskSummary())).toBe('Nigar Səfərli');
    expect(assigneeText(t, taskSummary({ assignee: null, team: TEAM }))).toBe('Texniki xidmət (komanda)');
    expect(assigneeText(t, taskSummary({ assignee: WORKER, team: TEAM }))).toBe('Nigar Səfərli · Texniki xidmət');
    expect(historyComment(t, 'assignee_deactivated')).toBe('İcraçı deaktiv edildi; tapşırıq komandaya qaytarıldı');
    expect(historyComment(t, 'Foto yoxdur')).toBe('Foto yoxdur');
    expect(historyComment(t, null)).toBeNull();
    expect(sameChoice({ type: 'user', id: 'w1', name: 'a' }, { type: 'user', id: 'w1', name: 'b' })).toBe(true);
    expect(sameChoice({ type: 'user', id: 'x', name: 'a' }, { type: 'team', id: 'x', name: 'a' })).toBe(false);
    expect(sameChoice(null, null)).toBe(true);
    expect(taskStatusVariant('completed')).toBe('default');
    expect(taskStatusVariant('cancelled')).toBe('outline');
    expect(taskStatusVariant('awaiting_review')).toBe('secondary');
    expect(resolutionVariant('resolved')).toBe('default');
    expect(resolutionVariant('open')).toBe('warning');
    expect(resolutionVariant('none')).toBe('outline');
  });
});
