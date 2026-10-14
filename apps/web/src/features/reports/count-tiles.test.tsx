import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { CountTiles } from './count-tiles';
import { IDS, reportSummary } from './fixtures';
import { DASHBOARD_TILES, SUMMARY_TILES } from './labels';

vi.mock('@/lib/session', () => ({ useMe: () => ({ tenant: { timezone: 'Asia/Baku', locale: 'az' } }) }));

/** The path and the query of a tile's link. */
function target(name: string) {
  const url = new URL(screen.getByRole('link', { name }).getAttribute('href')!, 'http://localhost');
  return { path: url.pathname, search: Object.fromEntries(url.searchParams) };
}

describe('CountTiles', () => {
  it('links every count to the runs report of its bucket, with the same filters', async () => {
    const search = { period: 'custom', from: '2026-11-01', to: '2026-11-15', siteId: IDS.zoneA, inactive: true } as const;
    renderWithRouter(<CountTiles summary={reportSummary()} search={search} keys={SUMMARY_TILES} />);
    await screen.findByRole('link', { name: 'Planlaşdırılıb: 12' });
    const same = { period: 'custom', from: '2026-11-01', to: '2026-11-15', siteId: IDS.zoneA, inactive: 'true', tab: 'runs' };
    expect(target('Planlaşdırılıb: 12')).toEqual({ path: '/reports', search: { ...same, bucket: 'planned' } });
    expect(target('Tamamlanıb: 7').search).toEqual({ ...same, bucket: 'completed' });
    expect(target('Davam edir: 1').search).toEqual({ ...same, bucket: 'in_progress' });
    expect(target('Gecikib: 1').search).toEqual({ ...same, bucket: 'overdue' });
    expect(target('Yarımçıq: 1').search).toEqual({ ...same, bucket: 'partial' });
    expect(target('Buraxılıb: 0').search).toEqual({ ...same, bucket: 'missed' });
    expect(target('Problemli: 2').search).toEqual({ ...same, bucket: 'problems' });
  });

  it('shows the completion and the average score, explains completion, and a dash when there is none', async () => {
    renderWithRouter(<CountTiles summary={reportSummary()} search={{}} keys={DASHBOARD_TILES} />);
    const completion = await screen.findByRole('group', { name: 'Tamamlanma faizi' });
    expect(completion).toHaveTextContent('70%');
    expect(completion).toHaveAccessibleDescription('Vaxtı çatmış icralardan tamamlananların payı');
    expect(screen.getByRole('group', { name: 'Orta bal' })).toHaveTextContent('87,5%');
    // The dashboard's five counts only.
    expect(screen.getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByRole('link', { name: /^Yarımçıq/ })).not.toBeInTheDocument();
    cleanup();
    renderWithRouter(<CountTiles summary={reportSummary({ completionPercent: null, averageScore: null })} search={{}} keys={DASHBOARD_TILES} />);
    expect(await screen.findByRole('group', { name: 'Tamamlanma faizi' })).toHaveTextContent('—');
    expect(screen.getByRole('group', { name: 'Orta bal' })).toHaveTextContent('—');
  });
});
