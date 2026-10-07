import type { SiteDto } from '@taskop/contracts';

export interface SiteNode extends SiteDto {
  children: SiteNode[];
}

export function buildTree(sites: SiteDto[]): SiteNode[] {
  const nodes = new Map(sites.map((s) => [s.id, { ...s, children: [] as SiteNode[] }]));
  const roots: SiteNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: SiteNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'az'));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function moveTargets(sites: SiteDto[], siteId: string): SiteDto[] {
  const self = sites.find((s) => s.id === siteId);
  if (!self) return sites;
  return sites.filter((s) => s.path !== self.path && !s.path.startsWith(`${self.path}.`));
}

/** Indented label for flat <select> lists of sites. */
export const indentedName = (s: SiteDto) => `${'  '.repeat(s.depth)}${s.name}`;
