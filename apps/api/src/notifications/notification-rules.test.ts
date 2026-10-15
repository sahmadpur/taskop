import { DEFAULT_RULES, RULE_TYPES } from '@taskop/contracts';
import { describe, expect, it } from 'vitest';
import { effectiveRule, type RoleCatalog, ruleIssues } from './notification-rules';

const MANAGER = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e01';
const ADMIN = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e02';
const CUSTOM = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e03';
const GONE = '0192f1e2-7c3a-7b4d-8e5f-0a1b2c3d4e04';
const roles: RoleCatalog = { bySystemKey: { manager: MANAGER, admin: ADMIN }, ids: new Set([MANAGER, ADMIN, CUSTOM]) };
const row = { enabled: false, push: false, email: true, notifyAssignees: true, notifyCreator: false, roleIds: [CUSTOM, GONE], leadMinutes: null };

describe('effectiveRule', () => {
  it('turns each default’s system roles into the tenant’s role ids', () => {
    expect(effectiveRule('checklist.missed', null, roles)).toEqual({
      type: 'checklist.missed', enabled: true, push: false, email: false, notifyAssignees: false, notifyCreator: false, roleIds: [MANAGER, ADMIN], leadMinutes: null, resultFilter: null, isDefault: true,
    });
    expect(effectiveRule('checklist.due_soon', null, roles)).toMatchObject({ roleIds: [], leadMinutes: 30, isDefault: true });
    for (const type of RULE_TYPES) expect(effectiveRule(type, null, roles)).toMatchObject({ enabled: DEFAULT_RULES[type].enabled, push: DEFAULT_RULES[type].push });
  });

  it('skips a system role the tenant does not have', () => {
    expect(effectiveRule('problem.critical', null, { bySystemKey: { admin: ADMIN }, ids: new Set([ADMIN]) }).roleIds).toEqual([ADMIN]);
  });

  it('lays the tenant row over the default and drops role ids that no longer exist', () => {
    expect(effectiveRule('task.assigned', row, roles)).toEqual({ type: 'task.assigned', ...row, roleIds: [CUSTOM], resultFilter: null, isDefault: false });
  });

  it('keeps the lead time only where it applies, falling back to the default when a stored one is missing', () => {
    expect(effectiveRule('checklist.due_soon', { ...row, leadMinutes: 120 }, roles).leadMinutes).toBe(120);
    expect(effectiveRule('checklist.due_soon', { ...row, leadMinutes: null }, roles).leadMinutes).toBe(30);
    expect(effectiveRule('checklist.available', { ...row, leadMinutes: 60 }, roles).leadMinutes).toBeNull();
  });
});

describe('ruleIssues', () => {
  const input = { enabled: true, push: true, email: false, notifyAssignees: false, notifyCreator: false, roleIds: [], leadMinutes: null, resultFilter: null };

  it('requires the lead time on due_soon and refuses it elsewhere', () => {
    expect(ruleIssues('checklist.due_soon', input)).toEqual({ leadMinutes: 'notifications.issues.leadMinutesRequired' });
    expect(ruleIssues('checklist.due_soon', { ...input, leadMinutes: 15 })).toEqual({});
    expect(ruleIssues('task.assigned', { ...input, leadMinutes: 15 })).toEqual({ leadMinutes: 'notifications.issues.leadMinutesNotApplicable' });
  });

  it('refuses direct audiences a type does not have', () => {
    expect(ruleIssues('problem.critical', { ...input, notifyAssignees: true, notifyCreator: true })).toEqual({
      notifyAssignees: 'notifications.issues.audienceNotApplicable',
      notifyCreator: 'notifications.issues.audienceNotApplicable',
    });
    expect(ruleIssues('checklist.overdue', { ...input, notifyAssignees: true, notifyCreator: true })).toEqual({ notifyCreator: 'notifications.issues.audienceNotApplicable' });
    expect(ruleIssues('task.overdue', { ...input, notifyAssignees: true, notifyCreator: true })).toEqual({});
  });
});
