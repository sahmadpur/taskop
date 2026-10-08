import {
  type ChecklistContent,
  CONTENT_LIMITS,
  hasRules,
  type Item,
  type ItemType,
  newItem,
  newRule,
  newSection,
  regenerateItemIds,
  type Rule,
  type Section,
} from '@taskop/contracts';
import { containerDepth, type ContainerRef, containerItems, edit, findItem, insertItem, moveItem, moveSection, type NodeRef, removeItem } from './tree';

export const HISTORY_LIMIT = 50;

export interface BuilderState {
  content: ChecklistContent;
  past: ChecklistContent[];
  future: ChecklistContent[];
  selected: NodeRef;
  /** Bumps on every content change (incl. undo/redo); autosave compares it with the last saved value. */
  version: number;
  /** Consecutive edits with the same key (same node + fields) share one undo step. */
  lastKey: string | null;
}

export interface RulePatch {
  when?: Rule['when'];
  then?: Partial<Omit<Rule['then'], 'followUps'>>;
}

export type BuilderAction =
  | { type: 'select'; node: NodeRef }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'updateSettings'; patch: Partial<Pick<ChecklistContent, 'instructions' | 'scoring'>> }
  | { type: 'addSection' }
  | { type: 'updateSection'; sectionId: string; patch: Partial<Pick<Section, 'title' | 'instructions'>> }
  | { type: 'removeSection'; sectionId: string }
  | { type: 'moveSection'; sectionId: string; index: number }
  | { type: 'addItem'; container: ContainerRef; index?: number; itemType: ItemType }
  | { type: 'updateItem'; itemId: string; patch: Partial<Item> }
  | { type: 'removeItem'; itemId: string }
  | { type: 'duplicateItem'; itemId: string }
  | { type: 'moveItem'; itemId: string; to: ContainerRef; index: number }
  | { type: 'addRule'; itemId: string }
  | { type: 'updateRule'; itemId: string; ruleId: string; patch: RulePatch }
  | { type: 'removeRule'; itemId: string; ruleId: string };

export const initialState = (content: ChecklistContent): BuilderState => ({
  content,
  past: [],
  future: [],
  selected: { kind: 'settings' },
  version: 0,
  lastKey: null,
});

const keyOf = (id: string, patch: object) => `${id}:${Object.keys(patch).sort().join(',')}`;

function commit(state: BuilderState, content: ChecklistContent, opts: { key?: string; selected?: NodeRef } = {}): BuilderState {
  if (content === state.content) return state;
  const coalesce = opts.key !== undefined && opts.key === state.lastKey;
  return {
    content,
    past: coalesce ? state.past : [...state.past, state.content].slice(-HISTORY_LIMIT),
    future: [],
    selected: opts.selected ?? state.selected,
    version: state.version + 1,
    lastKey: opts.key ?? null,
  };
}

function validSelection(content: ChecklistContent, sel: NodeRef): NodeRef {
  if (sel.kind === 'item' && !findItem(content, sel.id)) return { kind: 'settings' };
  if (sel.kind === 'section' && !content.sections.some((s) => s.id === sel.id)) return { kind: 'settings' };
  return sel;
}

function editRule(content: ChecklistContent, itemId: string, fn: (rules: Rule[]) => void): ChecklistContent {
  const found = findItem(content, itemId);
  if (!found || !hasRules(found.item)) return content;
  return edit(content, (d) => {
    const item = findItem(d, itemId)!.item;
    if (hasRules(item)) fn(item.rules);
  });
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  const c = state.content;
  switch (action.type) {
    case 'select':
      return { ...state, selected: action.node, lastKey: null };
    case 'undo': {
      const prev = state.past.at(-1);
      if (!prev) return state;
      return { ...state, content: prev, past: state.past.slice(0, -1), future: [c, ...state.future], version: state.version + 1, lastKey: null, selected: validSelection(prev, state.selected) };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, content: next, past: [...state.past, c].slice(-HISTORY_LIMIT), future: rest, version: state.version + 1, lastKey: null, selected: validSelection(next, state.selected) };
    }
    case 'updateSettings':
      return commit(state, edit(c, (d) => Object.assign(d, action.patch)), { key: keyOf('settings', action.patch) });
    case 'addSection': {
      const s = newSection();
      return commit(state, edit(c, (d) => void d.sections.push(s)), { selected: { kind: 'section', id: s.id } });
    }
    case 'updateSection':
      return commit(
        state,
        edit(c, (d) => {
          const s = d.sections.find((x) => x.id === action.sectionId);
          if (s) Object.assign(s, action.patch);
        }),
        { key: keyOf(action.sectionId, action.patch) },
      );
    case 'removeSection':
      return commit(state, edit(c, (d) => void (d.sections = d.sections.filter((s) => s.id !== action.sectionId))), { selected: { kind: 'settings' } });
    case 'moveSection':
      return commit(state, moveSection(c, action.sectionId, action.index));
    case 'addItem': {
      const depth = containerDepth(c, action.container);
      if (depth === null || depth > CONTENT_LIMITS.followUpDepth) return state;
      const item = newItem(action.itemType);
      const length = containerItems(c, action.container)!.length;
      return commit(state, insertItem(c, action.container, action.index ?? length, item), { selected: { kind: 'item', id: item.id } });
    }
    case 'updateItem':
      if (!findItem(c, action.itemId)) return state;
      return commit(state, edit(c, (d) => void Object.assign(findItem(d, action.itemId)!.item, action.patch)), { key: keyOf(action.itemId, action.patch) });
    case 'removeItem': {
      const found = findItem(c, action.itemId);
      if (!found) return state;
      return commit(state, removeItem(c, action.itemId), { selected: { kind: 'section', id: found.sectionId } });
    }
    case 'duplicateItem': {
      const found = findItem(c, action.itemId);
      if (!found) return state;
      const copy = regenerateItemIds(found.item);
      return commit(state, insertItem(c, found.container, found.index + 1, copy), { selected: { kind: 'item', id: copy.id } });
    }
    case 'moveItem':
      return commit(state, moveItem(c, action.itemId, action.to, action.index));
    case 'addRule': {
      const found = findItem(c, action.itemId);
      if (!found || !hasRules(found.item)) return state;
      const rule = newRule(found.item);
      return commit(state, editRule(c, action.itemId, (rules) => void rules.push(rule)));
    }
    case 'updateRule':
      return commit(
        state,
        editRule(c, action.itemId, (rules) => {
          const rule = rules.find((r) => r.id === action.ruleId);
          if (!rule) return;
          if (action.patch.when) rule.when = action.patch.when;
          if (action.patch.then) Object.assign(rule.then, action.patch.then);
        }),
        { key: keyOf(action.ruleId, { ...(action.patch.when ? { when: 1 } : {}), ...action.patch.then }) },
      );
    case 'removeRule':
      return commit(state, editRule(c, action.itemId, (rules) => void rules.splice(rules.findIndex((r) => r.id === action.ruleId) >>> 0, 1)));
  }
}
