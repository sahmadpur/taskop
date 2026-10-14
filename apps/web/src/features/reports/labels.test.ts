import { ApiError } from '@taskop/api-client';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { CHECKLISTS, completedRun, EMPLOYEE_ROWS, IDS, reportRun, SITE_ROWS, SITES } from './fixtures';
import {
  checklistOptions,
  employeeOptions,
  exportErrorText,
  exportQuery,
  nextSort,
  percentText,
  runPeople,
  siteOptions,
  sortRows,
  SUMMARY_TILES,
  tileSearch,
} from './labels';

const t = i18n.t.bind(i18n);
const FILTERS = { from: '2026-11-01', to: '2026-11-30', siteId: IDS.zoneA };

describe('tiles', () => {
  it('links each count to the runs report of its bucket, with the same filters', () => {
    const search = { period: 'last_7', siteId: IDS.zoneA, inactive: true } as const;
    expect(SUMMARY_TILES.map((k) => [k, tileSearch(search, k).bucket])).toEqual([
      ['planned', 'planned'],
      ['completed', 'completed'],
      ['inProgress', 'in_progress'],
      ['overdue', 'overdue'],
      ['partial', 'partial'],
      ['missed', 'missed'],
      ['withProblems', 'problems'],
    ]);
    expect(tileSearch(search, 'overdue')).toEqual({ period: 'last_7', siteId: IDS.zoneA, inactive: true, tab: 'runs', bucket: 'overdue' });
  });

  it('shows percentages with one decimal, and a dash when there is none', () => {
    expect(percentText(t, 70, 'az')).toBe('70%');
    expect(percentText(t, 87.5, 'az')).toBe('87,5%');
    expect(percentText(t, 0, 'az')).toBe('0%');
    expect(percentText(t, null, 'az')).toBe('—');
  });
});

describe('sortRows', () => {
  const pct = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('keeps the server order without a sort, sorts numbers with missing values last, and reverses', () => {
    expect(pct(sortRows(SITE_ROWS, null))).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(pct(sortRows(SITE_ROWS, { key: 'completionPercent', dir: 'desc' }))).toEqual(['Zona A1', 'Filial A', 'Zona B (köhnə)']);
    expect(pct(sortRows(SITE_ROWS, { key: 'completionPercent', dir: 'asc' }))).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(pct(sortRows(SITE_ROWS, { key: 'name', dir: 'desc' }))).toEqual(['Zona B (köhnə)', 'Zona A1', 'Filial A']);
  });

  it('keeps a pinned row last whatever the sort', () => {
    const unassigned = (r: { userId: string | null }) => r.userId === null;
    expect(pct(sortRows(EMPLOYEE_ROWS, { key: 'planned', dir: 'desc' }, unassigned))).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf Həsənov', 'Təyin edilməyib']);
    expect(pct(sortRows(EMPLOYEE_ROWS, { key: 'name', dir: 'desc' }, unassigned))).toEqual(['Rauf Həsənov', 'Kamran Əliyev', 'Aynur Quliyeva', 'Təyin edilməyib']);
  });

  it('sorts names A to Z and numbers high to low first, then reverses', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(null, 'planned')).toEqual({ key: 'planned', dir: 'desc' });
    expect(nextSort({ key: 'planned', dir: 'desc' }, 'planned')).toEqual({ key: 'planned', dir: 'asc' });
    expect(nextSort({ key: 'planned', dir: 'asc' }, 'missed')).toEqual({ key: 'missed', dir: 'desc' });
  });
});

describe('picker options', () => {
  it('lists sites in tree order, inactive ones only when asked or selected', () => {
    expect(siteOptions(SITES, false).map((s) => s.name)).toEqual(['Filial A', 'Zona A1']);
    expect(siteOptions(SITES, true).map((s) => s.name)).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
    expect(siteOptions(SITES, false, IDS.zoneB).map((s) => s.name)).toEqual(['Filial A', 'Zona A1', 'Zona B (köhnə)']);
  });

  it('lists the period’s people without the Unassigned row, deactivated ones only when asked or selected', () => {
    expect(employeeOptions(EMPLOYEE_ROWS, false)).toEqual([
      { id: IDS.aynur, name: 'Aynur Quliyeva', active: true },
      { id: IDS.kamran, name: 'Kamran Əliyev', active: true },
    ]);
    expect(employeeOptions(EMPLOYEE_ROWS, true).map((e) => e.name)).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf Həsənov']);
    expect(employeeOptions(EMPLOYEE_ROWS, false, IDS.rauf).map((e) => e.name)).toEqual(['Aynur Quliyeva', 'Kamran Əliyev', 'Rauf Həsənov']);
  });

  it('lists active checklists by name, deactivated ones only when asked or selected', () => {
    expect(checklistOptions(CHECKLISTS, false).map((c) => c.name)).toEqual(['Açılış yoxlaması']);
    expect(checklistOptions([...CHECKLISTS].reverse(), true).map((c) => c.name)).toEqual(['Açılış yoxlaması', 'Köhnə yoxlama']);
    expect(checklistOptions(CHECKLISTS, false, IDS.oldChecklist).map((c) => c.name)).toEqual(['Açılış yoxlaması', 'Köhnə yoxlama']);
  });
});

describe('exports', () => {
  it('sends the bucket with runs and the severity with problems, nothing extra otherwise', () => {
    const extra = { bucket: 'overdue', severity: 'critical' } as const;
    expect(exportQuery('runs', FILTERS, 'xlsx', extra)).toEqual({ ...FILTERS, format: 'xlsx', bucket: 'overdue' });
    expect(exportQuery('problems', FILTERS, 'csv', extra)).toEqual({ ...FILTERS, format: 'csv', severity: 'critical' });
    expect(exportQuery('sites', FILTERS, 'pdf', extra)).toEqual({ ...FILTERS, format: 'pdf' });
    expect(exportQuery('full', FILTERS, 'pdf', extra)).toEqual({ ...FILTERS, format: 'pdf' });
    expect(exportQuery('problems', FILTERS, 'csv', {})).toEqual({ ...FILTERS, format: 'csv' });
  });

  it('explains a too large export with its row count and limit, other errors from az.errors', () => {
    const tooLarge = new ApiError(422, 'REPORT_TOO_LARGE', 'errors.REPORT_TOO_LARGE', null, null, 'r1', null, null, null, null, 12000, 10000);
    expect(exportErrorText(t, tooLarge)).toBe('Hesabatda 12000 sətir var (limit 10000). Filtrləri daraldın.');
    const timeout = new ApiError(503, 'REPORT_TIMEOUT', 'errors.REPORT_TIMEOUT');
    expect(exportErrorText(t, timeout)).toBe('Hesabat vaxtında hazırlanmadı. Dövrü qısaldın və ya bir az sonra yenidən cəhd edin.');
  });
});

describe('runPeople', () => {
  it('names the executor, else the assignees, else Unassigned', () => {
    expect(runPeople(t, completedRun())).toBe('Aynur Quliyeva');
    expect(runPeople(t, reportRun())).toBe('Aynur Quliyeva, Kamran Əliyev');
    expect(runPeople(t, reportRun({ assignees: [] }))).toBe(t('reports.employees.unassigned'));
  });
});
