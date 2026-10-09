import { type ChecklistContent, type Item, parseDraftContent, walkItems } from '@taskop/contracts';

/** The highest checklist content schemaVersion this app understands (SP2 §3.2). */
export const SUPPORTED_SCHEMA_VERSION = 1;

export type ContentLoad = { kind: 'ok'; content: ChecklistContent } | { kind: 'needsUpdate' } | { kind: 'missing' };

/** Newer or unreadable content is never guessed at: the worker is told to update the app ("Tətbiqi yeniləyin"). */
export function loadContent(schemaVersion: number, raw: string): ContentLoad {
  if (schemaVersion > SUPPORTED_SCHEMA_VERSION) return { kind: 'needsUpdate' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: 'needsUpdate' };
  }
  const parsed = parseDraftContent(json);
  return parsed.success ? { kind: 'ok', content: parsed.content } : { kind: 'needsUpdate' };
}

export function findItem(content: ChecklistContent, itemId: string): Item | undefined {
  const items = new Map<string, Item>();
  walkItems(content, (item) => items.set(item.id, item));
  return items.get(itemId);
}
