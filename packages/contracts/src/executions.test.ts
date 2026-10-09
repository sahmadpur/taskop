import { describe, expect, it } from 'vitest';
import {
  answerIssues,
  type Answers,
  answersSchema,
  blankContent,
  type ChecklistContent,
  claimCommandSchema,
  type MediaKind,
  mediaLimitFor,
  newItem,
  newRule,
  newSection,
  type NumberItem,
  registerMediaCommandSchema,
  type YesNoItem,
} from './index.js';

const ID = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e5f';
const P1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e51';
const P2 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e52';
const P3 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e53';
const V1 = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e54';
const media = new Map<string, MediaKind>([[P1, 'photo'], [P2, 'photo'], [P3, 'photo'], [V1, 'video']]);

function fixture() {
  const problem = newItem('yes_no') as YesNoItem;
  problem.label = 'Problem varmı?';
  const rule = newRule(problem);
  rule.when = { kind: 'options', optionIds: [problem.options[0].id] };
  rule.then = { ...rule.then, problem: 'critical', requirePhoto: true };
  problem.rules.push(rule);
  const temp = newItem('number') as NumberItem;
  temp.label = 'Temperatur';
  temp.min = -50;
  temp.max = 50;
  const photo = newItem('photo');
  photo.label = 'Ümumi görünüş';
  if (photo.type === 'photo') photo.maxCount = 2;
  const note = newItem('text');
  note.label = 'Qeyd';
  const day = newItem('datetime');
  day.label = 'Tarix';
  if (day.type === 'datetime') day.mode = 'date';
  const content: ChecklistContent = { ...blankContent(), sections: [{ ...newSection('Zal'), items: [problem, temp, photo, note, day] }] };
  return { content, problem, temp, photo, note, day };
}

describe('answers schema', () => {
  it('accepts a manual problem and rejects unknown fields, empty notes and more than 5 problem media', () => {
    expect(answersSchema.safeParse({ [ID]: { optionIds: [ID], problem: { severity: 'normal', note: 'Qırıqdır', mediaIds: [P1] } } }).success).toBe(true);
    expect(answersSchema.safeParse({ [ID]: { bogus: 1 } }).success).toBe(false);
    expect(answersSchema.safeParse({ [ID]: { problem: { severity: 'normal', note: '  ', mediaIds: [] } } }).success).toBe(false);
    expect(answersSchema.safeParse({ [ID]: { problem: { severity: 'normal', note: 'x', mediaIds: Array(6).fill(P1) } } }).success).toBe(false);
    expect(answersSchema.safeParse({ 'not-a-uuid': {} }).success).toBe(false);
  });

  it('limits the serialised document to 1 MB', () => {
    const big = Object.fromEntries(Array.from({ length: 520 }, () => [globalThis.crypto.randomUUID(), { note: 'x'.repeat(2000) }]));
    const r = answersSchema.safeParse(big);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe('executions.issues.answersTooLarge');
  });
});

describe('answerIssues', () => {
  const f = fixture();
  const code = (answers: Answers) => answerIssues(f.content, answers, media).map((i) => [i.path.join('.'), i.code]);
  it.each<[string, () => Answers, string[][]]>([
    ['valid answers', () => ({ [f.problem.id]: { optionIds: [f.problem.options[0].id], photos: [P1] }, [f.temp.id]: { number: 5 }, [f.photo.id]: { photos: [P1, P2] }, [f.day.id]: { datetime: '2026-11-02' } }), []],
    ['an unknown item', () => ({ [ID]: { text: 'x' } }), [[`answers.${ID}`, 'executions.issues.unknownItem']]],
    ['an option of another item', () => ({ [f.problem.id]: { optionIds: [ID] } }), [[`answers.${f.problem.id}.optionIds`, 'executions.issues.unknownOption']]],
    ['two options on yes/no', () => ({ [f.problem.id]: { optionIds: f.problem.options.map((o) => o.id) } }), [[`answers.${f.problem.id}.optionIds`, 'executions.issues.invalidValue']]],
    ['a number out of range', () => ({ [f.temp.id]: { number: 60 } }), [[`answers.${f.temp.id}.number`, 'executions.issues.invalidValue']]],
    ['text on a number item', () => ({ [f.temp.id]: { text: '5' } }), [[`answers.${f.temp.id}.text`, 'executions.issues.invalidValue']]],
    ['text over maxLength', () => ({ [f.note.id]: { text: 'x'.repeat(501) } }), [[`answers.${f.note.id}.text`, 'executions.issues.invalidValue']]],
    ['a datetime in the wrong format', () => ({ [f.day.id]: { datetime: '2026-11-02T08:00' } }), [[`answers.${f.day.id}.datetime`, 'executions.issues.invalidValue']]],
    ['photos on an item without photo evidence', () => ({ [f.note.id]: { text: 'x', photos: [P1] } }), [[`answers.${f.note.id}.photos`, 'executions.issues.invalidValue']]],
    ['more photos than maxCount', () => ({ [f.photo.id]: { photos: [P1, P2, P3] } }), [[`answers.${f.photo.id}.photos`, 'executions.issues.tooManyMedia']]],
    ['an unregistered media id', () => ({ [f.photo.id]: { photos: [ID] } }), [[`answers.${f.photo.id}.photos.0`, 'executions.issues.unknownMedia']]],
    ['a video id among photos', () => ({ [f.photo.id]: { photos: [V1] } }), [[`answers.${f.photo.id}.photos.0`, 'executions.issues.unknownMedia']]],
    [
      'an unregistered problem medium',
      () => ({ [f.temp.id]: { number: 5, problem: { severity: 'normal', note: 'x', mediaIds: [P1, ID] } } }),
      [[`answers.${f.temp.id}.problem.mediaIds.1`, 'executions.issues.unknownMedia']],
    ],
  ])('%s', (_name, answers, expected) => {
    expect(code(answers())).toEqual(expected);
  });
});

describe('mediaLimitFor', () => {
  const f = fixture();
  it('uses maxCount for media items and the evidence cap elsewhere', () => {
    expect(mediaLimitFor(f.photo, 'photo')).toBe(2);
    expect(mediaLimitFor(f.photo, 'video')).toBe(0);
    expect(mediaLimitFor(f.problem, 'photo')).toBe(5);
    expect(mediaLimitFor(f.problem, 'video')).toBe(0);
    expect(mediaLimitFor(f.note, 'photo')).toBe(0);
  });
});

describe('commands', () => {
  it('parses a claim and a problem-only media registration', () => {
    const claim = { id: ID, occurrenceId: ID, startedAt: '2026-11-02T04:05:00.000Z', deviceTime: '2026-11-02T04:05:00.000Z', clientOffsetMs: 1200, device: { platform: 'ios', osVersion: '26.0', appVersion: '1.0.0' } };
    expect(claimCommandSchema.safeParse(claim).success).toBe(true);
    expect(claimCommandSchema.safeParse({ ...claim, clientOffsetMs: 1.5 }).success).toBe(false);
    expect(claimCommandSchema.safeParse({ ...claim, clientOffsetMs: 3_000_000_000 }).success).toBe(false);
    const media = { id: ID, itemId: null, kind: 'photo', source: 'camera', mime: 'image/jpeg', bytes: 1000, capturedAt: claim.startedAt, deviceTime: claim.startedAt, clientOffsetMs: 0 };
    expect(registerMediaCommandSchema.safeParse(media).success).toBe(true);
    expect(registerMediaCommandSchema.safeParse({ ...media, bytes: 0 }).success).toBe(false);
  });
});
