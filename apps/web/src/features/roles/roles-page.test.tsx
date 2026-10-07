import type { RoleDto } from '@taskop/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { RolesPage } from './roles-page';

const mocks = vi.hoisted(() => ({
  api: { roles: { list: vi.fn(), catalog: vi.fn(), create: vi.fn(), update: vi.fn(), setPermissions: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useCan: () => true,
  useMe: () => ({ permissions: ['users.view', 'users.manage'] }),
}));

const role = (over: Partial<RoleDto> = {}): RoleDto =>
  ({ id: 'r1', name: 'Köhnə', systemKey: null, dataScope: 'own', permissions: ['users.view'], editable: true, active: true, userCount: 0, ...over }) as RoleDto;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.roles.catalog.mockResolvedValue([{ group: 'users', keys: ['users.view', 'users.manage'] }]);
});

describe('RolesPage saving', () => {
  it('refreshes roles and shows the error when setPermissions fails after the name update', async () => {
    mocks.api.roles.list.mockResolvedValue([role()]);
    mocks.api.roles.update.mockResolvedValue(role({ name: 'Yeni' }));
    mocks.api.roles.setPermissions.mockRejectedValue(new Error('boom'));
    renderWithProviders(<RolesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Köhnə/ }));
    const name = await screen.findByLabelText('Rolun adı');
    await userEvent.clear(name);
    await userEvent.type(name, 'Yeni');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText(/Gözlənilməz xəta/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.roles.list.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
