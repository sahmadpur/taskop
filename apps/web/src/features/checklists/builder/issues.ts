import type { ChecklistContent, ContentIssue } from '@taskop/contracts';

export interface NodeIssue {
  field: string | null;
  code: string;
}
export interface LocatedIssue extends NodeIssue {
  node: { kind: 'section' | 'item'; id: string } | null;
}
export interface IssueIndex {
  byNode: Map<string, NodeIssue[]>;
  list: LocatedIssue[];
}

function nodeKind(v: unknown): 'section' | 'item' | null {
  if (!v || typeof v !== 'object' || typeof (v as { id?: unknown }).id !== 'string') return null;
  if ('title' in v && 'items' in v) return 'section';
  if ('type' in v && 'label' in v) return 'item';
  return null;
}

/** Maps each issue path (e.g. sections.0.items.2.rules.0.when) to the deepest section/item it passes through. */
export function indexIssues(content: ChecklistContent, issues: ContentIssue[]): IssueIndex {
  const byNode = new Map<string, NodeIssue[]>();
  const list: LocatedIssue[] = [];
  for (const issue of issues) {
    let cur: unknown = content;
    let node: LocatedIssue['node'] = null;
    let field: string | null = null;
    for (const seg of issue.path) {
      cur = cur && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[seg] : undefined;
      const kind = nodeKind(cur);
      if (kind) {
        node = { kind, id: (cur as { id: string }).id };
        field = null;
      } else if (node && field === null && typeof seg === 'string') {
        field = seg;
      }
    }
    list.push({ code: issue.code, field, node });
    if (node) byNode.set(node.id, [...(byNode.get(node.id) ?? []), { field, code: issue.code }]);
  }
  return { byNode, list };
}
