import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AssigneePicker } from './assignee-picker';
import { assigneeOptions } from './fixtures';
import type { AssigneeChoice } from './labels';

const mocks = vi.hoisted(() => ({ api: { tasks: { assignees: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

function Harness(props: { initial?: AssigneeChoice | null; clearable?: boolean; onChange: (c: AssigneeChoice | null) => void }) {
  const [value, setValue] = useState<AssigneeChoice | null>(props.initial ?? null);
  return (
    <AssigneePicker
      label="İcraçı"
      value={value}
      clearable={props.clearable}
      onChange={(c) => {
        setValue(c);
        props.onChange(c);
      }}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.tasks.assignees.mockResolvedValue(assigneeOptions());
});

describe('AssigneePicker', () => {
  it('lists people and teams in groups, searches by name and picks a team', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    // Closed: nothing is asked for.
    expect(mocks.api.tasks.assignees).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('combobox', { name: 'İcraçı' }));
    const list = await screen.findByRole('listbox', { name: 'İcraçı' });
    const people = await within(list).findByRole('group', { name: 'Əməkdaşlar' });
    expect(within(people).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Nigar Səfərli', 'Murad Əliyev']);
    expect(people).toHaveTextContent('Texnik');
    expect(within(list).getByRole('group', { name: 'Komandalar' })).toHaveTextContent('3 üzv');
    expect(mocks.api.tasks.assignees).toHaveBeenCalledWith({});
    await userEvent.type(screen.getByRole('combobox', { name: 'İcraçı' }), 'Tex');
    await waitFor(() => expect(mocks.api.tasks.assignees).toHaveBeenLastCalledWith({ q: 'Tex' }));
    await userEvent.click(await within(screen.getByRole('listbox')).findByRole('option', { name: 'Texniki xidmət' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'team', id: 'team1', name: 'Texniki xidmət' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'İcraçı' })).toHaveValue('Texniki xidmət');
  });

  it('picks with the arrow keys and Enter', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'İcraçı' });
    await userEvent.click(box);
    const murad = await screen.findByRole('option', { name: 'Murad Əliyev' });
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', murad.id);
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ type: 'user', id: 'w2', name: 'Murad Əliyev' });
  });

  it('shows the chosen name, clears it, and says when nothing matches', async () => {
    mocks.api.tasks.assignees.mockResolvedValue({ users: [], teams: [] });
    const onChange = vi.fn();
    renderWithProviders(<Harness initial={{ type: 'user', id: 'w1', name: 'Nigar Səfərli' }} clearable onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'İcraçı' })).toHaveValue('Nigar Səfərli');
    await userEvent.click(screen.getByRole('button', { name: 'Təmizlə' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('combobox', { name: 'İcraçı' }));
    expect(await screen.findByText('Nəticə tapılmadı')).toBeInTheDocument();
  });

  it('keeps the chosen assignee visible while a search no longer lists them', async () => {
    mocks.api.tasks.assignees.mockImplementation(async (params: { q?: string }) =>
      params.q ? assigneeOptions({ users: [], teams: [{ id: 'team1', name: 'Texniki xidmət', memberCount: 3 }] }) : assigneeOptions(),
    );
    renderWithProviders(<Harness initial={{ type: 'user', id: 'w1', name: 'Nigar Səfərli' }} onChange={vi.fn()} />);
    const box = screen.getByRole('combobox', { name: 'İcraçı' });
    await userEvent.click(box);
    expect(await screen.findByRole('option', { name: 'Nigar Səfərli', selected: true })).toBeInTheDocument();
    await userEvent.type(box, 'Tex');
    await waitFor(() => expect(mocks.api.tasks.assignees).toHaveBeenLastCalledWith({ q: 'Tex' }));
    await screen.findByRole('option', { name: 'Texniki xidmət' });
    // The search no longer returns Nigar, but she stays identifiable as the current choice.
    expect(screen.getByRole('option', { name: 'Nigar Səfərli', selected: true })).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Nigar Səfərli' })).toHaveLength(1);
  });
});
