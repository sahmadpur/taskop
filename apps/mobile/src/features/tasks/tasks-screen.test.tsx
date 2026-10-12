import { fireEvent, screen, within } from '@testing-library/react-native';
import '@/lib/i18n';
import { ME_REF, OTHER, syncResponse, syncTask, T, TASK, TASK2, TASK3, TASK4, TASK5, TEAM, versionOf } from '@/offline/testing/fixtures';
import { renderWithServices } from '@/offline/testing/render';
import { createTestServices } from '@/offline/testing/test-services';
import { TasksScreen } from './tasks-screen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  // The tab is focused while rendered in a test.
  useFocusEffect: (effect: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));

let mockPermissions: string[] = [];
const mockList = jest.fn();
jest.mock('@/lib/session', () => ({
  useSession: () => ({ status: 'authenticated', offline: false, me: { permissions: mockPermissions } }),
  api: { tasks: { list: (...a: unknown[]) => mockList(...a) } },
}));

beforeEach(() => {
  mockPush.mockClear();
  mockPermissions = [];
  mockList.mockReset();
  mockList.mockResolvedValue({ items: [], nextCursor: null });
});

async function world() {
  const t = await createTestServices();
  await t.seed(
    syncResponse({
      checklistVersions: [versionOf(t.c.content)],
      tasks: [
        syncTask({ id: TASK, title: 'Qapını təmir et' }),
        syncTask({ id: TASK2, title: 'Rəfi bərkit', dueAt: T.before }),
        syncTask({ id: TASK3, title: 'Lampanı dəyiş', assignee: null, team: { id: TEAM, name: 'Texniki xidmət' } }),
        syncTask({ id: TASK4, title: 'Kassanı yoxla', status: 'awaiting_review' }),
        syncTask({ id: TASK5, title: 'Anbarı təmizlə', status: 'completed', completedAt: T.open }),
      ],
    }),
  );
  return t;
}

describe('Tapşırıqlar', () => {
  it('lists my tasks in the spec sections with due dates, status, overdue and sync badges', async () => {
    const t = await world();
    await t.services.tasks.start(TASK);
    await renderWithServices(t.services, <TasksScreen />);
    const headers = { team: 'Komanda üçün', mine: 'Mənim', inReview: 'Yoxlamada', done: 'Tamamlanıb' };
    for (const [key, title] of Object.entries(headers)) expect((await screen.findByTestId(`section-${key}`)).props.children).toBe(title);
    expect(screen.getAllByTestId(/^task-/).map((e) => e.props.testID)).toEqual([`task-${TASK3}`, `task-${TASK2}`, `task-${TASK}`, `task-${TASK4}`, `task-${TASK5}`]);
    expect(within(screen.getByTestId(`task-${TASK3}`)).getByText('Komanda: Texniki xidmət')).toBeTruthy();
    expect(within(screen.getByTestId(`task-${TASK2}`)).getByText('Gecikib')).toBeTruthy();
    const started = within(screen.getByTestId(`task-${TASK}`));
    expect(started.getByText('İcradadır')).toBeTruthy();
    expect(started.getByText('Göndərilməyib')).toBeTruthy();
    expect(started.getByText(/^Son tarix: /)).toBeTruthy();
    expect(within(screen.getByTestId(`task-${TASK5}`)).getByText('Tamamlanıb')).toBeTruthy();
  });

  it('opens a task by its id', async () => {
    const t = await world();
    await renderWithServices(t.services, <TasksScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Rəfi bərkit' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK2 } });
  });

  it('offers "Yeni tapşırıq" to tasks.manage holders only', async () => {
    const t = await world();
    const view = await renderWithServices(t.services, <TasksScreen />);
    await screen.findByTestId('section-mine');
    expect(screen.queryByRole('button', { name: 'Yeni tapşırıq' })).toBeNull();
    await view.unmount();
    mockPermissions = ['tasks.manage'];
    await renderWithServices(t.services, <TasksScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Yeni tapşırıq' }));
    expect(mockPush).toHaveBeenCalledWith('/task/new');
  });

  it('lists the tasks awaiting my review for tasks.manage holders, online, and opens one', async () => {
    mockPermissions = ['tasks.manage'];
    mockList.mockResolvedValue({
      items: [
        {
          id: TASK4, title: 'Kassanı yoxla', priority: 'normal', status: 'awaiting_review', site: null, assignee: { id: OTHER, fullName: 'Murad Həsənov' },
          team: null, assigneeInactive: false, createdBy: ME_REF, requiresReview: true, source: 'adhoc',
          problemId: null, dueAt: null, overdueAt: null, rev: 3, createdAt: T.starts, updatedAt: T.open,
        },
      ],
      nextCursor: null,
    });
    const t = await createTestServices({ online: true });
    await renderWithServices(t.services, <TasksScreen />);
    expect((await screen.findByTestId('section-review')).props.children).toBe('Yoxlama');
    const row = await screen.findByTestId(`review-${TASK4}`);
    expect(within(row).getByText('Murad Həsənov')).toBeTruthy();
    expect(mockList).toHaveBeenCalledWith({ awaitingMyReview: 'true' });
    await fireEvent.press(row);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/review/[id]', params: { id: TASK4 } });
  });

  it('shows no Yoxlama to workers, and asks managers for a connection while offline', async () => {
    const t = await world();
    const view = await renderWithServices(t.services, <TasksScreen />);
    await screen.findByTestId('section-mine');
    expect(screen.queryByTestId('section-review')).toBeNull();
    await view.unmount();
    mockPermissions = ['tasks.manage'];
    await renderWithServices(t.services, <TasksScreen />);
    expect(await screen.findByText('İnternet bağlantısı tələb olunur')).toBeTruthy();
    expect(mockList).not.toHaveBeenCalled();
  });
});
