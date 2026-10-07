import type { TeamDto } from '@taskop/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { TeamsPage } from './teams-page';

const mocks = vi.hoisted(() => ({
  api: {
    teams: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setMembers: vi.fn() },
    users: { list: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api, useCan: () => true }));

const team = (over: Partial<TeamDto> = {}): TeamDto => ({
  id: 't1', name: 'Alfa', description: null, active: true, memberIds: ['u1'], ...over,
}) as TeamDto;
const users = [
  { id: 'u1', fullName: 'Elvin' },
  { id: 'u2', fullName: 'Aysel' },
];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.users.list.mockResolvedValue({ items: users });
});

describe('TeamsPage saving', () => {
  it('does not re-create the team when setMembers fails after create', async () => {
    mocks.api.teams.list.mockResolvedValue([]);
    mocks.api.teams.create.mockResolvedValue(team({ id: 'new', name: 'Yeni', memberIds: [] }));
    mocks.api.teams.update.mockResolvedValue(team({ id: 'new', name: 'Yeni', memberIds: [] }));
    mocks.api.teams.setMembers.mockRejectedValue(new Error('boom'));
    renderWithProviders(<TeamsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Komanda yarat' }));
    await userEvent.type(await screen.findByLabelText('Ad'), 'Yeni');
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Elvin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    expect(await screen.findByText(/Gözlənilməz xəta/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.teams.update).toHaveBeenCalledWith('new', { name: 'Yeni', description: null }));
    expect(mocks.api.teams.create).toHaveBeenCalledTimes(1);
  });

  it('skips setMembers when only the name changes', async () => {
    mocks.api.teams.list.mockResolvedValue([team()]);
    mocks.api.teams.update.mockResolvedValue(team({ name: 'Alfa2' }));
    renderWithProviders(<TeamsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Redaktə et' }));
    const name = await screen.findByLabelText('Ad');
    await userEvent.clear(name);
    await userEvent.type(name, 'Alfa2');
    await userEvent.click(screen.getByRole('button', { name: 'Yadda saxla' }));
    await waitFor(() => expect(mocks.api.teams.update).toHaveBeenCalledWith('t1', { name: 'Alfa2', description: null }));
    expect(mocks.api.teams.setMembers).not.toHaveBeenCalled();
  });
});
