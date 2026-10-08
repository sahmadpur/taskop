import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import { LoginScreen } from './login-screen';

const mockLoginWorker = jest.fn();
const mockLoginStaff = jest.fn();
const mockSignedIn = jest.fn();
const mockRememberOrgCode = jest.fn();
let mockStoredOrgCode: string | null = null;

jest.mock('@/lib/session', () => ({
  api: { auth: { loginWorker: (...a: unknown[]) => mockLoginWorker(...a), loginStaff: (...a: unknown[]) => mockLoginStaff(...a) } },
  session: {
    signedIn: (...a: unknown[]) => mockSignedIn(...a),
    rememberOrgCode: (...a: unknown[]) => mockRememberOrgCode(...a),
    getOrgCode: async () => mockStoredOrgCode,
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStoredOrgCode = null;
});

describe('LoginScreen', () => {
  it('logs a worker in with normalised identifiers and remembers the org code', async () => {
    mockLoginWorker.mockResolvedValue({ accessToken: 'a' });
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Təşkilat kodu'), ' ACME ');
    await fireEvent.changeText(screen.getByLabelText('İstifadəçi adı'), 'Elvin');
    await fireEvent.changeText(screen.getByLabelText('PIN və ya şifrə'), '730184');
    await fireEvent.press(screen.getByRole('button', { name: 'Daxil ol' }));
    await waitFor(() => expect(mockSignedIn).toHaveBeenCalledWith({ accessToken: 'a' }));
    expect(mockLoginWorker).toHaveBeenCalledWith({ orgCode: 'acme', username: 'elvin', secret: '730184', client: 'mobile' });
    expect(mockRememberOrgCode).toHaveBeenCalledWith('acme');
  });

  it('prefills the remembered org code', async () => {
    mockStoredOrgCode = 'acme';
    await render(<LoginScreen />);
    await waitFor(() => expect(screen.getByLabelText('Təşkilat kodu').props.value).toBe('acme'));
  });

  it('shows the translated API error', async () => {
    const { ApiError } = jest.requireActual('@taskop/api-client');
    mockLoginWorker.mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'errors.INVALID_CREDENTIALS'));
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Təşkilat kodu'), 'acme');
    await fireEvent.changeText(screen.getByLabelText('İstifadəçi adı'), 'elvin');
    await fireEvent.changeText(screen.getByLabelText('PIN və ya şifrə'), '000001');
    await fireEvent.press(screen.getByRole('button', { name: 'Daxil ol' }));
    expect(await screen.findByText('Giriş məlumatları yanlışdır.')).toBeTruthy();
  });

  it('switches to staff login', async () => {
    mockLoginStaff.mockResolvedValue({ accessToken: 's' });
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Rəhbər' }));
    await fireEvent.changeText(screen.getByLabelText('E-poçt'), ' Leyla@Acme.az ');
    await fireEvent.changeText(screen.getByLabelText('Şifrə'), 'manager password');
    await fireEvent.press(screen.getByRole('button', { name: 'Daxil ol' }));
    await waitFor(() => expect(mockLoginStaff).toHaveBeenCalledWith({ email: 'leyla@acme.az', password: 'manager password', client: 'mobile' }));
  });
});
