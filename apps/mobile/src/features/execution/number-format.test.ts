import { numberKeyboard, parseNumberAnswer } from './number-format';

const item = (over: { min?: number | null; max?: number | null; decimals?: number } = {}) => ({ min: null, max: null, decimals: 0, ...over });

describe('number answers', () => {
  it('accepts plain decimals with either separator and an optional sign', () => {
    expect(parseNumberAnswer(item(), ' -18 ')).toEqual({ kind: 'ok', value: -18 });
    expect(parseNumberAnswer(item({ decimals: 1 }), '4,5')).toEqual({ kind: 'ok', value: 4.5 });
    expect(parseNumberAnswer(item({ decimals: 2 }), '+3.25')).toEqual({ kind: 'ok', value: 3.25 });
    expect(parseNumberAnswer(item({ decimals: 1 }), '1.50')).toEqual({ kind: 'ok', value: 1.5 });
    expect(parseNumberAnswer(item(), '  ')).toEqual({ kind: 'empty' });
  });

  it('refuses other formats instead of guessing', () => {
    for (const text of ['1e3', '0x10', 'Infinity', '1.2.3', '1,000.5', '--1', '5 kg', '.']) {
      expect(parseNumberAnswer(item({ decimals: 3 }), text)).toEqual({ kind: 'invalid' });
    }
  });

  it('refuses more decimals than the item allows rather than rounding', () => {
    expect(parseNumberAnswer(item(), '4.5')).toEqual({ kind: 'invalid' });
    expect(parseNumberAnswer(item({ decimals: 1 }), '4.55')).toEqual({ kind: 'invalid' });
  });

  it('refuses values outside min and max', () => {
    expect(parseNumberAnswer(item({ min: 2, max: 8 }), '1')).toEqual({ kind: 'invalid' });
    expect(parseNumberAnswer(item({ min: 2, max: 8 }), '9')).toEqual({ kind: 'invalid' });
    expect(parseNumberAnswer(item({ min: 2, max: 8 }), '8')).toEqual({ kind: 'ok', value: 8 });
  });

  it('offers a keyboard with a minus key when the item may be negative', () => {
    expect(numberKeyboard(item({ min: 0 }), 'ios')).toBe('decimal-pad');
    expect(numberKeyboard(item({ min: 2 }), 'android')).toBe('decimal-pad');
    expect(numberKeyboard(item(), 'ios')).toBe('numbers-and-punctuation');
    expect(numberKeyboard(item({ min: -30 }), 'ios')).toBe('numbers-and-punctuation');
    expect(numberKeyboard(item(), 'android')).toBe('numeric');
  });
});
