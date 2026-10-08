import type { SiteDto } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { buildTree, moveTargets } from './tree';

const site = (id: string, path: string, name: string, parentId: string | null): SiteDto => ({
  id,
  path,
  name,
  parentId,
  typeId: 't',
  address: null,
  active: true,
  depth: path.split('.').length - 1,
});
const sites = [
  site('b', 'b', 'Bravo', null),
  site('a', 'a', 'Alfa', null),
  site('a1', 'a.a1', 'Zona 1', 'a'),
  site('a11', 'a.a1.a11', 'Bölmə', 'a1'),
  site('ab', 'ab', 'Alfa-B', null),
];

describe('buildTree', () => {
  it('nests children and sorts by name', () => {
    const tree = buildTree(sites);
    expect(tree.map((n) => n.name)).toEqual(['Alfa', 'Alfa-B', 'Bravo']);
    expect(tree[0]!.children[0]!.children[0]!.id).toBe('a11');
  });
});

describe('moveTargets', () => {
  it('move targets exclude the site and its descendants (but not path-prefix lookalikes)', () => {
    expect(moveTargets(sites, 'a').map((s) => s.id).sort()).toEqual(['ab', 'b']);
    expect(moveTargets(sites, 'a1').map((s) => s.id).sort()).toEqual(['a', 'ab', 'b']);
  });
});
