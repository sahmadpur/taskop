import { emptyRunCounts, type ReportProblem, type ReportRun, type ReportSummary, type ReportTask, type SiteReportRow } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import * as T from './report-tables';

// The Azerbaijani tables, which most cases check.
const summaryTables = (s: ReportSummary) => T.summaryTables(s, 'az');
const sitesTable = (r: SiteReportRow[]) => T.sitesTable(r, 'az');
const employeesTable = (r: Parameters<typeof T.employeesTable>[0]) => T.employeesTable(r, 'az');
const runsTable = (r: ReportRun[], title: string) => T.runsTable(r, title, 'az');
const runsTitle = (b: Parameters<typeof T.runsTitle>[0]) => T.runsTitle(b, 'az');
const problemsTable = (r: ReportProblem[]) => T.problemsTable(r, 'az');
const tasksTable = (r: ReportTask[]) => T.tasksTable(r, 'az');

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';

describe('report tables', () => {
  it('lays out the summary as measures and a daily trend', () => {
    const s: ReportSummary = {
      counts: { ...emptyRunCounts(), planned: 15, due: 13, completed: 7 },
      completionPercent: 53.8,
      averageScore: null,
      trend: [{ date: '2026-11-02', due: 6, completed: 4, completionPercent: 66.7 }],
    };
    const [measures, trend] = summaryTables(s);
    expect(measures!.title).toBe('Xülasə');
    expect(measures!.columns.map((c) => c.label)).toEqual(['Göstərici', 'Dəyər']);
    expect(measures!.rows).toHaveLength(12);
    expect(measures!.rows.slice(0, 3)).toEqual([['Planlaşdırılıb', 15], ['Vaxtı çatıb', 13], ['Tamamlanıb', 7]]);
    expect(measures!.rows.slice(-2)).toEqual([['Tamamlanma faizi', 53.8], ['Orta bal', null]]);
    expect(trend).toEqual({
      title: 'Gündəlik',
      columns: [{ label: 'Tarix', type: 'date' }, { label: 'Vaxtı çatıb', type: 'int' }, { label: 'Tamamlanıb', type: 'int' }, { label: 'Tamamlanma faizi', type: 'decimal' }],
      rows: [['2026-11-02', 6, 4, 66.7]],
    });
  });

  it('writes run rows with Azerbaijani statuses and the device and server times', () => {
    const run: ReportRun = {
      occurrenceId: ID, executionId: ID, localDate: '2026-11-02', dueAt: '2026-11-02T06:00:00.000Z',
      checklist: { id: ID, name: 'Açılış yoxlaması' }, site: { id: ID, name: 'Zona A1' }, status: 'completed',
      assignees: [{ id: ID, fullName: 'Aynur' }, { id: ID, fullName: 'Kamran' }], executor: { id: ID, fullName: 'Kamran' },
      startedAt: '2026-11-02T04:10:00.000Z', completedAt: '2026-11-02T05:40:00.000Z', completedReceivedAt: '2026-11-04T05:00:00.000Z',
      score: 100, problemCount: 1, criticalCount: 0, late: false, clockSuspect: true, auditState: 'passed', corrected: true,
    };
    const t = runsTable([run], runsTitle('all'));
    expect(t.title).toBe('İcralar');
    expect(t.columns.map((c) => c.label)).toEqual([
      'Tarix', 'Son vaxt', 'Yoxlama vərəqəsi', 'Obyekt', 'Status', 'İcraçılar', 'İcra edən', 'Başlanıb', 'Tamamlanıb (cihaz)', 'Serverə çatıb', 'Bal', 'Problemlər', 'Kritik', 'Gecikmə ilə', 'Saat şübhəli', 'Audit', 'Düzəliş edilib',
    ]);
    expect(t.rows[0]).toEqual([
      '2026-11-02', '2026-11-02T06:00:00.000Z', 'Açılış yoxlaması', 'Zona A1', 'Tamamlanıb', 'Aynur, Kamran', 'Kamran',
      '2026-11-02T04:10:00.000Z', '2026-11-02T05:40:00.000Z', '2026-11-04T05:00:00.000Z', 100, 1, 0, false, true, 'Audit uğurlu', true,
    ]);
    expect(runsTitle('missed')).toBe('İcralar (Buraxılmış)');
  });

  it('joins a site’s ancestors and labels the Unassigned employee', () => {
    const site: SiteReportRow = { ...emptyRunCounts(), planned: 7, siteId: ID, name: 'Zona A1', path: ['Filial A', 'Mərkəz'], active: false, completionPercent: 57.1, averageScore: 85 };
    const t = sitesTable([site]);
    expect(t.rows[0]!.slice(0, 4)).toEqual(['Zona A1', 'Filial A › Mərkəz', false, 7]);
    expect(t.rows[0]!.slice(-2)).toEqual([57.1, 85]);
    const e = employeesTable([{ ...emptyRunCounts(), userId: null, name: 'Təyin edilməyib', active: true, completionPercent: 0, averageScore: null }]);
    expect(e.columns.slice(0, 2).map((c) => c.label)).toEqual(['Əməkdaş', 'Aktiv']);
    expect(e.rows[0]!.slice(0, 2)).toEqual(['Təyin edilməyib', true]);
  });

  it('writes problem and task rows with their Azerbaijani labels', () => {
    const problem = {
      id: ID, executionId: ID, occurrenceId: ID, localDate: '2026-11-02', siteId: ID, siteName: 'Filial B', checklistId: ID, checklistName: 'Açılış yoxlaması',
      itemId: ID, itemLabel: 'Temperatur', source: 'manual', severity: 'critical', note: 'Kondisioner xarabdır', mediaIds: [], media: [],
      executorName: 'Nigar', createdAt: '2026-11-02T05:10:00.000Z', resolution: 'open', taskId: ID, executionState: 'completed', taskStatus: 'in_progress', clearedAt: null,
    } satisfies ReportProblem;
    expect(problemsTable([problem]).rows[0]).toEqual([
      '2026-11-02', 'Filial B', 'Açılış yoxlaması', 'Temperatur', 'Kritik', 'Əl ilə qeyd', 'Kondisioner xarabdır', 'Nigar', '2026-11-02T05:10:00.000Z', 'Açıq', 'İcradadır',
    ]);
    const task: ReportTask = {
      id: ID, title: 'Qapını təmir et', priority: 'high', status: 'completed', site: null, assignee: null, team: { id: ID, name: 'Texniki xidmət' },
      dueAt: '2026-11-03T08:00:00.000Z', completedAt: '2026-11-03T09:00:00.000Z', createdAt: '2026-11-01T08:00:00.000Z', overdue: true, problemId: null,
    };
    expect(tasksTable([task]).rows[0]).toEqual(['Qapını təmir et', null, 'Texniki xidmət', 'Tamamlanıb', 'Yüksək', '2026-11-03T08:00:00.000Z', '2026-11-03T09:00:00.000Z', true]);
  });
});

