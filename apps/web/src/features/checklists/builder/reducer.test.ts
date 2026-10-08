import { newItem, newRule, type YesNoItem } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { builderReducer, type BuilderAction, type BuilderState, HISTORY_LIMIT, initialState } from './reducer';
import { findItem } from './tree';
import { treeFixture } from './fixtures';

const run = (s: BuilderState, ...actions: BuilderAction[]) => actions.reduce(builderReducer, s);

describe('builderReducer', () => {
  it('adds an item and selects it', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'addItem', container: { kind: 'section', sectionId: f.s2.id }, itemType: 'number' });
    const added = s.content.sections[1]!.items[1]!;
    expect(added.type).toBe('number');
    expect(s.selected).toEqual({ kind: 'item', id: added.id });
    expect(s.version).toBe(1);
  });

  it('coalesces typing into one undo step', () => {
    const f = treeFixture();
    let s = initialState(f.content);
    for (const label of ['B', 'Bo', 'Bos']) s = builderReducer(s, { type: 'updateItem', itemId: f.b.id, patch: { label } });
    expect(s.past).toHaveLength(1);
    s = builderReducer(s, { type: 'updateItem', itemId: f.b.id, patch: { required: false } });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(findItem(s.content, f.b.id)!.item.label).toBe('B');
    s = builderReducer(s, { type: 'redo' });
    expect(findItem(s.content, f.b.id)!.item.label).toBe('Bos');
    expect(s.version).toBe(7);
  });

  it('caps history at 50 and clears redo on a new change', () => {
    const f = treeFixture();
    let s = initialState(f.content);
    for (let i = 0; i < 60; i++) s = builderReducer(s, { type: 'moveSection', sectionId: f.s1.id, index: i % 2 });
    expect(s.past.length).toBe(HISTORY_LIMIT);
    s = run(s, { type: 'undo' }, { type: 'addSection' });
    expect(s.future).toEqual([]);
  });

  it('duplicates with fresh ids right after the original', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'duplicateItem', itemId: f.a.id });
    const [orig, copy] = s.content.sections[0]!.items;
    expect(copy!.label).toBe('A');
    expect(copy!.id).not.toBe(orig!.id);
    expect(s.selected).toEqual({ kind: 'item', id: copy!.id });
  });

  it('edits rules and follow-ups, respecting depth', () => {
    const f = treeFixture();
    const noRule = initialState(f.content);
    expect(builderReducer(noRule, { type: 'addRule', itemId: f.b.id })).toBe(noRule);
    let s = run(initialState(f.content), { type: 'addRule', itemId: f.a.id });
    const newRule = (findItem(s.content, f.a.id)!.item as typeof f.a).rules[1]!;
    s = run(s, { type: 'updateRule', itemId: f.a.id, ruleId: newRule.id, patch: { then: { problem: 'critical' } } });
    expect((findItem(s.content, f.a.id)!.item as typeof f.a).rules[1]!.then).toMatchObject({ problem: 'critical', followUps: [] });
    const depth2 = { kind: 'rule' as const, itemId: f.a1.id, ruleId: f.rule1.id };
    s = run(s, { type: 'addItem', container: depth2, itemType: 'text' });
    expect(findItem(s.content, f.a1.id)!.item).toMatchObject({ rules: [{ then: { followUps: [{}, {}] } }] });
    s = run(s, { type: 'removeRule', itemId: f.a.id, ruleId: f.rule.id });
    expect(findItem(s.content, f.a1.id)).toBeNull();
  });

  it('drops a removed selection back to its section', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'select', node: { kind: 'item', id: f.b.id } }, { type: 'removeItem', itemId: f.b.id });
    expect(s.selected).toEqual({ kind: 'section', id: f.s1.id });
    const u = builderReducer(s, { type: 'undo' });
    expect(findItem(u.content, f.b.id)).not.toBeNull();
  });

  it('refuses addItem into a depth-4 container', () => {
    const f = treeFixture();
    const y = newItem('yes_no') as YesNoItem;
    const r3 = newRule(y);
    y.rules.push(r3);
    const z = newItem('yes_no') as YesNoItem;
    const r4 = newRule(z);
    z.rules.push(r4);
    r3.then.followUps.push(z);
    f.rule1.then.followUps[0] = y;
    const s = initialState(f.content);
    expect(builderReducer(s, { type: 'addItem', container: { kind: 'rule', itemId: z.id, ruleId: r4.id }, itemType: 'text' })).toBe(s);
    const ok = builderReducer(s, { type: 'addItem', container: { kind: 'rule', itemId: y.id, ruleId: r3.id }, itemType: 'text' });
    expect(ok).not.toBe(s);
  });

  it('resets the selection when removing its parent rule', () => {
    const f = treeFixture();
    const s = run(initialState(f.content), { type: 'select', node: { kind: 'item', id: f.a1.id } }, { type: 'removeRule', itemId: f.a.id, ruleId: f.rule.id });
    expect(s.selected).toEqual({ kind: 'settings' });
  });
});
