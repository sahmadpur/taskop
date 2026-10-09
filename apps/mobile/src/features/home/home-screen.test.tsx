import { fireEvent, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import '@/lib/i18n';
import { ME, OCC, OCC2, OCC3, OCC4, OCC5, occurrence, OTHER, OTHER_EXECUTION, syncResponse, VERSION2, versionOf } from '@/offline/testing/fixtures';
import { eventually, renderWithServices } from '@/offline/testing/render';
import { createTestServices, type TestServices } from '@/offline/testing/test-services';
import { HomeScreen } from './home-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { user: { fullName: 'Aysel Əliyeva' } } }),
}));

beforeEach(() => mockPush.mockClear());

/** OCC open, OCC2 claimed by Murad, OCC3 later today, OCC4 completed, OCC5 open (optionally on a too-new version). */
async function world(extra: { version?: string } = {}): Promise<TestServices> {
  const t = await createTestServices();
  const claim = { executionId: OTHER_EXECUTION, executorUserId: OTHER, executorName: 'Murad Həsənov' };
  await t.seed(
    syncResponse({
      occurrences: [
        occurrence(),
        occurrence({ id: OCC2, checklistName: 'Kassa yoxlaması', status: 'started', claim }),
        occurrence({ id: OCC3, checklistName: 'Bağlanış yoxlaması', startsAt: '2026-11-02T14:00:00.000Z', dueAt: '2026-11-02T16:00:00.000Z', closesAt: '2026-11-02T17:00:00.000Z' }),
        occurrence({ id: OCC4, checklistName: 'Anbar yoxlaması', status: 'completed' }),
        occurrence({ id: OCC5, checklistName: 'Mətbəx yoxlaması', ...(extra.version ? { checklistVersionId: extra.version } : {}) }),
      ],
      checklistVersions: [versionOf(t.c.content), versionOf({ schemaVersion: 2 }, VERSION2, 2)],
    }),
  );
  return t;
}

describe('My checklists', () => {
  it('groups my checklists, marks overdue and claimed ones, and counts the tiles', async () => {
    const t = await world();
    const id = await t.services.store.start(OCC, ME);
    await t.services.store.patchAnswer(id, t.c.temp.id, { number: 10 }); // a rule problem
    t.clock.set('2026-11-02T06:30:00.000Z'); // 10:30 in Baku: past due, before close
    await renderWithServices(t.services, <HomeScreen />);
    for (const title of ['İndi', 'Davam edən', 'Gələcək', 'Bitmiş']) expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText('Murad Həsənov icra edir')).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC5}`)).getByText('Gecikir')).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC}`)).getByRole('button', { name: 'Davam et: Açılış yoxlaması' })).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC3}`)).getByText('18:00-da açılır')).toBeTruthy();
    expect(within(screen.getByTestId(`occurrence-${OCC3}`)).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId(`occurrence-${OCC2}`)).queryByRole('button')).toBeNull();
    expect(within(await screen.findByTestId('stat-myTasks')).getByText('2')).toBeTruthy();
    expect(within(screen.getByTestId('stat-overdue')).getByText('2')).toBeTruthy();
    expect(within(screen.getByTestId('stat-completed')).getByText('1')).toBeTruthy();
    expect(await within(screen.getByTestId('stat-issues')).findByText('1')).toBeTruthy();
  });

  it('starts an open checklist and opens it by its occurrence id', async () => {
    const t = await world();
    await renderWithServices(t.services, <HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Başla: Mətbəx yoxlaması' }));
    await eventually(async () => expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC5 } }));
    const views = await t.services.store.occurrences();
    expect(views.find((o) => o.id === OCC5)!.execution).toMatchObject({ state: 'active', claim: 'pending' });
  });

  it('opens a started checklist by its occurrence id without starting it again', async () => {
    const t = await world();
    await t.services.store.start(OCC, ME);
    const start = jest.spyOn(t.services.store, 'start');
    await renderWithServices(t.services, <HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Davam et: Açılış yoxlaması' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/execution/[id]', params: { id: OCC } });
    expect(start).not.toHaveBeenCalled();
  });

  it('explains why a start is refused', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const t = await world({ version: VERSION2 });
    await renderWithServices(t.services, <HomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Başla: Mətbəx yoxlaması' }));
    await eventually(async () => expect(alert).toHaveBeenCalledWith('Tətbiqi yeniləyin'));
    expect(mockPush).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
