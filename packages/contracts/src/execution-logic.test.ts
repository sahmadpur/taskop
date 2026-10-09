import { describe, expect, it } from 'vitest';
import {
  type Answers,
  blankContent,
  type ChecklistContent,
  deriveProblems,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  progress,
  type YesNoItem,
} from './index.js';

const M1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e51';
const M2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e52';

/** problem (yes → critical + photo + follow-up comment), temp (outside 2–8 → normal + note), photo (required), note (optional). */
function fixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const [yes, no] = problem.options;
  const onYes = newRule(problem);
  onYes.when = { kind: 'options', optionIds: [yes.id] };
  onYes.then = { ...onYes.then, problem: 'critical', requirePhoto: true };
  const comment = newItem('comment');
  comment.label = 'Təsvir edin';
  onYes.then.followUps.push(comment);
  problem.rules.push(onYes);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  const out = newRule(temp);
  out.when = { kind: 'range', op: 'outside', min: 2, max: 8 };
  out.then.problem = 'normal';
  out.then.requireNote = true;
  temp.rules.push(out);
  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  const note = newItem('text');
  note.label = 'Qeyd';
  note.required = false;
  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo, note] }] };
  return { content, problem, yes, no, comment, temp, photo, note };
}

describe('progress', () => {
  it('counts visible items, answered ones and every completion blocker', () => {
    const f = fixture();
    expect(progress(f.content, {})).toEqual({ answered: 0, total: 4, requiredMissing: 3 });
    // "yes" shows the comment (5 visible) and requires a photo on the problem item.
    expect(progress(f.content, { [f.problem.id]: { optionIds: [f.yes.id] } })).toEqual({ answered: 1, total: 5, requiredMissing: 4 });
    const done: Answers = {
      [f.problem.id]: { optionIds: [f.no.id] },
      [f.temp.id]: { number: 5 },
      [f.photo.id]: { photos: [M1] },
    };
    expect(progress(f.content, done)).toEqual({ answered: 3, total: 4, requiredMissing: 0 });
  });

  it('ignores answers to hidden follow-ups', () => {
    const f = fixture();
    expect(progress(f.content, { [f.problem.id]: { optionIds: [f.no.id] }, [f.comment.id]: { text: 'köhnə' } })).toEqual({ answered: 1, total: 4, requiredMissing: 2 });
  });
});

describe('deriveProblems', () => {
  const f = fixture();
  it.each<[string, Answers, ReturnType<typeof deriveProblems>]>([
    ['no answers', {}, []],
    [
      'a rule problem carries the answer note and its evidence',
      { [f.problem.id]: { optionIds: [f.yes.id], photos: [M1], videos: [M2], note: ' Su axır ' } },
      [{ itemId: f.problem.id, source: 'rule', severity: 'critical', note: 'Su axır', mediaIds: [M1, M2] }],
    ],
    ['a number out of range', { [f.temp.id]: { number: 10 } }, [{ itemId: f.temp.id, source: 'rule', severity: 'normal', note: null, mediaIds: [] }]],
    [
      'a manual problem on a good answer',
      { [f.temp.id]: { number: 5, problem: { severity: 'critical', note: 'Termometr köhnədir', mediaIds: [M1] } } },
      [{ itemId: f.temp.id, source: 'manual', severity: 'critical', note: 'Termometr köhnədir', mediaIds: [M1] }],
    ],
    [
      'rule before manual on the same item, in visible order',
      {
        [f.problem.id]: { optionIds: [f.yes.id] },
        [f.temp.id]: { number: 10, note: 'isti', problem: { severity: 'normal', note: 'Kondisioner xarabdır', mediaIds: [] } },
      },
      [
        { itemId: f.problem.id, source: 'rule', severity: 'critical', note: null, mediaIds: [] },
        { itemId: f.temp.id, source: 'rule', severity: 'normal', note: 'isti', mediaIds: [] },
        { itemId: f.temp.id, source: 'manual', severity: 'normal', note: 'Kondisioner xarabdır', mediaIds: [] },
      ],
    ],
    [
      'a manual problem on a hidden follow-up is ignored',
      { [f.problem.id]: { optionIds: [f.no.id] }, [f.comment.id]: { text: 'x', problem: { severity: 'normal', note: 'gizli', mediaIds: [] } } },
      [],
    ],
  ])('%s', (_name, answers, expected) => {
    expect(deriveProblems(f.content, answers)).toEqual(expected);
  });
});
