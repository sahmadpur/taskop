import { blankContent, type ChecklistContent, newItem, newSection, type NumberItem, type SingleChoiceItem, type YesNoItem } from '@taskop/contracts';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Inspector } from './inspector';
import { indexIssues } from './issues';
import { builderReducer, type BuilderState, initialState } from './reducer';
import { findItem } from './tree';

let last: BuilderState;
function Harness({ content, itemId, readOnly = false }: { content: ChecklistContent; itemId: string; readOnly?: boolean }) {
  const [state, dispatch] = useReducer(builderReducer, { ...initialState(content), selected: { kind: 'item', id: itemId } });
  // eslint-disable-next-line react-hooks/globals -- test probe captures the latest reducer state for assertions
  last = state;
  return <Inspector content={state.content} selected={state.selected} issues={indexIssues(state.content, [])} dispatch={dispatch} readOnly={readOnly} />;
}
const doc = (...items: ChecklistContent['sections'][0]['items']) => ({ ...blankContent(), sections: [{ ...newSection('S'), items }] });

describe('Inspector', () => {
  it('edits common fields', async () => {
    const item = newItem('yes_no');
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    fireEvent.change(screen.getByLabelText('Sualın mətni'), { target: { value: 'Qapı bağlıdır?' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Məcburi' }));
    await userEvent.selectOptions(screen.getByLabelText('Foto'), 'required');
    fireEvent.change(screen.getByLabelText('Çəki (bal)'), { target: { value: '3' } });
    expect(findItem(last.content, item.id)!.item).toMatchObject({ label: 'Qapı bağlıdır?', required: false, weight: 3, evidence: { photo: 'required' } });
  });

  it('removing an option strips it from rules', async () => {
    const item = newItem('single_choice') as SingleChoiceItem;
    item.options = [{ id: crypto.randomUUID(), label: 'Yaxşı' }, { id: crypto.randomUUID(), label: 'Pis' }, { id: crypto.randomUUID(), label: 'Çox pis' }];
    item.rules = [{ id: crypto.randomUUID(), when: { kind: 'options', optionIds: [item.options[1]!.id, item.options[2]!.id] }, then: { problem: 'normal', requireNote: false, requirePhoto: false, requireVideo: false, followUps: [] } }];
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Seçimi sil' })[2]!);
    const after = findItem(last.content, item.id)!.item as SingleChoiceItem;
    expect(after.options.map((o) => o.label)).toEqual(['Yaxşı', 'Pis']);
    expect(after.rules[0]!.when).toEqual({ kind: 'options', optionIds: [item.options[1]!.id] });
  });

  it('builds a "Yes → critical problem + photo + follow-up" rule', async () => {
    const item = newItem('yes_no') as YesNoItem;
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qayda əlavə et' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Bəli' }));
    await userEvent.selectOptions(screen.getByLabelText('Problem'), 'critical');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Foto tələb et' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Əlavə sual' }));
    await userEvent.click(screen.getByRole('button', { name: 'Şərh' }));
    const rule = (findItem(last.content, item.id)!.item as YesNoItem).rules[0]!;
    expect(rule.when).toEqual({ kind: 'options', optionIds: [item.options[0].id] });
    expect(rule.then).toMatchObject({ problem: 'critical', requirePhoto: true, followUps: [{ type: 'comment' }] });
    expect(last.selected).toEqual({ kind: 'item', id: rule.then.followUps[0]!.id });
  });

  it('switches a number rule between single value and range', async () => {
    const item = newItem('number');
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qayda əlavə et' }));
    await userEvent.selectOptions(screen.getByLabelText('Cavab'), 'outside');
    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Maksimum'), { target: { value: '8' } });
    expect((findItem(last.content, item.id)!.item as { rules: { when: unknown }[] }).rules[0]!.when).toEqual({ kind: 'range', op: 'outside', min: 2, max: 8 });
  });

  it('disables everything when read-only', () => {
    const item = newItem('yes_no');
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} readOnly />);
    expect(screen.getByLabelText('Sualın mətni')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Qayda əlavə et' })).toBeNull();
  });

  it('clearing then typing a weight commits the typed number', async () => {
    const item = newItem('yes_no');
    const n = newItem('number');
    renderWithProviders(<Harness content={doc(item, n)} itemId={item.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qayda əlavə et' }));
    const weight = screen.getByLabelText('Çəki (bal)');
    await userEvent.clear(weight);
    await userEvent.type(weight, '12');
    expect(weight).toHaveValue(12);
    expect((findItem(last.content, item.id)!.item as YesNoItem).weight).toBe(12);
  });

  it('types a negative rule value and clears number-item limits to null', async () => {
    const item = newItem('number') as NumberItem;
    item.min = 3;
    renderWithProviders(<Harness content={doc(item)} itemId={item.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Qayda əlavə et' }));
    await userEvent.selectOptions(screen.getByLabelText('Cavab'), 'eq');
    const value = screen.getByLabelText('Dəyər');
    await userEvent.clear(value);
    await userEvent.type(value, '-5');
    expect((findItem(last.content, item.id)!.item as NumberItem).rules[0]!.when).toMatchObject({ value: -5 });
    await userEvent.clear(screen.getByLabelText('Minimum dəyər'));
    expect((findItem(last.content, item.id)!.item as NumberItem).min).toBeNull();
  });

  it('deletes a selected follow-up from its rule', async () => {
    const item = newItem('yes_no') as YesNoItem;
    const followUp = newItem('comment');
    item.rules = [{ id: crypto.randomUUID(), when: { kind: 'options', optionIds: [item.options[0].id] }, then: { problem: null, requireNote: false, requirePhoto: false, requireVideo: false, followUps: [followUp] } }];
    renderWithProviders(<Harness content={doc(item)} itemId={followUp.id} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }));
    expect(findItem(last.content, followUp.id)).toBeNull();
    expect((findItem(last.content, item.id)!.item as YesNoItem).rules[0]!.then.followUps).toEqual([]);
  });
});
