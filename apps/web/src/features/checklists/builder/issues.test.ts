import { validateForPublish } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { indexIssues } from './issues';
import { treeFixture } from './fixtures';

describe('indexIssues', () => {
  it('attaches issues to the deepest section or item on the path', () => {
    const f = treeFixture();
    f.content.sections[1]!.title = '';
    f.a11.label = '';
    const idx = indexIssues(f.content, validateForPublish(f.content));
    expect(idx.byNode.get(f.s2.id)).toEqual([{ field: 'title', code: 'checklists.issues.titleRequired' }]);
    expect(idx.byNode.get(f.a.id)).toEqual([{ field: 'rules', code: 'checklists.issues.ruleNoOptions' }]);
    expect(idx.byNode.get(f.a11.id)).toEqual([{ field: 'label', code: 'checklists.issues.labelRequired' }]);
    expect(idx.list.find((i) => i.node?.id === f.a11.id)).toEqual({ code: 'checklists.issues.labelRequired', field: 'label', node: { kind: 'item', id: f.a11.id } });
  });

  it('keeps checklist-level issues without a node', () => {
    const f = treeFixture();
    const idx = indexIssues(f.content, [{ path: ['sections'], code: 'checklists.issues.noItems' }]);
    expect(idx.list).toEqual([{ code: 'checklists.issues.noItems', field: null, node: null }]);
  });
});
