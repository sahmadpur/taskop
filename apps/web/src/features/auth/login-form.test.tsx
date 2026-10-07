import { ApiError } from '@taskop/api-client';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { LoginForm } from './login-form';

const loginStaff = vi.fn();
vi.mock('@/lib/session', () => ({ api: { auth: { loginStaff: (...a: unknown[]) => loginStaff(...a) } } }));

describe('LoginForm', () => {
  beforeEach(() => {
    loginStaff.mockReset();
  });

  it('submits normalised credentials for the web client', async () => {
    const onSuccess = vi.fn();
    loginStaff.mockResolvedValue({ accessToken: 'a' });
    renderWithProviders(<LoginForm onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText('E-poçt'), '  Owner@Acme.AZ ');
    await userEvent.type(screen.getByLabelText('Şifrə'), 'secret password');
    await userEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(loginStaff).toHaveBeenCalledWith({ email: 'owner@acme.az', password: 'secret password', client: 'web' });
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: 'a' });
  });

  it('shows the translated API error', async () => {
    loginStaff.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'errors.INVALID_CREDENTIALS'));
    renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('E-poçt'), 'a@b.az');
    await userEvent.type(screen.getByLabelText('Şifrə'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Giriş məlumatları yanlışdır.');
  });

  it('shows required-field errors without calling the API', async () => {
    renderWithProviders(<LoginForm onSuccess={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findAllByText('Bu xana mütləqdir.')).toHaveLength(2);
    expect(loginStaff).not.toHaveBeenCalled();
  });
});
