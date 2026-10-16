import { LANGUAGE_STORAGE_KEY } from '@taskop/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import i18n from '@/lib/i18n';
import { LanguageMenu } from './language-menu';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  setMe: vi.fn(),
  state: { current: { status: 'anonymous' } as { status: string; me?: unknown } },
}));
vi.mock('@/lib/session', () => ({
  api: { preferences: { update: mocks.update } },
  session: { get: () => mocks.state.current, setMe: mocks.setMe },
}));

const me = { user: { id: 'u1', fullName: 'Elvin', locale: null, emailNotifications: true }, permissions: [], tenant: { locale: 'az' } };

beforeEach(() => {
  mocks.update.mockReset();
  mocks.setMe.mockReset();
  mocks.state.current = { status: 'anonymous' };
});
afterEach(async () => {
  await i18n.changeLanguage('az');
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'az');
});

describe('LanguageMenu', () => {
  it('switches the UI language and keeps the choice on this browser only while signed out', async () => {
    renderWithProviders(<LanguageMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Azərbaycan dili/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'English' }));
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('also saves the choice to the profile while signed in, and the session follows the saved value', async () => {
    mocks.state.current = { status: 'authenticated', me };
    mocks.update.mockResolvedValue({ emailNotifications: true, locale: 'ru' });
    renderWithProviders(<LanguageMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Azərbaycan dili/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Русский' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ locale: 'ru' }));
    await waitFor(() => expect(mocks.setMe).toHaveBeenCalledWith({ ...me, user: { ...me.user, locale: 'ru' } }));
    expect(i18n.language).toBe('ru');
  });

  it('keeps the local choice when the profile cannot be saved', async () => {
    mocks.state.current = { status: 'authenticated', me };
    mocks.update.mockRejectedValue(new Error('offline'));
    renderWithProviders(<LanguageMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Azərbaycan dili/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'English' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(i18n.language).toBe('en');
    expect(mocks.setMe).not.toHaveBeenCalled();
  });
});
