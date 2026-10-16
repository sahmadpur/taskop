import { describe, expect, it } from 'vitest';
import { contrast } from './contrast.js';
import { markSvg, tileSvg, wordmarkSvg } from './logo.js';
import { type ColorTokens, dark, light } from './tokens.js';

/** The text/background pairs the apps use, with the WCAG AA ratio each must meet (4.5 for text, 3 for large text and UI). */
function pairs(t: ColorTokens): [string, string, string, number][] {
  const list: [string, string, string, number][] = [
    ['ink on canvas', t.ink, t.canvas, 4.5],
    ['ink on surface', t.ink, t.surface, 4.5],
    ['ink2 on surface', t.ink2, t.surface, 4.5],
    ['ink2 on canvas', t.ink2, t.canvas, 4.5],
    ['primary on surface (links)', t.primary, t.surface, 4.5],
    ['onPrimary on primary (buttons)', t.onPrimary, t.primary, 4.5],
    ['onDeep on deep', t.onDeep, t.deep, 4.5],
    ['onDeepMuted on deep', t.onDeepMuted, t.deep, 4.5],
    ['saffron on deep (brand accent)', t.saffron, t.deep, 3],
    ['focus ring on surface', t.focus, t.surface, 3],
    ['line-strong on surface (input borders)', t.lineStrong, t.surface, 1.5],
  ];
  for (const [key, s] of Object.entries(t.status)) {
    list.push([`${key} text on ${key} soft`, s.text, s.soft, 4.5]);
    list.push([`${key} solid on surface`, s.solid, t.surface, 3]);
  }
  return list;
}

describe.each([
  ['light', light],
  ['dark', dark],
])('%s tokens', (_name, tokens) => {
  it.each(pairs(tokens))('%s meets AA', (_label, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
  it('uses #RRGGBB everywhere', () => {
    const walk = (o: object) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') expect(v).toMatch(/^#[0-9A-F]{6}$/);
        else walk(v);
      }
    };
    walk(tokens);
  });
});

describe('logo', () => {
  it('renders the mark, the tile and the wordmark as SVG', () => {
    expect(markSvg({ size: 24 })).toMatch(/^<svg [^>]*viewBox="0 0 64 64"[^>]*width="24"/);
    expect(tileSvg({ background: light.primary, color: '#FFFFFF', radius: 0.22 })).toContain('<rect width="64" height="64" rx="14.08"');
    expect(tileSvg({ background: 'none', color: '#FFFFFF' })).not.toContain('<rect');
    expect(wordmarkSvg()).toContain('Taskop');
  });
});
