import { QueryClient } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { occurrenceDetail } from '@/features/executions/fixtures';
import { taskDetail } from '@/features/tasks/fixtures';
import { renderWithRouter } from '@/test/router';
import { ReportTaskDrawer, RunDrawer } from './drawers';
import { IDS, meWith, VIEWER } from './fixtures';

const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: { occurrences: { get: vi.fn(), cancel: vi.fn() }, executions: { get: vi.fn() }, tasks: { get: vi.fn() }, taskMedia: { url: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = meWith([...VIEWER, 'tasks.view']);
  mocks.api.occurrences.get.mockImplementation(async (id: string) => occurrenceDetail({ id }));
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('report drawers', () => {
  it('refreshes every report query when the run drawer closes', async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onClose = vi.fn();
    renderWithRouter(<RunDrawer id={IDS.run} tab="execution" onClose={onClose} />, '/', qc);
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByRole('tab', { name: 'İcra' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.occurrences.get).toHaveBeenCalledWith(IDS.run);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
  });

  it('refreshes every report query when the task drawer closes', async () => {
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onClose = vi.fn();
    renderWithRouter(<ReportTaskDrawer id={IDS.task} onClose={onClose} />, '/', qc);
    const drawer = await screen.findByRole('dialog');
    expect(mocks.api.tasks.get).toHaveBeenCalledWith(IDS.task);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['reports'] });
  });
});
