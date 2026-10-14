import { act, fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { NotificationBell } from './notification-bell';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('Home bell', () => {
  it('shows the unread count from the last sync, caps it at 99+, and opens the inbox', async () => {
    const t = await createTestServices();
    await renderWithServices(t.services, <NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Bildirişlər, 0 oxunmamış' })).toBeTruthy();
    expect(screen.queryByTestId('notification-bell-count')).toBeNull();
    await act(async () => {
      await t.services.setUnreadNotifications(3);
    });
    expect(await screen.findByRole('button', { name: 'Bildirişlər, 3 oxunmamış' })).toBeTruthy();
    expect(within(screen.getByTestId('notification-bell-count')).getByText('3')).toBeTruthy();
    await act(async () => {
      await t.services.setUnreadNotifications(120);
    });
    expect(await within(screen.getByTestId('notification-bell-count')).findByText('99+')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bildirişlər, 120 oxunmamış' }));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });
});
