import { describe, expect, it } from 'vitest';
import {
  type Answers,
  blankContent,
  type ChecklistContent,
  computeScore,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  regenerateIds,
  requirements,
  ruleMatches,
  validateForPublish,
  visibleItems,
  walkItems,
  type YesNoItem,
} from './index.js';

function fixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  problem.weight = 2;
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true, requireNote: true };
  const describeIt = newItem('comment');
  describeIt.label = 'Təsvir';
  const deeper = newItem('yes_no') as YesNoItem;
  deeper.label = 'Təcili?';
  deeper.required = false;
  const deeperRule = newRule(deeper);
  deeperRule.when = { kind: 'options', optionIds: [deeper.options[0].id] };
  const call = newItem('text');
  call.label = 'Kimə zəng edildi?';
  deeperRule.then.followUps.push(call);
  deeper.rules.push(deeperRule);
  onYes.then.followUps.push(describeIt, deeper);
  problem.rules.push(onYes);

  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  temp.rules.push(out);

  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  photo.required = false;
  if (photo.type === 'photo') photo.minCount = 2;

  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo] }] };
  return { content, problem, yes, no, describeIt, deeper, call, temp, photo };
}

describe('visibleItems', () => {
  it('shows follow-ups only for matching answers, recursively', () => {
    const f = fixture();
    const ids = (a: Answers) => visibleItems(f.content, a).map((v) => `${v.depth}:${v.item.label}`);
    expect(ids({})).toEqual(['0:Problem varmı?', '0:Temperatur', '0:Ümumi görünüş']);
    expect(ids({ [f.problem.id]: { optionIds: [f.no.id] } })).toEqual(['0:Problem varmı?', '0:Temperatur', '0:Ümumi görünüş']);
    expect(ids({ [f.problem.id]: { optionIds: [f.yes.id] }, [f.deeper.id]: { optionIds: [f.deeper.options[0].id] } })).toEqual([
      '0:Problem varmı?', '1:Təsvir', '1:Təcili?', '2:Kimə zəng edildi?', '0:Temperatur', '0:Ümumi görünüş',
    ]);
  });

  it('matches number conditions', () => {
    const f = fixture();
    const rule = f.temp.rules[0]!;
    expect(ruleMatches(rule, f.temp, { number: 1.5 })).toBe(true);
    expect(ruleMatches(rule, f.temp, { number: 2 })).toBe(false);
    expect(ruleMatches(rule, f.temp, { number: 8 })).toBe(false);
    expect(ruleMatches(rule, f.temp, { number: 9 })).toBe(true);
    expect(ruleMatches(rule, f.temp, {})).toBe(false);
    for (const [op, value, n, expected] of [['lt', 5, 4, true], ['lte', 5, 5, true], ['gt', 5, 5, false], ['gte', 5, 5, true], ['eq', 5, 5, true]] as const) {
      expect(ruleMatches({ ...rule, when: { kind: 'number', op, value } }, f.temp, { number: n }), op).toBe(expected);
    }
    expect(ruleMatches({ ...rule, when: { kind: 'range', op: 'between', min: 2, max: 8 } }, f.temp, { number: 8 })).toBe(true);
  });

  it('matches multi-choice when any selected option is listed', () => {
    const m = newItem('multi_choice');
    if (m.type !== 'multi_choice') throw new Error();
    const r = newRule(m);
    r.when = { kind: 'options', optionIds: [m.options[1]!.id] };
    expect(ruleMatches(r, m, { optionIds: [m.options[0]!.id, m.options[1]!.id] })).toBe(true);
    expect(ruleMatches(r, m, { optionIds: [m.options[0]!.id] })).toBe(false);
  });
});

describe('requirements', () => {
  it('lists missing answers, rule evidence, notes and media counts', () => {
    const f = fixture();
    expect(requirements(f.content, {})).toEqual([
      { itemId: f.problem.id, kind: 'answer' },
      { itemId: f.temp.id, kind: 'answer' },
    ]);
    const a: Answers = { [f.problem.id]: { optionIds: [f.yes.id] }, [f.temp.id]: { number: 5 }, [f.photo.id]: { photos: ['p1'] } };
    expect(requirements(f.content, a)).toEqual([
      { itemId: f.problem.id, kind: 'photo' },
      { itemId: f.problem.id, kind: 'note' },
      { itemId: f.describeIt.id, kind: 'answer' },
      { itemId: f.photo.id, kind: 'mediaCount' },
    ]);
    a[f.problem.id] = { optionIds: [f.yes.id], photos: ['x'], note: 'Su axır' };
    a[f.describeIt.id] = { text: 'Kran sınıb' };
    a[f.photo.id] = { photos: ['p1', 'p2'] };
    expect(requirements(f.content, a)).toEqual([]);
  });

  it('ignores hidden follow-ups and item-level required evidence until answered', () => {
    const f = fixture();
    f.temp.evidence.photo = 'required';
    const a: Answers = { [f.problem.id]: { optionIds: [f.no.id] } };
    expect(requirements(f.content, a)).toEqual([{ itemId: f.temp.id, kind: 'answer' }]);
    a[f.temp.id] = { number: 4 };
    expect(requirements(f.content, a)).toEqual([{ itemId: f.temp.id, kind: 'photo' }]);
  });
});

describe('computeScore', () => {
  it('weights items that have problem rules and lists problems', () => {
    const f = fixture();
    const a: Answers = { [f.problem.id]: { optionIds: [f.yes.id] }, [f.temp.id]: { number: 5 } };
    expect(computeScore(f.content, a)).toEqual({ earned: 1, possible: 3, percent: 33.3, problems: [{ itemId: f.problem.id, severity: 'critical' }] });
    a[f.problem.id] = { optionIds: [f.no.id] };
    expect(computeScore(f.content, a)).toMatchObject({ earned: 3, possible: 3, percent: 100, problems: [] });
  });

  it('respects problemsReduceScore and enabled', () => {
    const f = fixture();
    const a: Answers = { [f.temp.id]: { number: 20 } };
    f.content.scoring.problemsReduceScore = false;
    expect(computeScore(f.content, a)).toEqual({ earned: 1, possible: 1, percent: 100, problems: [{ itemId: f.temp.id, severity: 'normal' }] });
    f.content.scoring.enabled = false;
    expect(computeScore(f.content, a).percent).toBeNull();
    expect(computeScore(f.content, {}).percent).toBeNull();
  });
});

describe('regenerateIds', () => {
  it('replaces every id and keeps rules pointing at their own options', () => {
    const f = fixture();
    const copy = regenerateIds(f.content);
    const oldIds = new Set<string>();
    walkItems(f.content, (i) => oldIds.add(i.id));
    walkItems(copy, (i) => expect(oldIds.has(i.id)).toBe(false));
    expect(copy.sections[0]!.id).not.toBe(f.content.sections[0]!.id);
    expect(validateForPublish(copy)).toEqual([]);
    const p = copy.sections[0]!.items[0]! as YesNoItem;
    expect(visibleItems(copy, { [p.id]: { optionIds: [p.options[0].id] } })).toHaveLength(5);
    expect(f.content.sections[0]!.items[0]!.id).toBe(f.problem.id);
  });
});
