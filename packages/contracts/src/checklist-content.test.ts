import { describe, expect, it } from 'vitest';
import {
  blankContent,
  type ChecklistContent,
  countItems,
  ITEM_TYPES,
  type Item,
  newItem,
  newRule,
  newSection,
  parseDraftContent,
  walkItems,
} from './index.js';

const withItems = (...items: Item[]): ChecklistContent => ({ ...blankContent(), sections: [{ ...newSection('S'), items }] });

function nest(depth: number): Item {
  const root = newItem('yes_no');
  let cur = root;
  for (let i = 0; i < depth; i++) {
    if (cur.type !== 'yes_no') throw new Error('unreachable');
    const rule = newRule(cur);
    const child = newItem('yes_no');
    rule.then.followUps.push(child);
    cur.rules.push(rule);
    cur = child;
  }
  return root;
}

describe('checklist content schema', () => {
  it('accepts every item type built by the factories', () => {
    const content = withItems(...ITEM_TYPES.map((t) => newItem(t)));
    const r = parseDraftContent(JSON.parse(JSON.stringify(content)));
    expect(r.success).toBe(true);
  });

  it('accepts a blank draft with empty labels (drafts are lenient)', () => {
    expect(parseDraftContent(blankContent()).success).toBe(true);
  });

  it('strips unknown keys', () => {
    const content = withItems(newItem('text'));
    const raw = JSON.parse(JSON.stringify(content));
    raw.sections[0].items[0].hack = 1;
    const r = parseDraftContent(raw);
    expect(r.success && 'hack' in r.content.sections[0]!.items[0]!).toBe(false);
  });

  it('reports issues with exact paths and i18n codes', () => {
    const content = withItems(newItem('text'));
    const raw = JSON.parse(JSON.stringify(content));
    raw.sections[0].items[0].label = 'x'.repeat(501);
    const r = parseDraftContent(raw);
    expect(r).toEqual({ success: false, issues: [{ path: ['sections', 0, 'items', 0, 'label'], code: 'errors.validation.tooLong' }] });
  });

  it('allows follow-ups three levels deep but not four', () => {
    expect(parseDraftContent(withItems(nest(3))).success).toBe(true);
    const r = parseDraftContent(withItems(nest(4)));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => i.code)).toContain('checklists.issues.tooDeep');
  });

  it('rejects pathological nesting without recursion', () => {
    let raw: unknown = {};
    for (let i = 0; i < 20_000; i++) raw = { x: [raw] };
    expect(parseDraftContent(raw)).toEqual({ success: false, issues: [{ path: [], code: 'checklists.issues.tooDeep' }] });
  });

  it('rejects more than 500 items', () => {
    const items = Array.from({ length: 501 }, () => newItem('text'));
    const r = parseDraftContent(withItems(...items));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues).toContainEqual({ path: ['sections'], code: 'checklists.issues.tooManyItems' });
  });

  it('only rule-capable types carry rules', () => {
    const raw = JSON.parse(JSON.stringify(withItems(newItem('text'))));
    raw.sections[0].items[0].rules = [];
    const r = parseDraftContent(raw);
    expect(r.success && 'rules' in r.content.sections[0]!.items[0]!).toBe(false);
  });

  it('walks items depth-first with paths and counts them', () => {
    const content = withItems(nest(2), newItem('text'));
    const seen: Array<[number, string]> = [];
    walkItems(content, (_item, at) => seen.push([at.depth, at.path.join('.')]));
    expect(seen).toEqual([
      [0, 'sections.0.items.0'],
      [1, 'sections.0.items.0.rules.0.then.followUps.0'],
      [2, 'sections.0.items.0.rules.0.then.followUps.0.rules.0.then.followUps.0'],
      [0, 'sections.0.items.1'],
    ]);
    expect(countItems(content)).toBe(4);
  });
});
