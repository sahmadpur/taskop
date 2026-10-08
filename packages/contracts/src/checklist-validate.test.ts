import { describe, expect, it } from 'vitest';
import { blankContent, type ChecklistContent, type Item, newItem, newRule, newSection, validateForPublish } from './index.js';

function valid(): ChecklistContent {
  const yn = newItem('yes_no');
  if (yn.type !== 'yes_no') throw new Error();
  yn.label = 'Döşəmə təmizdir?';
  const rule = newRule(yn);
  rule.when = { kind: 'options', optionIds: [yn.options[1].id] };
  rule.then.problem = 'critical';
  const follow = newItem('comment');
  follow.label = 'Problemi təsvir edin';
  rule.then.followUps.push(follow);
  yn.rules.push(rule);
  const choice = newItem('single_choice');
  if (choice.type !== 'single_choice') throw new Error();
  choice.label = 'Vəziyyət';
  choice.options[0]!.label = 'Yaxşı';
  choice.options[1]!.label = 'Pis';
  return { ...blankContent(), sections: [{ ...newSection('Zal'), items: [yn, choice] }] };
}
const codes = (c: ChecklistContent) => validateForPublish(c).map((i) => `${i.path.join('.')}:${i.code.replace('checklists.issues.', '')}`);
const first = (c: ChecklistContent) => c.sections[0]!.items[0]! as Extract<Item, { type: 'yes_no' }>;

describe('validateForPublish', () => {
  it('accepts a complete checklist', () => expect(validateForPublish(valid())).toEqual([]));

  it('requires sections, items, titles and labels', () => {
    expect(codes({ ...blankContent(), sections: [] })).toEqual(['sections:noSections']);
    expect(codes(blankContent())).toEqual(['sections.0.title:titleRequired', 'sections:noItems']);
    const c = valid();
    c.sections[0]!.items[0]!.label = '  ';
    expect(codes(c)).toEqual(['sections.0.items.0.label:labelRequired']);
  });

  it('checks choice options', () => {
    const c = valid();
    const choice = c.sections[0]!.items[1]!;
    if (choice.type !== 'single_choice') throw new Error();
    choice.options[1]!.label = ' yaxşı ';
    expect(codes(c)).toEqual(['sections.0.items.1.options.1.label:duplicateOptionLabel']);
    choice.options = [choice.options[0]!];
    expect(codes(c)).toEqual(['sections.0.items.1.options:tooFewOptions']);
  });

  it('flags a rule that points at a removed option', () => {
    const c = valid();
    first(c).rules[0]!.when = { kind: 'options', optionIds: [crypto.randomUUID()] };
    expect(codes(c)).toEqual(['sections.0.items.0.rules.0.when:unknownOption']);
    first(c).rules[0]!.when = { kind: 'options', optionIds: [] };
    expect(codes(c)).toEqual(['sections.0.items.0.rules.0.when:ruleNoOptions']);
  });

  it('checks number ranges and rule kinds', () => {
    const c = valid();
    const n = newItem('number');
    if (n.type !== 'number') throw new Error();
    n.label = 'Temperatur';
    n.min = 0;
    n.max = 10;
    const r = newRule(n);
    r.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
    n.rules.push(r);
    c.sections[0]!.items.push(n);
    expect(validateForPublish(c)).toEqual([]);
    r.when = { kind: 'range', op: 'between', min: 8, max: 2 };
    expect(codes(c)).toEqual(['sections.0.items.2.rules.0.when:rangeInvalid']);
    r.when = { kind: 'number', op: 'gt', value: 50 };
    expect(codes(c)).toEqual(['sections.0.items.2.rules.0.when:ruleOutOfRange']);
    r.when = { kind: 'options', optionIds: [] };
    expect(codes(c)).toEqual(['sections.0.items.2.rules.0.when:ruleKindMismatch']);
    r.when = { kind: 'number', op: 'gt', value: 5 };
    n.min = 20;
    expect(codes(c)).toEqual(['sections.0.items.2.max:rangeInvalid', 'sections.0.items.2.rules.0.when:ruleOutOfRange']);
  });

  it('checks media counts', () => {
    const c = valid();
    const p = newItem('photo');
    if (p.type !== 'photo') throw new Error();
    p.label = 'Şəkil';
    p.minCount = 0;
    c.sections[0]!.items.push(p);
    expect(codes(c)).toEqual(['sections.0.items.2.minCount:requiredMediaMin']);
    p.required = false;
    p.minCount = 6;
    expect(codes(c)).toEqual(['sections.0.items.2.maxCount:mediaCountInvalid']);
  });

  it('detects duplicate ids anywhere in the document', () => {
    const c = valid();
    c.sections[0]!.items[1]!.id = c.sections[0]!.items[0]!.id;
    expect(codes(c)).toEqual(['sections.0.items.1.id:duplicateId']);
  });

  it('validates follow-ups too', () => {
    const c = valid();
    first(c).rules[0]!.then.followUps[0]!.label = '';
    expect(codes(c)).toEqual(['sections.0.items.0.rules.0.then.followUps.0.label:labelRequired']);
  });
});
