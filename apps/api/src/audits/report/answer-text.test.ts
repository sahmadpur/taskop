import { type Item, newItem, type NumberItem, type SingleChoiceItem, type YesNoItem } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { answerLine, answerText } from './answer-text';

describe('answer text', () => {
  it('prints every item type in Azerbaijani', () => {
    const yn = newItem('yes_no') as YesNoItem;
    expect(answerText(yn, { optionIds: [yn.options[0].id] })).toBe('Bəli');
    const choice = newItem('single_choice') as SingleChoiceItem;
    choice.options[1]!.label = 'Təmiz';
    expect(answerText(choice, { optionIds: [choice.options[1]!.id] })).toBe('Təmiz');
    const n = newItem('number') as NumberItem;
    n.unit = '°C';
    expect(answerText(n, { number: 5 })).toBe('5 °C');
    expect(answerText(newItem('text'), { text: 'Hazırdır' })).toBe('Hazırdır');
    expect(answerText(newItem('datetime'), { datetime: '2026-11-02T08:00+04:00' })).toBe('2026-11-02T08:00+04:00');
    expect(answerText(newItem('photo'), { photos: ['a', 'b'] })).toBe('2 foto');
    expect(answerText(newItem('video'), { videos: ['v'] })).toBe('1 video');
    expect(answerText(newItem('text'), undefined)).toBe('Cavab yoxdur');
    expect(answerText(newItem('text') as Item, { text: '  ' })).toBe('Cavab yoxdur');
  });

  it('adds the note', () => {
    const n = newItem('number') as NumberItem;
    expect(answerLine(n, { number: 10, note: 'isti' })).toBe('10 — isti');
    expect(answerLine(n, { number: 10 })).toBe('10');
  });
});
