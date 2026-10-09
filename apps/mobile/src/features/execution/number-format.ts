import type { NumberItem } from '@taskop/contracts';

/** A plain decimal: optional sign, digits, one `.` or `,` separator. No exponents, hex, or grouping. */
const PLAIN_DECIMAL = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

export type NumberEntry = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'invalid' };

/**
 * What the worker typed → the stored number. Invalid when it is not a plain decimal, has more decimals than the
 * item allows (never rounded silently), or falls outside min/max.
 */
export function parseNumberAnswer(item: Pick<NumberItem, 'min' | 'max' | 'decimals'>, text: string): NumberEntry {
  const s = text.trim();
  if (!s) return { kind: 'empty' };
  if (!PLAIN_DECIMAL.test(s)) return { kind: 'invalid' };
  const normalised = s.replace(',', '.');
  const fraction = (normalised.split('.')[1] ?? '').replace(/0+$/, '');
  if (fraction.length > item.decimals) return { kind: 'invalid' };
  const value = Number(normalised);
  if (!Number.isFinite(value) || (item.min !== null && value < item.min) || (item.max !== null && value > item.max)) return { kind: 'invalid' };
  return { kind: 'ok', value };
}

/** iOS's decimal pad has no minus key: items that may be negative get a keyboard with one. */
export function numberKeyboard(item: Pick<NumberItem, 'min'>, os: string): 'decimal-pad' | 'numbers-and-punctuation' | 'numeric' {
  if (item.min !== null && item.min >= 0) return 'decimal-pad';
  return os === 'ios' ? 'numbers-and-punctuation' : 'numeric';
}
