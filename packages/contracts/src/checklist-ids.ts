import { type ChecklistContent, hasRules, type Item } from './checklist-content.js';

const uid = (): string => globalThis.crypto.randomUUID();

function remap(item: Item): Item {
  const optionMap = new Map<string, string>();
  const next = { ...item, id: uid() } as Item;
  if ('options' in next) {
    (next as { options: Array<{ id: string }> }).options = next.options.map((o) => {
      const id = uid();
      optionMap.set(o.id, id);
      return { ...o, id };
    });
  }
  if (hasRules(next)) {
    next.rules = next.rules.map((r) => ({
      id: uid(),
      when: r.when.kind === 'options' ? { kind: 'options', optionIds: r.when.optionIds.map((id) => optionMap.get(id) ?? id) } : { ...r.when },
      then: { ...r.then, followUps: r.then.followUps.map(remap) },
    }));
  }
  return next;
}

/** Deep copy of one item with fresh ids for it, its options, rules and follow-ups (rule → option links kept). */
export const regenerateItemIds = (item: Item): Item => remap(structuredClone(item));

/** Deep copy with fresh ids everywhere: used for copies, templates and save-as-template. */
export function regenerateIds(content: ChecklistContent): ChecklistContent {
  const c = structuredClone(content);
  return { ...c, sections: c.sections.map((s) => ({ ...s, id: uid(), items: s.items.map(remap) })) };
}