describe('report table languages', () => {
  it('labels the headings, columns and enum cells in English and Russian', () => {
    const run: ReportRun = {
      occurrenceId: ID, executionId: ID, localDate: '2026-11-02', dueAt: '2026-11-02T06:00:00.000Z',
      checklist: { id: ID, name: 'Açılış yoxlaması' }, site: { id: ID, name: 'Zona A1' }, status: 'completed',
      assignees: [], executor: null, startedAt: null, completedAt: null, completedReceivedAt: null,
      score: null, problemCount: 0, criticalCount: 0, late: false, clockSuspect: false, auditState: 'passed', corrected: false,
    };
    const en = T.runsTable([run], T.runsTitle('missed', 'en'), 'en');
    expect(en.title).toBe('Runs (Missed)');
    expect(en.columns.slice(0, 5).map((c) => c.label)).toEqual(['Date', 'Due by', 'Checklist', 'Site', 'Status']);
    expect(en.rows[0]![4]).toBe('Completed');
    expect(en.rows[0]![15]).toBe('Audit passed');
    const ru = T.runsTable([run], T.runsTitle('all', 'ru'), 'ru');
    expect(ru.title).toBe('Выполнения');
    expect(ru.rows[0]![4]).toBe('Завершено');
    expect(T.summaryTables({ counts: emptyRunCounts(), completionPercent: 0, averageScore: null, trend: [] }, 'en')[0]!.title).toBe('Summary');
  });
});
