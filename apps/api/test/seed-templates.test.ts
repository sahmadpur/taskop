import { countItems, hasRules, validateForPublish, walkItems } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { GLOBAL_TEMPLATE_FIXTURES } from '../src/db/scripts/seed-templates';

describe('global template fixtures', () => {
  it('has one valid template per category except other', () => {
    expect(GLOBAL_TEMPLATE_FIXTURES.map((f) => f.category).sort()).toEqual(['cleaning', 'maintenance', 'production', 'quality', 'restaurant', 'retail', 'safety', 'warehouse']);
    expect(new Set(GLOBAL_TEMPLATE_FIXTURES.map((f) => f.id)).size).toBe(8);
  });

  it.each(GLOBAL_TEMPLATE_FIXTURES.map((f) => [f.name, f] as const))('%s is publishable and uses rules, problems and evidence', (_n, f) => {
    const c = f.build();
    expect(validateForPublish(c)).toEqual([]);
    expect(countItems(c)).toBeGreaterThanOrEqual(10);
    expect(countItems(c)).toBeLessThanOrEqual(25);
    let followUps = 0;
    let problems = 0;
    let evidence = 0;
    walkItems(c, (item, at) => {
      if (at.depth > 0) followUps++;
      if (hasRules(item) && item.rules.some((r) => r.then.problem)) problems++;
      if (item.evidence.photo === 'required' || (hasRules(item) && item.rules.some((r) => r.then.requirePhoto))) evidence++;
    });
    expect(followUps).toBeGreaterThan(0);
    expect(problems).toBeGreaterThan(0);
    expect(evidence).toBeGreaterThan(0);
  });
});
