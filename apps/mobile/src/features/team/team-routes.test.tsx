import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import '@/lib/i18n';
import { OCC, OCC2 } from '@/offline/testing/fixtures';
import AppLayout from '../../../app/(app)/_layout';
import TeamRoute from '../../../app/(app)/team/index';
import TeamRunRoute from '../../../app/(app)/team/run/[id]';
import { teamMe } from './testing/fixtures';

const mockScreens: { name: string; options?: { href?: null; title?: string } }[] = [];
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  const Tabs = ({ children }: { children: ReactNode }) => children;
  Tabs.Screen = (p: { name: string; options?: { href?: null; title?: string } }) => {
    mockScreens.push(p);
    return null;
  };
  return { Tabs, Redirect: ({ href }: { href: string }) => <MockText>{`redirect ${href}`}</MockText>, useLocalSearchParams: () => mockParams };
});
let mockSession: { status: string; offline?: boolean; me?: ReturnType<typeof teamMe> } = { status: 'authenticated', offline: false, me: teamMe() };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/offline/offline-provider', () => ({ OfflineProvider: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/notifications/notifications-bridge', () => ({ NotificationsBridge: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/features/team/team-screen', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { TeamScreen: () => <MockText>team screen</MockText> };
});
jest.mock('@/features/team/run-screen', () => {
  const { Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { TeamRunScreen: ({ occurrenceId }: { occurrenceId: string }) => <MockText>{`run ${occurrenceId}`}</MockText> };
});

const signedIn = (me: ReturnType<typeof teamMe>) => (mockSession = { status: 'authenticated', offline: false, me });
const teamTab = () => mockScreens.find((s) => s.name === 'team/index');

beforeEach(() => {
  mockScreens.length = 0;
  mockParams = {};
  signedIn(teamMe());
});

describe('Team tab (spec §7.1)', () => {
  it('is a tab for a manager with reports.view and a wider scope, between Tapşırıqlar and Profil', async () => {
    await render(<AppLayout />);
    expect(mockScreens.slice(0, 4).map((s) => s.name)).toEqual(['index', 'tasks', 'team/index', 'profile']);
    expect(teamTab()?.options).toMatchObject({ title: 'Komanda' });
    expect(teamTab()?.options).not.toHaveProperty('href');
    expect(mockScreens.find((s) => s.name === 'team/run/[id]')?.options).toMatchObject({ href: null });
  });

  it('is hidden without reports.view, and for an own-scope role that has it', async () => {
    for (const me of [teamMe({ permissions: ['assignments.view'] }), teamMe({ dataScope: 'own' }), teamMe({ permissions: [], dataScope: 'own' })]) {
      mockScreens.length = 0;
      signedIn(me);
      const view = await render(<AppLayout />);
      expect(teamTab()?.options).toMatchObject({ href: null });
      await view.unmount();
    }
  });
});

describe('Team routes', () => {
  it('open the Team screen, and a run keyed by its occurrence', async () => {
    await render(<TeamRoute />);
    expect(screen.getByText('team screen')).toBeTruthy();
    mockParams = { id: OCC };
    const view = await render(<TeamRunRoute />);
    expect(screen.getByText(`run ${OCC}`)).toBeTruthy();
    mockParams = { id: OCC2 };
    await view.rerender(<TeamRunRoute />);
    expect(screen.getByText(`run ${OCC2}`)).toBeTruthy();
  });

  it('send a deep link without access Home', async () => {
    signedIn(teamMe({ permissions: [], dataScope: 'own' }));
    await render(<TeamRoute />);
    expect(screen.getByText('redirect /')).toBeTruthy();
    expect(screen.queryByText('team screen')).toBeNull();
    mockParams = { id: OCC };
    await render(<TeamRunRoute />);
    // `screen` is the latest render: the run route redirects too.
    expect(screen.getByText('redirect /')).toBeTruthy();
    expect(screen.queryByText(`run ${OCC}`)).toBeNull();
  });

  it('render nothing while signed out', async () => {
    mockSession = { status: 'anonymous' };
    const view = await render(<TeamRoute />);
    expect(view.toJSON()).toBeNull();
  });
});
