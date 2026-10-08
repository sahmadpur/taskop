import { type ChecklistContent, newItem, newRule, type YesNoItem } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { treeFixture } from './fixtures';
import { canMoveTo, containerDepth, findItem, listContainers, moveItem, moveSection, rootItemId, subtreeHeight } from './tree';

const labels = (c: ChecklistContent, s: number) => c.sections[s]!.items.map((i) => i.label);

describe('tree helpers', () => {
  it('finds items with depth, container and section', () => {
    const f = treeFixture();
    expect(findItem(f.content, f.a11.id)).toMatchObject({ depth: 2, sectionId: f.s1.id, index: 0, container: { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id } });
    expect(findItem(f.content, 'nope')).toBeNull();
    expect(rootItemId(f.content, f.a11.id)).toBe(f.a.id);
    expect(subtreeHeight(f.a)).toBe(2);
    expect(containerDepth(f.content, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id })).toBe(2);
  });

  it('moves within and across sections without mutating the input', () => {
    const f = treeFixture();
    const before = structuredClone(f.content);
    const down = moveItem(f.content, f.a.id, { kind: 'section', sectionId: f.s1.id }, 1);
    expect(labels(down, 0)).toEqual(['B', 'A']);
    const across = moveItem(f.content, f.b.id, { kind: 'section', sectionId: f.s2.id }, 0);
    expect([labels(across, 0), labels(across, 1)]).toEqual([['A'], ['B', 'C']]);
    expect(f.content).toEqual(before);
    expect(moveSection(f.content, f.s2.id, 0).sections.map((s) => s.title)).toEqual(['S2', 'S1']);
  });

  it('refuses moves into own subtree or beyond depth 3', () => {
    const f = treeFixture();
    expect(canMoveTo(f.content, f.a.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id })).toBe(false);
    expect(canMoveTo(f.content, f.b.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id })).toBe(true);
    // Moving A into its own descendant is refused by the ancestry check, not the depth rule.
    const c = f.content.sections[1]!.items[0]!;
    expect(canMoveTo(f.content, c.id, { kind: 'section', sectionId: f.s1.id })).toBe(true);
    const deep = moveItem(f.content, f.a.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id }, 0);
    expect(deep).toBe(f.content);
  });

  it('enforces the follow-up depth limit of 3', () => {
    const f = treeFixture();
    // Deepen: A11 becomes a yes/no Y (depth 2) whose rule r3 is a depth-3 container; Z (depth 3) has rule r4 (depth-4 container).
    const y = newItem('yes_no') as YesNoItem;
    const r3 = newRule(y);
    y.rules.push(r3);
    const z = newItem('yes_no') as YesNoItem;
    const r4 = newRule(z);
    z.rules.push(r4);
    r3.then.followUps.push(z);
    f.rule1.then.followUps[0] = y;
    // D (S2, height 1): a yes/no with one follow-up.
    const d = newItem('yes_no') as YesNoItem;
    const rd = newRule(d);
    rd.then.followUps.push(newItem('text'));
    d.rules.push(rd);
    f.s2.items.push(d);

    const depth2 = { kind: 'rule' as const, itemId: f.a1.id, ruleId: f.rule1.id };
    const depth3 = { kind: 'rule' as const, itemId: y.id, ruleId: r3.id };
    const depth4 = { kind: 'rule' as const, itemId: z.id, ruleId: r4.id };
    expect(containerDepth(f.content, depth3)).toBe(3);
    expect(containerDepth(f.content, depth4)).toBe(4);
    expect(subtreeHeight(d)).toBe(1);

    expect(canMoveTo(f.content, d.id, depth3)).toBe(false); // 3 + 1 > 3
    expect(canMoveTo(f.content, f.b.id, depth4)).toBe(false); // 4 + 0 > 3
    expect(canMoveTo(f.content, d.id, depth2)).toBe(true); // 2 + 1 = 3
    expect(canMoveTo(f.content, f.c.id, depth3)).toBe(true); // 3 + 0 = 3
    expect(moveItem(f.content, d.id, depth3, 0)).toBe(f.content);
  });

  it('lists move targets in document order with depth', () => {
    const f = treeFixture();
    expect(listContainers(f.content).map((c) => [c.depth, c.sectionTitle, c.ownerLabel, c.ruleNo])).toEqual([
      [0, 'S1', null, null],
      [1, 'S1', 'A', 1],
      [2, 'S1', 'A1', 1],
      [0, 'S2', null, null],
    ]);
  });
});
