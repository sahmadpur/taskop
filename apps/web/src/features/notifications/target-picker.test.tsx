import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { renderWithProviders } from '@/test/render';
import { targetOptions } from './fixtures';
import { type MessageTargets, NO_TARGETS } from './message-form';
import { TargetPicker } from './target-picker';

const mocks = vi.hoisted(() => ({ api: { messages: { options: vi.fn() } } }));
vi.mock('@/lib/session', () => ({ api: mocks.api }));

function Harness({ onChange }: { onChange: (v: MessageTargets) => void }) {
  const [value, setValue] = useState<MessageTargets>(NO_TARGETS);
  return (
    <TargetPicker
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.api.messages.options.mockResolvedValue(targetOptions());
});

describe('TargetPicker', () => {
  it('lists people, teams and sites in groups; people and teams are searched by the API, sites here', async () => {
    renderWithProviders(<Harness onChange={vi.fn()} />);
    // Closed: nothing is asked for.
    expect(mocks.api.messages.options).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
    const list = await screen.findByRole('listbox', { name: 'Alıcılar' });
    expect(await within(list).findByRole('group', { name: 'Əməkdaşlar' })).toHaveTextContent('Texnik');
    expect(within(list).getByRole('group', { name: 'Komandalar' })).toHaveTextContent('3 üzv');
    expect(within(within(list).getByRole('group', { name: 'Obyektlər' })).getAllByRole('option')).toHaveLength(2);
    expect(mocks.api.messages.options).toHaveBeenCalledWith({});
    mocks.api.messages.options.mockResolvedValue(targetOptions({ users: [], teams: [] }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Alıcılar' }), 'anbar');
    await waitFor(() => expect(mocks.api.messages.options).toHaveBeenLastCalledWith({ q: 'anbar' }));
    await waitFor(() =>
      expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Anbar №1']),
    );
  });

  it('adds and removes people, teams and sites, keeping the list open', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Texniki xidmət' }));
    await userEvent.click(screen.getByRole('option', { name: 'Nigar Səfərli' }));
    await userEvent.click(screen.getByRole('option', { name: 'Ofis' }));
    expect(onChange).toHaveBeenLastCalledWith({
      users: [{ id: 'w1', name: 'Nigar Səfərli' }],
      teams: [{ id: 'team1', name: 'Texniki xidmət' }],
      sites: [{ id: 'site2', name: 'Ofis' }],
    });
    expect(screen.getByRole('option', { name: 'Ofis' })).toHaveAttribute('aria-selected', 'true');
    // A second click on a chosen option takes it out again.
    await userEvent.click(screen.getByRole('option', { name: 'Ofis' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sites: [] }));
    const chosen = screen.getByRole('list', { name: 'Seçilmiş alıcılar' });
    expect(within(chosen).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nigar Səfərli', 'Texniki xidmət']);
    await userEvent.click(within(chosen).getByRole('button', { name: 'Sil: Texniki xidmət' }));
    expect(onChange).toHaveBeenLastCalledWith({ users: [{ id: 'w1', name: 'Nigar Səfərli' }], teams: [], sites: [] });
  });

  it('picks with the arrow keys and Enter', async () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'Alıcılar' });
    await userEvent.click(box);
    await screen.findByRole('option', { name: 'Murad Əliyev' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ users: [{ id: 'w2', name: 'Murad Əliyev' }], teams: [], sites: [] });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('says when the API capped a list instead of silently cutting it: search for people and teams, a plain note for sites', async () => {
    const refine = i18n.t('notifications.messages.refine');
    const sitesCapped = i18n.t('notifications.messages.sitesCapped', { count: 200 });
    const people = Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, fullName: `Əməkdaş ${i}`, jobTitle: null }));
    mocks.api.messages.options.mockResolvedValue(targetOptions({ users: people }));
    renderWithProviders(<Harness onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Alıcılar' }));
    expect(await screen.findByText(refine)).toBeInTheDocument();
    expect(screen.queryByText(sitesCapped)).not.toBeInTheDocument();
    // Searching cannot bring back the sites past the cap (the API ignores q for them), so they get their own note.
    const places = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, name: `Obyekt ${i}` }));
    mocks.api.messages.options.mockResolvedValue(targetOptions({ sites: places }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Alıcılar' }), 'Obyekt');
    expect(await screen.findByText(sitesCapped)).toBeInTheDocument();
    expect(screen.queryByText(refine)).not.toBeInTheDocument();
    // Under every cap: neither.
    mocks.api.messages.options.mockResolvedValue(targetOptions());
    await userEvent.clear(screen.getByRole('combobox', { name: 'Alıcılar' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Alıcılar' }), 'Nigar');
    await waitFor(() => expect(screen.queryByText(sitesCapped)).not.toBeInTheDocument());
    expect(screen.queryByText(refine)).not.toBeInTheDocument();
  });
});
