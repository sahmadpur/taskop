import type { ChecklistContent } from '@taskop/contracts';
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
    // A (height 2) under C's rule would put A11 at depth 3: allowed. Under A11-depth container (3) it would be 5.
    const c = f.content.sections[1]!.items[0]!;
    expect(canMoveTo(f.content, c.id, { kind: 'section', sectionId: f.s1.id })).toBe(true);
    const deep = moveItem(f.content, f.a.id, { kind: 'rule', itemId: f.a1.id, ruleId: f.rule1.id }, 0);
    expect(deep).toBe(f.content);
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
