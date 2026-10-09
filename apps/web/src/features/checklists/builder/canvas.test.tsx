import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { Canvas } from './canvas';
import { indexIssues } from './issues';
import { treeFixture } from './fixtures';

describe('Canvas', () => {
  it('shows the section of the selected item and edits labels inline', () => {
    const f = treeFixture();
    const dispatch = vi.fn();
    renderWithProviders(<Canvas content={f.content} selected={{ kind: 'item', id: f.c.id }} issues={indexIssues(f.content, [])} dispatch={dispatch} readOnly={false} />);
    expect(screen.getByLabelText('Bölmənin adı')).toHaveValue('S2');
    fireEvent.change(screen.getByDisplayValue('C'), { target: { value: 'C2' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'updateItem', itemId: f.c.id, patch: { label: 'C2' } });
  });

  it('adds an item of the chosen type after a card', async () => {
    const f = treeFixture();
    const dispatch = vi.fn();
    renderWithProviders(<Canvas content={f.content} selected={{ kind: 'section', id: f.s1.id }} issues={indexIssues(f.content, [])} dispatch={dispatch} readOnly={false} />);
    await userEvent.click(screen.getAllByRole('button', { name: '+ Bənd əlavə et' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: 'Rəqəm' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'addItem', container: { kind: 'section', sectionId: f.s1.id }, index: 1, itemType: 'number' });
  });
});
