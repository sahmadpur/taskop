import { ApiError } from '@taskop/api-client';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/router';
import { assigneeOptions, taskDetail, taskSummary, TEAM } from './fixtures';
import { TasksPage } from './tasks-page';

const manager = { user: { id: 'me1' }, permissions: ['tasks.view', 'tasks.manage', 'sites.view'], tenant: { timezone: 'Asia/Baku', locale: 'az' } };
const mocks = vi.hoisted(() => ({
  me: { current: null as unknown },
  api: {
    tasks: { list: vi.fn(), get: vi.fn(), assignees: vi.fn(), create: vi.fn() },
    taskMedia: { url: vi.fn() },
    sites: { list: vi.fn() },
  },
}));
vi.mock('@/lib/session', () => ({
  api: mocks.api,
  useMe: () => mocks.me.current,
  useCan: (...keys: string[]) => keys.every((k) => (mocks.me.current as { permissions: string[] }).permissions.includes(k)),
}));

const empty = { items: [], nextCursor: null };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.me.current = manager;
  mocks.api.sites.list.mockResolvedValue([{ id: 'site1', name: 'Anbar №1', active: true }]);
  mocks.api.tasks.assignees.mockResolvedValue(assigneeOptions());
  mocks.api.tasks.get.mockImplementation(async (id: string) => taskDetail({ id }));
});

