import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allRules, roleList } from '@/features/notifications/fixtures';
import { renderWithProviders } from '@/test/render';
import { SettingsPage } from './settings-page';

const mocks = vi.hoisted(() => ({
  permissions: { current: [] as string[] },
  api: { tenant: { get: vi.fn() }, notificationRules: { list: vi.fn() }, roles: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: (...keys: string[]) => keys.every((k) => mocks.permissions.current.includes(k)),
  session: { setMe: vi.fn() },
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.tenant.get.mockResolvedValue({
    id: 't1',
    name: 'Acme',
    orgCode: 'acme',
    timezone: 'Asia/Baku',
    locale: 'az',
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  mocks.api.notificationRules.list.mockResolvedValue(allRules());
  mocks.api.roles.list.mockResolvedValue(roleList());
});

describe('SettingsPage', () => {
  it('without notifications.manage keeps the page as it was, without tabs', async () => {
    mocks.permissions.current = ['tenant.manage'];
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByLabelText('Təşkilatın adı')).toHaveValue('Acme');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(mocks.api.notificationRules.list).not.toHaveBeenCalled();
  });

  it('with notifications.manage shows Təşkilat and Bildirişlər tabs; the rules load on their tab', async () => {
    mocks.permissions.current = ['tenant.manage', 'notifications.manage'];
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByLabelText('Təşkilatın adı')).toHaveValue('Acme');
    expect(screen.getByRole('tab', { name: 'Təşkilat' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.api.notificationRules.list).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Bildirişlər' }));
    await waitFor(() => expect(mocks.api.notificationRules.list).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('region', { name: 'Tapşırıqlar' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Təşkilatın adı')).not.toBeInTheDocument();
  });
});
