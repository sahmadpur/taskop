import { type DataScope, PERIOD_PRESETS, type PermissionKey, RUN_BUCKETS } from '@taskop/contracts';
import { OCC, OCC2, OCC3 } from '@/offline/testing/fixtures';
import { canSeeTeam, CHIP_BUCKETS, employeeChoices, notCompleted, TEAM_CHIPS, TEAM_PERIODS, teamPeriod, uniqueRuns } from './team-rules';
import { employeeRow, KAMRAN, reportRun, unassignedRow, WORKER_A, WORKER_B } from './testing/fixtures';

const viewer = (permissions: PermissionKey[], dataScope: DataScope) => ({ permissions, role: { dataScope } });

describe('canSeeTeam (spec §7.1)', () => {
  it('needs reports.view and a data scope wider than own', () => {
    expect(canSeeTeam(viewer(['reports.view'], 'site_subtree'))).toBe(true);
    expect(canSeeTeam(viewer(['reports.view'], 'subordinates'))).toBe(true);
    expect(canSeeTeam(viewer(['reports.view', 'reports.export'], 'all'))).toBe(true);
    expect(canSeeTeam(viewer(['reports.view'], 'own'))).toBe(false);
    expect(canSeeTeam(viewer(['assignments.view', 'reports.export'], 'all'))).toBe(false);
    expect(canSeeTeam(viewer([], 'own'))).toBe(false);
  });
});

describe('periods', () => {
  const monday = Date.parse('2026-11-02T04:10:00.000Z'); // 08:10 on Monday 2 Nov in Baku

  it('offers today, 7 and 30 days as Part 1 presets', () => {
    expect(TEAM_PERIODS).toEqual(['today', 'last_7', 'last_30']);
    for (const p of TEAM_PERIODS) expect(PERIOD_PRESETS).toContain(p);
  });

  it('resolves each chip from the tenant’s today', () => {
    expect(teamPeriod('today', monday, 'Asia/Baku')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(teamPeriod('last_7', monday, 'Asia/Baku')).toEqual({ from: '2026-10-27', to: '2026-11-02' });
    expect(teamPeriod('last_30', monday, 'Asia/Baku')).toEqual({ from: '2026-10-04', to: '2026-11-02' });
  });

  it('takes the tenant’s day, not the phone’s', () => {
    const instant = Date.parse('2026-11-01T21:30:00.000Z'); // 01:30 on 2 Nov in Baku, 16:30 on 1 Nov in New York
    expect(teamPeriod('today', instant, 'Asia/Baku')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(teamPeriod('today', instant, 'America/New_York')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });
});

describe('status chips', () => {
  it('map onto the runs buckets of the same name, all first', () => {
    expect(TEAM_CHIPS.map((c) => CHIP_BUCKETS[c])).toEqual(['all', 'overdue', 'partial', 'missed', 'problems']);
    for (const c of TEAM_CHIPS) expect(RUN_BUCKETS).toContain(CHIP_BUCKETS[c]);
  });
});

describe('tiles and people', () => {
  it('counts the due runs that are not completed', () => {
    expect(notCompleted({ due: 10, completed: 7 })).toBe(3);
    expect(notCompleted({ due: 0, completed: 0 })).toBe(0);
  });

  it('offers every employee row but the Unassigned one, active people first', () => {
    const rows = [employeeRow({ userId: WORKER_B, name: KAMRAN.fullName, active: false }), employeeRow(), unassignedRow()];
    expect(employeeChoices(rows)).toEqual([
      { userId: WORKER_A, name: 'Aynur Quliyeva', active: true },
      { userId: WORKER_B, name: 'Kamran Əliyev', active: false },
    ]);
    expect(employeeChoices([unassignedRow()])).toEqual([]);
  });
});

describe('uniqueRuns', () => {
  it('keeps each run once, at its first place', () => {
    const pages = [
      { items: [reportRun(), reportRun({ occurrenceId: OCC2 })] },
      { items: [reportRun({ occurrenceId: OCC2, status: 'missed' }), reportRun({ occurrenceId: OCC3 })] },
    ];
    expect(uniqueRuns(pages).map((r) => [r.occurrenceId, r.status])).toEqual([
      [OCC, 'completed'],
      [OCC2, 'completed'],
      [OCC3, 'completed'],
    ]);
    expect(uniqueRuns([])).toEqual([]);
  });
});
