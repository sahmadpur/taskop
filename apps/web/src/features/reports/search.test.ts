import { describe, expect, it } from 'vitest';
import { cleanSearch, filterSearch, pageExtras, reportSearch, reportsPageSearch, resolveReportFilters, withPeriod } from './search';

const SITE = '0192f1e2-7c3a-7b4d-8e5f-0000000000b2';
const USER = '0192f1e2-7c3a-7b4d-8e5f-0000000000c1';
const LIST = '0192f1e2-7c3a-7b4d-8e5f-0000000000d1';
/** A Wednesday. */
const TODAY = '2026-11-04';

describe('reportsPageSearch', () => {
  it('keeps every valid parameter of a shared URL', () => {
    const s = {
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      siteId: SITE,
      userId: USER,
      checklistId: LIST,
      inactive: true,
      tab: 'runs',
      bucket: 'missed',
      severity: 'critical',
    };
    expect(reportsPageSearch(s)).toEqual(s);
  });

  it('drops what a hand-edited or old bookmark gets wrong', () => {
    expect(
      reportsPageSearch({ period: 'last_90', from: '2026-02-30', siteId: 'site-1', userId: 42, checklistId: '', tab: 'audit', bucket: 'late', severity: 'major', inactive: 'yes' }),
    ).toEqual({});
    // A range belongs to the custom period only: a preset ignores a leftover one.
    expect(reportsPageSearch({ period: 'this_week', from: '2026-10-01', to: '2026-10-31' })).toEqual({ period: 'this_week' });
    expect(reportsPageSearch({ from: '2026-10-01', to: '2026-10-31' })).toEqual({});
    // A custom period keeps a half-typed range, so the filter bar can ask for the other end.
    expect(reportsPageSearch({ period: 'custom', from: '2026-10-01', to: 'tomorrow' })).toEqual({ period: 'custom', from: '2026-10-01' });
  });

  it('reads "show inactive" both as the router parses it and as a raw string', () => {
    expect(reportSearch({ inactive: true })).toEqual({ inactive: true });
    expect(reportSearch({ inactive: 'true' })).toEqual({ inactive: true });
    expect(reportSearch({ inactive: false })).toEqual({});
  });

  it('gives the dashboard only the shared filters', () => {
    expect(reportSearch({ period: 'last_7', siteId: SITE, tab: 'runs', bucket: 'overdue' })).toEqual({ period: 'last_7', siteId: SITE });
  });
});

describe('resolveReportFilters', () => {
  it("resolves the presets from the tenant's today, Today by default", () => {
    const range = (from: string, to = TODAY) => ({ ok: true, filters: { from, to } });
    expect(resolveReportFilters({}, TODAY)).toEqual(range(TODAY));
    expect(resolveReportFilters({ period: 'yesterday' }, TODAY)).toEqual(range('2026-11-03', '2026-11-03'));
    expect(resolveReportFilters({ period: 'this_week' }, TODAY)).toEqual(range('2026-11-02'));
    expect(resolveReportFilters({ period: 'this_month' }, TODAY)).toEqual(range('2026-11-01'));
    expect(resolveReportFilters({ period: 'last_7' }, TODAY)).toEqual(range('2026-10-29'));
    expect(resolveReportFilters({ period: 'last_30' }, TODAY)).toEqual(range('2026-10-06'));
  });

  it('adds the site, employee and checklist, never the picker toggle', () => {
    expect(resolveReportFilters({ siteId: SITE, userId: USER, checklistId: LIST, inactive: true }, TODAY)).toEqual({
      ok: true,
      filters: { from: TODAY, to: TODAY, siteId: SITE, userId: USER, checklistId: LIST },
    });
  });

  it('checks a custom range before anything is asked', () => {
    expect(resolveReportFilters({ period: 'custom', from: '2026-10-01' }, TODAY)).toEqual({ ok: false, issue: 'incomplete' });
    expect(resolveReportFilters({ period: 'custom', from: '2026-10-31', to: '2026-10-01' }, TODAY)).toEqual({ ok: false, issue: 'toBeforeFrom' });
    // 366 days (to − from = 365) is the longest range; one day more is refused, as the API would.
    expect(resolveReportFilters({ period: 'custom', from: '2025-11-05', to: '2026-11-05' }, TODAY)).toEqual({ ok: true, filters: { from: '2025-11-05', to: '2026-11-05' } });
    expect(resolveReportFilters({ period: 'custom', from: '2025-11-04', to: '2026-11-05' }, TODAY)).toEqual({ ok: false, issue: 'tooLong' });
    expect(resolveReportFilters({ period: 'custom', from: '2026-10-07', to: '2026-10-07', siteId: SITE }, TODAY)).toEqual({
      ok: true,
      filters: { from: '2026-10-07', to: '2026-10-07', siteId: SITE },
    });
  });
});

describe('withPeriod', () => {
  it('pre-fills a custom range with the current period and keeps the other filters', () => {
    expect(withPeriod({ period: 'this_week', siteId: SITE, inactive: true }, 'custom', TODAY)).toEqual({
      period: 'custom',
      from: '2026-11-02',
      to: TODAY,
      siteId: SITE,
      inactive: true,
    });
  });

  it('drops the range when a preset is chosen', () => {
    expect(withPeriod({ period: 'custom', from: '2026-10-01', to: '2026-10-31', userId: USER }, 'last_7', TODAY)).toEqual({ period: 'last_7', userId: USER });
  });

  it('starts an unusable custom range over at today', () => {
    expect(withPeriod({ period: 'custom', from: '2026-10-31', to: '2026-10-01' }, 'custom', TODAY)).toEqual({ period: 'custom', from: TODAY, to: TODAY });
  });
});

describe('search parts', () => {
  it('splits the shared filters from the page parameters and drops empty values', () => {
    const s = { period: 'custom', from: '2026-10-01', to: '2026-10-31', siteId: SITE, inactive: true, tab: 'runs', bucket: 'overdue', severity: 'critical' } as const;
    expect(filterSearch(s)).toEqual({ period: 'custom', from: '2026-10-01', to: '2026-10-31', siteId: SITE, inactive: true });
    expect(pageExtras(s)).toEqual({ tab: 'runs', bucket: 'overdue', severity: 'critical' });
    expect(cleanSearch({ period: 'today', siteId: '', userId: undefined, checklistId: null })).toEqual({ period: 'today' });
  });
});
