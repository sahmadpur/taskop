import { blankContent, type ChecklistContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';

/** S1: [A (rule → A1 (rule → A11)), B], S2: [C]. Shared by the builder tests. */
export function treeFixture() {
  const a = newItem('yes_no') as YesNoItem;
  a.label = 'A';
  const rule = newRule(a);
  const a1 = newItem('yes_no') as YesNoItem;
  a1.label = 'A1';
  const rule1 = newRule(a1);
  const a11 = newItem('text');
  a11.label = 'A11';
  rule1.then.followUps.push(a11);
  a1.rules.push(rule1);
  rule.then.followUps.push(a1);
  a.rules.push(rule);
  const b = newItem('text');
  b.label = 'B';
  const c = newItem('text');
  c.label = 'C';
  const s1 = { ...newSection('S1'), items: [a, b] };
  const s2 = { ...newSection('S2'), items: [c] };
  const content: ChecklistContent = { ...blankContent(), sections: [s1, s2] };
  return { content, a, rule, a1, rule1, a11, b, c, s1, s2 };
}
