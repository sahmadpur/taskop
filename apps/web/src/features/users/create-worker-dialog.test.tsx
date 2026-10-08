import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const roleId = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const createWorker = vi.fn();
const granted = new Set<string>();
const useRoles = vi.fn((enabled = true) => ({
  data: enabled ? [{ id: roleId, name: 'Worker', systemKey: 'worker', active: true, permissions: [], dataScope: 'own', editable: true, userCount: 0 }] : undefined,
}));
const useSites = vi.fn((_enabled = true) => ({ data: [] }));
const useTeams = vi.fn((_enabled = true) => ({ data: [] }));
vi.mock('@/lib/session', () => ({
  api: { users: { createWorker: (...a: unknown[]) => createWorker(...a) } },
  useCan: (...keys: string[]) => keys.every((k) => granted.has(k)),
}));
vi.mock('@/features/roles/queries', () => ({
  useRoles: (enabled?: boolean) => useRoles(enabled),
  roleDisplayName: (_t: unknown, r: { name: string }) => r.name,
}));
vi.mock('@/features/sites/queries', () => ({ useSites: (enabled?: boolean) => useSites(enabled) }));
vi.mock('@/features/teams/queries', () => ({ useTeams: (enabled?: boolean) => useTeams(enabled), useActiveUsers: () => ({ data: [] }) }));

const { CreateWorkerDialog } = await import('./create-worker-dialog');

describe('CreateWorkerDialog', () => {
  beforeEach(() => {
    createWorker.mockReset();
    [useRoles, useSites, useTeams].forEach((m) => m.mockClear());
    granted.clear();
    ['roles.view', 'sites.view', 'teams.view', 'users.view'].forEach((k) => granted.add(k));
  });

  it('creates a worker and shows the generated PIN once', async () => {
    createWorker.mockResolvedValue({ user: { id: 'u1', username: 'elvin.m' }, generatedSecret: '730184' });
    const onCreated = vi.fn();
    renderWithProviders(<CreateWorkerDialog open onOpenChange={vi.fn()} orgCode="acme" onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Ad və soyad'), 'Elvin Məmmədov');
    await userEvent.type(screen.getByLabelText('İstifadəçi adı'), 'Elvin.M');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));

    expect(createWorker).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'Elvin Məmmədov', username: 'elvin.m', roleId, credentialKind: 'pin', siteIds: [], teamIds: [] }),
    );
    expect(createWorker.mock.calls[0]![0]).not.toHaveProperty('secret');
    expect(await screen.findByText('730184')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
  });

  it('maps API field errors onto inputs', async () => {
    const { ApiError } = await import('@taskop/api-client');
    createWorker.mockRejectedValue(new ApiError(409, 'USERNAME_TAKEN', 'errors.USERNAME_TAKEN', { username: 'errors.USERNAME_TAKEN' }));
    renderWithProviders(<CreateWorkerDialog open onOpenChange={vi.fn()} orgCode="acme" onCreated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Ad və soyad'), 'Elvin Məmmədov');
    await userEvent.type(screen.getByLabelText('İstifadəçi adı'), 'elvin');
    await userEvent.click(screen.getByRole('button', { name: 'Yarat' }));
    expect(await screen.findByText('Bu istifadəçi adı artıq mövcuddur.')).toBeInTheDocument();
  });

  it('does not query sites, teams or roles the actor may not view', () => {
    granted.clear();
    granted.add('users.view');
    renderWithProviders(<CreateWorkerDialog open onOpenChange={vi.fn()} orgCode="acme" onCreated={vi.fn()} />);
    expect(useSites).toHaveBeenCalled();
    expect(useSites.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(useTeams.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(useRoles.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
  });

  it('explains that roles.view is required and blocks submit without it', async () => {
    granted.delete('roles.view');
    renderWithProviders(<CreateWorkerDialog open onOpenChange={vi.fn()} orgCode="acme" onCreated={vi.fn()} />);
    expect(screen.getByText('İşçi yaratmaq üçün «Rollara baxmaq» icazəsi lazımdır.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rol')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yarat' })).toBeDisabled();
  });
});
