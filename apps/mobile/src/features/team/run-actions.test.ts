import type { AuditBrief, ExecutionState, OccurrenceStatus, PermissionKey } from '@taskop/contracts';
import { NO_ACTIONS, type RunActions, runActions } from './run-actions';
import { auditBrief } from './testing/fixtures';

const BOTH: PermissionKey[] = ['reports.view', 'audits.perform', 'executions.correct'];
const AUDITOR: PermissionKey[] = ['reports.view', 'audits.perform'];
const MANAGER: PermissionKey[] = ['reports.view', 'executions.correct'];

describe('runActions (spec §8.2, Part 1 "What the UI may offer")', () => {
  it.each<[string, PermissionKey[], OccurrenceStatus, ExecutionState | null, AuditBrief | null, RunActions]>([
    ['a completed run, both keys', BOTH, 'completed', 'completed', null, { audit: 'start', correct: true, sendBack: true, withdraw: false }],
    ['a run waiting in the audit queue', AUDITOR, 'audit_pending', 'completed', null, { ...NO_ACTIONS, audit: 'start' }],
    ['a run whose audit is in progress', BOTH, 'audit_pending', 'completed', auditBrief(), { audit: 'open', correct: true, sendBack: true, withdraw: false }],
    ['a run whose audit was cancelled', AUDITOR, 'completed', 'completed', auditBrief({ status: 'cancelled' }), { ...NO_ACTIONS, audit: 'start' }],
    ['an audited run is locked: its audit only opens', BOTH, 'audited', 'completed', auditBrief({ status: 'finished', result: 'passed', percent: 100 }), { ...NO_ACTIONS, audit: 'open' }],
    ['a run sent back: withdraw, and the paused audit opens', BOTH, 'correction_required', 'rework', auditBrief({ paused: true }), { ...NO_ACTIONS, audit: 'open', withdraw: true }],
    ['a run sent back, manager only', MANAGER, 'correction_required', 'rework', null, { ...NO_ACTIONS, withdraw: true }],
    ['a partial run', BOTH, 'partial', 'partial', null, NO_ACTIONS],
    ['a run still being done', BOTH, 'in_progress', 'active', null, NO_ACTIONS],
    ['a run nobody executed', BOTH, 'missed', null, null, NO_ACTIONS],
    ['a viewer with neither key', ['reports.view'], 'completed', 'completed', null, NO_ACTIONS],
    ['an auditor cannot correct', AUDITOR, 'completed', 'completed', null, { ...NO_ACTIONS, audit: 'start' }],
    ['a manager cannot audit', MANAGER, 'completed', 'completed', null, { ...NO_ACTIONS, correct: true, sendBack: true }],
  ])('%s', (_name, permissions, status, state, audit, expected) => {
    expect(runActions(permissions, status, state, audit)).toEqual(expected);
  });
});
