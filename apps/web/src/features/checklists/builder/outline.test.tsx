import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { indexIssues } from './issues';
import { dropAction, Outline } from './outline';
import { treeFixture } from './fixtures';

describe('dropAction', () => {
  it('maps drops to moves and refuses invalid ones', () => {
    const f = treeFixture();
    const s1 = { kind: 'section' as const, sectionId: f.s1.id };
    const s2 = { kind: 'section' as const, sectionId: f.s2.id };
    expect(dropAction(f.content, { kind: 'item', itemId: f.b.id, container: s1, index: 1 }, { kind: 'item', itemId: f.c.id, container: s2, index: 0 })).toEqual({
      type: 'moveItem', itemId: f.b.id, to: s2, index: 0,
    });
    expect(dropAction(f.content, { kind: 'item', itemId: f.b.id, container: s1, index: 1 }, { kind: 'container', container: s2, length: 1 })).toMatchObject({ index: 1 });
    expect(dropAction(f.content, { kind: 'section', sectionId: f.s2.id, index: 1, itemCount: 1 }, { kind: 'section', sectionId: f.s1.id, index: 0, itemCount: 2 })).toEqual({
      type: 'moveSection', sectionId: f.s2.id, index: 0,
    });
    const own = { kind: 'rule' as const, itemId: f.a1.id, ruleId: f.rule1.id };
    expect(dropAction(f.content, { kind: 'item', itemId: f.a.id, container: s1, index: 0 }, { kind: 'container', container: own, length: 1 })).toBeNull();
  });
});

describe('Outline', () => {
  const setup = (readOnly = false) => {
    const f = treeFixture();
    const dispatch = vi.fn();
    renderWithProviders(<Outline content={f.content} selected={{ kind: 'settings' }} issues={indexIssues(f.content, [])} dispatch={dispatch} readOnly={readOnly} />);
    return { f, dispatch };
  };

  it('renders the tree with follow-ups and selects nodes', async () => {
    const { f, dispatch } = setup();
    const tree = screen.getByRole('tree');
    expect(within(tree).getAllByRole('treeitem').map((n) => n.getAttribute('aria-label'))).toEqual(['S1', 'A', 'A1', 'A11', 'B', 'S2', 'C']);
    await userEvent.click(screen.getByRole('button', { name: 'A1' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'select', node: { kind: 'item', id: f.a1.id } });
  });

  it('moves an item with the Move to dialog', async () => {
    const { f, dispatch } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Köçür… — C' }));
    await userEvent.selectOptions(screen.getByLabelText('Hara'), `section:${f.s1.id}`);
    await userEvent.selectOptions(screen.getByLabelText('Mövqe'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Köçür' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'moveItem', itemId: f.c.id, to: { kind: 'section', sectionId: f.s1.id }, index: 0 });
  });

  it('Move to hides invalid targets', async () => {
    const { f } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Köçür… — A' }));
    const values = within(screen.getByLabelText('Hara')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([`section:${f.s1.id}`, `section:${f.s2.id}`]);
  });

  it('has no editing controls when read-only', () => {
    setup(true);
    expect(screen.queryByRole('button', { name: /Köçür/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bölmə əlavə et' })).toBeNull();
  });
});
