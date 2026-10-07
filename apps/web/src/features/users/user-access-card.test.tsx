import type { UserDto } from '@taskop/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';

const resetCredential = vi.fn();
const deactivate = vi.fn();
vi.mock('@/lib/session', () => ({
  api: { users: { resetCredential: (...a: unknown[]) => resetCredential(...a), deactivate: (...a: unknown[]) => deactivate(...a), reactivate: vi.fn() } },
}));
const { UserAccessCard } = await import('./user-access-card');

const worker: UserDto = {
  id: 'u1', fullName: 'Elvin Məmmədov', jobTitle: null, kind: 'worker', email: null, username: 'elvin', phone: null, status: 'active',
  credentialKind: 'pin', role: { id: 'r', name: 'Worker', systemKey: 'worker' }, managerId: null, managerName: null, siteIds: [], teamIds: [],
  lastLoginAt: null, createdAt: '2026-10-07T10:00:00.000Z',
};

describe('UserAccessCard', () => {
  beforeEach(() => {
    resetCredential.mockReset();
    deactivate.mockReset();
  });

  it('resets a worker PIN after confirmation and shows it once', async () => {
    resetCredential.mockResolvedValue({ user: worker, generatedSecret: '730184' });
    renderWithProviders(<UserAccessCard user={worker} orgCode="acme" isSelf={false} canManage onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'PIN/şifrəni sıfırla' }));
    await userEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(resetCredential).toHaveBeenCalledWith('u1', {});
    expect(await screen.findByText('730184')).toBeInTheDocument();
  });

  it('asks before deactivating', async () => {
    deactivate.mockResolvedValue({ ...worker, status: 'deactivated' });
    const onChanged = vi.fn();
    renderWithProviders(<UserAccessCard user={worker} orgCode="acme" isSelf={false} canManage onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deaktiv et' }));
    expect(screen.getByText(/Elvin Məmmədov deaktiv edilsin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Təsdiqlə' }));
    expect(deactivate).toHaveBeenCalledWith('u1');
    expect(onChanged).toHaveBeenCalled();
  });

  it('hides destructive actions on your own account', () => {
    renderWithProviders(<UserAccessCard user={worker} orgCode="acme" isSelf canManage onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Deaktiv et' })).not.toBeInTheDocument();
    expect(screen.getByText('Bu sizin hesabınızdır.')).toBeInTheDocument();
  });
});
