import { ApiError } from '@taskop/api-client';
import type { RuleType } from '@taskop/contracts';
import { az } from '@taskop/i18n';
import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { allRules, ROLE_IDS, roleList, ruleDto } from './fixtures';
import { notificationKeys } from './queries';
import { NotificationRulesTab } from './rules-tab';

const mocks = vi.hoisted(() => ({
  api: { notificationRules: { list: vi.fn(), update: vi.fn(), reset: vi.fn() }, roles: { list: vi.fn() } },
}));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

/** A rule row's control: "<type label> — <control>" (the type labels are Part 1's). */
const ctl = (type: RuleType, control: string) => `${az.notifications.types[type]} — ${control}`;
const { audiences, channels } = az.notifications;
const answer = async (type: RuleType, body: object) => ({ ...ruleDto(type), ...body, isDefault: false });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
  mocks.api.notificationRules.list.mockResolvedValue(allRules({ 'problem.critical': { email: false, isDefault: false } }));
  mocks.api.roles.list.mockResolvedValue(roleList());
});

describe('NotificationRulesTab', () => {
  it('groups the rules, offers only the audiences and the lead time each type has, and marks customised rows', async () => {
    renderWithProviders(<NotificationRulesTab />);
    for (const g of ['checklist', 'problem', 'task'] as const) {
      expect(await screen.findByRole('region', { name: az.notifications.groups[g] })).toBeInTheDocument();
    }
    // Header row + problem.recorded + problem.critical.
    expect(within(screen.getByRole('region', { name: az.notifications.groups.problem })).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('checkbox', { name: ctl('problem.recorded', audiences.assignees) })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: ctl('checklist.overdue', audiences.creator) })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: ctl('task.overdue', audiences.creator) })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: ctl('checklist.missed', channels.push) })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: ctl('task.assigned', 'Aktiv') })).toBeChecked();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: ctl('checklist.due_soon', 'Xatırlatma vaxtı') })).toHaveValue('30');
    // Until GET /roles answers the button is a disabled count; then it names the roles.
    await waitFor(() => expect(screen.getByRole('button', { name: ctl('problem.critical', 'Rollar') })).toHaveTextContent('Administrator, Menecer'));
    const critical = screen.getByRole('button', { name: ctl('problem.critical', 'Yadda saxla') }).closest('tr')!;
    expect(critical).toHaveTextContent('Dəyişdirilib');
    expect(within(critical).getByRole('button', { name: ctl('problem.critical', 'Defolta qaytar') })).toBeInTheDocument();
    const recorded = screen.getByRole('button', { name: ctl('problem.recorded', 'Yadda saxla') });
    expect(recorded.closest('tr')).not.toHaveTextContent('Dəyişdirilib');
    expect(recorded).toBeDisabled();
  });

  it('marks a rule as changed whenever the tenant has an override row, even one saved with the default values', async () => {
    mocks.api.notificationRules.list.mockResolvedValue(allRules({ 'task.assigned': { isDefault: false } }));
    renderWithProviders(<NotificationRulesTab />);
    const row = (await screen.findByRole('button', { name: ctl('task.assigned', 'Yadda saxla') })).closest('tr')!;
    expect(row).toHaveTextContent('Dəyişdirilib');
    expect(within(row).getByRole('button', { name: ctl('task.assigned', 'Defolta qaytar') })).toBeInTheDocument();
  });

  // Drives 13 rows of Radix controls: seeded cache, no typing delay and an explicit timeout keep it stable under full-monorepo load.
  it('saves one row with its full rule and shows the answer', { timeout: 15_000 }, async () => {
    mocks.api.notificationRules.update.mockImplementation(answer);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    client.setQueryData(notificationKeys.rules, await mocks.api.notificationRules.list());
    client.setQueryData(['roles'], roleList());
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<NotificationRulesTab />, client);
    const save = screen.getByRole('button', { name: ctl('checklist.due_soon', 'Yadda saxla') });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: ctl('checklist.due_soon', 'Xatırlatma vaxtı') }), '60');
    await user.click(screen.getByRole('checkbox', { name: ctl('checklist.due_soon', channels.email) }));
    await user.click(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Rollar') }));
    await user.click(await screen.findByRole('checkbox', { name: 'Administrator' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Rollar') })).toHaveTextContent('Administrator');
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(mocks.api.notificationRules.update).toHaveBeenCalledWith('checklist.due_soon', {
        enabled: true,
        push: true,
        email: true,
        notifyAssignees: true,
        notifyCreator: false,
        roleIds: [ROLE_IDS.admin],
        leadMinutes: 60,
      }),
    );
    expect(await within(save.closest('tr')!).findByText('Dəyişdirilib')).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('puts a customised rule back to the default', async () => {
    mocks.api.notificationRules.reset.mockResolvedValue(ruleDto('problem.critical'));
    renderWithProviders(<NotificationRulesTab />);
    const email = await screen.findByRole('checkbox', { name: ctl('problem.critical', channels.email) });
    expect(email).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: ctl('problem.critical', 'Defolta qaytar') }));
    await waitFor(() => expect(mocks.api.notificationRules.reset).toHaveBeenCalledWith('problem.critical'));
    await waitFor(() => expect(email).toBeChecked());
    expect(screen.queryByRole('button', { name: ctl('problem.critical', 'Defolta qaytar') })).not.toBeInTheDocument();
    expect(email.closest('tr')).not.toHaveTextContent('Dəyişdirilib');
  });

  it("shows the server's reasons under the row", async () => {
    mocks.api.notificationRules.update.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'errors.VALIDATION_FAILED', { leadMinutes: 'notifications.issues.leadMinutesRequired' }),
    );
    renderWithProviders(<NotificationRulesTab />);
    await userEvent.click(await screen.findByRole('checkbox', { name: ctl('checklist.due_soon', channels.email) }));
    await userEvent.click(screen.getByRole('button', { name: ctl('checklist.due_soon', 'Yadda saxla') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(az.notifications.issues.leadMinutesRequired);
  });

  it('without the roles list keeps the chosen roles and still saves the row', async () => {
    mocks.api.roles.list.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'errors.FORBIDDEN'));
    mocks.api.notificationRules.update.mockImplementation(answer);
    renderWithProviders(<NotificationRulesTab />);
    expect(await screen.findByText('Rolların siyahısı yüklənmədi; seçilmiş rollar dəyişməz qalır.')).toBeInTheDocument();
    const roles = screen.getByRole('button', { name: ctl('checklist.overdue', 'Rollar') });
    expect(roles).toBeDisabled();
    expect(roles).toHaveTextContent('1 rol');
    await userEvent.click(screen.getByRole('checkbox', { name: ctl('checklist.overdue', channels.push) }));
    await userEvent.click(screen.getByRole('button', { name: ctl('checklist.overdue', 'Yadda saxla') }));
    await waitFor(() =>
      expect(mocks.api.notificationRules.update).toHaveBeenCalledWith('checklist.overdue', expect.objectContaining({ push: false, roleIds: [ROLE_IDS.manager] })),
    );
  });
});