describe('TasksPage', () => {
  it('lists tasks with status and overdue badges, assignee or team, site, due and source, and opens a row in the drawer', async () => {
    mocks.api.tasks.list.mockResolvedValue({
      items: [
        taskSummary({ status: 'in_progress', overdueAt: '2026-11-03T14:00:00.000Z' }),
        taskSummary({ id: 't2', title: 'Kameranı yoxlayın', assignee: null, team: TEAM, site: null, dueAt: null, source: 'problem', problemId: 'p1' }),
      ],
      nextCursor: null,
    });
    const router = renderWithRouter(<TasksPage />, '/tasks');
    await screen.findByRole('link', { name: 'Kameranı yoxlayın' });
    const [, first, second] = screen.getAllByRole('row');
    for (const text of ['Soyuducunun qapısını təmir edin', 'İcradadır', 'Gecikib', 'Nigar Səfərli', 'Anbar №1', '18:00', 'Birbaşa']) expect(first).toHaveTextContent(text);
    for (const text of ['Texniki xidmət (komanda)', 'Problemdən', '—']) expect(second).toHaveTextContent(text);
    expect(mocks.api.tasks.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    await userEvent.click(screen.getByRole('link', { name: 'Kameranı yoxlayın' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ task: 't2' }));
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expect(mocks.api.tasks.get).toHaveBeenCalledWith('t2'));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Bağla' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('asks for each tab: awaiting my review, overdue and open, created by me', async () => {
    mocks.api.tasks.list.mockResolvedValue(empty);
    renderWithRouter(<TasksPage />, '/tasks');
    expect(await screen.findByText('Tapşırıq tapılmadı.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Yoxlamamı gözləyir' }));
    await waitFor(() => expect(mocks.api.tasks.list).toHaveBeenLastCalledWith(expect.objectContaining({ awaitingMyReview: 'true' })));
    await userEvent.click(screen.getByRole('tab', { name: 'Gecikmiş' }));
    await waitFor(() =>
      expect(mocks.api.tasks.list).toHaveBeenLastCalledWith(expect.objectContaining({ overdue: 'true', status: 'new,accepted,in_progress,awaiting_review' })),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Mənim yaratdıqlarım' }));
    await waitFor(() => expect(mocks.api.tasks.list).toHaveBeenLastCalledWith(expect.objectContaining({ createdBy: 'me1' })));
    expect(mocks.api.tasks.list.mock.lastCall![0]).not.toHaveProperty('overdue');
  });

  it("sends status, site, assignee, source and the due range in the tenant's zone, and refuses an inverted range", async () => {
    mocks.api.tasks.list.mockResolvedValue(empty);
    renderWithRouter(<TasksPage />, '/tasks');
    await screen.findByRole('option', { name: 'Anbar №1' });
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'in_progress');
    await userEvent.selectOptions(screen.getByLabelText('Obyekt'), 'site1');
    await userEvent.selectOptions(screen.getByLabelText('Mənbə'), 'problem');
    await userEvent.click(screen.getByRole('combobox', { name: 'İcraçı və ya komanda' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Texniki xidmət' }));
    fireEvent.change(screen.getByLabelText('Son tarix: başlanğıc'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Son tarix: son'), { target: { value: '2026-11-02' } });
    await waitFor(() =>
      expect(mocks.api.tasks.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'in_progress',
          siteId: 'site1',
          teamId: 'team1',
          source: 'problem',
          dueFrom: '2026-10-31T20:00:00.000Z',
          dueTo: '2026-11-02T19:59:59.999Z',
        }),
      ),
    );
    const calls = mocks.api.tasks.list.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Son tarix: başlanğıc'), { target: { value: '2026-11-05' } });
    expect(await screen.findByText('Aralığın sonu başlanğıcından əvvəl ola bilməz.')).toBeInTheDocument();
    expect(mocks.api.tasks.list).toHaveBeenCalledTimes(calls);
  });

  it('loads more pages with the cursor', async () => {
    mocks.api.tasks.list.mockImplementation(async (q: { cursor?: string }) =>
      q.cursor ? { items: [taskSummary({ id: 't2', title: 'İkinci' })], nextCursor: null } : { items: [taskSummary()], nextCursor: 't1' },
    );
    renderWithRouter(<TasksPage />, '/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Daha çox göstər' }));
    expect(await screen.findByRole('link', { name: 'İkinci' })).toBeInTheDocument();
    expect(mocks.api.tasks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 't1' }));
    expect(screen.queryByRole('button', { name: 'Daha çox göstər' })).not.toBeInTheDocument();
  });

  it('creates a task with "Yeni tapşırıq" and opens it in the drawer', async () => {
    mocks.api.tasks.list.mockResolvedValue(empty);
    mocks.api.tasks.create.mockImplementation(async (body: { id: string }) => taskDetail({ id: body.id }));
    const router = renderWithRouter(<TasksPage />, '/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni tapşırıq' }));
    const dialog = await screen.findByRole('dialog', { name: 'Yeni tapşırıq' });
    await userEvent.type(within(dialog).getByLabelText('Başlıq'), 'Qapı');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'İcraçı' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Nigar Səfərli' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yarat' }));
    const id = await waitFor(() => mocks.api.tasks.create.mock.calls[0]![0].id as string);
    await waitFor(() => expect(router.state.location.search).toEqual({ task: id }));
    await waitFor(() => expect(mocks.api.tasks.get).toHaveBeenCalledWith(id));
  });

  it('without task rights: no create button or assignee filter; a task it cannot read shows the error in the drawer', async () => {
    mocks.me.current = { ...manager, permissions: [] };
    mocks.api.tasks.list.mockResolvedValue({ items: [taskSummary()], nextCursor: null });
    mocks.api.tasks.get.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'errors.NOT_FOUND'));
    renderWithRouter(<TasksPage />, '/tasks');
    // The API decides what the list holds (own and team tasks for anyone, spec §6.2).
    const link = await screen.findByRole('link', { name: 'Soyuducunun qapısını təmir edin' });
    expect(screen.queryByRole('button', { name: 'Yeni tapşırıq' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'İcraçı və ya komanda' })).not.toBeInTheDocument();
    await userEvent.click(link);
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Məlumat tapılmadı.')).toBeInTheDocument();
    expect(mocks.api.tasks.assignees).not.toHaveBeenCalled();
    expect(mocks.api.sites.list).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Obyekt')).not.toBeInTheDocument();
  });

  it('shows no site filter and does not ask for sites without sites.view', async () => {
    mocks.me.current = { ...manager, permissions: ['tasks.view', 'tasks.manage'] };
    mocks.api.tasks.list.mockResolvedValue(empty);
    renderWithRouter(<TasksPage />, '/tasks');
    expect(await screen.findByText('Tapşırıq tapılmadı.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Obyekt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(mocks.api.sites.list).not.toHaveBeenCalled();
  });

  it('opens the drawer from the address and follows a changed ?task', async () => {
    mocks.api.tasks.list.mockResolvedValue(empty);
    const router = renderWithRouter(<TasksPage />, '/tasks?task=a1');
    await waitFor(() => expect(mocks.api.tasks.get).toHaveBeenCalledWith('a1'));
    await router.navigate({ to: '/tasks', search: { task: 'b2' } } as never);
    await waitFor(() => expect(mocks.api.tasks.get).toHaveBeenCalledWith('b2'));
  });
});
