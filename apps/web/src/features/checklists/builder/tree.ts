import { type ChecklistContent, CONTENT_LIMITS, hasRules, type Item } from '@taskop/contracts';

export type ContainerRef = { kind: 'section'; sectionId: string } | { kind: 'rule'; itemId: string; ruleId: string };
export type NodeRef = { kind: 'settings' } | { kind: 'section'; id: string } | { kind: 'item'; id: string };

export const containerKey = (c: ContainerRef): string => (c.kind === 'section' ? `section:${c.sectionId}` : `rule:${c.itemId}:${c.ruleId}`);

export interface FoundItem {
  item: Item;
  list: Item[];
  index: number;
  container: ContainerRef;
  depth: number;
  sectionId: string;
}

export function findItem(content: ChecklistContent, itemId: string): FoundItem | null {
  const search = (list: Item[], container: ContainerRef, depth: number, sectionId: string): FoundItem | null => {
    for (let index = 0; index < list.length; index++) {
      const item = list[index]!;
      if (item.id === itemId) return { item, list, index, container, depth, sectionId };
      if (hasRules(item)) {
        for (const rule of item.rules) {
          const hit = search(rule.then.followUps, { kind: 'rule', itemId: item.id, ruleId: rule.id }, depth + 1, sectionId);
          if (hit) return hit;
        }
      }
    }
    return null;
  };
  for (const s of content.sections) {
    const hit = search(s.items, { kind: 'section', sectionId: s.id }, 0, s.id);
    if (hit) return hit;
  }
  return null;
}

export function rootItemId(content: ChecklistContent, itemId: string): string | null {
  let found = findItem(content, itemId);
  while (found && found.container.kind === 'rule') found = findItem(content, found.container.itemId);
  return found?.item.id ?? null;
}

export function containerItems(content: ChecklistContent, c: ContainerRef): Item[] | null {
  if (c.kind === 'section') return content.sections.find((s) => s.id === c.sectionId)?.items ?? null;
  const owner = findItem(content, c.itemId);
  if (!owner || !hasRules(owner.item)) return null;
  return owner.item.rules.find((r) => r.id === c.ruleId)?.then.followUps ?? null;
}

/** Depth of the items that live in `c` (section = 0). */
export function containerDepth(content: ChecklistContent, c: ContainerRef): number | null {
  if (c.kind === 'section') return content.sections.some((s) => s.id === c.sectionId) ? 0 : null;
  const owner = findItem(content, c.itemId);
  return owner && containerItems(content, c) ? owner.depth + 1 : null;
}

export function subtreeHeight(item: Item): number {
  if (!hasRules(item)) return 0;
  let h = 0;
  for (const r of item.rules) for (const f of r.then.followUps) h = Math.max(h, 1 + subtreeHeight(f));
  return h;
}

function contains(item: Item, itemId: string): boolean {
  if (item.id === itemId) return true;
  return hasRules(item) && item.rules.some((r) => r.then.followUps.some((f) => contains(f, itemId)));
}

export function canMoveTo(content: ChecklistContent, itemId: string, to: ContainerRef): boolean {
  const found = findItem(content, itemId);
  const depth = containerDepth(content, to);
  if (!found || depth === null) return false;
  if (to.kind === 'rule' && contains(found.item, to.itemId)) return false;
  return depth + subtreeHeight(found.item) <= CONTENT_LIMITS.followUpDepth;
}

/** Clones the content, applies `fn` to the clone and returns it. */
export const edit = (content: ChecklistContent, fn: (draft: ChecklistContent) => void): ChecklistContent => {
  const d = structuredClone(content);
  fn(d);
  return d;
};

/** `index` is the final position in the target list (after removal from the source). */
export function moveItem(content: ChecklistContent, itemId: string, to: ContainerRef, index: number): ChecklistContent {
  if (!canMoveTo(content, itemId, to)) return content;
  return edit(content, (d) => {
    const found = findItem(d, itemId)!;
    found.list.splice(found.index, 1);
    const target = containerItems(d, to)!;
    target.splice(Math.max(0, Math.min(index, target.length)), 0, found.item);
  });
}

export function insertItem(content: ChecklistContent, to: ContainerRef, index: number, item: Item): ChecklistContent {
  return edit(content, (d) => {
    const target = containerItems(d, to);
    if (target) target.splice(Math.max(0, Math.min(index, target.length)), 0, item);
  });
}

export function removeItem(content: ChecklistContent, itemId: string): ChecklistContent {
  return edit(content, (d) => {
    const found = findItem(d, itemId);
    if (found) found.list.splice(found.index, 1);
  });
}

export function moveSection(content: ChecklistContent, sectionId: string, index: number): ChecklistContent {
  const from = content.sections.findIndex((s) => s.id === sectionId);
  if (from < 0) return content;
  return edit(content, (d) => {
    const [s] = d.sections.splice(from, 1);
    d.sections.splice(Math.max(0, Math.min(index, d.sections.length)), 0, s!);
  });
}

export interface ContainerOption {
  ref: ContainerRef;
  key: string;
  depth: number;
  sectionTitle: string;
  ownerLabel: string | null;
  ruleNo: number | null;
}

export function listContainers(content: ChecklistContent): ContainerOption[] {
  const out: ContainerOption[] = [];
  const visit = (items: Item[], depth: number, sectionTitle: string) => {
    for (const item of items) {
      if (!hasRules(item)) continue;
      item.rules.forEach((rule, i) => {
        const ref: ContainerRef = { kind: 'rule', itemId: item.id, ruleId: rule.id };
        out.push({ ref, key: containerKey(ref), depth: depth + 1, sectionTitle, ownerLabel: item.label, ruleNo: i + 1 });
        visit(rule.then.followUps, depth + 1, sectionTitle);
      });
    }
  };
  for (const s of content.sections) {
    const ref: ContainerRef = { kind: 'section', sectionId: s.id };
    out.push({ ref, key: containerKey(ref), depth: 0, sectionTitle: s.title, ownerLabel: null, ruleNo: null });
    visit(s.items, 0, s.title);
  }
  return out;
}
