import { describe, expect, it } from 'vitest';
import { ruleDto } from './fixtures';
import { draftOf, ruleBody, sameDraft } from './rules-form';

const all = { enabled: true, push: true, email: true, notifyAssignees: true, notifyCreator: true, roleIds: ['r1', 'r1', 'r2'], leadMinutes: 60, resultFilter: 'any' } as const;

describe('rule form', () => {
  it('sends the full rule with only the audiences and the lead time the type has, each role once', () => {
    expect(ruleBody('problem.critical', { ...all, roleIds: [...all.roleIds] })).toEqual({
      enabled: true,
      push: true,
      email: true,
      notifyAssignees: false,
      notifyCreator: false,
      roleIds: ['r1', 'r2'],
      leadMinutes: null,
      resultFilter: null,
    });
    expect(ruleBody('checklist.due_soon', { ...all, roleIds: [], leadMinutes: null })).toEqual({
      enabled: true,
      push: true,
      email: true,
      notifyAssignees: true,
      notifyCreator: false,
      roleIds: [],
      // A due-soon rule always carries a lead time: the default (30) when none was picked.
      leadMinutes: 30,
      resultFilter: null,
    });
    expect(ruleBody('task.overdue', { ...all, roleIds: [] })).toMatchObject({ notifyAssignees: true, notifyCreator: true, leadMinutes: null, resultFilter: null });
  });

  it('sends the result filter of audit.finished only, its default when none was picked', () => {
    expect(ruleBody('audit.finished', { ...all, roleIds: [] })).toMatchObject({ resultFilter: 'any', leadMinutes: null, notifyCreator: false });
    expect(ruleBody('audit.finished', { ...all, roleIds: [], resultFilter: null })).toMatchObject({ resultFilter: 'failed' });
    expect(ruleBody('run.resubmitted', { ...all, roleIds: [] })).toMatchObject({ resultFilter: null, notifyAssignees: false, notifyCreator: true });
  });

  it('counts a changed result filter as a change', () => {
    const a = draftOf(ruleDto('audit.finished'));
    expect(a.resultFilter).toBe('failed');
    expect(sameDraft(a, { ...a, resultFilter: 'any' })).toBe(false);
  });

  it('compares drafts by value, ignoring the order of roles', () => {
    const a = draftOf(ruleDto('problem.critical'));
    expect(sameDraft(a, { ...a, roleIds: [...a.roleIds].reverse() })).toBe(true);
    expect(sameDraft(a, { ...a, email: false })).toBe(false);
    expect(sameDraft(a, { ...a, roleIds: a.roleIds.slice(1) })).toBe(false);
  });
});
