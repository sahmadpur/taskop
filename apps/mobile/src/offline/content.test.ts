import { blankContent, newItem, newRule, newSection, type YesNoItem } from '@taskop/contracts';
import { findItem, loadContent } from './content';

describe('checklist content gate', () => {
  it('parses content this app understands', () => {
    const r = loadContent(1, JSON.stringify(blankContent()));
    expect(r.kind).toBe('ok');
  });

  it('refuses a newer schemaVersion without parsing it, and treats unreadable content the same way', () => {
    expect(loadContent(2, '{"schemaVersion":2,"anything":true}')).toEqual({ kind: 'needsUpdate' });
    expect(loadContent(1, '{not json')).toEqual({ kind: 'needsUpdate' });
    expect(loadContent(1, '{"schemaVersion":1}')).toEqual({ kind: 'needsUpdate' });
  });

  it('finds follow-up items nested in rules', () => {
    const q = newItem('yes_no') as YesNoItem;
    const rule = newRule(q);
    const follow = newItem('text');
    rule.then.followUps.push(follow);
    q.rules.push(rule);
    const content = { ...blankContent(), sections: [{ ...newSection('A'), items: [q] }] };
    expect(findItem(content, follow.id)).toBe(follow);
    expect(findItem(content, 'nope')).toBeUndefined();
  });
});
