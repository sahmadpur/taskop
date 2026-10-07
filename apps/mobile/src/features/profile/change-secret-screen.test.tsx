import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import { ChangeSecretScreen } from './change-secret-screen';

const mockChangeCredential = jest.fn();
jest.mock('@/lib/session', () => ({ api: { auth: { changeCredential: (...a: unknown[]) => mockChangeCredential(...a) } } }));

describe('ChangeSecretScreen', () => {
  it('shows the weak-PIN field error', async () => {
    const { ApiError } = jest.requireActual('@taskop/api-client');
    mockChangeCredential.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { newSecret: 'errors.validation.pinWeak' }));
    await render(<ChangeSecretScreen onDone={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Cari PIN/şifrə'), '730184');
    await fireEvent.changeText(screen.getByLabelText('Yeni PIN/şifrə'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Dəyiş' }));
    expect(await screen.findByText('Bu PIN çox sadədir. Başqa PIN seçin.')).toBeTruthy();
  });

  it('calls onDone after a successful change', async () => {
    mockChangeCredential.mockResolvedValue(undefined);
    const onDone = jest.fn();
    await render(<ChangeSecretScreen onDone={onDone} />);
    await fireEvent.changeText(screen.getByLabelText('Cari PIN/şifrə'), '730184');
    await fireEvent.changeText(screen.getByLabelText('Yeni PIN/şifrə'), '482915');
    await fireEvent.press(screen.getByRole('button', { name: 'Dəyiş' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockChangeCredential).toHaveBeenCalledWith({ currentSecret: '730184', newSecret: '482915' });
  });
});
